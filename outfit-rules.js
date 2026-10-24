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
 for(const key of ['conditions','needs'])context[key]=[...new Set((Array.isArray(value[key])?value[key]:[]).map(s=>short(s,240)).filter(Boolean))].slice(0,12);
 if(typeof value.temperature==='number'&&Number.isFinite(value.temperature)&&value.temperature>=-80&&value.temperature<=65)context.temperature=value.temperature;
 return context;
}
export function ensureContexts(state){
 for(const who of ['character','persona'])if(state?.people?.[who])state.people[who].context=normalizeContext(state.people[who].context);
 return state;
}

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const word=value=>typeof value==='string'?value.trim().toLowerCase().replace(/[\s-]+/g,'_').replace(/[.!,:;]+$/,''):'';
const aliases={
 location:{house:'home',at_home:'home',outdoor:'outside',outdoors:'outside',office:'work',workplace:'work'},
 space:{indoors_private:'private',private_space:'private',public_space:'public'},
 phase:{rest:'resting',relaxing:'resting',bathing:'washing',showering:'washing',after_shower:'after_washing',after_bathing:'after_washing',asleep:'sleeping',preparation:'preparing',outdoor:'outdoors',work:'working',party:'formal',inpatient_care:'care'},
 season:{fall:'autumn'},weather:{raining:'rain',rainy:'rain',snowing:'snow',snowy:'snow'},
 purpose:{everyday:'casual',business:'work',party:'formal',medical_care:'care'},
 exception:{none:'',no_exception:'',nude:'undressed',naked:'undressed'},
 category:{top:'상의',tops:'상의',shirt:'상의',bottom:'하의',bottoms:'하의',pants:'하의',underwear:'속옷',footwear:'신발',shoes:'신발',shoe:'신발',outerwear:'겉옷',coat:'겉옷',accessory:'소품',accessories:'소품',props:'소품'},
 op:{put_on:'wear',wears:'wear',putting_on:'wear',take_off:'remove',took_off:'remove',removed:'remove',remove_clothing:'remove',roll_up:'adjust',adjusted:'adjust',undress:'nude',undressed:'nude',naked:'nude',fully_nude:'nude'},
 key:{physical_conditions:'conditions',physical_state:'conditions',clothing_needs:'needs',clothing_constraints:'needs',temp:'temperature',location_type:'location',activity_phase:'phase',operation:'op',action:'op',type:'op',garment:'name',item_name:'name',wearing_state:'wearing',wearing_ko:'wearingKo',sceneko:'sceneKo',scene_ko:'sceneKo'},
};
const bool=value=>typeof value==='boolean'?value:['true','yes','1'].includes(word(String(value)))?true:['false','no','0'].includes(word(String(value)))?false:undefined;
function canonicalObject(value){return object(value)?Object.fromEntries(Object.entries(value).map(([key,v])=>[aliases.key[word(key)]||[...Object.keys(VALUES),'changes','people','characters','context','state','actions','events','transition','category','op','name','color','brand','wearing','wearingKo','layer','scene','sceneKo','time','place','activity','reason','reasoning','confidence','noChange','status','result','data','conditions','needs','temperature'].find(v=>word(v)===word(key))||key,v])):{};}
export function normalizeSceneResponse(raw,{names={}}={}){
 const facts={changes:{}},adjustments=[],unresolved=[];
 const note=(path,input,output)=>{if(JSON.stringify(input)!==JSON.stringify(output))adjustments.push({path,input,output});};
 const unknown=(path,value,reason='meaning unclear')=>unresolved.push({path,value,reason});
 const enumValue=(key,value,path)=>{
  const token=word(value),next=aliases[key]?.[token]??token;
  if(VALUES[key]?.includes(next)||key==='category'&&CATEGORIES.includes(next)||key==='op'&&['wear','remove','adjust','nude'].includes(next)){note(path,value,next);return next;}
  if(value!==null&&value!==undefined&&value!=='')unknown(path,value);
 };
 const whoFor=value=>{const token=word(value);return ['character','char','캐릭터'].includes(token)||names.character&&token===word(names.character)?'character':['persona','user','페르소나','펠소'].includes(token)||names.persona&&token===word(names.persona)?'persona':null;};
 let root=raw,explicitNoChange=false;
 if(typeof raw==='string'){
  explicitNoChange=/^(?:no (?:changes?|clothing changes?)(?: detected)?|unchanged|변화 없음)[.!]?\s*$/i.test(raw.trim());
  const people={};let who;
  for(const line of raw.split(/\r?\n/)){
   if(/^<\/(?:character|persona)>$/i.test(line.trim())){who=null;continue;}
   const match=line.trim().match(/^[<\[*#\s]*([^:：=<>\]]+)[\]>]*\s*[:：=]\s*(.*?)\s*(?:<\/[^>]+>)?$/);
   if(!match)continue;
   const actor=whoFor(match[1]);if(actor){who=actor;people[who]??={};if(match[2])unknown(who,match[2],'unstructured actor description');continue;}
   const key=word(match[1]);if(who)people[who][key]=match[2];
  }
  root={changes:people};
  if(!Object.keys(people).length&&!explicitNoChange)unknown('response',raw,'unstructured response');
 }
 if(Array.isArray(root)){
  root={changes:Object.fromEntries(root.flatMap(value=>{const actor=whoFor(value?.who||value?.person||value?.target);return actor?[[actor,value]]:[];}))};
  if(!Object.keys(root.changes).length)unknown('response',raw,'unrecognized list');
 }
 root=canonicalObject(root);
 if(object(root.result)||object(root.data)){note('wrapper',Object.keys(root),['unwrapped']);root=canonicalObject(root.result||root.data);}
 const supplied=root.changes??root.people??root.characters??root;
 const changes=canonicalObject(supplied);
 if(object(root.changes)&&!Object.keys(root.changes).length)explicitNoChange=true;
 if(bool(root.noChange)===true||word(root.status)==='unchanged')explicitNoChange=true;
 for(const [actor,value] of Object.entries(changes)){
  const who=whoFor(actor);if(!who){if(!['scene','sceneKo','reason','reasoning','confidence','note','status','noChange'].includes(actor))unknown(actor,value,'unrecognized subject');continue;}
  if(value===null)continue;
  const change=canonicalObject(value),next={context:{},actions:[]};
  if(!object(value)){unknown(who,value,'unstructured actor description');continue;}
  const context=canonicalObject(change.context||change.state||change);
  for(const [key,value] of Object.entries(context)){
   const path=who+'.context.'+key;
   if(value===null||value===undefined)continue;
   if(VALUES[key]){
    const result=enumValue(key,value,path);if(result!==undefined)next.context[key]=result;
   }else if(key==='temperature'){
    const numeric=typeof value==='number'?value:typeof value==='string'&&/^-?\d+(?:\.\d+)?\s*(?:°?\s*c|℃)?$/i.test(value.trim())?parseFloat(value):NaN;
    if(Number.isFinite(numeric)&&numeric>=-80&&numeric<=65){next.context[key]=numeric;note(path,value,numeric);}else unknown(path,value);
   }else if(['conditions','needs'].includes(key)){
    const list=Array.isArray(value)?value:typeof value==='string'?[value]:null;
    if(!list){unknown(path,value);continue;}
    const terms={임신:'Pregnant',부상:'Injured',회복:'Recovered'};
    const valid=list.flatMap(v=>{if(typeof v!=='string')return [];const translated=terms[v.trim()]||v.trim();if(!translated||/[가-힣]/.test(translated)){unknown(path,v,'English fact unavailable');return [];}return [translated];});
    if(!list.length||valid.length){next.context[key]=[...new Set(valid)];note(path,value,next.context[key]);}
   }
  }
  if(change.transition!=null){const result=bool(change.transition);if(result!==undefined){next.transition=result;note(who+'.transition',change.transition,result);}else unknown(who+'.transition',change.transition);}
  const source=change.actions??change.events;
  if(source!=null){
   const list=Array.isArray(source)?source:object(source)?[source]:[];
   if(!list.length&&!Array.isArray(source)){unknown(who+'.actions',source);next.automatic=false;}
   for(const [index,entry] of list.entries()){
    const path=who+'.actions.'+index,action=canonicalObject(entry),op=enumValue('op',action.op,path+'.op');
    if(!op){unknown(path,entry);next.automatic=false;continue;}
    if(op==='nude'){next.actions.push({op});continue;}
    const category=enumValue('category',action.category,path+'.category');
    if(!category){next.automatic=false;continue;}
    const result={op,category};let invalidIdentity=false;
    for(const key of ['name','color','brand','wearing']){
     if(action[key]==null)continue;
     if(typeof action[key]==='string'&&!/[가-힣]/.test(action[key]))result[key]=action[key].trim();
     else{unknown(path+'.'+key,action[key]);if(['name','color','brand'].includes(key))invalidIdentity=true;next.automatic=false;}
    }
    if(invalidIdentity)continue;
    if(typeof action.wearingKo==='string'&&/[가-힣]/.test(action.wearingKo)&&!/[A-Za-z]/.test(action.wearingKo))result.wearingKo=action.wearingKo.trim();
    if(action.layer!=null){const layer=bool(action.layer);if(layer!==undefined)result.layer=layer;}
    if(op==='wear'&&!result.name||op==='adjust'&&result.wearing===undefined){unknown(path,entry,'garment identity/state missing');next.automatic=false;continue;}
    next.actions.push(result);
   }
  }
  if(change.items||change.outfit)unknown(who+'.items',change.items||change.outfit,'inventory needs interpretation');
  if(Object.keys(next.context).length||next.actions.length||next.transition!==undefined)facts.changes[who]=next;
 }
 for(const field of ['scene','sceneKo']){
  if(!object(root[field]))continue;
  const scene=canonicalObject(root[field]),summary={};
  for(const key of ['time','place','activity','weather']){
   const value=scene[key];if(typeof value!=='string'||!value.trim())continue;
   if(field==='scene'&&/[가-힣]/.test(value)||field==='sceneKo'&&/[A-Za-z]/.test(value)){note(field+'.'+key,value,'display omitted');continue;}
   summary[key]=value.trim();
  }
  if(Object.keys(summary).length)facts[field]=summary;
 }
 const substantive=Object.keys(facts.changes).length>0;
 const outcome=substantive?(unresolved.length?'partial':'applied'):explicitNoChange&&!unresolved.length?'unchanged':'unusable';
 return {facts,outcome,adjustments,unresolved};
}
export const validateSceneFacts=(raw,options)=>normalizeSceneResponse(raw,options).facts;

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
  if(change.automatic===false||context.exception==='keep'||context.exception==='undressed'||blocked.has('all')||privatePhase)continue;
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
 if(missing.length>12)throw Error('한 장면에서 필요한 의상이 너무 많습니다. 판독 내용을 로그에서 확인하세요.');
 return {state,missing};
}

export function sceneRequest(baseline,messages,contextMessages=[],names={}){
 const compact=context=>Object.fromEntries(Object.entries(normalizeContext(context)).filter(([,value])=>value!==null&&value!==''&&value!=='unknown'&&(!Array.isArray(value)||value.length)));
 return {people:Object.fromEntries(PEOPLE.map(who=>[who,{...(names[who]?{name:names[who]}:{}),context:compact(baseline.people[who].context),worn:baseline.people[who].items.map(({name,color,brand})=>({name,color,brand})),nude:baseline.people[who].nude}])),contextMessages,messages};
}
