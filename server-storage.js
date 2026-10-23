import {KEY,Store,clone,branchId} from './core.js';

export const FILE_NAME='kikki-closet-state.json';
export const FILE_PATH=`user/files/${FILE_NAME}`;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const same=(a,b)=>a?.revision===b?.revision&&equal(a?.data,b?.data);
const validate=data=>{if(data===null)return null;if(!object(data)||!object(data.settings)||!object(data.characters))throw Error('저장 데이터가 손상되었습니다. 기존 파일을 보존했습니다.');new Store({getItem:()=>JSON.stringify(data)});for(const value of Object.values(data.characters))if(!object(value)||!object(value.profiles)||!object(value.branches))throw Error('캐릭터 저장 데이터가 손상되었습니다. 기존 파일을 보존했습니다.');return data;};
const encode=text=>{let binary='';for(const byte of new TextEncoder().encode(text))binary+=String.fromCharCode(byte);return btoa(binary);};
export const characterFile=name=>/^kikki-closet-character-[a-z0-9-]+\.json$/.test(name);
const conflict=()=>Error('다른 기기에서 변경된 내용을 불러왔습니다. 다시 확인한 뒤 작업하세요.');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Settings/catalog + one stable file per character, independent of model/preset IDs.
// A temporary snapshot in the catalog makes interrupted multi-file saves recoverable.
// It is removed only after every character write/deletion has been verified.
export class ServerStorage {
 constructor({fetch:request=(...args)=>globalThis.fetch(...args),headers,legacy,onChange=()=>{},onStatus=()=>{}}){
  Object.assign(this,{request,headers,legacy,onChange,onStatus});this.remote=null;this.value=null;this.pending=undefined;this.job=null;this.error=null;this.ready=false;this.status='서버 저장소 연결 중';this.legacyAvailable=false;this.cache=new Map();this.attempt=null;this.cleanupCandidates=[];this.deletedFiles=0;this.completedTransactions=0;
 }
 notify(status){this.status=status;this.onStatus(status);}
 characterPath(id){const file=this.remote?.manifest?.characters?.[id]?.file;return file?`user/files/${file}`:'';}
 async fetchFile(name){
  if(name!==FILE_NAME&&!characterFile(name))throw Error('의상실 저장 파일 경로가 잘못되었습니다.');
  const response=await this.request(`/user/files/${name}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error(`서버 저장소를 읽지 못했습니다 (${response.status}).`);
  return response.json();
 }
 async fetchRemote(){
  const manifest=await this.fetchFile(FILE_NAME);if(!manifest)return null;
  if(typeof manifest.revision!=='string'||!Object.hasOwn(manifest,'data'))throw Error('서버 저장소 형식을 읽을 수 없습니다. 기존 파일을 보존했습니다.');
  if(manifest.format===1){validate(manifest.data);return manifest;}
  if(manifest.format!==2||!object(manifest.characters))throw Error('서버 저장소 형식을 읽을 수 없습니다. 기존 파일을 보존했습니다.');
  validate(manifest.data);
  if(manifest.data!==null&&Object.keys(manifest.data.characters).length)throw Error('캐릭터 저장 목록 형식이 잘못되었습니다. 기존 파일을 보존했습니다.');
  const refs=Object.entries(manifest.characters),files=new Set();
  for(const [id,ref] of refs){if(!id||!object(ref)||!characterFile(ref.file)||typeof ref.revision!=='string'||files.has(ref.file))throw Error('캐릭터 저장 목록이 손상됐습니다. 기존 파일을 보존했습니다.');files.add(ref.file);}
  let data;
  if(manifest.transaction){
   const tx=manifest.transaction;validate(tx.snapshot);
   if(!Array.isArray(tx.deletes)||tx.deletes.some(name=>!characterFile(name)||files.has(name))||!equal(Object.keys(tx.snapshot?.characters||{}).sort(),refs.map(([id])=>id).sort())||!equal(manifest.data,tx.snapshot===null?null:{...tx.snapshot,characters:{}}))throw Error('저장 복구 정보를 읽을 수 없습니다. 기존 파일을 보존했습니다.');
   data=tx.snapshot;
  }else if(manifest.data===null){if(refs.length)throw Error('삭제된 저장소에 캐릭터 목록이 남아 있습니다.');data=null;}
  else{
   const characters=[];
   for(const [id,ref] of refs){let file=this.cache.get(ref.file);if(file?.revision!==ref.revision)file=await this.fetchFile(ref.file);
    if(file?.format!==1||file.characterId!==id||file.revision!==ref.revision||!object(file.data?.profiles)||!object(file.data?.branches))throw Error('캐릭터 저장 파일이 없거나 일치하지 않습니다. 기존 데이터를 덮어쓰지 않았습니다.');
    this.cache.set(ref.file,file);characters.push([id,file.data]);
   }
   data={...manifest.data,characters:Object.fromEntries(characters)};validate(data);
  }
  return {format:2,revision:manifest.revision,data,manifest};
 }
 async upload(record,name=FILE_NAME){
  if(name!==FILE_NAME&&!characterFile(name))throw Error('의상실 저장 파일 경로가 잘못되었습니다.');
  const response=await this.request('/api/files/upload',{method:'POST',credentials:'same-origin',headers:this.headers(),body:JSON.stringify({name,data:encode(JSON.stringify(record))}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`서버에 저장하지 못했습니다 (${response.status}).`);
  const result=await response.json();
  if(String(result.path).replace(/^\//,'')!==`user/files/${name}`)throw Error('서버 저장 경로를 확인하지 못했습니다.');
 }
 async assertCurrent(manifest){const actual=await this.fetchFile(FILE_NAME);if(actual?.format!==2||actual.revision!==manifest.revision)throw conflict();return actual;}
 async verifyFiles(names){
  if(!names.length)return {};
  if(names.some(name=>!characterFile(name)))throw Error('정리 대상 파일 경로가 잘못되었습니다.');
  const response=await this.request('/api/files/verify',{method:'POST',credentials:'same-origin',headers:this.headers(),body:JSON.stringify({urls:names.map(name=>`user/files/${name}`)}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('정리 대상 파일을 확인하지 못했습니다. 파일을 보존했습니다.');
  const raw=await response.json();if(names.some(name=>typeof raw[`user/files/${name}`]!=='boolean'))throw Error('파일 확인 응답이 올바르지 않습니다. 파일을 보존했습니다.');
  return Object.fromEntries(names.map(name=>[name,raw[`user/files/${name}`]]));
 }
 async finishTransaction(manifest){
  if(!manifest.transaction)return manifest;
  const snapshot=manifest.transaction.snapshot;
  for(const [id,ref] of Object.entries(manifest.characters)){
   const expected={format:1,characterId:id,revision:ref.revision,data:snapshot.characters[id]};
   await this.assertCurrent(manifest);const existing=await this.fetchFile(ref.file);
   if(!equal(existing,expected)){await this.assertCurrent(manifest);await this.upload(expected,ref.file);if(!equal(await this.fetchFile(ref.file),expected))throw Error('캐릭터 파일 저장을 확인하지 못했습니다. 복구 정보를 유지합니다.');}
   this.cache.set(ref.file,expected);
  }
  const exists=await this.verifyFiles(manifest.transaction.deletes);
  for(const name of manifest.transaction.deletes){
   await this.assertCurrent(manifest);
   if(!exists[name]){this.cache.delete(name);continue;}
   const response=await this.request('/api/files/delete',{method:'POST',credentials:'same-origin',headers:this.headers(),body:JSON.stringify({path:`user/files/${name}`}),signal:AbortSignal.timeout(15000)});
   if((!response.ok&&response.status!==404)||(await this.verifyFiles([name]))[name])throw Error('캐릭터 저장 파일 삭제를 완료하지 못했습니다. 다시 연결하면 정리를 재시도합니다.');
   this.cache.delete(name);this.deletedFiles++;
  }
  const current=await this.assertCurrent(manifest);if(!current.transaction)return current;
  const clean={...manifest};delete clean.transaction;
  await this.upload(clean);if(!equal(await this.fetchFile(FILE_NAME),clean))throw conflict();
  this.completedTransactions++;
  return clean;
 }
 async init(){
  try{
   this.remote=await this.fetchRemote();this.value=this.remote?.data??null;this.ready=true;this.error=null;
   if(this.remote?.manifest?.transaction){await this.finishTransaction(this.remote.manifest);this.remote=await this.fetchRemote();this.value=this.remote?.data??null;}
   if(this.remote?.data===null)this.clearLegacy();
   const old=this.legacy?.getItem(KEY);this.legacyAvailable=!!old;
   if((this.remote?.format===1&&this.value!==null)||(!this.remote&&old)){
    const importing=!this.remote;if(importing)this.value=validate(JSON.parse(old));this.setItem(KEY,JSON.stringify(this.value));await this.flush();if(importing)this.clearLegacy();
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
   let latest=await this.fetchRemote();
   if(this.attempt&&latest?.revision===this.attempt.revision&&equal(latest.data,this.attempt.data))this.remote=latest;
   if(!same(latest,this.remote)){
    this.pending=undefined;this.cleanupCandidates=[];this.attempt=null;this.remote=latest;this.value=latest?.data??null;if(latest?.data===null)this.clearLegacy();this.onChange();
    throw Error('다른 기기에서 변경된 내용을 불러왔습니다. 다시 확인한 뒤 작업하세요.');
   }
   if(latest?.manifest?.transaction){await this.finishTransaction(latest.manifest);latest=await this.fetchRemote();this.remote=latest;}
   const data=this.pending;this.pending=undefined;
   if(latest?.format===2&&equal(data,latest.data)&&!this.cleanupCandidates.length){this.attempt=null;continue;}
   const previous=latest?.manifest?.characters||{},characters=Object.fromEntries(Object.entries(data?.characters||{}).map(([id,character])=>{
    const ref=previous[id];return [id,{file:ref?.file||`kikki-closet-character-${branchId()}.json`,revision:ref&&equal(character,latest.data?.characters[id])?ref.revision:branchId()}];
   }));
   const used=new Set(Object.values(characters).map(ref=>ref.file)),deletes=[...new Set([...Object.values(previous).map(ref=>ref.file),...this.cleanupCandidates])].filter(file=>!used.has(file));
   const manifest={format:2,revision:branchId(),data:data===null?null:{...data,characters:{}},characters,transaction:{snapshot:data,deletes}};
   // Commit a recoverable snapshot before touching stable character files or deleting any.
   try{
    this.attempt={revision:manifest.revision,data};
    await this.upload(manifest);const committed=await this.fetchRemote();
    if(committed?.revision!==manifest.revision||!equal(committed.data,data))throw conflict();
    this.remote=committed;
    await this.finishTransaction(manifest);this.remote=await this.fetchRemote();this.attempt=null;this.cleanupCandidates=[];if(data===null)this.clearLegacy();
   }catch(error){
    const actual=await this.fetchRemote().catch(()=>null);
    if(actual&&actual.revision!==latest?.revision&&actual.revision!==manifest.revision){this.pending=undefined;this.cleanupCandidates=[];this.attempt=null;this.remote=actual;this.value=actual.data;if(actual.data===null)this.clearLegacy();this.onChange();throw conflict();}
    if(actual?.revision===manifest.revision&&equal(actual.data,data))this.remote=actual;
    if(this.pending===undefined)this.pending=data;throw error;
   }
  }
  this.notify('서버 저장됨');
 }
 async flush(){if(this.job)await this.job;if(this.error)throw this.error;}
 async pull(){
  await this.flush();if(!this.ready)throw Error('서버 저장소에 연결되지 않았습니다.');
  const record=await this.fetchRemote();
  // A local edit may have started while this request was in flight.
  if(this.job||this.pending!==undefined)return;
  if(!same(record,this.remote)){this.remote=record;this.value=record?.data??null;if(record?.data===null)this.clearLegacy();this.onChange();}
  this.notify('서버 저장됨');
 }
 async retry(){
  if(!this.ready){await this.init();if(this.error)throw this.error;this.onChange();return;}
  this.error=null;if(this.pending!==undefined){this.start();await this.flush();}else await this.pull();
 }
 async cleanup(){
  const files=this.deletedFiles,transactions=this.completedTransactions;
  await this.retry();await this.pull();
  const used=new Set(Object.values(this.remote?.manifest?.characters||{}).map(ref=>ref.file));
  const candidates=[...this.cache.keys()].filter(name=>characterFile(name)&&!used.has(name)),exists=await this.verifyFiles(candidates);let skipped=0;
  for(const name of candidates){
   if(!exists[name]){this.cache.delete(name);continue;}
   let record;try{record=await this.fetchFile(name);}catch(error){if(error instanceof SyntaxError){skipped++;continue;}throw error;}
   if(record?.format!==1||record.characterId!==this.cache.get(name)?.characterId||!object(record.data?.profiles)||!object(record.data?.branches)){skipped++;continue;}
   this.cleanupCandidates.push(name);
  }
  if(this.value===null)this.removeItem(KEY);else this.setItem(KEY,JSON.stringify(this.value));await this.flush();
  const live=new Set(Object.values(this.remote?.manifest?.characters||{}).map(ref=>ref.file));for(const name of this.cache.keys())if(!live.has(name))this.cache.delete(name);
  return {files:this.deletedFiles-files,transactions:this.completedTransactions-transactions,skipped};
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
