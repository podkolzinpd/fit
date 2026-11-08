import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

// Exact upstream release assets, independently checked against their SHA256SUMS.
// API asset downloads avoid the failing github.com browser-download redirect.
export const officialTools = Object.freeze({
  gradle: { url: 'https://api.github.com/repos/gradle/gradle-distributions/releases/assets/269969098?download=complete', size: 224584249, sha256: 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c' },
  terraform: { url: 'https://api.github.com/repos/yandex-cloud/terraform-provider-yandex/releases/assets/471147237?download=complete', size: 30461414, sha256: '214ac0a04a4f31ee0e3eb04ab1db9213c3ecaee9d4ebfd3d05b57399081c9d25' },
})

// This existing Capacitor dependency is byte-identical in Maven Central and the
// official Kotlin release. The release asset publishes this SHA256; Maven's
// published SHA1 was independently checked against those complete bytes.
export const kotlinCompiler = Object.freeze({
  url: 'https://api.github.com/repos/JetBrains/kotlin/releases/assets/587823233?download=complete',
  size: 58272093,
  sha256: '9fa8cdd1de0dccffe154c997d423ec6b5f53cd6d9177e3a77a9b0de03fb1bc81',
  sha1: '79346ed53db48b18312a472602eb5c057070c54d',
})

export const kotlinCompilerPom = Object.freeze({
  url: 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-compiler-embeddable/2.0.21/kotlin-compiler-embeddable-2.0.21.pom',
  size: 2666,
  sha256: 'bd4656a46ec418252e5bc5e1c20eb2029fb2a8e0e3cc94eeddfac7e87c8cd5b6',
})

export function gradleKotlinInit(repository) {
  // Exclusive content affects this one existing module only. Its original POM
  // retains every transitive dependency; all other resolution stays unchanged.
  const uri = pathToFileURL(resolve(repository)).href.replaceAll("'", "%27")
  return `def verifiedCompilerRepository = { repositories ->
    repositories.exclusiveContent {
        forRepository {
            repositories.maven {
                url = java.net.URI.create('${uri}')
                metadataSources { mavenPom() }
            }
        }
        filter { includeVersion('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.0.21') }
    }
}
gradle.beforeProject { project ->
    verifiedCompilerRepository(project.buildscript.repositories)
    verifiedCompilerRepository(project.repositories)
}
`
}

async function verifyFile(path, spec) {
  if ((await stat(path)).size !== spec.size) throw new Error('Official tool size mismatch')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== spec.sha256) throw new Error('Official tool SHA256 mismatch')
}

export async function downloadVerifiedAsset(spec, destination, fetchAsset = fetch) {
  try { await verifyFile(destination, spec); return destination }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.part`
  let file
  try {
    const response = await fetchAsset(spec.url, {
      headers: { Accept: 'application/octet-stream', ...(new URL(spec.url).hostname === 'api.github.com' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) },
      signal: AbortSignal.timeout(120_000),
    })
    if (response.status !== 200 || !response.body) throw new Error(`Official tool download failed: HTTP ${response.status}`)
    file = await open(temporary, 'wx', 0o600)
    let size = 0
    const hash = createHash('sha256')
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > spec.size) throw new Error('Official tool size mismatch')
      hash.update(chunk)
      await file.writeFile(chunk)
    }
    if (size !== spec.size) throw new Error('Official tool size mismatch')
    if (hash.digest('hex') !== spec.sha256) throw new Error('Official tool SHA256 mismatch')
    await file.close(); file = undefined
    await rename(temporary, destination)
    return destination
  } finally {
    if (file) await file.close()
    await rm(temporary, { force: true })
  }
}

export function gradleCacheZip(properties, gradleHome) {
  const url = 'https://services.gradle.org/distributions/gradle-8.14.3-all.zip'
  const configured = /^distributionUrl=(.+)$/m.exec(properties)?.[1].replaceAll('\\:', ':').trim()
  const settings = Object.fromEntries(properties.split(/\r?\n/).filter(line => line.includes('=')).map(line => line.split('=')))
  if (configured !== url || settings.distributionBase !== 'GRADLE_USER_HOME' || settings.zipStoreBase !== 'GRADLE_USER_HOME'
    || settings.distributionPath !== 'wrapper/dists' || settings.zipStorePath !== 'wrapper/dists') throw new Error('Unreviewed Gradle distribution configuration')
  // Gradle v8.14.3 PathAssembler uses MD5/base36 only for this directory name.
  // Archive integrity is always SHA256 above; no wrapper .ok marker is created.
  const key = BigInt(`0x${createHash('md5').update(url).digest('hex')}`).toString(36)
  return join(gradleHome, 'wrapper/dists/gradle-8.14.3-all', key, 'gradle-8.14.3-all.zip')
}

export async function prepareOfficialCiTool(mode, { root = process.cwd(), gradleHome = process.env.GRADLE_USER_HOME || join(homedir(), '.gradle'), temporaryRoot = process.env.RUNNER_TEMP, pluginRoot, fetchAsset = fetch } = {}) {
  if (mode === 'gradle') {
    if (!temporaryRoot) throw new Error('Gradle CI preparation requires a temporary runner directory')
    const properties = await readFile(join(root, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8')
    const archive = await downloadVerifiedAsset(officialTools.gradle, gradleCacheZip(properties, gradleHome), fetchAsset)
    const repository = join(temporaryRoot, 'fit-ci-kotlin-maven')
    const module = join(repository, 'org/jetbrains/kotlin/kotlin-compiler-embeddable/2.0.21/kotlin-compiler-embeddable-2.0.21')
    await downloadVerifiedAsset(kotlinCompiler, `${module}.jar`, fetchAsset)
    await downloadVerifiedAsset(kotlinCompilerPom, `${module}.pom`, fetchAsset)
    await writeFile(join(temporaryRoot, 'fit-ci-kotlin.init.gradle'), gradleKotlinInit(repository), { mode: 0o600 })
    return archive
  }
  if (mode !== 'terraform' || !pluginRoot) throw new Error('Expected gradle or terraform with a temporary plugin directory')
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Terraform CI provider requires linux/amd64')
  const archive = await downloadVerifiedAsset(officialTools.terraform, join(pluginRoot, 'terraform-provider-yandex_0.215.0_linux_amd64.zip'), fetchAsset)
  const directory = join(pluginRoot, 'registry.terraform.io/yandex-cloud/yandex/0.215.0/linux_amd64')
  await mkdir(directory, { recursive: true })
  const result = spawnSync('unzip', ['-j', '-o', archive, 'terraform-provider-yandex_v0.215.0', '-d', directory], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error('Cannot extract verified Terraform provider')
  await chmod(join(directory, 'terraform-provider-yandex_v0.215.0'), 0o755)
  return directory
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareOfficialCiTool(process.argv[2], { pluginRoot: process.argv[3] })
  console.log(`Verified official CI tool: ${process.argv[2]}`)
}
