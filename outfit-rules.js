// Pure scene facts and clothing rules. No model, storage or DOM access.
import {itemTraits} from './wardrobe.js';

const PEOPLE=['character','persona'];
const CATEGORIES=['상의','하의','속옷','신발','겉옷','소품'];
const VALUES={
 location:['unknown','home','outside','work','school','hospital','other'],
 space:['unknown','private','public'],
 phase:['unknown','resting','washing','after_washing','sleeping','preparing','outdoors','working','formal','care'],
 season:['unknown','spring','summer','autumn','winter'],
 weather:['unknown','mild','hot','cold','rain','snow'],
 purpose:['unknown','casual','work','formal','care'],
 exception:['','barefoot','undressed','keep'],
};
const short=(value,max=80)=>typeof value==='string'?value.trim().slice(0,max):'';
export function emptyContext(){return {location:'unknown',space:'unknown',phase:'unknown',conditions:[],needs:[],season:'unknown',temperature:null,weather:'unknown',purpose:'unknown',exception:''};}
export function normalizeContext(value={}){
 const context=emptyContext();
 for(const [key,values] of Object.entries(VALUES))if(values.includes(value[key]))context[key]=value[key];
 for(const key of ['conditions','needs'])context[key]=[...new Set((Array.isArray(value[key])?value[key]:[]).map(s=>short(s)).filter(Boolean))].slice(0,4);
 if(typeof value.temperature==='number'&&Number.isFinite(value.temperature)&&value.temperature>=-80&&value.temperature<=65)context.temperature=value.temperature;
 return context;
}
export function ensureContexts(state){
 for(const who of ['character','persona'])if(state?.people?.[who])state.people[who].context=normalizeContext(state.people[who].context);
 return state;
}

const fail=()=>{throw Error('장면 판독 형식이 맞지 않습니다. 기존 착장은 유지됩니다.');};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function keysOnly(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail();}
export function validateSceneFacts(raw){
 keysOnly(raw,['changes','scene','sceneKo']);keysOnly(raw.changes,PEOPLE);
 const result={changes:{}};
 for(const who of PEOPLE){
  const change=raw.changes[who];if(change===undefined)continue;
  keysOnly(change,['context','actions','transition']);const next={context:{},actions:[]};
  if(change.transition!==undefined){if(typeof change.transition!=='boolean')fail();next.transition=change.transition;}
  if(change.context!==undefined){
   keysOnly(change.context,[...Object.keys(VALUES),'conditions','needs','temperature']);
   for(const [key,value] of Object.entries(change.context)){
    if(VALUES[key]){if(!VALUES[key].includes(value))fail();}
    else if(key==='temperature'){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value< -80||value>65))fail();}
    else if(!Array.isArray(value)||value.length>4||value.some(v=>typeof v!=='string'||!v.trim()||v.length>80||/[가-힣]/.test(v)))fail();
    next.context[key]=structuredClone(value);
   }
  }
  if(change.actions!==undefined){
   if(!Array.isArray(change.actions)||change.actions.length>8)fail();
   next.actions=change.actions.map(action=>{
    keysOnly(action,['op','category','name','color','brand','wearing','wearingKo','layer']);
    if(!['wear','remove','adjust','nude'].includes(action.op))fail();
    if(action.op!=='nude'&&!CATEGORIES.includes(action.category))fail();
    for(const key of ['name','color','brand','wearing'])if(action[key]!==undefined&&(typeof action[key]!=='string'||action[key].length>80||/[가-힣]/.test(action[key])))fail();
    if(action.wearingKo!==undefined&&(typeof action.wearingKo!=='string'||action.wearingKo.length>50||/[A-Za-z]/.test(action.wearingKo)))fail();
    if(action.layer!==undefined&&typeof action.layer!=='boolean')fail();
    if(action.op==='wear'&&!short(action.name))fail();
    if(action.op==='adjust'&&typeof action.wearing!=='string')fail();
    if(action.op==='nude'&&Object.keys(action).some(key=>key!=='op'))fail();
    return structuredClone(action);
   });
   if(next.actions.some(a=>a.op==='nude')&&next.actions.some(a=>a.op==='wear'||a.op==='adjust'))fail();
  }
  result.changes[who]=next;
 }
 for(const field of ['scene','sceneKo'])if(raw[field]!==undefined){
  keysOnly(raw[field],['time','place','activity','weather']);result[field]={};
  for(const [key,value] of Object.entries(raw[field])){if(typeof value!=='string'||value.length>100||field==='scene'&&/[가-힣]/.test(value)||field==='sceneKo'&&/[A-Za-z]/.test(value))fail();result[field][key]=value.trim();}
 }
 return result;
}

export function patchContext(previous,patch={}){
 const next=normalizeContext(previous);
 const moved=['location','space','phase'].some(key=>patch[key]&&patch[key]!=='unknown'&&patch[key]!==next[key]);
 if(moved)next.exception='';
 for(const [key,value] of Object.entries(patch)){
  if(value==='unknown')continue;
  next[key]=structuredClone(value);
 }
 return next;
}

function tokens(value){return short(value,200).toLowerCase().replace(/\b(?:pants|slacks)\b/g,'trousers').replace(/\b(?:sneaker|trainer)s?\b/g,'sneakers').replace(/\b(?:underpants|underwear|panties)\b/g,'briefs').split(/[^a-z0-9]+/).filter(Boolean);}
function sameGarment(item,action){
 if(item.category!==action.category)return false;
 for(const key of ['color','brand'])if(action[key]&&short(item[key]).toLowerCase()!==action[key].toLowerCase())return false;
 const needle=tokens(action.name);if(!needle.length)return true;
 const haystack=tokens(item.name);return needle.every(word=>haystack.includes(word));
}
const regularBriefs=item=>item.category==='속옷'&&!/\b(?:sock|stocking|bra|undershirt|vest)\b/i.test(item.name||'')&&!/\b(?:socks|stockings)\b/i.test(item.name||'');
function slot(item){
 if(item.category==='속옷'){const name=item.name||'';if(/\b(?:socks?|stockings?)\b/i.test(name))return 'socks';if(/\bbra\b/i.test(name))return 'bra';if(/\b(?:undershirt|vest)\b/i.test(name))return 'undershirt';return 'briefs';}
 if(item.category==='소품')return tokens(item.name).at(-1)||item.id;
 return item.category;
}
function clothingNeeds(context){
 const conditions=context.conditions.join(' ').toLowerCase(),needs=[...context.needs];
 if(/late pregnancy|third trimester|[7-9] months? pregnant|(?:2[89]|3\d|40) weeks? pregnant/.test(conditions))needs.push('Avoid waist pressure');
 if(/arm.{0,15}(?:cast|immobili[sz]ed)|(?:cast|immobili[sz]ed).{0,15}arm/.test(conditions))needs.push('Arm access');
 return needs.join(' ').toLowerCase();
}
function unsuitable(item,context){
 const traits=itemTraits(item),needs=clothingNeeds(context),description=[item.name,...(item.features||[])].join(' ').toLowerCase();
 if(/waist|abdomen|belly/.test(needs)&&/tight|slim|compression|rigid|non.stretch/.test(description)&&!traits.fit.some(v=>['loose','adjustable','maternity'].includes(v)))return true;
 if(/loose fit|no pressure/.test(needs)&&/tight|slim|compression/.test(description)&&!traits.fit.includes('loose'))return true;
 if(/flat shoe|low heel|no heel|balance/.test(needs)&&/high.heel|stiletto/.test(description))return true;
 if(/front.open|arm access/.test(needs)&&/pullover|turtleneck/.test(description)&&!traits.fit.includes('front_opening'))return true;
 if(context.purpose==='formal'&&traits.use.includes('casual')&&!traits.use.includes('formal'))return true;
 return false;
}
function score(item,context,preferred){
 const traits=itemTraits(item);let value=preferred.includes(item.id)?12:0;
 if(context.purpose!=='unknown'&&traits.use.includes(context.purpose))value+=6;
 if(context.location==='home'&&context.phase==='resting'){if(traits.use.includes('home'))value+=6;else if(traits.use.includes('casual'))value+=3;}
 if(context.phase==='working'&&traits.use.includes('work'))value+=6;
 if(context.phase==='formal'&&traits.use.includes('formal'))value+=6;
 if(traits.climate.includes(context.weather))value+=4;
 if(context.season==='winter'&&traits.climate.includes('cold'))value+=3;
 if(context.season==='summer'&&traits.climate.includes('hot'))value+=3;
 const needs=clothingNeeds(context);
 if(/waist|abdomen|belly/.test(needs)&&traits.fit.some(v=>['loose','adjustable','maternity'].includes(v)))value+=8;
 if(/front.open|arm access/.test(needs)&&traits.fit.includes('front_opening'))value+=8;
 if(/flat shoe|low heel|no heel|balance/.test(needs)&&traits.fit.includes('flat'))value+=8;
 return value;
}

// A proposed result stays local until all missing garments are generated and validated.
export function resolveOutfit(baseline,facts,wardrobes,memory={},policies={}){
 const state=ensureContexts(structuredClone(baseline)),missing=[];
 if(facts.scene)Object.assign(state.scene,facts.scene);
 if(facts.sceneKo)state.sceneKo={...(state.sceneKo||{}),...facts.sceneKo};
 for(const who of PEOPLE){
  const change=facts.changes[who];if(!change)continue;
  const person=state.people[who],before=normalizeContext(person.context),context=patchContext(before,change.context);person.context=context;
  if(change.transition&&change.context.exception===undefined)context.exception='';
  const exceptions=policies[who]?.wardrobeExceptions||{},categoryKeys={'상의':'top','하의':'bottom','속옷':'underwear','신발':'footwear','겉옷':'outerwear','소품':'accessory'};
  const owned=(wardrobes[who]||[]).filter(item=>item.available!==false),protectedIds=new Set(),blocked=new Set();
  const preferred=[...(memory[who]?.beforeUndress||[]),...(memory[who]?.lastDressed||[])];
  const choose=(category,predicate=()=>true)=>owned.filter(item=>item.category===category&&!blocked.has(item.id)&&!itemTraits(item).temporary&&!unsuitable(item,context)&&predicate(item)).sort((a,b)=>score(b,context,preferred)-score(a,context,preferred)||a.id.localeCompare(b.id))[0];
  const need=(category,reason,extra={})=>{if(!missing.some(item=>item.who===who&&item.category===category&&item.reason===reason&&item.name===extra.name))missing.push({who,category,reason,...extra});};
  const wear=(item,{layer=false,wearing,wearingKo}={})=>{
   const current=person.items.find(value=>value.id===item.id);
   if(!layer)person.items=person.items.filter(value=>value.id===item.id||slot(value)!==slot(item));
   const next=structuredClone(item);delete next.wearing;delete next.wearingKo;
   if(wearing){next.wearing=wearing;if(wearingKo)next.wearingKo=wearingKo;}
   else if(wearing===undefined&&current){if(current.wearing)next.wearing=current.wearing;if(current.wearingKo)next.wearingKo=current.wearingKo;}
   const index=person.items.findIndex(value=>value.id===item.id);if(index<0)person.items.push(next);else person.items[index]=next;person.nude=false;
  };
  for(const action of change.actions||[]){
   if(action.op==='nude'){for(const item of person.items)blocked.add(item.id);person.items=[];person.nude=true;blocked.add('all');continue;}
   const worn=person.items.filter(item=>sameGarment(item,action));
   if(action.op==='remove'){
    if(!worn.length&&action.name)continue;
    for(const item of worn)blocked.add(item.id);blocked.add(action.category);
    person.items=person.items.filter(item=>!worn.includes(item));continue;
   }
   if(action.op==='adjust'){
    // Never guess which of several garments was adjusted.
    if(worn.length===1){worn[0].wearing=action.wearing;if(action.wearingKo)worn[0].wearingKo=action.wearingKo;else delete worn[0].wearingKo;protectedIds.add(worn[0].id);}continue;
   }
   const matched=person.items.find(item=>sameGarment(item,action))||owned.find(item=>sameGarment(item,action)&&item.name.toLowerCase()===action.name.toLowerCase())||owned.find(item=>sameGarment(item,action));
   if(matched){wear(matched,action);protectedIds.add(matched.id);}
   else need(action.category,'explicit',{name:action.name,color:action.color||'',brand:action.brand||'',wearing:action.wearing||'',wearingKo:action.wearingKo||'',layer:!!action.layer});
  }
  const relevant=Object.keys(change.context||{}).some(key=>JSON.stringify(before[key])!==JSON.stringify(context[key]));
  const publicPlace=context.space==='public'||['outside','work','school'].includes(context.location);
  const completed=publicPlace&&['outdoors','working','formal'].includes(context.phase);
  const publicTransition=completed&&(change.transition||relevant&&(['location','space','phase'].some(key=>before[key]!==context[key])||before.exception!==context.exception&&!context.exception));
  const privatePhase=['washing','after_washing','sleeping'].includes(context.phase);
  const bootstrap=before.location==='unknown'&&context.location!=='unknown'&&context.phase!=='care'&&!person.nude&&!person.items.some(item=>['upper','lower','full'].includes(itemTraits(item).coverage))&&owned.some(item=>['upper','full'].includes(itemTraits(item).coverage)&&!itemTraits(item).temporary);
  if(context.phase==='washing'&&before.phase!=='washing'&&context.exception!=='keep'&&!protectedIds.size&&!missing.some(item=>item.who===who&&item.reason==='explicit')){person.items=[];person.nude=true;continue;}
  if(context.exception==='keep'||context.exception==='undressed'||blocked.has('all')||privatePhase)continue;
  if(!relevant&&!publicTransition)continue;
  // Change existing pieces only when a newly established requirement makes them unsuitable.
  for(const current of [...person.items]){
   if(protectedIds.has(current.id)||blocked.has(current.category)||!unsuitable(current,context))continue;
   const candidate=choose(current.category,item=>item.id!==current.id&&slot(item)===slot(current));
   if(candidate)wear(candidate);else need(current.category,'suitability',current.category==='속옷'?{slot:slot(current)}:{});
  }
  if(publicTransition||bootstrap){
   const incomplete=person.nude||!person.items.some(item=>['upper','full'].includes(itemTraits(item).coverage)&&!itemTraits(item).temporary);
   if(incomplete){
    const restore=memory[who]?.beforeUndress?.length?memory[who].beforeUndress:memory[who]?.lastDressed||[];
    for(const id of restore){
     const item=owned.find(value=>value.id===id);
     if(!item||blocked.has(item.category)||exceptions[categoryKeys[item.category]]||itemTraits(item).temporary||unsuitable(item,context)||item.category==='신발'&&context.exception==='barefoot')continue;
     if(person.items.some(worn=>protectedIds.has(worn.id)&&slot(worn)===slot(item)))continue;
     if(!person.items.some(worn=>slot(worn)===slot(item)))wear(item);
    }
   }
   const full=()=>person.items.some(item=>itemTraits(item).coverage==='full'&&(!itemTraits(item).temporary||protectedIds.has(item.id)));
   for(const category of ['상의','하의','속옷','신발']){
    if(category==='신발'&&!publicPlace)continue;
    if(blocked.has(category)||exceptions[categoryKeys[category]]||category==='신발'&&context.exception==='barefoot')continue;
    const exists=category==='속옷'?person.items.some(regularBriefs):person.items.some(item=>item.category===category&&(!itemTraits(item).temporary||protectedIds.has(item.id)));
    if(exists||['상의','하의'].includes(category)&&full())continue;
    const candidate=choose(category,category==='속옷'?regularBriefs:()=>true);
    if(candidate)wear(candidate);else need(category,'public_coverage');
   }
   // Temporary towels/gowns cannot silently become a permanent outdoor outfit.
   if(person.items.some(item=>['상의','하의'].includes(item.category)&&!itemTraits(item).temporary))person.items=person.items.filter(item=>!itemTraits(item).temporary||protectedIds.has(item.id));
  }
  const cold=context.temperature!==null?context.temperature<12:context.weather==='cold'||context.weather==='snow'||context.season==='winter';
  const hot=context.temperature!==null?context.temperature>=26:context.weather==='hot';
  if(completed&&cold&&relevant&&!blocked.has('겉옷')&&!exceptions.outerwear&&!person.items.some(item=>item.category==='겉옷')){const candidate=choose('겉옷');if(candidate)wear(candidate);else need('겉옷','cold');}
  if(completed&&hot&&relevant)person.items=person.items.filter(item=>item.category!=='겉옷'||!itemTraits(item).climate.includes('cold')||protectedIds.has(item.id));
  if(person.items.length)person.nude=false;
 }
 if(missing.length>12)fail();
 return {state,missing};
}

export function sceneRequest(baseline,messages,contextMessages=[],names={}){
 const compact=context=>Object.fromEntries(Object.entries(normalizeContext(context)).filter(([,value])=>value!==null&&value!==''&&value!=='unknown'&&(!Array.isArray(value)||value.length)));
 return {people:Object.fromEntries(PEOPLE.map(who=>[who,{...(names[who]?{name:names[who]}:{}),context:compact(baseline.people[who].context),worn:baseline.people[who].items.map(({name,color,brand})=>({name,color,brand})),nude:baseline.people[who].nude}])),contextMessages,messages};
}
