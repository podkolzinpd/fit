// Issue only synthetic five-minute room credentials, encrypted to an ephemeral public key.
import { readFileSync } from 'node:fs'
import { createCipheriv, createHmac, createPublicKey, publicEncrypt, randomBytes, randomUUID } from 'node:crypto'

const publicKey = createPublicKey(process.env.QA_PUBLIC_KEY)
if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Invalid QA public key')
const settings = Object.fromEntries(readFileSync('/opt/fit-jitsi/.env', 'utf8').trim().split('\n').map(line => {
  const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)]
}))
const room = `fit-${randomUUID()}`
const issued = Math.floor(Date.now() / 1000)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
function token() {
  const unsigned = `${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'fit',aud:'jitsi',sub:'meet.jitsi',room,iat:issued,nbf:issued-5,exp:issued+300,
    context:{user:{id:randomUUID(),name:'Fit infrastructure probe'}}})}`
  return `${unsigned}.${createHmac('sha256',settings.JWT_APP_SECRET).update(unsigned).digest('base64url')}`
}
const payload = {origin:'https://api.fit-training.ru',domain:'meet.jitsi',muc:'muc.meet.jitsi',room,tokens:[token(),token()],expiresAt:issued+300}
const key = randomBytes(32)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm',key,iv)
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()])
console.log(JSON.stringify({key:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}))
