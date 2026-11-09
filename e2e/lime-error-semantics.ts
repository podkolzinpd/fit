import {expect,type Locator} from '@playwright/test'

/** Resolve existing danger in the message's inherited theme; no new color token. */
export async function captureLimeErrorSemantics(error:Locator){
  return error.evaluate(element=>{
    const probe=document.createElement('span')
    probe.style.color='var(--danger)'
    element.append(probe)
    const danger=getComputedStyle(probe).color
    probe.remove()
    const messages=[element,...element.querySelectorAll('p')].map(node=>{
      const css=getComputedStyle(node),rect=node.getBoundingClientRect()
      return {tag:node.tagName,class:node.getAttribute('class'),color:css.color,
        style:Object.fromEntries(Array.from(css).map(property=>[property,css.getPropertyValue(property)])),
        rect:[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value*100)/100)}
    })
    const active=document.activeElement
    return {danger,messages,focus:active?{tag:active.tagName,class:active.className}:null,
      scroll:Array.from(document.querySelectorAll('.content')).map(node=>({x:node.scrollLeft,y:node.scrollTop,height:node.scrollHeight,client:node.clientHeight}))}
  })
}

export function expectLimeErrorSemantics(result:Awaited<ReturnType<typeof captureLimeErrorSemantics>>){
  expect(result.danger).toMatch(/^rgb/)
  expect(result.messages.length).toBeGreaterThan(0)
  expect(result.messages.map(message=>message.color)).toEqual(result.messages.map(()=>result.danger))
}
