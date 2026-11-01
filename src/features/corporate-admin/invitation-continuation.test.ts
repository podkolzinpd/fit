import {describe,expect,it} from 'vitest'
import {captureCorporateInvitation} from './invitation-continuation'
const token='a'.repeat(43)
describe('corporate invitation continuation',()=>{
 it('retains an opaque invitation across login without accepting it',()=>{
  sessionStorage.clear()
  expect(captureCorporateInvitation(`#token=${token}`,sessionStorage,1000)).toEqual({token,persisted:true})
  expect(captureCorporateInvitation('',sessionStorage,2000)).toEqual({token,persisted:true})
  expect(captureCorporateInvitation('',sessionStorage,2*60*60*1000+1001).token).toBeNull()
 })
 it('rejects malformed or duplicate secrets and preserves the link when storage is unavailable',()=>{
  for(const hash of ['#token=bad',`#token=${token}&token=${token}`,`#token=${token}&extra=1`])expect(captureCorporateInvitation(hash,undefined).token).toBeNull()
  expect(captureCorporateInvitation(`#token=${token}`,undefined)).toEqual({token,persisted:false})
 })
})
