import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerStorage,FILE_NAME,FILE_PATH} from '../server-storage.js';
import {Store,KEY,compactStoredData,hash} from '../core.js';
import {visibleBounds,clampMascot,restoreMascot,rememberMascot} from '../mascot-position.js';
import {sanitizeSavedOutputs} from '../output-guard.js';

const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function server(){
 const s={files:new Map(),uploads:0,writes:[],deletes:[],fail:false,readsFail:false,failFile:null,failDelete:false};
 Object.defineProperty(s,'record',{get:()=>s.files.get(FILE_NAME)||null,set:record=>{if(record)s.files.set(FILE_NAME,record);else s.files.delete(FILE_NAME);}});
 s.data=()=>{const r=s.record;if(!r)return null;if(r.format===1)return r.data;if(r.transaction)return r.transaction.snapshot;if(r.data===null)return null;return {...r.data,characters:Object.fromEntries(Object.entries(r.characters).map(([id,ref])=>[id,s.files.get(ref.file)?.data]))};};
 s.fetch=async(url,options={})=>{
  if(url.startsWith('/user/files/')){if(s.readsFail)return new Response('',{status:503});const file=s.files.get(url.slice('/user/files/'.length));return file?Response.json(file):new Response('',{status:404});}
  if(url==='/api/files/verify'){const {urls}=JSON.parse(options.body);return Response.json(Object.fromEntries(urls.map(path=>[path,s.files.has(path.slice('user/files/'.length))])));}
  if(url==='/api/files/delete'){const {path}=JSON.parse(options.body);if(s.failDelete)return new Response('',{status:503});const name=path.slice('user/files/'.length);s.deletes.push(name);return new Response('',{status:s.files.delete(name)?200:404});}
  assert.equal(url,'/api/files/upload');assert.equal(options.headers['Content-Type'],'application/json');
  if(s.fail)return new Response('',{status:503});
  const body=JSON.parse(options.body);if(s.failFile?.(body.name))return new Response('',{status:503});s.files.set(body.name,JSON.parse(Buffer.from(body.data,'base64').toString('utf8')));s.uploads++;s.writes.push(body.name);return Response.json({path:'user/files/'+body.name});
 };
 s.client=async(legacy=memory(),onChange=()=>{})=>new ServerStorage({fetch:s.fetch,headers:()=>({'Content-Type':'application/json'}),legacy,onChange}).init();return s;
}
test('PC 자동 저장을 빈 모바일 저장소에서 읽고, 브라우저에는 옷장을 쓰지 않음',async()=>{
 const s=server(),legacy=memory(),pc=await s.client(legacy),store=new Store(pc);store.createCharacter('c','끼끼');const bid=store.createBranch('c','첫 이야기');store.bind('c',bid,'chat');await pc.flush();
 const mobile=await s.client();assert.equal(new Store(mobile).find('c','chat')[0],bid);assert.equal(legacy.getItem(KEY),null);assert.equal(s.files.size,2);assert.equal(s.record.transaction,undefined);assert.deepEqual(s.record.data.characters,{});
});
test('이전 브라우저 데이터는 서버 저장·검증 성공 후에만 제거',async()=>{
 const s=server(),legacy=memory(),old=new Store(legacy);old.createCharacter('c','기존 자료');s.fail=true;
 const first=await s.client(legacy);assert.ok(first.error);assert.ok(legacy.getItem(KEY));s.fail=false;await first.retry();assert.equal(legacy.getItem(KEY),null);assert.equal(s.data().characters.c.name,'기존 자료');
});
test('부분 삭제와 전체 삭제가 공유되고, 오래된 화면은 삭제된 데이터 재생성 금지',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');p.createCharacter('d','D');await pc.flush();
 const mobile=await s.client(),m=new Store(mobile);p.deleteCharacter('c');await pc.flush();await mobile.pull();assert.equal(new Store(mobile).character('c'),undefined);assert.ok(new Store(mobile).character('d'));
 m.data=new Store(mobile).data;p.deleteAll();await pc.flush();m.createCharacter('stale','오래된 화면');await assert.rejects(mobile.flush(),/다른 기기/);assert.equal(s.record.data,null);
 const legacy=memory();legacy.setItem(KEY,JSON.stringify(m.data));const reopened=await s.client(legacy);assert.equal(reopened.getItem(KEY),null);assert.equal(reopened.legacyAvailable,false);assert.equal(legacy.getItem(KEY),null);assert.equal(s.record.data,null);
});
test('서버 단절은 빈 저장소로 취급하거나 기존 서버 파일을 덮지 않음',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await pc.flush();const before=structuredClone(s.record);s.readsFail=true;
 const mobile=await s.client();assert.ok(mobile.error);assert.throws(()=>new Store(mobile).createCharacter('d','D'));assert.deepEqual(s.record,before);
});
test('업로드 실패는 실패 상태를 유지하고 명시적 재연결로 재시도',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);s.fail=true;p.createCharacter('c','C');await assert.rejects(pc.flush(),/저장하지 못/);assert.notEqual(pc.pending,undefined);assert.notEqual(pc.status,'서버 저장됨');s.fail=false;await pc.retry();assert.equal(s.data().characters.c.name,'C');
});
test('진행 중인 저장 뒤 전체 삭제가 반드시 마지막으로 저장됨',async()=>{
 const s=server();let release,started;const began=new Promise(resolve=>started=resolve),request=s.fetch;s.fetch=async(url,options)=>{if(url==='/api/files/upload'&&!release){await new Promise(resolve=>{release=resolve;started();});}return request(url,options);};
 const pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await began;p.deleteAll();release();await pc.flush();assert.equal(s.record.data,null);assert.equal(pc.getItem(KEY),null);
});
test('깨진 서버 파일을 자동 초기화하지 않음',async()=>{
 const s=server();s.record={format:1,revision:'r',data:{broken:true}};const before=structuredClone(s.record),pc=await s.client();assert.ok(pc.error);assert.equal(s.uploads,0);assert.deepEqual(s.record,before);
});
test('기존 서버가 있으면 이전 브라우저 자료는 명시적으로 가져오며 활성 브랜치를 덮지 않음',async()=>{
 const s=server(),legacy=memory(),old=new Store(legacy);old.createCharacter('c','C');const oldbid=old.createBranch('c','옛 이야기');old.bind('c',oldbid,'chat');
 const pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');const active=p.createBranch('c','새 이야기');p.bind('c',active,'chat');await pc.flush();
 const mobile=await s.client(legacy);assert.equal(Object.keys(new Store(mobile).character('c').branches).length,1);await mobile.importLegacy();const data=new Store(mobile);assert.equal(data.find('c','chat')[0],active);assert.equal(Object.keys(data.character('c').branches).length,2);assert.equal(legacy.getItem(KEY),null);
});
test('키보드·회전·확대된 화면과 안전영역 안에 좌표 제한',()=>{
 const desktop=visibleBounds(null,1440,900),mobile=visibleBounds({offsetLeft:30,offsetTop:120,width:320,height:280},360,780,{bottom:20});
 const old=restoreMascot({x:1,y:1},48,48,desktop),saved=rememberMascot({left:old.x,top:old.y,width:48,height:48},desktop);
 const moved=restoreMascot(saved,44,44,mobile);assert.equal(moved.x+44,mobile.right);assert.equal(moved.y+44,mobile.bottom);
 assert.deepEqual(clampMascot(-500,50000,44,44,mobile),{x:mobile.left,y:mobile.bottom-44});
 const fallback=restoreMascot({x:NaN,y:Infinity},44,44,mobile);assert.ok(fallback.x>=mobile.left&&fallback.y>=mobile.top);
});
test('캐릭터 파일은 연결 프로필·모델·프리셋 설정 변경과 분리되고 같은 이름으로 갱신',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c.png','C');p.createCharacter('d.png','D');p.character('c.png').profiles={character:{fields:{style:{value:'Casual'}},wardrobe:[{id:'shirt',name:'shirt'}]}};p.save();await pc.flush();
 const refs=structuredClone(s.record.characters),files=new Map([...s.files].filter(([name])=>name!==FILE_NAME).map(([name,value])=>[name,JSON.stringify(value)]));
 const before=s.writes.length;p.data.settings.profileId='another-model-profile';p.data.settings.preset='different preset';p.save();await pc.flush();
 assert.ok(s.writes.slice(before).every(name=>name===FILE_NAME));assert.deepEqual(s.record.characters,refs);for(const [name,content] of files)assert.equal(JSON.stringify(s.files.get(name)),content);
 const mobile=await s.client(),loaded=new Store(mobile);assert.deepEqual(loaded.character('c.png'),p.character('c.png'));assert.equal(loaded.data.settings.profileId,'another-model-profile');assert.equal(pc.characterPath('c.png'),'user/files/'+refs['c.png'].file);
 p.character('c.png').name='C changed';p.save();await pc.flush();assert.equal(s.record.characters['c.png'].file,refs['c.png'].file);assert.equal(JSON.stringify(s.files.get(refs['d.png'].file)),files.get(refs['d.png'].file));assert.equal(s.files.size,3);assert.equal(s.record.transaction,undefined);
 assert.equal(Object.hasOwn(s.files.get(refs['c.png'].file).data,'settings'),false);
});
test('기존 한 파일 저장소를 취향·옷장·브랜치 그대로 자동 분리하며 이전 중복 본문은 제거',async()=>{
 const s=server(),old=new Store(memory());old.createCharacter('c.png','C');const bid=old.createBranch('c.png','Story');old.bind('c.png',bid,'room');old.data.settings.profileId='old-profile';
 s.record={format:1,revision:'legacy',data:structuredClone(old.data)};const pc=await s.client();assert.equal(pc.error,null);assert.deepEqual(new Store(pc).data,old.data);assert.equal(s.record.format,2);assert.deepEqual(s.record.data.characters,{});assert.equal(s.files.size,2);assert.equal(s.record.transaction,undefined);assert.deepEqual(s.data(),old.data);
 const file=s.record.characters['c.png'].file;assert.deepEqual(s.files.get(file).data,old.character('c.png'));
});
test('캐릭터 파일 저장 중 실패해도 서버 복구 정보가 자료를 보존하고 다음 접속에서 완료',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);s.failFile=name=>name!==FILE_NAME;p.createCharacter('c.png','C');p.createCharacter('d.png','D');await assert.rejects(pc.flush(),/저장하지 못/);
 assert.deepEqual(s.record.transaction.snapshot.characters,p.data.characters);const refs=structuredClone(s.record.characters);s.failFile=null;
 const recovered=await s.client();assert.equal(recovered.error,null);assert.deepEqual(new Store(recovered).data,p.data);assert.deepEqual(s.record.characters,refs);assert.equal(s.record.transaction,undefined);assert.equal(s.files.size,3);
 await pc.retry();assert.deepEqual(s.record.characters,refs);assert.equal(s.files.size,3);
});
test('전체 삭제의 파일 정리가 실패하면 삭제 표시를 유지하고 재시도로 모든 캐릭터 파일 제거',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c.png','C');p.createCharacter('d.png','D');await pc.flush();s.failDelete=true;p.deleteAll();await assert.rejects(pc.flush(),/삭제를 완료하지 못/);
 assert.equal(s.record.data,null);assert.equal(s.record.transaction.snapshot,null);assert.equal(pc.getItem(KEY),null);assert.equal(s.files.size,3);
 s.failDelete=false;await pc.retry();assert.equal(s.files.size,1);assert.equal(s.record.transaction,undefined);assert.deepEqual(s.record.characters,{});assert.equal(s.record.data,null);
});
test('한 캐릭터 삭제는 그 파일만 지우며 다른 캐릭터 파일은 변경하지 않음',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c.png','C');p.createCharacter('d.png','D');await pc.flush();const refs=structuredClone(s.record.characters),other=JSON.stringify(s.files.get(refs['d.png'].file));p.deleteCharacter('c.png');await pc.flush();
 assert.equal(s.files.has(refs['c.png'].file),false);assert.equal(JSON.stringify(s.files.get(refs['d.png'].file)),other);assert.deepEqual(s.deletes,[refs['c.png'].file]);assert.equal(s.files.size,2);
});
test('없거나 다른 캐릭터의 파일을 빈 데이터로 간주하지 않고 덮어쓰기를 막음',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c.png','C');await pc.flush();const name=s.record.characters['c.png'].file,good=structuredClone(s.files.get(name)),writes=s.writes.length;
 s.files.delete(name);const missing=await s.client();assert.ok(missing.error);assert.equal(s.writes.length,writes);s.files.set(name,{...good,characterId:'other'});const mismatch=await s.client();assert.ok(mismatch.error);assert.equal(s.writes.length,writes);
});
test('손상된 파일 경로나 복구 삭제 목록으로 의상실 외 파일을 읽거나 지우지 않음',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await pc.flush();const original=structuredClone(s.record);s.record.characters.c.file='../settings.json';const bad=await s.client();assert.ok(bad.error);assert.deepEqual(s.deletes,[]);
 s.record={format:2,revision:'bad-delete',data:null,characters:{},transaction:{snapshot:null,deletes:['settings.json']}};const other=await s.client();assert.ok(other.error);assert.deepEqual(s.deletes,[]);assert.ok(s.files.size>=2);s.record=original;
});
test('서버는 저장했지만 응답이 끊긴 경우 자기 저장을 다른 기기 충돌로 오인하지 않고 복구',async()=>{
 const s=server(),request=s.fetch;let lose=true;s.fetch=async(url,options)=>{const response=await request(url,options);if(lose&&url==='/api/files/upload'){lose=false;throw Error('connection lost after commit');}return response;};
 const pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await assert.rejects(pc.flush(),/connection lost/);assert.ok(s.record.transaction);const ref=structuredClone(s.record.characters.c);await pc.retry();assert.equal(pc.error,null);assert.deepEqual(s.record.characters.c,ref);assert.equal(s.record.transaction,undefined);assert.equal(new Store(pc).character('c').name,'C');assert.equal(s.files.size,2);
});
test('정리는 알려진 미사용 파일만 지우고 사용 중인 캐릭터·공용 파일과 소유 미확인 파일을 보존',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await pc.flush();const active=s.record.characters.c.file,activeContents=JSON.stringify(s.files.get(active));
 const orphan='kikki-closet-character-orphan.json',mismatch='kikki-closet-character-other.json',missing='kikki-closet-character-gone.json';
 const old={format:1,characterId:'old',revision:'old',data:{name:'Old',profiles:{},branches:{}}};s.files.set(orphan,old);pc.cache.set(orphan,old);pc.cache.set(missing,old);pc.cache.set(mismatch,old);s.files.set(mismatch,{...old,characterId:'not-owned'});s.files.set('unrelated.json',{user:'file'});
 const result=await pc.cleanup();assert.equal(result.files,1);assert.equal(result.skipped,1);assert.equal(s.files.has(orphan),false);assert.equal(JSON.stringify(s.files.get(active)),activeContents);assert.equal(s.files.has(mismatch),true);assert.equal(s.files.has('unrelated.json'),true);assert.deepEqual(s.deletes,[orphan]);assert.equal(s.record.transaction,undefined);assert.deepEqual(new Store(pc).data,p.data);
 const again=await pc.cleanup();assert.equal(again.files,0);assert.equal(again.transactions,0);
});
test('정리 중 파일 삭제 실패는 삭제 대기 정보를 남기고 재접속·재정리로 완료',async()=>{
 const s=server(),pc=await s.client(),p=new Store(pc);p.createCharacter('c','C');await pc.flush();const name='kikki-closet-character-unused.json',record={format:1,characterId:'unused',revision:'r',data:{profiles:{},branches:{}}};s.files.set(name,record);pc.cache.set(name,record);s.failDelete=true;
 await assert.rejects(pc.cleanup(),/삭제를 완료하지 못/);assert.deepEqual(s.record.transaction.deletes,[name]);assert.equal(s.files.has(name),true);s.failDelete=false;const result=await pc.cleanup();assert.equal(result.files,1);assert.equal(s.record.transaction,undefined);assert.equal(s.files.has(name),false);assert.equal(new Store(pc).character('c').name,'C');
});
test('보관 한도 초과 기록과 만료 번역만 정리하며 옷장·착장·복원 정보와 유효 번역은 보존',()=>{
 const p=new Store(memory());p.createCharacter('c','C');const bid=p.createBranch('c','Story'),b=p.branch('c',bid);b.profiles.character={fields:{style:{value:'Quiet'}},wardrobe:[{id:'worn',name:'shirt'}]};b.current.people.character.items=[{id:'worn'}];b.extra.character=[{id:'owned-but-unworn'}];b.outfitMemory={character:{lastDressed:['worn'],beforeUndress:['worn']}};
 b.reportTranslations={character:{signature:hash(JSON.stringify(b.profiles.character.fields)),fields:{style:{value:'차분함'}}},persona:{signature:'stale',fields:{}}};b.history=Array.from({length:8},(_,i)=>({scene:i}));b.outfits=Array.from({length:12},(_,i)=>String(i));b.checkpoints=Object.fromEntries(Array.from({length:83},(_,i)=>['snapshot-'+i,{state:i}]));
 const before=structuredClone(p.data),result=compactStoredData(p.data),next=result.data.characters.c.branches[bid];assert.deepEqual(p.data,before);assert.deepEqual(result.removed,{translations:1,history:3,outfits:2,checkpoints:3});assert.deepEqual(next.profiles,b.profiles);assert.deepEqual(next.current,b.current);assert.deepEqual(next.extra,b.extra);assert.deepEqual(next.outfitMemory,b.outfitMemory);assert.deepEqual(next.reportTranslations.character,b.reportTranslations.character);assert.equal(next.reportTranslations.persona,undefined);assert.deepEqual(next.history,b.history.slice(-5));assert.equal(Object.keys(next.checkpoints).length,80);assert.equal(compactStoredData(result.data).total,0);
});
test('수동 채팅 정리는 내부 태그만 제거하고 사용자 원문·일반 서식·스와이프를 보존',async()=>{
 const c={chat:[{is_user:true,mes:'<kikki_outfit>user example</kikki_outfit>'},{is_user:false,mes:'Normal ```text\n```'},{is_user:false,mes:'Story<kikki_outfit>hidden</kikki_outfit>',swipes:['Another story','Second<kikki_outfit>hidden</kikki_outfit>']}],saveChat:async()=>{}};
 const result=await sanitizeSavedOutputs(()=>c,{report:true,onlyInternal:true});assert.deepEqual(result,{changed:true,messages:1,swipes:1});assert.equal(c.chat[0].mes,'<kikki_outfit>user example</kikki_outfit>');assert.equal(c.chat[1].mes,'Normal ```text\n```');assert.equal(c.chat[2].mes,'Story');assert.deepEqual(c.chat[2].swipes,['Another story','Second']);
});
test('채팅 정리 저장 실패는 성공으로 표시하지 않고 편집 전 메시지·스와이프로 복구',async()=>{
 const c={chat:[{is_user:false,mes:'Story<kikki_outfit>hidden</kikki_outfit>',swipes:['Alt<kikki_outfit>hidden</kikki_outfit>']}],saveChat:async()=>{throw Error('save failed');}},before=structuredClone(c.chat);
 await assert.rejects(sanitizeSavedOutputs(()=>c,{report:true,onlyInternal:true}),/save failed/);assert.deepEqual(c.chat,before);
});
