import { createSign, createVerify } from 'node:crypto'

const maxClockSkewSeconds = 300

export function signLlmGatewayRequest(body: string, privateKey: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signer = createSign('RSA-SHA256')
  signer.update(`${timestamp}\n${body}`)
  signer.end()
  return { timestamp, signature: signer.sign(privateKey).toString('base64url') }
}

export function verifyLlmGatewayRequest(body: string, timestamp: string | undefined, signature: string | undefined, publicKey: string): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isSafeInteger(Number(timestamp)) || age > maxClockSkewSeconds) return false
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${timestamp}\n${body}`)
  verifier.end()
  try {
    return verifier.verify(publicKey, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}
