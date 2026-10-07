import {KEY,Store,clone,branchId} from './core.js';

export const FILE_NAME='kikki-closet-state.json';
export const FILE_PATH=`user/files/${FILE_NAME}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validate=data=>{if(data===null)return null;new Store({getItem:()=>JSON.stringify(data)});return data;};
const encode=text=>{let binary='';for(const byte of new TextEncoder().encode(text))binary+=String.fromCharCode(byte);return btoa(binary);};

// One account-scoped server file. No rolling files, browser data cache, or settings.json copy.
export class ServerStorage {
 constructor({fetch:request=(...args)=>globalThis.fetch(...args),headers,legacy,onChange=()=>{},onStatus=()=>{}}){
  Object.assign(this,{request,headers,legacy,onChange,onStatus});this.remote=null;this.value=null;this.pending=undefined;this.job=null;this.error=null;this.ready=false;this.status='서버 저장소 연결 중';this.legacyAvailable=false;
 }
 notify(status){this.status=status;this.onStatus(status);}
 async fetchRemote(){
  const response=await this.request(`/${FILE_PATH}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error(`서버 저장소를 읽지 못했습니다 (${response.status}).`);
  const record=await response.json();
  if(record?.format!==1||typeof record.revision!=='string'||!Object.hasOwn(record,'data'))throw Error('서버 저장소 형식을 읽을 수 없습니다. 기존 파일을 보존했습니다.');
  validate(record.data);return record;
 }
 async upload(record){
  const response=await this.request('/api/files/upload',{method:'POST',credentials:'same-origin',headers:this.headers(),body:JSON.stringify({name:FILE_NAME,data:encode(JSON.stringify(record))}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`서버에 저장하지 못했습니다 (${response.status}).`);
  const result=await response.json();
  if(String(result.path).replace(/^\//,'')!==FILE_PATH)throw Error('서버 저장 경로를 확인하지 못했습니다.');
 }
 async init(){
  try{
   this.remote=await this.fetchRemote();this.value=this.remote?.data??null;this.ready=true;this.error=null;
   if(this.remote?.data===null)this.clearLegacy();
   const old=this.legacy?.getItem(KEY);this.legacyAvailable=!!old;
   if(!this.remote&&old){
    this.value=validate(JSON.parse(old));this.setItem(KEY,JSON.stringify(this.value));await this.flush();this.clearLegacy();
   }
   this.error=null;this.notify('서버 저장됨');return this;
  }catch(error){this.error=error;this.ready=false;this.notify('서버 연결 실패 · 다시 연결하세요');return this;}
 }
 clearLegacy(){this.legacy?.removeItem(KEY);this.legacyAvailable=false;}
 getItem(){return this.value===null?null:JSON.stringify(this.value);}
 setItem(_key,raw){
  if(!this.ready||this.error)throw Error('서버 저장소 연결을 확인한 뒤 다시 시도하세요.');
  this.value=validate(JSON.parse(raw));this.pending=clone(this.value);this.notify('서버에 저장 중…');this.start();
 }
 removeItem(){
  if(!this.ready||this.error)throw Error('서버 저장소 연결을 확인한 뒤 다시 시도하세요.');
  this.value=null;this.pending=null;this.notify('서버에서 삭제 중…');this.start();
 }
 start(){
  if(this.job)return;
  this.job=Promise.resolve().then(()=>this.drain()).catch(error=>{this.error=error;this.notify(error.message);}).finally(()=>{this.job=null;});
 }
 async drain(){
  while(this.pending!==undefined){
   const latest=await this.fetchRemote();
   if(!equal(latest,this.remote)){
    this.pending=undefined;this.remote=latest;this.value=latest?.data??null;if(latest?.data===null)this.clearLegacy();this.onChange();
    throw Error('다른 기기에서 변경된 내용을 불러왔습니다. 다시 확인한 뒤 작업하세요.');
   }
   const data=this.pending;this.pending=undefined;
   const record={format:1,revision:branchId(),data};
   // An empty record retains only a revision, so stale clients cannot resurrect deleted data.
   try{await this.upload(record);const verified=await this.fetchRemote();
    if(!equal(verified,record)){this.pending=undefined;this.remote=verified;this.value=verified?.data??null;if(verified?.data===null)this.clearLegacy();this.onChange();throw Error('다른 기기의 동시 저장을 감지했습니다. 최신 내용을 확인하세요.');}
    this.remote=record;if(data===null)this.clearLegacy();
   }catch(error){if(this.pending===undefined&&equal(this.remote,latest))this.pending=data;throw error;}
  }
  this.notify('서버 저장됨');
 }
 async flush(){if(this.job)await this.job;if(this.error)throw this.error;}
 async pull(){
  await this.flush();if(!this.ready)throw Error('서버 저장소에 연결되지 않았습니다.');
  const record=await this.fetchRemote();
  // A local edit may have started while this request was in flight.
  if(this.job||this.pending!==undefined)return;
  if(!equal(record,this.remote)){this.remote=record;this.value=record?.data??null;if(record?.data===null)this.clearLegacy();this.onChange();}
  this.notify('서버 저장됨');
 }
 async retry(){
  if(!this.ready){await this.init();if(this.error)throw this.error;this.onChange();return;}
  this.error=null;if(this.pending!==undefined){this.start();await this.flush();}else await this.pull();
 }
 async importLegacy(){
  await this.pull();const raw=this.legacy?.getItem(KEY);if(!raw)return;
  const old=validate(JSON.parse(raw)),merged=clone(this.value||old);
  if(this.value)for(const [id,character] of Object.entries(old.characters)){
   if(!merged.characters[id]){merged.characters[id]=character;continue;}
   const target=merged.characters[id];
   for(const [bid,branch] of Object.entries(character.branches||{})){
    if(equal(branch,target.branches[bid]))continue;
    // Preserve server links and keep older stories selectable without overwriting active chats.
    target.branches[branchId()]={...branch,name:`${branch.name} · 이전 브라우저`,links:[]};
   }
  }
  this.setItem(KEY,JSON.stringify(merged));await this.flush();this.clearLegacy();this.onChange();
 }
}
