import {needsOutfitRead} from './scene-gate.js';
import {wardrobeLevel,ownedItems,normalizeTraits,itemTraits,newItemPolicy} from './wardrobe.js';
import {ensureContexts,normalizeSceneResponse,resolveOutfit,sceneRequest,satisfiesRequest} from './outfit-rules.js';

export const KEY = 'kikki-closet:v1';
export const CATEGORIES = ['상의','하의','속옷','신발','겉옷','소품'];
export const PROFILE_FIELDS = ['나이대','직업','생활수준','생활환경','세계관','복식 규칙','배경·복식 문화','브랜드 성향','선택 성향','패션 관심도','스타일','색상','핏·소재','신발·소품','관리 습관','고정 조건'];
export const DEFAULTS = {enabled:false,profileId:'',fixed:false,wardrobeLevel:'medium',newItems:'medium',brands:true,mascot:true,mascotLocked:false,displayMode:'floating',auto:true,chatTurns:8,displayLimit:1};
export const clone = x => structuredClone(x);
export const EXTENSION_VERSION='1.6.4';
const redactString=value=>value.replace(/\bBearer\s+\S+|\bsk-[a-zA-Z0-9_-]{12,}/g,'[redacted]').replace(/((?:api[_-]?key|authorization|password)\s*[:=]\s*["']?)[^\s"',}]+/gi,'$1[redacted]');
function diagnosticValue(value,seen=new WeakSet()){
 if(typeof value==='string')return redactString(value);
 if(value instanceof Error){if(seen.has(value))return '[circular error]';seen.add(value);const result={name:value.name,message:redactString(value.message),stack:redactString(value.stack||''),cause:value.cause?diagnosticValue(value.cause,seen):undefined};seen.delete(value);return result;}
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return '[circular]';seen.add(value);
 const result=Array.isArray(value)?value.map(v=>diagnosticValue(v,seen)):Object.fromEntries(Object.entries(value).map(([key,v])=>[key,/^(?:api.?key|authorization|cookies?|headers|password|access.?token|refresh.?token|secret)$/i.test(key)?'[redacted]':diagnosticValue(v,seen)]));
 seen.delete(value);return result;
}
export class DiagnosticLog{
 constructor({limit=30,bytes=2*1024*1024,console:output=globalThis.console}={}){this.limit=limit;this.bytes=bytes;this.output=output;this.records=[];this.listeners=new Set();this.serial=0;this.reported=new WeakSet();}
 subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
 notify(){
  const size=()=>new TextEncoder().encode(JSON.stringify(this.records)).length;
  while(this.records.length>this.limit||this.records.length>1&&size()>this.bytes)this.records.shift();
  if(this.records.length&&size()>this.bytes){
   const row=this.records[0];row.truncated=true;
   for(const event of row.events){if(size()<=this.bytes)break;const original=JSON.stringify(event.data);event.data={truncated:true,originalBytes:new TextEncoder().encode(original||'').length,preview:(original||'').slice(0,Math.max(0,Math.floor(this.bytes/16)))};}
   while(row.events.length>2&&size()>this.bytes)row.events.splice(1,1);
  }
  for(const fn of this.listeners)try{fn();}catch{}
 }
 start(type,scope={}){
  const row={id:type+'-'+Date.now().toString(36)+'-'+(++this.serial),version:EXTENSION_VERSION,time:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,type,scope:diagnosticValue(scope),outcome:'running',events:[]};this.records.push(row);const started=Date.now(),log=this;
  const trace={id:row.id,get ended(){return row.outcome!=='running';},get outcome(){return row.outcome;},event(stage,message,data,level='info'){
   row.events.push({time:new Date().toISOString(),elapsedMs:Date.now()-started,stage,level,message,data:diagnosticValue(data)});
   const c=log.output;c?.groupCollapsed?.('[Kikki Closet]['+row.id+'] '+message);(level==='error'?c?.error:level==='warn'?c?.warn:c?.info)?.call(c,{stage,data:diagnosticValue(data)});c?.groupEnd?.();log.notify();
  },finish(outcome,message,data){if(trace.ended)return;row.outcome=outcome;trace.event('result',message,data,outcome==='unusable'||outcome==='partial'?'warn':'info');},
  fail(error,stage='execution'){if(error&&typeof error==='object')log.reported.add(error);if(trace.ended)return;row.outcome=error?.name==='AbortError'?'cancelled':'error';trace.event(stage,error?.message||String(error),error,row.outcome==='error'?'error':'info');}};
  trace.event('start','작업 시작',scope);return trace;
 }
 error(error,scope={}){if(error&&typeof error==='object'&&this.reported.has(error))return;this.start('error',scope).fail(error);}
 list(){return clone(this.records).reverse();}
 copy(id){return JSON.stringify({extension:'Kikki Closet',version:EXTENSION_VERSION,exportedAt:new Date().toISOString(),records:id?this.list().filter(row=>row.id===id):this.list()},null,2);}
 clear(){this.records=[];this.notify();}
}

export function compactStoredData(source){
 const data=clone(source),removed={translations:0,history:0,outfits:0,checkpoints:0,display:0};
 for(const character of Object.values(data.characters))for(const branch of Object.values(character.branches)){
  for(const who of ['character','persona'])if(branch.reportTranslations?.[who]&&(!branch.profiles?.[who]||branch.reportTranslations[who].signature!==hash(JSON.stringify(branch.profiles[who].fields)))){delete branch.reportTranslations[who];removed.translations++;}
  for(const [key,limit] of [['history',5],['outfits',10]])if(Array.isArray(branch[key])&&branch[key].length>limit){removed[key]+=branch[key].length-limit;branch[key]=branch[key].slice(-limit);}
  if(branch.checkpoints){const keys=Object.keys(branch.checkpoints);for(const key of keys.slice(0,Math.max(0,keys.length-80))){delete branch.checkpoints[key];removed.checkpoints++;}}
  removed.display+=trimDisplay(branch,data.settings?.displayLimit);
 }
 return {data,removed,total:Object.values(removed).reduce((sum,n)=>sum+n,0)};
}
export function branchId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=new Uint32Array(4);globalThis.crypto.getRandomValues(bytes);return 'branch-'+[...bytes].map(x=>x.toString(16).padStart(8,'0')).join('');}
export const text = (x,n=400) => typeof x==='string'?x.replace(/<\/?kikki_outfit\b[^>]*>/gi,'').trim().slice(0,n):'';
export function emptyState(){return ensureContexts({scene:{time:'불명',place:'불명',activity:'불명',weather:'불명'},people:{character:{nude:false,items:[]},persona:{nude:false,items:[]}}});}
export function sceneSummary(state){
 const summary={...(state?.sceneKo||{})},contexts=['character','persona'].map(who=>state?.people?.[who]?.context||{}),context=contexts.find(c=>c.location&&c.location!=='unknown')||contexts[0]||{};
 const labels={location:{home:'집',outside:'외부',work:'직장',school:'학교',hospital:'병원',other:'기타 장소'},phase:{resting:'휴식',washing:'씻는 중',after_washing:'씻은 후',sleeping:'수면',preparing:'준비 중',outdoors:'외출 중',working:'일하는 중',formal:'격식 있는 자리',care:'돌봄·치료'},weather:{mild:'온화',hot:'더움',cold:'추움',rain:'비',snow:'눈'}};
 summary.activity=labels.phase[context.phase]||'';
 for(const [field,key] of [['place','location'],['activity','phase'],['weather','weather']])if(!summary[field]||summary[field]==='불명')summary[field]=labels[key][context[key]]||'';
 if(typeof context.temperature==='number'&&Number.isFinite(context.temperature)&&!String(summary.weather).includes('°')&&!String(summary.weather).includes('℃'))summary.weather=[summary.weather,context.temperature+'℃'].filter(Boolean).join(' · ');
 return summary;
}
export function hash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
const sceneText=value=>{const source=String(value||'').replace(/<kikki_outfit\s*>[\s\S]*?<\/kikki_outfit\s*>/gi,'');return source.length>12000?source.slice(0,9000)+'\n[Middle omitted; latest context retained]\n'+source.slice(-3000):source;};
export function visibleMessages(chat){return chat.flatMap((m,i)=>m.is_system||m.is_hidden||m.extra?.is_hidden?[]:[{id:String(m.extra?.kikki_id||m.send_date||i),swipe:m.swipe_id??0,role:m.is_user?'user':'character',name:text(m.name,80),content:sceneText(m.mes)}]);}
export function prefixKeys(messages){let key='root';return messages.map(m=>(key=hash(key+JSON.stringify(m))));}
export const displayLimit=value=>Math.max(1,Math.min(20,Math.floor(Number(value))||1));
export function displayKey(message){return hash(JSON.stringify([message.id,message.swipe??0,message.content]));}
export function pruneDisplaySnapshots(branch){
 if(!branch.display)return 0;
 const used=new Set(Object.values(branch.display.chats||{}).flatMap(records=>Object.values(records).map(record=>record.snapshot)));let count=0;
 for(const key of Object.keys(branch.display.snapshots||{}))if(!used.has(key)){delete branch.display.snapshots[key];count++;}
 return count;
}
export function recordDisplay(branch,chatId,messages,state,limit=1){
 const index=messages.findLastIndex(message=>message.role==='character');
 const message=messages[index];if(!chatId||message?.role!=='character')return;
 branch.display??={chats:{},snapshots:{}};
 const display=branch.display,snapshot={sceneKo:sceneSummary(state),people:Object.fromEntries(['character','persona'].map(who=>[who,{nude:!!state.people[who].nude,items:clone(state.people[who].items),context:clone(state.people[who].context||{})}]))};
 const serialized=JSON.stringify(snapshot);let key=hash(serialized),n=0;
 while(display.snapshots[key]&&JSON.stringify(display.snapshots[key])!==serialized)key=hash(serialized)+'-'+(++n);
 display.snapshots[key]=snapshot;
 const records=display.chats[chatId]??={},id=displayKey(message),previous=records[id];
 // Numeric hashes are enumerated before other keys by JS; store recency explicitly.
 const orders=Object.values(records).map((record,i)=>record.order??i+1);
 const order=previous?(previous.order??Object.keys(records).indexOf(id)+1):Math.max(0,...orders)+1;
 delete records[id];records[id]={prefix:prefixKeys(messages)[index],snapshot:key,order,folded:previous?.folded||false,tab:previous?.tab||'character'};
 trimDisplay(branch,limit);
}
export function savedDisplay(branch,chatId,message,prefix){
 const record=branch?.display?.chats?.[chatId]?.[displayKey(message)];
 return record?.prefix===prefix&&branch.display.snapshots[record.snapshot]?{record,state:branch.display.snapshots[record.snapshot]}:null;
}
export function removeDisplayChat(branch,chatId){if(branch?.display?.chats){delete branch.display.chats[chatId];if(branch.display.heads)delete branch.display.heads[chatId];pruneDisplaySnapshots(branch);}}
export function trimDisplay(branch,limit=1){
 let count=0;
 for(const records of Object.values(branch.display?.chats||{})){
  const oldest=Object.entries(records).map(([key,record],i)=>({key,order:record.order??i+1})).sort((a,b)=>a.order-b.order);
  for(const {key} of oldest.slice(0,-displayLimit(limit))){delete records[key];count++;}
 }
 return count+pruneDisplaySnapshots(branch);
}
export function pruneDisplayChat(branch,chatId,chat,limit=1){
 const records=branch?.display?.chats?.[chatId];if(!records)return 0;
 const messages=visibleMessages(chat),keys=prefixKeys(messages),live=new Map(messages.flatMap((message,i)=>message.role==='character'?[[displayKey(message),keys[i]]]:[]).slice(-displayLimit(limit)));
 let count=0;for(const [key,record] of Object.entries(records))if(live.get(key)!==record.prefix){delete records[key];count++;}
 return count+pruneDisplaySnapshots(branch);
}
// A small per-chat cursor validates the current flow; it never stores another outfit copy.
export function trustedTimeline(branch,messages,chatId){
 if(!branch)return null;
 const keys=prefixKeys(messages),head=branch.display?.heads?.[chatId];
 const fromKey=key=>{const index=keys.indexOf(key),checkpoint=branch.checkpoints?.[key];return index>=0&&checkpoint?{state:checkpoint.state,checkpoint,index,key}:null;};
 if(head&&!head.stale){if(head.key==='root')return {state:branch.base,checkpoint:null,index:-1,key:'root'};const saved=fromKey(head.key);if(saved)return saved;}
 const last=messages.findLastIndex(message=>message.role==='character');
 if(last>=0&&savedDisplay(branch,chatId,messages[last],keys[last])){const saved=fromKey(keys[last]);if(saved)return saved;}
 if(!head){
  const saved=fromKey(branch.keys?.at(-1));if(saved)return saved;
  if(!branch.keys?.length&&!Object.keys(branch.checkpoints||{}).length)return {state:branch.base,checkpoint:null,index:-1,key:'root'};
 }
 return null;
}
export function reconcileDisplay(branch,chatId,messages,limit=1){
 if(!branch||!chatId)return false;
 branch.display??={chats:{},snapshots:{}};
 const before=JSON.stringify(branch.display),timeline=trustedTimeline(branch,messages,chatId);
 // Root is a deliberate new branch base, not a fallback after deleting all messages.
 if(timeline?.key!=='root'){branch.display.heads??={};branch.display.heads[chatId]=timeline?{key:timeline.key,stale:false}:{key:branch.display.heads[chatId]?.key||'',stale:true};}
 const records=branch.display.chats[chatId]||{};
 const last=messages.findLastIndex(message=>message.role==='character');
 // A manual read can include a trailing user input. If that input is deleted,
 // align the memo with the same surviving checkpoint used by the macro.
 if(timeline&&last>=0&&timeline.index>=last)recordDisplay(branch,chatId,messages,timeline.state,limit);
 const keys=prefixKeys(messages);
 const live=new Map(messages.flatMap((message,i)=>message.role==='character'?[[displayKey(message),keys[i]]]:[]).slice(-displayLimit(limit)));
 for(const [key,record] of Object.entries(records))if(live.get(key)!==record.prefix)delete records[key];
 trimDisplay(branch,limit);
 return before!==JSON.stringify(branch.display);
}
export function recentTurnStart(messages,turns=8){
 const limit=Math.max(1,Math.min(50,Math.floor(Number(turns)||8)));
 let count=0;for(let i=messages.length-1;i>=0;i--)if(messages[i].role==='user'&&++count===limit)return i;
 return count?0:Math.max(0,messages.length-limit);
}
export function missingBrand(brand){return !String(brand||'').trim()||/^(?:unknown|brand unknown|unknown brand|unbranded|무브랜드|브랜드 미상|불명)$/i.test(String(brand).trim());}
export function savedOutfitForMessages(branch,messages,chatId){
 if(chatId!==undefined)return trustedTimeline(branch,messages,chatId)?.state||null;
 const keys=prefixKeys(messages);for(let i=keys.length-1;i>=0;i--)if(branch.checkpoints[keys[i]])return branch.checkpoints[keys[i]].state;
 return branch.base;
}
// Select the active timeline before showing/editing a shared branch in another chat.
export function restoreBranchForMessages(branch,messages,chatId){
 if(chatId!==undefined){
  const timeline=trustedTimeline(branch,messages,chatId),cp=timeline?.checkpoint;
  Object.assign(branch,{current:ensureContexts(clone(timeline?.state||emptyState())),extra:clone(cp?.extra||branch.extra||{character:[],persona:[]}),history:clone(cp?.history||[]),outfits:clone(cp?.outfits||[]),outfitMemory:clone(cp?.outfitMemory||(timeline?.key==='root'?branch.baseMemory:{} )||{}),keys:prefixKeys(messages).slice(0,(timeline?.index??-1)+1)});
  return branch.current;
 }
 const keys=prefixKeys(messages);let checkpoint,start=0;
 for(let i=keys.length-1;i>=0;i--)if(branch.checkpoints[keys[i]]){checkpoint=branch.checkpoints[keys[i]];start=i+1;break;}
 const state=ensureContexts(clone(checkpoint?.state||branch.base));
 Object.assign(branch,{current:state,extra:clone(checkpoint?.extra||branch.baseExtra||{character:[],persona:[]}),history:clone(checkpoint?.history||[]),outfits:clone(checkpoint?.outfits||[]),outfitMemory:clone(checkpoint?.outfitMemory||branch.baseMemory||memoryFromStates([state])),keys:keys.slice(0,start)});
 return state;
}
export function saveManualOutfit(branch,people,messages,chatId,limit=1){
 const next=ensureContexts({...clone(branch.current),people:clone(people)});
 validateState(next,Object.fromEntries(['character','persona'].map(who=>[who,ownedItems(branch,who)])));
 for(const person of Object.values(next.people)){person.origins=Object.fromEntries(person.items.map(item=>[item.id,'manual']));person.manualOutfit=true;}
 branch.outfitMemory=updateOutfitMemory(branch.outfitMemory,branch.current,next);branch.current=next;
 branch.keys=prefixKeys(messages);const last=branch.keys.at(-1);
 if(last){
  branch.checkpoints[last]={state:clone(next),extra:clone(branch.extra),history:clone(branch.history),outfits:clone(branch.outfits),outfitMemory:clone(branch.outfitMemory)};
  for(const stale of Object.keys(branch.checkpoints).slice(0,-80))delete branch.checkpoints[stale];
 }else{branch.base=clone(next);branch.baseExtra=clone(branch.extra);branch.baseMemory=clone(branch.outfitMemory);}
 branch.display??={chats:{},snapshots:{}};branch.display.heads??={};branch.display.heads[chatId]={key:last||'root',stale:false};
 recordDisplay(branch,chatId,messages,next,limit);
}
export function outfitInjection(state){
 return outfitText(state,2,true);
}
export function itemBrandLabel(item){return String(item.brand||'').trim()||'Brand pending';}
export const koreanDisplay=value=>typeof value==='string'&&/[가-힣]/.test(value)&&!/[A-Za-z]/.test(value)?value:'';
export const itemUiLabel=item=>koreanDisplay(item.labelKo)||(item.category+' · 표시명 준비 전');
export const itemUiBrand=item=>koreanDisplay(item.brandKo)||'브랜드 표시 준비 전';
export function itemDescription(item,detail=2){
 const name=String(item.name||'').trim(),color=String(item.color||'').trim();
 const base=[detail>=2&&!name.toLowerCase().includes(color.toLowerCase())?color:'',name].filter(Boolean).join(' ');
 if(detail<3)return base;
 const features=[...new Set(item.features||[])].filter(value=>!base.toLowerCase().includes(value.toLowerCase())).slice(0,2);
 return base+(features.length?' ('+features.join(', ')+')':'');
}
export function outfitText(state, detail=2, brands=true){return ['character','persona'].flatMap((who)=>{const p=state?.people?.[who];if(!p||p.nude||!p.items.length)return [];return [(who==='character'?'Character':'Persona')+': '+p.items.map(i=>itemDescription(i,detail)+(brands&&i.brand?' ('+i.brand+')':'')+(i.wearing?' ['+text(i.wearing,80)+']':'')).join(', ')+'.'];}).join('\n');}
export function replaceTags(value,content,{keep=true}={}){let found=0;const replaced=String(value).replace(/<kikki_outfit\s*>[\s\S]*?<\/kikki_outfit\s*>/gi,()=>{found++;return found===1&&keep?`<kikki_outfit>\n${content}\n</kikki_outfit>`:'';});return {text:replaced,found,malformed:(!found&&/<\/?kikki_outfit\b/i.test(value))};}
export function parseJSON(reply,{array=false}={}){
 if(reply&&typeof reply==='object'&&(!Array.isArray(reply)||array))return reply;
 let str=String(reply??'').replace(/^\uFEFF/,'').trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 const first=str.search(array?/[{\[]/:/{/);if(first>=0)str=str.slice(first);
 let quoted=false,escaped=false,depth=0,end=-1,clean='';
 for(let i=0;i<str.length;i++){
  const c=str[i];if(quoted){clean+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;clean+=c;continue;}
  if(c===','&&/^\s*[}\]]/.test(str.slice(i+1)))continue;
  clean+=c;if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0){end=clean.length;break;}}
 }
 if(end>=0)clean=clean.slice(0,end);
 let value;try{value=JSON.parse(clean);}catch(error){throw Error('응답 내용을 JSON으로 읽지 못했습니다.',{cause:error});}
 if(!value||typeof value!=='object'||Array.isArray(value)&&!array)throw Error('응답에 읽을 수 있는 정보가 없습니다.');
 return value;
}
export function normalizeItem(raw){
 if(!raw||!CATEGORIES.includes(raw.category)||!text(raw.name,100))throw Error('아이템의 카테고리나 이름이 잘못되었습니다.');
 if(missingBrand(raw.brand))throw Error('새 의상의 브랜드 또는 제작 정보가 빠졌습니다. 다시 판독해 주세요.');
 if([raw.name,raw.color,raw.brand,...(Array.isArray(raw.features)?raw.features:[])].some(value=>typeof value==='string'&&/[가-힣]/.test(value)))throw Error('새 의상 원문은 영어여야 합니다. 기존 데이터는 유지됩니다.');
 return {
  id:text(raw.id,100)||'item-'+hash(JSON.stringify(raw)),category:raw.category,
  name:text(raw.name,100),color:text(raw.color,60),brand:text(raw.brand,80),
  labelKo:text(raw.labelKo,120),brandKo:text(raw.brandKo,120),
  features:Array.isArray(raw.features)?raw.features.slice(0,2).map(x=>text(x,80)).filter(Boolean):[],
  source:['추정 보유','기존 보유','구매','대여·지급'].includes(raw.source)?raw.source:'추정 보유',available:raw.available!==false,
  ...(raw.traits?{traits:normalizeTraits(raw.traits)}:{}),...(raw.wearing?{wearing:text(raw.wearing,80)}:{}),
 };
}
const item=normalizeItem;
export function normalizeProfile(raw){
 const out={};
 for(const who of ['character','persona']){
  const profile=raw[who];if(!profile)continue;
  const fields={};
  for(const key of PROFILE_FIELDS){
   const field=profile.fields?.[key];
   fields[key]={value:text(field?.value,Infinity)||'Unknown',certainty:['명시','추정','불명'].includes(field?.certainty)?field.certainty:'불명',evidence:text(field?.evidence,Infinity),locked:false};
  }
  const wardrobeHints={};
  for(const axis of ['type','fit','material','color','detail','brandSource']){
   const values=profile.wardrobeHints?.[axis];
   if(Array.isArray(values))wardrobeHints[axis]=values.slice(0,24).map(value=>text(value,100)).filter(Boolean);
  }
  const wardrobeExceptions=Object.fromEntries(['top','bottom','outerwear','footwear','underwear','accessory'].filter(key=>text(profile.wardrobeExceptions?.[key],300)).map(key=>[key,text(profile.wardrobeExceptions[key],300)]));
  const wardrobe=(Array.isArray(profile.wardrobe)?profile.wardrobe:[]).slice(0,60).map(item);
  const ids=new Set();for(const garment of wardrobe){if(ids.has(garment.id))throw Error('옷장 아이템 ID가 중복되었습니다.');ids.add(garment.id);}
  out[who]={fields,wardrobeHints,wardrobeExceptions,wardrobe};
 }
 if(!Object.keys(out).length)throw Error('분석 대상의 프로필이 없습니다.');return out;
}
// Validate the code-produced state, never a full outfit returned by the reader model.
export function validateState(value,wardrobes){
 const state=ensureContexts(clone(value));
 for(const who of ['character','persona']){
  const person=state.people?.[who],registry=new Map((wardrobes[who]||[]).map(item=>[item.id,item]));
  if(!person||typeof person.nude!=='boolean'||!Array.isArray(person.items))throw Error('인물 착장 상태가 누락되었습니다.');
  if(person.items.length>18||person.nude&&person.items.length)throw Error('착장 상태가 서로 모순됩니다.');
  const seen=new Set();
  for(const item of person.items){
   const source=registry.get(item?.id);
   if(!source||source.available===false||seen.has(item.id))throw Error('보유 옷에서 찾을 수 없는 아이템입니다.');
   for(const key of ['name','category','color','brand'])if(item[key]!==source[key])throw Error('기존 의상의 이름·색상·브랜드는 변경할 수 없습니다.');
   if(item.wearing!==undefined&&typeof item.wearing!=='string')throw Error('착용 상태 내용을 읽을 수 없습니다.');
   seen.add(item.id);
  }
 }
 return state;
}
const covered=person=>!person?.nude&&!(person?.items||[]).some(i=>itemTraits(i).temporary)&&((person?.items||[]).some(i=>i.category==='상의')&&(person?.items||[]).some(i=>i.category==='하의')||(person?.items||[]).some(i=>i.category==='상의'&&itemTraits(i).coverage==='full'));
export function updateOutfitMemory(previous,before,after){
 const memory=clone(previous||{});for(const who of ['character','persona']){
  const old=before?.people[who],next=after?.people[who];memory[who]??={lastDressed:[],beforeUndress:[]};
  for(const key of ['lastDressed','beforeUndress'])memory[who][key]=[...new Set((memory[who][key]||[]).map(i=>typeof i==='string'?i:i.id).filter(Boolean))];
  if(covered(old)&&!covered(next))memory[who].beforeUndress=old.items.map(i=>i.id);
  else if(next?.nude&&!old?.nude&&old?.items?.length)memory[who].beforeUndress=clone(memory[who].lastDressed.length?memory[who].lastDressed:old.items.map(i=>i.id));
  if(covered(next))memory[who].lastDressed=next.items.map(i=>i.id);
 }return memory;
}
export function memoryFromStates(states){let memory={},before=emptyState();for(const state of states){memory=updateOutfitMemory(memory,before,state);before=state;}return updateOutfitMemory(memory,before,before);}
export class Store {
 constructor(storage){this.storage=storage;this.epoch=0;this.data=this.load();}
 load(){
  const raw=this.storage.getItem(KEY);if(!raw)return {version:1,settings:clone(DEFAULTS),characters:{}};
  try{
   const d=JSON.parse(raw);if(d.version!==1||!d.characters||typeof d.characters!=='object')throw Error();
   d.settings={...DEFAULTS,...d.settings,wardrobeLevel:wardrobeLevel(d.settings)};
   d.settings.displayLimit=displayLimit(d.settings.displayLimit);
   if(!['floating','inline'].includes(d.settings.displayMode))d.settings.displayMode='floating';
   d.settings.newItems=newItemPolicy(d.settings.newItems);
   for(const key of ['wardrobeSize','wardrobeLevels','worlds','target','variety','detail'])delete d.settings[key];
   for(const character of Object.values(d.characters))for(const branch of Object.values(character.branches||{})){
    for(const state of [branch.base,branch.current,...(branch.history||[])])ensureContexts(state);
    for(const cp of Object.values(branch.checkpoints||{})){ensureContexts(cp.state);for(const state of cp.history||[])ensureContexts(state);}
    branch.display??={chats:{},snapshots:{}};trimDisplay(branch,d.settings.displayLimit);
   }
   return d;
  }catch{throw Error('저장 데이터가 손상되었습니다. 데이터 관리에서 초기화하세요.');}
 }
 save(){try{this.storage.setItem(KEY,JSON.stringify(this.data));}catch(error){this.invalidate();this.data=this.load();throw Error('저장 공간이 부족하거나 저장할 수 없습니다. 데이터 관리에서 정리하세요.',{cause:error});}}
 invalidate(){this.epoch++;}
 character(id){return this.data.characters[id];}
 createCharacter(id,name){this.data.characters[id]??={name,profiles:{},branches:{}};this.save();return this.character(id);}
 branch(id,bid){return this.character(id)?.branches[bid];}
 createBranch(id,name,copyFrom=null){const c=this.character(id);if(!c)throw Error('인물 분석을 먼저 시작하세요.');const bid=branchId();const copied=copyFrom?this.branch(id,copyFrom):null;if(copyFrom&&!copied)throw Error('복제할 브랜치를 찾을 수 없습니다.');c.branches[bid]={name:text(name,100)||'새 스토리',links:[],personaKey:copied?.personaKey??c.personaKey??'',base:ensureContexts(clone(copied?.current||emptyState())),current:ensureContexts(clone(copied?.current||emptyState())),profiles:clone(copied?.profiles||c.profiles),reportTranslations:clone(copied?.reportTranslations||{}),analysisSources:clone(copied?.analysisSources||{targets:[],selected:{}}),extra:clone(copied?.extra||{character:[],persona:[]}),baseExtra:clone(copied?.extra||{character:[],persona:[]}),history:[],outfits:[],checkpoints:{},keys:[],display:{chats:{},snapshots:{}},outfitMemory:clone(copied?.outfitMemory||memoryFromStates([copied?.current||emptyState()])),baseMemory:clone(copied?.outfitMemory||memoryFromStates([copied?.current||emptyState()])),suspended:false};this.save();return bid;}
 bind(id,bid,chatId){const b=this.branch(id,bid);if(!b)throw Error('연결할 브랜치를 찾을 수 없습니다.');for(const branch of Object.values(this.character(id).branches))branch.links=branch.links.filter(x=>x!==chatId);b.links.push(chatId);b.suspended=false;this.invalidate();this.save();}
 find(id,chatId){return Object.entries(this.character(id)?.branches||{}).find(([,b])=>b.links.includes(chatId));}
 deleteChat(id,chatId){const entry=this.find(id,chatId);if(!entry)return;const [bid,b]=entry;b.links=b.links.filter(x=>x!==chatId);removeDisplayChat(b,chatId);if(!b.links.length)delete this.character(id).branches[bid];this.invalidate();this.save();}
 deleteBranch(id,bid){delete this.character(id)?.branches[bid];this.invalidate();this.save();}
 deleteCharacter(id){delete this.data.characters[id];this.invalidate();this.save();}
 deleteAll(){this.invalidate();this.storage.removeItem(KEY);this.data={version:1,settings:clone(DEFAULTS),characters:{}};}
 resetChat(id,chatId){
  const [,branch]=this.find(id,chatId)||[];if(!branch)return;
  removeDisplayChat(branch,chatId);
  if(branch.links.length>1){
   branch.links=branch.links.filter(x=>x!==chatId);
   const fresh=this.createBranch(id,'초기화된 채팅'),target=this.branch(id,fresh);
   // Reset this chat's timeline, not the source branch's selected persona/preferences.
   target.profiles=clone(branch.profiles);target.reportTranslations=clone(branch.reportTranslations||{});
   target.analysisSources=clone(branch.analysisSources||{targets:[],selected:{}});target.personaKey=branch.personaKey||'';
   this.bind(id,fresh,chatId);target.suspended=true;
  }else{
   Object.assign(branch,{base:emptyState(),current:emptyState(),history:[],outfits:[],extra:{character:[],persona:[]},baseExtra:{character:[],persona:[]},checkpoints:{},keys:[],display:{chats:{},snapshots:{}},outfitMemory:memoryFromStates([]),baseMemory:memoryFromStates([]),suspended:true});
  }
  this.invalidate();this.save();
 }

}
export class Engine {
 constructor(store,request,generate){this.store=store;this.request=request;this.generate=generate;this.controller=null;this.serial=0;this.attempts=new Map();}
 cancel(){this.serial++;this.controller?.abort();this.controller=null;}
 async read(id,bid,messages,{force=false,system,gate=false,onRequest=()=>{},profileId,chatId,names={},trace,isCurrent=()=>true}={}){
  this.cancel();const serial=this.serial,epoch=this.store.epoch,b=this.store.branch(id,bid);
  if(!b||b.suspended)return null;
  const keys=prefixKeys(messages),key=keys.at(-1)||'root';
  const timeline=chatId?trustedTimeline(b,messages,chatId):null;
  if(!force&&key===b.keys.at(-1)&&(!chatId||timeline)){trace?.event('gate','이미 처리한 메시지',{});if(chatId&&reconcileDisplay(b,chatId,messages,this.store.data.settings.displayLimit))this.store.save();return b.current;}
  let baseline=ensureContexts(clone(b.base)),extra=clone(b.baseExtra||{character:[],persona:[]}),history=[],outfits=[],memory=clone(b.baseMemory||memoryFromStates([b.base])),start=0;
  for(let i=keys.length-1;i>=0;i--)if(b.checkpoints[keys[i]]&&(!chatId||timeline?.key===keys[i])){
   const cp=b.checkpoints[keys[i]];baseline=ensureContexts(clone(cp.state));extra=clone(cp.extra);history=clone(cp.history);outfits=clone(cp.outfits);memory=clone(cp.outfitMemory||memoryFromStates([b.base,...cp.history,cp.state]));start=i+1;break;
  }
  if(chatId&&!timeline){baseline=emptyState();extra=clone(b.extra);history=[];outfits=[];memory={};start=0;}
  const added={character:[],persona:[]};let state=baseline;
  const needsRead=force||chatId&&!timeline||(start!==messages.length&&(!gate||needsOutfitRead(messages,start)));
  const attemptKey=JSON.stringify([id,bid,chatId,key,profileId,epoch]);
  if(!force&&this.attempts.has(attemptKey)){trace?.finish('unusable','같은 응답의 자동 재시도 생략',{reason:this.attempts.get(attemptKey)});return null;}
  trace?.event('gate',needsRead?'새 장면 판독':'변화 후보 없음 · 착장 유지',{force,start,messageCount:messages.length,chatId,names});

  if(needsRead){
   this.controller=new AbortController();const signal=this.controller.signal;
   const valid=()=>!signal.aborted&&serial===this.serial&&epoch===this.store.epoch&&this.store.branch(id,bid)===b&&isCurrent();
   const windowStart=recentTurnStart(messages,this.store.data.settings.chatTurns);
   const evidenceStart=force?Math.max(windowStart,messages.findLastIndex(message=>message.role==='character')):Math.max(start,windowStart);
   const request=sceneRequest(baseline,messages.slice(evidenceStart),messages.slice(windowStart,evidenceStart),names);
   if(force)request.reread=true;
   trace?.event('context','현재 상황 판독 범위',{reread:force,evidenceStart,latestEvidence:request.messages.map(({id,role,swipe,content})=>({id,role,swipe,characters:content.length,hasInfoBlock:/<[^>]*(?:info|status)|(?:location|loc|장소|위치)\s*[:：]/i.test(content)})),backgroundMessages:request.contextMessages.length});
   if(windowStart>start)request.omittedEarlierMessages=windowStart-start;
   onRequest();
   let raw;try{raw=await this.request(system,request,signal,profileId,trace);}catch(error){if(error.kind==='connection'){this.attempts.set(attemptKey,error.message);while(this.attempts.size>30)this.attempts.delete(this.attempts.keys().next().value);}throw error;}if(!valid()){trace?.finish('cancelled','변경된 채팅의 늦은 응답 폐기');return null;}
   const parsed=raw?.sceneResult?raw:normalizeSceneResponse(raw,{names});
   if(!raw?.sceneResult)trace?.event('normalize','장면 내용 해석',parsed);
   if(parsed.outcome==='unusable'){
    this.attempts.set(attemptKey,'장면 내용을 확인하지 못함');while(this.attempts.size>30)this.attempts.delete(this.attempts.keys().next().value);
    trace?.finish('unusable','확인된 착장 유지 · 응답 내용 확인 보류',{unresolved:parsed.unresolved});this.controller=null;return null;
   }
   this.attempts.delete(attemptKey);if(trace)trace.decision=parsed.outcome;
   const facts=parsed.facts,wardrobes=Object.fromEntries(['character','persona'].map(w=>[w,ownedItems({...b,extra,current:baseline},w)]));
   const matching={newItems:newItemPolicy(this.store.data.settings.newItems)};
   let resolved=resolveOutfit(baseline,facts,wardrobes,memory,b.profiles,matching);
   trace?.event('physical-state','신체 상태 추가·유지·해제',Object.fromEntries(['character','persona'].map(who=>{
    const previous=baseline.people[who].context,next=resolved.state.people[who].context;
    const key=value=>String(value).trim().toLowerCase().replace(/[.!]+$/,'');
    const added=(old,values)=>values.filter(value=>!old.some(item=>key(item)===key(value)));
    return [who,{retainedConditions:next.conditions.filter(value=>previous.conditions.some(item=>key(item)===key(value))),addedConditions:added(previous.conditions,next.conditions),resolvedConditions:added(next.conditions,previous.conditions),retainedNeeds:next.needs.filter(value=>previous.needs.some(item=>key(item)===key(value))),addedNeeds:added(previous.needs,next.needs),resolvedNeeds:added(next.needs,previous.needs)}];
   })));
   trace?.event('decision','필요한 착장 변경 계산',{policy:matching.newItems,before:baseline.people,after:resolved.state.people,missing:resolved.missing,decisions:resolved.decisions});
   if(resolved.missing.length){
    if(!this.generate)throw Error('필요한 옷이 옷장에 없습니다. 기존 착장은 유지됩니다.');
    const profiles=Object.fromEntries([...new Set(resolved.missing.map(n=>n.who))].map(who=>[who,{fields:Object.fromEntries(Object.entries(b.profiles[who]?.fields||{}).filter(([name])=>PROFILE_FIELDS.includes(name)).map(([name,field])=>[name,{value:text(field.value,160)}])),wardrobeHints:b.profiles[who]?.wardrobeHints||{}}]));
    const generated=await this.generate({missing:resolved.missing,creationPolicy:matching.newItems,profiles,contexts:Object.fromEntries(Object.keys(profiles).map(who=>[who,resolved.state.people[who].context]))},signal,profileId,trace);
    if(!valid()){trace?.finish('cancelled','취소된 의상 생성 결과 폐기');return null;}
    if(!generated||typeof generated!=='object'||!generated.newItems||typeof generated.newItems!=='object'||Array.isArray(generated.newItems))throw Error('필요한 의상 생성 형식이 맞지 않습니다. 기존 착장은 유지됩니다.');
    for(const who of ['character','persona']){
     const items=generated.newItems[who]||[],needs=resolved.missing.filter(n=>n.who===who);
     if(!Array.isArray(items)||items.length>needs.length)throw Error('요청하지 않은 의상이 포함됐습니다. 기존 착장은 유지됩니다.');
     const remaining=[...needs];
     for(const value of items){
      const item=normalizeItem(value),n=remaining.findIndex(need=>satisfiesRequest(item,need,resolved.state.people[who].context));
      if(n<0||!item.available)throw Error('생성된 의상이 요청한 종류·용도·핏을 충족하지 못했습니다. 기존 착장은 유지됩니다.');remaining.splice(n,1);
      if(!koreanDisplay(item.labelKo)||!koreanDisplay(item.brandKo))throw Error('생성된 의상의 한글 표시명이 누락됐습니다. 기존 데이터는 유지됩니다.');
      item.id='scene-'+branchId();added[who].push(item);wardrobes[who].push(item);
     }
    }
    resolved=resolveOutfit(baseline,facts,wardrobes,memory,b.profiles,matching);
    trace?.event('matching','생성 의상 매칭 확인',{added:Object.fromEntries(Object.entries(added).map(([who,items])=>[who,items.map(({id,category,name})=>({id,category,name}))])),decisions:resolved.decisions,remaining:resolved.missing});
    if(resolved.missing.length)throw Error('생성된 옷이 현재 조건을 충족하지 못했습니다. 기존 착장은 유지됩니다.');
   }
   if(!valid()){trace?.finish('cancelled','취소된 판독 결과 폐기');return null;}
   state=validateState(resolved.state,wardrobes);
  }
  const meaningful=value=>JSON.stringify({scene:value.scene,sceneKo:value.sceneKo,people:Object.fromEntries(['character','persona'].map(who=>[who,{nude:value.people[who].nude,items:value.people[who].items,context:value.people[who].context}]))});
  const changed=meaningful(state)!==meaningful(baseline);
  if(trace&&changed&&trace.decision!=='partial')trace.decision='applied';
  const nextMemory=updateOutfitMemory(memory,baseline,state);
  for(const who of ['character','persona']){const merged=new Map(extra[who].map(i=>[i.id,i]));for(const item of added[who])merged.set(item.id,item);extra[who]=[...merged.values()];}
  if(changed){history.push(clone(baseline));history=history.slice(-5);const outfit=outfitText(state);if(outfit&&outfits.at(-1)!==outfit)outfits.push(outfit);outfits=outfits.slice(-10);}
  trace?.event('apply',changed?'착장 변경 적용':'확인된 착장 유지',{people:state.people,changed});
  Object.assign(b,{current:state,keys,extra,history,outfits,outfitMemory:nextMemory});
  b.checkpoints[key]={state:clone(state),extra:clone(extra),history:clone(history),outfits:clone(outfits),outfitMemory:clone(nextMemory)};
  for(const stale of Object.keys(b.checkpoints).slice(0,-80))delete b.checkpoints[stale];
  if(chatId){b.display??={chats:{},snapshots:{}};b.display.heads??={};b.display.heads[chatId]={key,stale:false};}
  recordDisplay(b,chatId||b.links[0],messages,state,this.store.data.settings.displayLimit);this.store.save();this.controller=null;return state;
 }
}
