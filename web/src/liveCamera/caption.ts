import {handlingRisks,liveFindings,type LiveState} from './model'
export function liveCaption(state:LiveState|null){
 if(!state)return null
 const windowId=state.windows.at(-1)?.windowId
 const recent=state.observations.filter(e=>!windowId||e.windows.includes(windowId))
 const e=recent.filter(e=>e.category!=='other_visible_handling'&&e.category!=='obstruction').at(-1)??recent.at(-1),transfer=state.events.at(-1)
 const cupLabel=(id:string,color?:string)=>id!=='unknown'?id:color&&color!=='unknown'?`${color.toUpperCase()} liquid`:'Unknown cup'
 const risk=handlingRisks(state.observations).find(r=>e&&r.id.endsWith(e.id)&&r.text.startsWith('Possible utensil'))
 if(e&&risk)return {id:e.id,text:`${e.cups.filter(c=>c!=='unknown').join(' + ')||'Cup'} · possible tool carryover`,start:e.startMs,concern:true,detail:'No cleaning observed · review required'}
 if(transfer&&(!e||e.category==='liquid_transfer'||transfer.startMs>= (e.startMs??0)))return {id:transfer.id,text:`${cupLabel(transfer.source,transfer.sourceLiquidColor)} → ${cupLabel(transfer.destination,transfer.destinationLiquidColor)}`,start:transfer.startMs,concern:transfer.uncertain||liveFindings(state).at(-1)?.includes('Possible')===true,detail:transfer.uncertain?'Cup identity uncertain · review required':'Model observation · review required'}
 if(!e)return null
 const cup=e.cups.filter(c=>c!=='unknown').join(' + ')||(e.liquidColor&&e.liquidColor!=='unknown'?`${e.liquidColor.toUpperCase()} liquid`:'Cup')
 const labels:Record<string,string>={mixing:`${cup} mixed`,utensil_contact:`Tool contact · ${cup}`,cleaning_or_rinse:'Cleaning / rinsing observed',spill_or_splash:'Possible spill / splash',appearance_change:`${cup} · appearance changed`,obstruction:'View obstructed',liquid_transfer:'Possible pour · identity unclear',other_visible_handling:'Handling observed'}
 return {id:e.id,text:labels[e.category]||'Observation requires review',start:e.startMs,concern:e.status!=='observed'||['spill_or_splash','obstruction','liquid_transfer'].includes(e.category),detail:'Model observation · review required'}
}
