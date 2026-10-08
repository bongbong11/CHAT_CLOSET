import {needsOutfitRead} from './scene-gate.js';
import {wardrobeLevel,ownedItems} from './wardrobe.js';

export const KEY = 'kikki-closet:v1';
export const CATEGORIES = ['상의','하의','속옷','신발','겉옷','소품'];
export const PROFILE_FIELDS = ['나이대','직업','생활수준','생활환경','세계관','복식 규칙','배경·복식 문화','브랜드 성향','선택 성향','패션 관심도','스타일','색상','핏·소재','신발·소품','관리 습관','고정 조건'];
export const DEFAULTS = {enabled:false,profileId:'',worlds:[],target:'both',fixed:false,wardrobeLevel:'medium',newItems:'보통',variety:'보통',detail:2,brands:true,mascot:true,mascotLocked:false,auto:true,chatTurns:8};
export const clone = x => structuredClone(x);
export function branchId(){if(globalThis.crypto?.randomUUID)return crypto.randomUUID();const bytes=new Uint32Array(4);globalThis.crypto.getRandomValues(bytes);return 'branch-'+[...bytes].map(x=>x.toString(16).padStart(8,'0')).join('');}
export const text = (x,n=400) => typeof x==='string'?x.replace(/<\/?kikki_outfit\b[^>]*>/gi,'').trim().slice(0,n):'';
export function emptyState(){return {scene:{time:'불명',place:'불명',activity:'불명',weather:'불명'},people:{character:{nude:false,items:[]},persona:{nude:false,items:[]}}};}
export function hash(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
export function visibleMessages(chat){return chat.filter(m=>!m.is_system&&!m.is_hidden&&!m.extra?.is_hidden).map((m,i)=>({id:String(m.extra?.kikki_id||m.send_date||i),swipe:m.swipe_id??0,role:m.is_user?'user':'character',name:text(m.name,80),content:text(String(m.mes||'').replace(/<kikki_outfit\s*>[\s\S]*?<\/kikki_outfit\s*>/gi,''),12000)}));}
export function prefixKeys(messages){let key='root';return messages.map(m=>(key=hash(key+JSON.stringify(m))));}
export function recentTurnStart(messages,turns=8){
 const limit=Math.max(1,Math.min(50,Math.floor(Number(turns)||8)));
 let count=0;for(let i=messages.length-1;i>=0;i--)if(messages[i].role==='user'&&++count===limit)return i;
 return count?0:Math.max(0,messages.length-limit);
}
export function missingBrand(brand){return !String(brand||'').trim()||/^(?:unknown|brand unknown|unknown brand|unbranded|무브랜드|브랜드 미상|불명)$/i.test(String(brand).trim());}
export function savedOutfitForMessages(branch,messages){
 const keys=prefixKeys(messages);for(let i=keys.length-1;i>=0;i--)if(branch.checkpoints[keys[i]])return branch.checkpoints[keys[i]].state;
 return branch.base;
}
export function outfitInjection(state){
 const clothes=outfitText(state,2,true);if(!clothes)return '';
 return "Previous-scene clothing only; current story input/output take priority. Never invent actions or reasons to preserve/change it. NEVER reproduce this note, tags, or list; NEVER add a clothing section. Mention clothing only when the scene needs it.\n"+clothes;
}
export function itemBrandLabel(item){return String(item.brand||'').trim()||'Brand pending';}
export function itemDescription(item,detail=2){
 const name=String(item.name||'').trim(),color=String(item.color||'').trim();
 const base=[detail>=2&&!name.toLowerCase().includes(color.toLowerCase())?color:'',name].filter(Boolean).join(' ');
 if(detail<3)return base;
 const features=[...new Set(item.features||[])].filter(value=>!base.toLowerCase().includes(value.toLowerCase())).slice(0,2);
 return base+(features.length?' ('+features.join(', ')+')':'');
}
export function outfitText(state, detail=2, brands=true){return ['character','persona'].flatMap((who)=>{const p=state?.people?.[who];if(!p||p.nude||!p.items.length)return [];return [(who==='character'?'Character':'Persona')+': '+p.items.map(i=>itemDescription(i,detail)+(brands&&i.brand?' ('+i.brand+')':'')).join(', ')+'.'];}).join('\n');}
export function replaceTags(value,content,{keep=true}={}){let found=0;const replaced=String(value).replace(/<kikki_outfit\s*>[\s\S]*?<\/kikki_outfit\s*>/gi,()=>{found++;return found===1&&keep?`<kikki_outfit>\n${content}\n</kikki_outfit>`:'';});return {text:replaced,found,malformed:(!found&&/<\/?kikki_outfit\b/i.test(value))};}
export function parseJSON(reply){if(typeof reply==='object'&&reply!==null&&!Array.isArray(reply))return reply;let str=String(reply??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const first=str.indexOf('{'),last=str.lastIndexOf('}');if(first>=0&&last>first)str=str.slice(first,last+1);let value;try{value=JSON.parse(str);}catch{throw Error('모델이 올바른 JSON 형식으로 응답하지 않았습니다. 자동으로 한 번 고쳐서 다시 확인합니다.');}if(!value||typeof value!=='object'||Array.isArray(value))throw Error('모델 응답이 JSON 객체 형식이 아닙니다.');return value;}
function item(raw){if(!raw||!CATEGORIES.includes(raw.category)||!text(raw.name,100))throw Error('아이템의 카테고리나 이름이 잘못되었습니다.');if(missingBrand(raw.brand))throw Error('새 의상의 브랜드 또는 제작 정보가 빠졌습니다. 다시 판독해 주세요.');return {id:text(raw.id,100)||'item-'+hash(JSON.stringify(raw)),category:raw.category,name:text(raw.name,100),color:text(raw.color,60),features:Array.isArray(raw.features)?raw.features.slice(0,6).map(x=>text(x,80)).filter(Boolean):[],brand:text(raw.brand,80),source:['추정 보유','기존 보유','구매','대여·지급'].includes(raw.source)?raw.source:'추정 보유',available:raw.available!==false};}
export function normalizeProfile(raw){const out={};for(const who of ['character','persona']){const p=raw[who];if(!p)continue;const fields={};for(const key of PROFILE_FIELDS){const f=p.fields?.[key];fields[key]={value:text(f?.value,Infinity)||'Unknown',certainty:['명시','추정','불명'].includes(f?.certainty)?f.certainty:'불명',evidence:text(f?.evidence,Infinity),locked:false};}const wardrobeHints={};for(const axis of ['type','fit','material','color','detail','brandSource']){const values=p.wardrobeHints?.[axis];if(Array.isArray(values))wardrobeHints[axis]=values.slice(0,24).map(v=>text(v,100)).filter(Boolean);}const wardrobeExceptions=Object.fromEntries(['top','bottom','outerwear','footwear'].filter(key=>text(p.wardrobeExceptions?.[key],300)).map(key=>[key,text(p.wardrobeExceptions[key],300)]));out[who]={fields,wardrobeHints,wardrobeExceptions,wardrobe:(Array.isArray(p.wardrobe)?p.wardrobe:[]).slice(0,60).map(item)};const ids=new Set();for(const i of out[who].wardrobe){if(ids.has(i.id))throw Error('옷장 아이템 ID가 중복되었습니다.');ids.add(i.id);}}if(!Object.keys(out).length)throw Error('분석 대상의 프로필이 없습니다.');return out;}
export function validateState(raw,wardrobes){const state=emptyState();for(const k of Object.keys(state.scene))state.scene[k]=text(raw.scene?.[k],150)||'불명';const added={character:[],persona:[]};for(const who of ['character','persona']){const p=raw.people?.[who];if(!p||typeof p.nude!=='boolean'||!Array.isArray(p.items))throw Error('착장 판독에 인물 상태가 누락되었습니다.');const registry=new Map((wardrobes[who]||[]).map(i=>[i.id,i]));for(const r of (raw.newItems?.[who]||[])){const i=item(r);if(!registry.has(i.id)){added[who].push(i);registry.set(i.id,i);}}
for(const update of (raw.brandUpdates?.[who]||[])){
 const existing=registry.get(update?.id),brand=text(update?.brand,80);
 if(!existing||!brand)throw Error('브랜드 보완 대상이나 브랜드명이 잘못되었습니다.');
 if(!missingBrand(existing.brand)){if(existing.brand!==brand)throw Error('이미 정해진 옷의 브랜드는 변경할 수 없습니다.');continue;}
 const completed={...clone(existing),brand};registry.set(completed.id,completed);
 const addedIndex=added[who].findIndex(i=>i.id===completed.id);if(addedIndex>=0)added[who][addedIndex]=completed;else added[who].push(completed);
}
const ids=new Set();for(const id of p.items){if(typeof id!=='string'||!registry.has(id)||!registry.get(id).available)throw Error('보유 옷에서 찾을 수 없는 아이템을 선택했습니다.');if(ids.has(id))continue;ids.add(id);state.people[who].items.push(clone(registry.get(id)));}if(p.nude&&ids.size)throw Error('완전 탈의와 착용 아이템이 동시에 지정되었습니다.');state.people[who].nude=p.nude;state.people[who].note=text(p.note,200);if(state.people[who].items.length>18)throw Error('착용 아이템이 너무 많습니다.');}return {state,added};}
const covered=person=>!person?.nude&&((person?.items||[]).some(i=>i.category==='상의')&&(person?.items||[]).some(i=>i.category==='하의')||(person?.items||[]).some(i=>i.category==='상의'&&/\b(?:dress|robe|gown|jumpsuit|romper)\b|원피스|드레스|로브/i.test(i.name)));
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
 load(){const raw=this.storage.getItem(KEY);if(!raw)return {version:1,settings:clone(DEFAULTS),characters:{}};try{const d=JSON.parse(raw);if(d.version!==1||!d.characters||typeof d.characters!=='object')throw Error();d.settings={...DEFAULTS,...d.settings,wardrobeLevel:wardrobeLevel(d.settings)};delete d.settings.wardrobeSize;delete d.settings.wardrobeLevels;return d;}catch{throw Error('저장 데이터가 손상되었습니다. 데이터 관리에서 초기화하세요.');}}
 save(){try{this.storage.setItem(KEY,JSON.stringify(this.data));}catch(error){this.invalidate();this.data=this.load();throw Error('저장 공간이 부족하거나 저장할 수 없습니다. 데이터 관리에서 정리하세요.',{cause:error});}}
 invalidate(){this.epoch++;}
 character(id){return this.data.characters[id];}
 createCharacter(id,name){this.data.characters[id]??={name,profiles:{},branches:{}};this.save();return this.character(id);}
 branch(id,bid){return this.character(id)?.branches[bid];}
 createBranch(id,name,copyFrom=null){const c=this.character(id);if(!c)throw Error('인물 분석을 먼저 시작하세요.');const bid=branchId();const copied=copyFrom?this.branch(id,copyFrom):null;c.branches[bid]={name:text(name,100)||'새 스토리',links:[],base:clone(copied?.current||emptyState()),current:clone(copied?.current||emptyState()),profiles:clone(copied?.profiles||c.profiles),reportTranslations:clone(copied?.reportTranslations||{}),analysisSources:clone(copied?.analysisSources||{targets:[],selected:{}}),extra:clone(copied?.extra||{character:[],persona:[]}),baseExtra:clone(copied?.extra||{character:[],persona:[]}),history:[],outfits:[],checkpoints:{},keys:[],outfitMemory:clone(copied?.outfitMemory||memoryFromStates([copied?.current||emptyState()])),baseMemory:clone(copied?.outfitMemory||memoryFromStates([copied?.current||emptyState()])),suspended:false};this.save();return bid;}
 bind(id,bid,chatId){for(const b of Object.values(this.character(id).branches))b.links=b.links.filter(x=>x!==chatId);const b=this.branch(id,bid);b.links.push(chatId);b.suspended=false;this.invalidate();this.save();}
 find(id,chatId){return Object.entries(this.character(id)?.branches||{}).find(([,b])=>b.links.includes(chatId));}
 deleteChat(id,chatId){const entry=this.find(id,chatId);if(!entry)return;const [bid,b]=entry;b.links=b.links.filter(x=>x!==chatId);if(!b.links.length)delete this.character(id).branches[bid];this.invalidate();this.save();}
 deleteBranch(id,bid){delete this.character(id)?.branches[bid];this.invalidate();this.save();}
 deleteCharacter(id){delete this.data.characters[id];this.invalidate();this.save();}
 deleteAll(){this.invalidate();this.storage.removeItem(KEY);this.data={version:1,settings:clone(DEFAULTS),characters:{}};}
 resetChat(id,chatId){const [bid,b]=this.find(id,chatId)||[];if(!b)return;if(b.links.length>1){b.links=b.links.filter(x=>x!==chatId);const fresh=this.createBranch(id,'초기화된 채팅');this.bind(id,fresh,chatId);this.branch(id,fresh).suspended=true;}else{b.base=emptyState();b.current=emptyState();b.history=[];b.outfits=[];b.extra={character:[],persona:[]};b.baseExtra={character:[],persona:[]};b.checkpoints={};b.keys=[];b.outfitMemory=memoryFromStates([]);b.baseMemory=memoryFromStates([]);b.suspended=true;}this.invalidate();this.save();}
}
export class Engine {
 constructor(store,request){this.store=store;this.request=request;this.controller=null;this.serial=0;}
 cancel(){this.serial++;this.controller?.abort();this.controller=null;}
 async read(id,bid,messages,{force=false,system,candidates=[],gate=false,onRequest=()=>{}}={}){this.cancel();const serial=this.serial,epoch=this.store.epoch,b=this.store.branch(id,bid);if(!b||b.suspended)return null;const keys=prefixKeys(messages),key=keys.at(-1)||'root';if(!force&&key===b.keys.at(-1))return b.current;
let baseline=clone(b.base),extra=clone(b.baseExtra||{character:[],persona:[]}),history=[],outfits=[],memory=clone(b.baseMemory||memoryFromStates([b.base])),start=0;for(let i=keys.length-1;i>=0;i--)if(b.checkpoints[keys[i]]){const cp=b.checkpoints[keys[i]];baseline=clone(cp.state);extra=clone(cp.extra);history=clone(cp.history);outfits=clone(cp.outfits);memory=clone(cp.outfitMemory||memoryFromStates([b.base,...cp.history,cp.state]));start=i+1;break;}
if(!force&&(start===messages.length||(gate&&!needsOutfitRead(messages,start)))){b.current=baseline;b.extra=extra;b.history=history;b.outfits=outfits;b.outfitMemory=memory;b.keys=keys;if(key)b.checkpoints[key]={state:clone(baseline),extra:clone(extra),history:clone(history),outfits:clone(outfits),outfitMemory:clone(memory)};for(const stale of Object.keys(b.checkpoints).slice(0,-80))delete b.checkpoints[stale];this.store.save();return baseline;}
const wardrobes=Object.fromEntries(['character','persona'].map(w=>[w,ownedItems({...b,extra,current:baseline},w)]));this.controller=new AbortController();const signal=this.controller.signal;
const windowStart=recentTurnStart(messages,this.store.data.settings.chatTurns);
onRequest();
const raw=await this.request(system,{profiles:b.profiles,wardrobes,baseline,outfitMemory:memory,recent:history.slice(-5),recentOutfits:outfits.slice(-10),contextMessages:messages.slice(windowStart,Math.max(windowStart,start)),messages:messages.slice(Math.max(start,windowStart)),omittedEarlierMessages:Math.max(0,windowStart-start),candidates,options:this.store.data.settings},signal);
if(signal.aborted||serial!==this.serial||epoch!==this.store.epoch||this.store.branch(id,bid)!==b)return null;const {state,added}=validateState(raw,wardrobes);const changed=JSON.stringify(state)!==JSON.stringify(baseline);b.outfitMemory=updateOutfitMemory(memory,baseline,state);b.current=state;b.keys=keys;b.extra=extra;b.history=history;b.outfits=outfits;for(const w of ['character','persona']){const merged=new Map(b.extra[w].map(i=>[i.id,i]));for(const i of added[w])merged.set(i.id,i);b.extra[w]=[...merged.values()];}if(changed){b.history.push(clone(baseline));b.history=b.history.slice(-5);const outfit=outfitText(state);if(outfit&&b.outfits.at(-1)!==outfit)b.outfits.push(outfit);b.outfits=b.outfits.slice(-10);}delete b.checkpoints[key];b.checkpoints[key]={state:clone(state),extra:clone(b.extra),history:clone(b.history),outfits:clone(b.outfits),outfitMemory:clone(b.outfitMemory)};const retained=Object.keys(b.checkpoints);for(const stale of retained.slice(0,-80))delete b.checkpoints[stale];this.store.save();this.controller=null;return state;}
}
