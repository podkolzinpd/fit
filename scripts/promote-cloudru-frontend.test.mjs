import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const script = readFileSync(new URL('./promote-cloudru-frontend.sh', import.meta.url), 'utf8')
function fixture(overrides, check) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fit-cloudru-promote-')))
  const frontend = join(root, 'frontend')
  const sha = 'a'.repeat(40)
  const candidate = join(frontend, 'candidates', sha + '-1-1')
  const current = join(frontend, 'current')
  const config = join(root, 'nginx', 'fit-frontend-stage.conf')
  const unit = join(root, 'systemd', 'fit-frontend-stage.service')
  const previous = join(frontend, 'previous')
  try {
    for (const directory of [join(candidate, 'site'), previous, join(root, 'nginx'), join(root, 'systemd')]) {
      mkdirSync(directory, { recursive: true })
    }
    writeFileSync(join(candidate, 'stage.conf'), 'new config')
    if (!overrides.FIRST_INSTALL) {
      symlinkSync(previous, current)
      writeFileSync(config, 'previous config')
      writeFileSync(unit, 'previous unit')
    }
    // Explicit return codes matter in an inherited ERR trap: Bash 5.2 can
    // interpret a bare return as the original failed command's status.
    const mocks = String.raw`
node() {
  case "$*" in
    *--serving) test "$FIXTURE_FAIL" != smoke && test "$FIXTURE_FAIL" != rollback; return "$?" ;;
    *) test "$FIXTURE_FAIL" != probe; return "$?" ;;
  esac
}
readlink() {
  "$FIXTURE_NODE" --input-type=module -e 'import { realpathSync } from "node:fs"; console.log(realpathSync(process.argv[1]));' "$2"
}
sudo() {
  if [ "$1" = systemctl ]; then
    shift
    case "$1" in
      is-active|is-enabled) test -z "$FIRST_INSTALL"; return "$?" ;;
      reload)
        if [ "$FIXTURE_FAIL" = reload ] && [ ! -e "$RUNNER_TEMP/failure" ]; then
          touch "$RUNNER_TEMP/failure"; return 1
        fi ;;
      restart)
        printf '%s\n' restored >> "$RUNNER_TEMP/service-calls"
        test "$FIXTURE_FAIL" != rollback; return "$?" ;;
      *) ;;
    esac
    return 0
  elif [ "$1" = nginx ]; then
    if [ "$FIXTURE_FAIL" = syntax ] && [ ! -e "$RUNNER_TEMP/failure" ]; then
      touch "$RUNNER_TEMP/failure"; return 1
    fi
    return 0
  elif [ "$1" = install ]; then
    shift 3
    if [ "$1" = infra/cloudru/fit-frontend-stage.service ]; then
      printf '%s' 'new unit' > "$2"
    else
      command cp "$1" "$2"
    fi
  elif [ "$1" = mv ]; then
    "$FIXTURE_NODE" --input-type=module -e 'import { renameSync } from "node:fs"; renameSync(process.argv[1], process.argv[2]);' "$3" "$4"
  else
    command "$@"
  fi
}
`
    const rewritten = script.replaceAll('/opt/fit/frontend', frontend)
      .replaceAll('/etc/nginx/fit-frontend-stage.conf', config)
      .replaceAll('/etc/systemd/system/fit-frontend-stage.service', unit)
    const result = spawnSync('bash', ['-c', mocks + '\n' + rewritten, 'fixture', 'release.json', candidate, sha], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: root, FIXTURE_NODE: process.execPath, FIXTURE_FAIL: '', FIRST_INSTALL: '', ...overrides },
    })
    check({ result, current, previous, candidate, config, unit, root })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('verified frontend advances the pointer only after a successful serving check', () => {
  fixture({}, ({ result, current, candidate, config, unit }) => {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readlinkSync(current), join(candidate, 'site'))
    assert.equal(readFileSync(config, 'utf8'), 'new config')
    assert.equal(readFileSync(unit, 'utf8'), 'new unit')
  })
})

for (const failure of ['probe', 'syntax', 'reload', 'smoke']) {
  test('failed ' + failure + ' preserves or restores the previous pointer, config and service', () => {
    fixture({ FIXTURE_FAIL: failure }, ({ result, current, previous, config, unit, root }) => {
      assert.notEqual(result.status, 0)
      assert.equal(readlinkSync(current), previous)
      assert.equal(readFileSync(config, 'utf8'), 'previous config')
      assert.equal(readFileSync(unit, 'utf8'), 'previous unit')
      if (failure !== 'probe') {
        assert.match(result.stderr, /Previous frontend configuration and serving pointer restored/)
        assert.equal(readFileSync(join(root, 'service-calls'), 'utf8'), 'restored\n')
      }
    })
  })
}

test('first install failing serving check removes only its newly created pointer and service', () => {
  fixture({ FIRST_INSTALL: 'true', FIXTURE_FAIL: 'smoke' }, ({ result, current, candidate, config, unit }) => {
    assert.notEqual(result.status, 0)
    for (const path of [current, config, unit]) assert.equal(existsSync(path), false)
    assert.equal(readFileSync(join(candidate, 'stage.conf'), 'utf8'), 'new config')
    assert.match(result.stderr, /Previous frontend configuration and serving pointer restored/)
  })
})

test('failure to restart the old service is reported as failed rollback, never as success', () => {
  fixture({ FIXTURE_FAIL: 'rollback' }, ({ result, current, previous, config }) => {
    assert.notEqual(result.status, 0)
    assert.equal(readlinkSync(current), previous)
    assert.equal(readFileSync(config, 'utf8'), 'previous config')
    assert.match(result.stderr, /Frontend rollback failed/)
    assert.doesNotMatch(result.stderr, /serving pointer restored/)
  })
})

test('promotion never modifies public ingress, API containers, DNS, data or saved releases', () => {
  assert.doesNotMatch(script, /sites-enabled|certbot|podman|psql|pg_restore|dns|rm -rf|rm -r /)
  assert.match(script, /trap 'rollback \$\?' ERR/)
  assert.ok(script.indexOf('verify-cloudru-frontend.mjs') < script.indexOf("trap 'rollback"))
  assert.equal(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status, 0)
})
