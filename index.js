import {getContext} from '../../../extensions.js';
import {ConnectionManagerRequestService} from '../../shared.js';
import * as worldInfo from '../../../world-info.js';
import {Store,Engine,normalizeProfile,clone,outfitText,prefixKeys,outfitInjection,savedOutfitForMessages} from './core.js';
import {ANALYSIS,SCENE,candidates} from './prompts.js';
import {createHost,injectPayload} from './host.js';
import {createUI} from './ui.js';
import {translateReport} from './profile-report.js';
import {installOutputGuard,sanitizeSavedOutputs} from './output-guard.js';
import {ServerStorage} from './server-storage.js';

const host=createHost(getContext,ConnectionManagerRequestService,worldInfo);
const outputGuard=installOutputGuard(getContext);
let legacyStorage;try{legacyStorage=localStorage;}catch{}
const storage=await new ServerStorage({headers:()=>getContext().getRequestHeaders(),legacy:legacyStorage}).init();
const store=new Store(storage);
const settings=()=>store.data.settings;
const engine=new Engine(store,(system,data,signal)=>host.request(settings().profileId,system,data,signal,'scene'));
let analysisController=null,revision=0,timer=null,prepared=null,pending=false,injectionError='',runningRead=null,readId=0,generating=false;
const cancel=()=>{revision++;readId++;engine.cancel();analysisController?.abort();analysisController=null;runningRead=null;pending=false;prepared=null;clearTimeout(timer);ui.toast(false);};
const current=()=>{const i=host.identity();if(!i)return null;const pair=store.find(i.id,i.chat);return pair?{i,bid:pair[0],b:pair[1]}:null;};
const state=()=>{const v=current();return {identity:host.identity(),character:host.identity()?store.character(host.identity().id):null,branch:v?.b,bid:v?.bid,settings:settings(),injectionError,pending,storageStatus:storage.status,legacyAvailable:storage.legacyAvailable};};
async function read(chat=host.context().chat,force=false){
 await storage.pull();
 const v=current();if(!settings().enabled||!v||v.b.suspended||generating)return v?.b.current||null;
 if(v.b.personaKey&&v.b.personaKey!==v.i.personaKey)throw Error('페르소나가 변경되었습니다. 새 브랜치를 만들거나 취향을 재분석하세요.');
 const messages=host.messages(chat),messageKey=prefixKeys(messages).at(-1)||'root';
 const key=JSON.stringify([v.i.id,v.bid,messageKey,settings().chatTurns,settings().profileId]);
 if(runningRead?.key===key)return runningRead.promise;
 const id=++readId;
 const promise=(async()=>{
  try{
   if(!messages.length){engine.cancel();v.b.current=clone(v.b.base);v.b.extra=clone(v.b.baseExtra||{character:[],persona:[]});v.b.keys=[];v.b.history=[];v.b.outfits=[];store.save();return v.b.current;}
   return await engine.read(v.i.id,v.bid,messages,{force,gate:true,system:SCENE,candidates:candidates(Math.random,v.b.profiles),onRequest:()=>{pending=true;ui.toast(true);ui.refresh();}});
  }finally{try{await storage.flush();}finally{if(id===readId){runningRead=null;pending=false;ui.toast(false);ui.refresh();}}}
 })();
 runningRead={id,key,messageKey,promise};return promise;
}
async function analyze(selection){
 await storage.pull();
 const targets=selection?.targets||[];
 if(targets.length!==1||!['character','persona'].includes(targets[0]))throw Error('분석할 대상을 먼저 선택하세요.');
 const who=targets[0],sources=selection.sources?.[who];
 if(!sources?.sheet?.source&&!sources?.lore?.length)throw Error('선택한 대상의 시트나 로어북 엔트리를 먼저 가져오세요.');
 cancel();const i=host.identity();if(!i)throw Error('개별 캐릭터 채팅을 먼저 여세요.');
 const rev=revision,epoch=store.epoch;analysisController=new AbortController();const controller=analysisController,signal=controller.signal;
 ui.toast(true);
 try{
  const data={targets:[who],sources:{[who]:sources},fixedOutfit:settings().fixed,wardrobeSize:settings().wardrobeSize};
  const raw=await host.request(settings().profileId,ANALYSIS,data,signal,'analysis');
  if(signal.aborted||rev!==revision||epoch!==store.epoch||host.identity()?.id!==i.id||host.identity()?.chat!==i.chat||host.identity()?.personaKey!==i.personaKey)return false;
  if(!raw[who])throw Error('선택한 대상의 분석 결과가 빠져 있습니다. 다시 분석해 주세요.');
  const result=normalizeProfile({[who]:raw[who]})[who];
  const c=store.createCharacter(i.id,i.name);
  let v=current();
  if(!v){const bid=store.createBranch(i.id,'기본 스토리');store.bind(i.id,bid,i.chat);v=current();}
  const old=v.b.profiles[who];
  for(const [key,field] of Object.entries(old?.fields||{}))if(field.locked)result.fields[key]=clone(field);
  const wardrobe=new Map(result.wardrobe.map(item=>[item.id,item]));
  for(const item of old?.wardrobe||[])wardrobe.set(item.id,clone(item));
  for(const item of v.b.current.people[who].items)wardrobe.set(item.id,clone(item));
  result.wardrobe=[...wardrobe.values()];
  v.b.profiles[who]=result;
  // First analysis establishes a reusable base; later story changes stay in their branch.
  if(!c.profiles[who]){c.profiles[who]=clone(result);if(who==='persona')c.personaKey=i.personaKey;}
  const previous=v.b.analysisSources||{targets:[],selected:{}};
  v.b.analysisSources={targets:[...new Set([...previous.targets,who])],selected:{...previous.selected,[who]:(sources.lore||[]).map(x=>JSON.stringify([x.book,String(x.uid)]))}};
  v.b.personaKey=i.personaKey;v.b.suspended=false;v.b.checkpoints={};v.b.keys=[];
  store.save();await storage.flush();ui.refresh();return true;
 }finally{if(analysisController===controller){analysisController=null;ui.toast(false);}}
}
async function newBranch(mode,name,bid){await storage.pull();cancel();const i=host.identity();if(!i)throw Error('캐릭터 채팅을 여세요.');if(!store.character(i.id))throw Error('취향 분석을 먼저 실행하세요.');let target=bid;if(mode==='existing'&&store.branch(i.id,bid)?.personaKey&&store.branch(i.id,bid).personaKey!==i.personaKey)throw Error('이 브랜치의 페르소나가 다릅니다. 새 브랜치를 만들어 분석하세요.');if(mode!=='existing')target=store.createBranch(i.id,name,mode==='copy'?current()?.bid:null);const targetBranch=store.branch(i.id,target);if(mode!=='existing'&&store.character(i.id).personaKey!==i.personaKey){delete targetBranch.profiles.persona;targetBranch.current.people.persona={nude:false,items:[]};targetBranch.base.people.persona={nude:false,items:[]};targetBranch.extra.persona=[];targetBranch.baseExtra.persona=[];}store.bind(i.id,target,i.chat);store.branch(i.id,target).personaKey=i.personaKey;store.save();ui.refresh();}
const ui=createUI({base:new URL('.',import.meta.url),state,profiles:()=>host.profiles(),sheet:kind=>host.sheet(kind),lore:kind=>host.lore(kind),analyze,read:()=>read(undefined,true),newBranch,
 flush:()=>storage.flush(),retryStorage:()=>storage.retry(),importLegacy:()=>storage.importLegacy(),
 translateProfile:(profile,signal)=>translateReport(profile,(system,data,requestSignal)=>host.request(settings().profileId,system,data,requestSignal,'translation'),signal),
 updateSettings(patch){if(Object.keys(patch).some(key=>!['mascot','mascotPosition','mascotPositions','mascotLocked'].includes(key)))cancel();if(patch.enabled)outputGuard.install?.();Object.assign(settings(),patch);store.save();ui.refresh();},
 saveProfiles(profiles){cancel();const v=current();if(!v)return;v.b.profiles=profiles;store.save();ui.refresh();},
 promote(){const v=current();if(!v)return;store.character(v.i.id).profiles=clone(v.b.profiles);store.save();},
 saveOutfit(people){cancel();const v=current();if(!v)return;v.b.current.people=people;v.b.base=clone(v.b.current);v.b.baseExtra=clone(v.b.extra);v.b.checkpoints={};v.b.keys=prefixKeys(host.messages());const last=v.b.keys.at(-1);if(last)v.b.checkpoints[last]={state:clone(v.b.current),extra:clone(v.b.extra),history:clone(v.b.history),outfits:clone(v.b.outfits)};store.save();ui.refresh();},
 async testConnection(){return host.request(settings().profileId,'Return only {"ok":true}.',{},new AbortController().signal,'test').then(x=>{if(x.ok!==true)throw Error('연결 확인 응답이 잘못되었습니다.');});},
 remove(kind,bid){cancel();const i=host.identity();if(kind==='all'){store.deleteAll();outputGuard.remove();}else if(i){if(kind==='chat')store.resetChat(i.id,i.chat);if(kind==='branch')store.deleteBranch(i.id,bid||current()?.bid);if(kind==='character')store.deleteCharacter(i.id);}ui.refresh();},
});
// Main RP generation never waits for, or asks for output from, the wardrobe reader.
globalThis.kikkiClosetInterceptor=(_chat,_size,abort,type)=>{
 prepared=null;if(!settings().enabled||['quiet','impersonate'].includes(type))return;
 if(!outputGuard.safe()){ui.error('출력 차단을 위해 실리를 업데이트하거나 기본 Regex 확장을 켜주세요.');abort(true);return;}
 const v=current();if(!v||v.b.suspended)return;
 if(v.b.personaKey&&v.b.personaKey!==v.i.personaKey){ui.error('페르소나가 변경되었습니다. 취향을 재분석하거나 새 브랜치를 연결하세요.');return;}
 let messages=host.messages();
 if(['swipe','regenerate'].includes(type)&&messages.at(-1)?.role==='character')messages=messages.slice(0,-1);
 const snapshot=savedOutfitForMessages(v.b,messages);
 prepared={revision,character:v.i.id,chat:v.i.chat,content:outfitInjection(snapshot)};
};
const {eventSource,eventTypes}=host.context();
function outgoing(payload,dryRun){if(dryRun)return;const i=host.identity();const valid=prepared&&prepared.revision===revision&&prepared.character===i?.id&&prepared.chat===i?.chat;const content=settings().enabled&&valid?prepared.content:'';const r=injectPayload(payload,content,settings().enabled);injectionError=settings().enabled?(r.malformed?'착장 태그 짝을 확인하세요.':!r.found?'모델 입력에 착장 태그가 없습니다. 인포블록 설정을 확인하세요.':''):'';ui.refresh();}
if(eventTypes.GENERATE_AFTER_DATA)eventSource.on(eventTypes.GENERATE_AFTER_DATA,outgoing);
const schedule=()=>{
 if(!settings().enabled||!settings().auto||generating||analysisController)return;
 const messageKey=prefixKeys(host.messages()).at(-1)||'root';
 if(runningRead&&runningRead.messageKey!==messageKey){engine.cancel();readId++;runningRead=null;pending=false;ui.toast(false);}
 clearTimeout(timer);timer=setTimeout(()=>{if(!generating)read().catch(e=>{if(e.name!=='AbortError')ui.error(e.message);});},300);
};
if(eventTypes.GENERATION_STARTED)eventSource.on(eventTypes.GENERATION_STARTED,(type,_options,dryRun)=>{
 if(dryRun||['quiet','impersonate'].includes(type))return;generating=true;clearTimeout(timer);
});
for(const key of ['MESSAGE_RECEIVED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED'])if(eventTypes[key])eventSource.on(eventTypes[key],async()=>{await sanitizeSavedOutputs(getContext);schedule();});
if(eventTypes.GENERATION_ENDED)eventSource.on(eventTypes.GENERATION_ENDED,()=>{generating=false;schedule();});
if(eventTypes.CHAT_CHANGED)eventSource.on(eventTypes.CHAT_CHANGED,()=>{generating=false;cancel();ui.refresh();});
if(eventTypes.GENERATION_STOPPED)eventSource.on(eventTypes.GENERATION_STOPPED,()=>{generating=false;cancel();ui.toast(false);});
if(eventTypes.CHAT_DELETED)eventSource.on(eventTypes.CHAT_DELETED,name=>{cancel();const i=host.identity();if(i)store.deleteChat(i.id,String(name).replace(/\.jsonl$/,''));ui.refresh();});
if(eventTypes.CHAT_RENAMED)eventSource.on(eventTypes.CHAT_RENAMED,data=>{cancel();const id=String(data.avatarId||host.identity()?.id||'');const c=store.character(id);if(c){const old=String(data.oldFileName||'').replace(/\.jsonl$/,'');const fresh=String(data.newFileName||'').replace(/\.jsonl$/,'');for(const b of Object.values(c.branches))b.links=b.links.map(x=>x===old?fresh:x);store.save();}ui.refresh();});
storage.onChange=()=>{cancel();store.invalidate();store.data=store.load();if(settings().enabled)outputGuard.install?.();else outputGuard.remove();ui.remoteRefresh();};
storage.onStatus=()=>ui.storageStatus();
let syncing=false;
async function syncFromServer(){if(syncing||document.hidden)return;syncing=true;try{await storage.pull();}catch(error){storage.notify(error.message);}finally{syncing=false;}}
window.addEventListener('focus',syncFromServer);
window.addEventListener('pageshow',syncFromServer);
document.addEventListener('visibilitychange',syncFromServer);
setInterval(syncFromServer,15000);
window.addEventListener('beforeunload',event=>{if(storage.job||storage.pending!==undefined){event.preventDefault();event.returnValue='';}});
// Hide/unhide has no dedicated event in some ST versions. Compare actual context on the next generation.
const chatElement=document.querySelector('#chat');
if(chatElement)new MutationObserver(changes=>{if(changes.some(c=>c.type==='attributes'&&c.attributeName==='is_system'))schedule();}).observe(chatElement,{subtree:true,attributes:true,attributeFilter:['is_system']});
ui.mount();
if(storage.error)ui.error(storage.error.message);
