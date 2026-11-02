const key='fit.corporate-invitation.v1'
const pattern=/^[a-zA-Z0-9_-]{43}$/
const maxAge=2*60*60*1000
export function captureCorporateInvitation(hash:string,storage:Storage|undefined,now=Date.now()):{token:string|null;persisted:boolean} {
  const params=new URLSearchParams(hash.replace(/^#/,''))
  if (hash) {
    const token=params.get('token')
    if ([...params.keys()].length!==1 || !token || !pattern.test(token)) return {token:null,persisted:false}
    try {if(storage){storage.setItem(key,JSON.stringify({token,savedAt:now}));return {token,persisted:true}}}catch{/* Keep the original link when storage is unavailable. */}
    return {token,persisted:false}
  }
  try {
    const saved:unknown=JSON.parse(storage?.getItem(key)??'null')
    if (typeof saved==='object'&&saved!==null&&'token' in saved&&'savedAt' in saved&&typeof saved.token==='string'&&pattern.test(saved.token)&&typeof saved.savedAt==='number'&&saved.savedAt<=now+60_000&&now-saved.savedAt<=maxAge) return {token:saved.token,persisted:true}
    storage?.removeItem(key)
  }catch{/* Storage failure must not create or accept an invitation. */}
  return {token:null,persisted:false}
}
