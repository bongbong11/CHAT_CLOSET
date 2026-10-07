import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerStorage,FILE_NAME,FILE_PATH} from '../server-storage.js';
import {Store,KEY} from '../core.js';
import {visibleBounds,clampMascot,restoreMascot,rememberMascot} from '../mascot-position.js';

const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function server(){
 const s={record:null,uploads:0,fail:false,readsFail:false};
 s.fetch=async(url,options={})=>{
  if(url===`/${FILE_PATH}`){if(s.readsFail)return new Response('',{status:503});return s.record?Response.json(s.record):new Response('',{status:404});}
  assert.equal(url,'/api/files/upload');assert.equal(options.headers['Content-Type'],'application/json');
  if(s.fail)return new Response('',{status:503});
  const body=JSON.parse(options.body);assert.equal(body.name,FILE_NAME);s.record=JSON.parse(Buffer.from(body.data,'base64').toString('utf8'));s.uploads++;return Response.json({path:FILE_PATH});
 };
 s.client=async(legacy=memory(),onChange=()=>{})=>new ServerStorage({fetch:s.fetch,headers:()=>({'Content-Type':'application/json'}),legacy,onChange}).init();return s;
}
test('PC 자동 저장을 빈 모바일 저장소에서 읽고, 브라우저에는 옷장을 쓰지 않음',async()=>{
 const s=server(),legacy=memory(),pc=await s.client(legacy),store=new Store(pc);store.createCharacter('c','끼끼');const bid=store.createBranch('c','첫 이야기');store.bind('c',bid,'chat');await pc.flush();
 const mobile=await s.client();assert.equal(new Store(mobile).find('c','chat')[0],bid);assert.equal(legacy.getItem(KEY),null);assert.equal(s.uploads,1);
});
test('이전 브라우저 데이터는 서버 저장·검증 성공 후에만 제거',async()=>{
 const s=server(),legacy=memory(),old=new Store(legacy);old.createCharacter('c','기존 자료');s.fail=true;
 const first=await s.client(legacy);assert.ok(first.error);assert.ok(legacy.getItem(KEY));s.fail=false;await first.retry();assert.equal(legacy.getItem(KEY),null);assert.equal(s.record.data.characters.c.name,'기존 자료');
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
 const s=server(),pc=await s.client(),p=new Store(pc);s.fail=true;p.createCharacter('c','C');await assert.rejects(pc.flush(),/저장하지 못/);assert.notEqual(pc.pending,undefined);assert.notEqual(pc.status,'서버 저장됨');s.fail=false;await pc.retry();assert.equal(s.record.data.characters.c.name,'C');
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
