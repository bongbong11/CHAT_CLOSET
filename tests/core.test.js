import {DiagnosticLog,parseJSON,sceneSummary} from '../core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,KEY,emptyState,replaceTags,validateState,outfitText,visibleMessages,normalizeProfile} from '../core.js';
import {injectPayload,createHost} from '../host.js';
import {stripOutfitBlocks,installOutputGuard,sanitizeSavedOutputs} from '../output-guard.js';
import {ANALYSIS,SCENE} from '../prompts.js';
import {toModelData,fromModelData} from '../model-schema.js';
const mem=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
test('연결 서비스 내부의 JSON 파싱 실패도 고정 지시와 실행 데이터를 분리해 한 번 재시도',async()=>{let calls=0;const seen=[];const service={getProfile:()=>({}),validateProfile:()=>{},sendRequest:async(_id,messages)=>{seen.push(messages);if(++calls===1)throw new SyntaxError("Expected ',' or '}' after property value in JSON at position 16153");return {content:'{"ok":true}'};}};const h=createHost(()=>({}),service,{});assert.deepEqual(await h.request('p','Return JSON.',{},new AbortController().signal,'test'),{ok:true});assert.equal(calls,2);assert.equal(seen[1].length,2);assert.match(seen[1][0].content,/RESPONSE REPAIR/);assert.deepEqual(JSON.parse(seen[1][1].content),{});});
const shoe={id:'shoe',name:'sneakers',category:'신발',color:'white',features:['canvas'],labelKo:'흰색 운동화',brandKo:'컨버스',brand:'CONVERSE',available:true};
function setup(request){const storage=mem(),s=new Store(storage);s.createCharacter('c','끼끼');s.character('c').profiles={character:{fields:{},wardrobe:[shoe]}};const id=s.createBranch('c','첫 장면');s.bind('c',id,'chat');return {s,id,storage,e:new Engine(s,request,async()=>({newItems:{character:[{...shoe,id:'coat',name:'cardigan',category:'겉옷'}]}}))};}
const legacyRaw=(items=[],nude=false)=>{const state=emptyState();state.people.character={...state.people.character,nude,items:items.map(id=>id==='shoe'?shoe:{id})};return state;};
const raw=(items=[],nude=false)=>({scene:{place:'Street',activity:'Moving',time:'Morning'},changes:{character:{actions:nude?[{op:'nude'}]:[{op:'remove',category:'신발'},...items.map(id=>({op:'wear',category:id==='shoe'?'신발':'겉옷',name:id==='shoe'?'sneakers':'cardigan'}))]}}});
const msg=(content,swipe=0)=>({id:'1',swipe,role:'character',content});
test('외출 판독 후 보유 신발을 저장하고 주입은 착장만 만든다',async()=>{const {s,id,e}=setup(async()=>raw(['shoe']));await e.read('c',id,[msg('외출 준비를 하고 나갔다.')]);assert.equal(s.branch('c',id).current.people.character.items[0].id,'shoe');assert.equal(outfitText(s.branch('c',id).current),'Character: white sneakers (CONVERSE).');});
test('태그 내용 교체, 중복 제거, 비활성 제거, 파손 감지',()=>{const str='<kikki_outfit>OLD</kikki_outfit> X <kikki_outfit>OLD2</kikki_outfit>';const r=replaceTags(str,'NEW');assert.equal(r.found,2);assert.equal(r.text,'<kikki_outfit>\nNEW\n</kikki_outfit> X ');assert.equal(replaceTags(str,'',{keep:false}).text,' X ');assert.equal(replaceTags('<kikki_outfit>','x').malformed,true);});
test('최종 요청의 여러 메시지에서 태그는 한 번만 채움',()=>{const p={prompt:[{role:'system',content:'<kikki_outfit>old</kikki_outfit>'},{role:'assistant',content:'<kikki_outfit>older</kikki_outfit>'}]};assert.equal(injectPayload(p,'NOW').found,2);assert.equal(p.prompt[1].content,'');assert.match(p.prompt[0].content,/NOW/);});
test('불명과 탈의를 구분하고 미등록 ID·모순 응답 거절',()=>{assert.throws(()=>validateState(legacyRaw(['missing']),{character:[shoe],persona:[]}));assert.throws(()=>validateState(legacyRaw(['shoe'],true),{character:[shoe],persona:[]}));assert.equal(validateState(legacyRaw([],true),{character:[shoe],persona:[]}).people.character.nude,true);assert.equal(outfitText(emptyState()),'');});
test('스와이프 변경 시 버린 답변에서 추가한 옷 제거, 재선택 복원',async()=>{const coat={...shoe,id:'coat',name:'가디건',category:'겉옷'};const {s,id,e}=setup(async(_sys,data)=>data.messages.at(-1)?.swipe===0?raw(['coat'],false,[coat]):raw(['shoe']));await e.read('c',id,[msg('가디건을 샀다.',0)]);assert.equal(s.branch('c',id).extra.character.length,1);await e.read('c',id,[msg('신발만 신었다.',1)]);assert.equal(s.branch('c',id).extra.character.length,0);await e.read('c',id,[msg('가디건을 샀다.',0)]);assert.equal(s.branch('c',id).extra.character.length,1);assert.equal(s.branch('c',id).current.people.character.items[0].name,'cardigan');});
test('하이드·편집은 활성 문맥만 반영',async()=>{const {s,id,e}=setup(async(_sys,d)=>raw(d.messages.some(m=>m.content.includes('신발'))?['shoe']:[]));await e.read('c',id,[msg('신발을 신음')]);await e.read('c',id,[msg('옷을 벗음',1)]);assert.equal(s.branch('c',id).current.people.character.items.length,0);assert.equal(visibleMessages([{is_system:true,mes:'숨김'},{is_user:true,mes:'보임'}]).length,1);});
test('삭제 후 늦게 온 판독 결과는 데이터를 되살리지 않음',async()=>{let finish;const {s,id,e,storage}=setup(()=>new Promise(resolve=>finish=resolve));const p=e.read('c',id,[msg('외출')]);s.deleteAll();finish(raw(['shoe']));assert.equal(await p,null);assert.equal(storage.getItem(KEY),null);assert.deepEqual(s.data.characters,{});});
test('새 판독이 시작되면 오래된 결과 무시',async()=>{const calls=[];const {s,id,e}=setup(()=>new Promise(resolve=>calls.push(resolve)));const a=e.read('c',id,[msg('첫 답변')]);const b=e.read('c',id,[msg('다른 답변',1)]);calls[1](raw([]));await b;calls[0](raw(['shoe']));assert.equal(await a,null);assert.equal(s.branch('c',id).current.people.character.items.length,0);});
test('공유 브랜치의 한 채팅 삭제는 다른 채팅 보존, 마지막 연결 삭제는 브랜치 제거',()=>{const {s,id}=setup();s.bind('c',id,'other');s.deleteChat('c','chat');assert.ok(s.branch('c',id));s.deleteChat('c','other');assert.equal(s.branch('c',id),undefined);assert.ok(s.character('c').profiles.character);});
test('공유 채팅 초기화는 분리하고 자동 재생성 중단',()=>{const {s,id}=setup();s.bind('c',id,'other');s.resetChat('c','chat');assert.ok(s.branch('c',id));const [newId,b]=s.find('c','chat');assert.notEqual(newId,id);assert.equal(b.suspended,true);assert.deepEqual(b.extra.character,[]);});
test('상황 5개, 조합 10개 이내 유지',async()=>{let n=0;const {s,id,e}=setup(async()=>{const r=raw(n%2?['shoe']:[]);r.scene.time=String(n++);return r;});const messages=[];for(let i=0;i<18;i++){messages.push({...msg('시간 '+i),id:String(i)});await e.read('c',id,messages);}assert.equal(s.branch('c',id).history.length,5);assert.ok(s.branch('c',id).outfits.length<=10);});
test('손상 저장소 자동 덮어쓰기 없이 보고',()=>{const storage=mem();storage.setItem(KEY,'broken');assert.throws(()=>new Store(storage),/손상/);assert.equal(storage.getItem(KEY),'broken');});
test('프로필은 근거를 보존하고 중복 ID 거절',()=>{assert.throws(()=>normalizeProfile({character:{wardrobe:[shoe,shoe]}}),/중복/);const p=normalizeProfile({character:{fields:{'직업':{value:'학생',certainty:'명시',evidence:'시트'}},wardrobe:[shoe]}});assert.equal(p.character.fields['직업'].evidence,'시트');});
test('연결 프로필 요청에 모델 지시와 자료를 분리하고 신호 전달',async()=>{let passed;const service={getProfile:()=>({}),validateProfile:()=>{},sendRequest:async(...args)=>{passed=args;return {content:'{"ok":true}'};}};const h=createHost(()=>({}),service,{});assert.deepEqual(await h.request('p','SYS',{a:1},new AbortController().signal),{ok:true});assert.equal(passed[0],'p');assert.equal(passed[1][0].role,'system');assert.equal(passed[3].includePreset,false);assert.equal(passed[3].includeInstruct,false);});
test('스트리밍의 모든 접두 구간에서 내부 태그·내용이 보이지 않음',()=>{const block='<kikki_outfit>PRIVATE SECRET</kikki_outfit>';for(let i=1;i<=block.length;i++){const result=stripOutfitBlocks('안녕 '+block.slice(0,i));assert.doesNotMatch(result,/PRIVATE|SECRET|kikki_outfit/);}assert.equal(stripOutfitBlocks('전 '+block+' 후'),'전  후');assert.equal(stripOutfitBlocks('```xml\n'+block+'\n```'),'');assert.equal(stripOutfitBlocks('&lt;kikki_outfit&gt;PRIVATE&lt;/kikki_outfit&gt;'),'');});
test('출력 포맷터 차단은 사용자 입력을 보존하고 AI 출력만 제거',()=>{let hook;installOutputGuard(()=>({messageFormatter:{stage:{BEFORE_REGEX:'before'},addHook:f=>hook=f}}));const t='<kikki_outfit>hidden</kikki_outfit>';assert.equal(hook(t,{isUser:false}),'');assert.equal(hook(t,{isUser:true}),t);});
test('완료된 답변과 모든 스와이프에서 내부 블록을 제거하고 저장',async()=>{let saves=0;const c={chat:[{is_user:false,mes:'대사<kikki_outfit>hidden</kikki_outfit>',swipes:['<kikki_outfit>old</kikki_outfit>다른 대사']},{is_user:true,mes:'<kikki_outfit>user</kikki_outfit>'}],saveChat:async()=>saves++};await sanitizeSavedOutputs(()=>c);assert.equal(c.chat[0].mes,'대사');assert.equal(c.chat[0].swipes[0],'다른 대사');assert.match(c.chat[1].mes,/user/);assert.equal(saves,1);});
test('구버전 출력 필터는 전체 삭제 시 자신의 규칙만 제거',()=>{const c={extensionSettings:{regex:[{id:'user-rule'}],disabledExtensions:[]},saveSettingsDebounced(){}};const guard=installOutputGuard(()=>c);assert.equal(c.extensionSettings.regex.length,3);assert.equal(guard.safe(),true);c.extensionSettings.disabledExtensions.push('regex');assert.equal(guard.safe(),false);guard.remove();assert.deepEqual(c.extensionSettings.regex,[{id:'user-rule'}]);});
test('구버전 필터도 스트리밍 접두·이스케이프 블록을 차단',()=>{const c={extensionSettings:{regex:[],disabledExtensions:[]}};installOutputGuard(()=>c);const spec=c.extensionSettings.regex[0].findRegex;const re=new RegExp(spec.slice(1,spec.lastIndexOf('/')),spec.slice(spec.lastIndexOf('/')+1));const block='<kikki_outfit>PRIVATE</kikki_outfit>';for(let i=1;i<=block.length;i++)assert.doesNotMatch(('앞 '+block.slice(0,i)).replace(re,''),/PRIVATE|kikki_outfit/);assert.equal('&lt;kikki_outfit&gt;PRIVATE&lt;/kikki_outfit&gt;'.replace(re,''),'');});
test('복제 브랜치는 추가된 옷도 그대로 사용 가능',async()=>{const coat={...shoe,id:'coat',name:'가디건',category:'겉옷'};const {s,id,e}=setup(async()=>raw(['coat'],false,[coat]));await e.read('c',id,[msg('가디건을 입음')]);const copied=s.createBranch('c','복제',id);const b=s.branch('c',copied);const copyEngine=new Engine(s,async()=>raw(['coat']));await copyEngine.read('c',copied,[msg('계속 입고 있음')]);assert.equal(b.current.people.character.items[0].name,'cardigan');});
test('중첩된 내부 블록도 내용 전체 제거',()=>{assert.equal(stripOutfitBlocks('전<kikki_outfit>OUTER<kikki_outfit>INNER</kikki_outfit>TAIL</kikki_outfit>후'),'전후');});
test('생성 프롬프트는 세계관·문화권·SPA·중고 원브랜드를 존중한다',()=>{assert.match(ANALYSIS,/historical or fantasy/i);assert.match(ANALYSIS,/SPA/);assert.match(ANALYSIS,/Source AU\/setting rules/);assert.match(ANALYSIS,/original brands for second-hand/);});
test('분석된 세계관과 복식 선택지를 보존한다',()=>{const p=normalizeProfile({character:{fields:{'세계관':{value:'Harry Potter AU',certainty:'명시',evidence:'Selected lore'}},wardrobe:[],wardrobeHints:{type:['school robe','casual knit']}}});assert.equal(p.character.fields['세계관'].value,'Harry Potter AU');assert.deepEqual(p.character.wardrobeHints.type,['school robe','casual knit']);});
test('모델 지시문과 구조 키는 영어이고 한국어 저장 형식을 왕복 변환',()=>{assert.doesNotMatch(ANALYSIS+SCENE,/[가-힣]/);const model=toModelData({character:{fields:{'직업':{value:'학생',certainty:'명시'}},wardrobe:[shoe]}});assert.ok(model.character.fields.occupation);assert.equal(model.character.wardrobe[0].category,'footwear');const stored=fromModelData(model);assert.equal(stored.character.fields['직업'].certainty,'명시');assert.equal(stored.character.wardrobe[0].category,'신발');});
test('캐릭터 설명·성격 요약과 연결된 로어북 엔트리만 불러옴',async()=>{const context=()=>({characterId:0,characters:[{avatar:'a.png',data:{name:'A',description:'설명',personality:'성격',scenario:'제외',extensions:{world:'책'}}}],powerUserSettings:{}});const world={world_info:{charLore:[]},loadWorldInfo:async()=>({entries:{1:{comment:'사용',content:'내용'},2:{comment:'꺼짐',content:'제외',disable:true}}})};const h=createHost(context,{},world);const sheet=await h.sheet('character');assert.match(sheet.source,/DESCRIPTION:\n설명/);assert.match(sheet.source,/PERSONALITY:\n성격/);assert.doesNotMatch(sheet.source,/제외/);const lore=await h.lore('character');assert.deepEqual(lore.map(x=>x.title),['사용']);});
test('깨진 JSON은 자동 교정하고 영문 파싱 위치 오류를 노출하지 않음',async()=>{let calls=0;const service={getProfile:()=>({}),validateProfile:()=>{},sendRequest:async()=>({content:++calls===1?'{"ok": true':'{"ok":true}'})};const h=createHost(()=>({}),service,{});assert.deepEqual(await h.request('p','Return JSON.',{},new AbortController().signal,'test'),{ok:true});assert.equal(calls,2);const bad={...service,sendRequest:async()=>({content:'{"bad":'})};const broken=createHost(()=>({}),bad,{});await assert.rejects(()=>broken.request('p','Return JSON.',{},new AbortController().signal,'test'),error=>error.kind==='incomplete'&&!/position|column|Expected/.test(error.message));});

test('장면 표기 차이와 로컬에서 읽는 텍스트는 모델을 재호출하지 않는다',async()=>{
 for(const content of ['{"Changes":{"CHAR":{"Context":{"LOCATION":"Home.","PHASE":"rest"},"Actions":null}},"sceneKo":{"place":"Main room"}}','Character:\nLocation: home\nPhase: resting']){
  let calls=0;const service={getProfile:()=>({model:'fixture'}),validateProfile(){},async sendRequest(){calls++;return {content};}};
  const result=await createHost(()=>({}),service,{}).request('p','Scene',{},new AbortController().signal,'scene');
  assert.equal(calls,1);assert.equal(result.facts.changes.character.context.location,'home');assert.notEqual(result.outcome,'unusable');
 }
});
test('문장 응답은 의미를 복구하고 실패한 복구는 두 번째 호출에서 끝난다',async()=>{
 for(const recovered of ['{"changes":{"character":{"context":{"location":"outside","phase":"outdoors"}}}}','I cannot determine the scene.']){
  let calls=0;const seen=[];const service={getProfile:()=>({}),validateProfile(){},async sendRequest(_id,messages){seen.push(messages);return {content:++calls===1?'Alex has left the house.':recovered};}};
  const result=await createHost(()=>({}),service,{}).request('p','Scene',{people:{character:{name:'Alex'}}},new AbortController().signal,'scene');
  assert.equal(calls,2);assert.equal(result.outcome,recovered.startsWith('{')?'applied':'unusable');assert.equal(seen[1].length,2);assert.deepEqual(Object.keys(JSON.parse(seen[1][1].content)).sort(),['people','reply']);assert.doesNotMatch(seen[1][0].content,/blood-pressure|watching media|pregnancy|sleeping\/preparing/i);assert.match(seen[1][0].content,/sleeping\|preparing/);
 }
});
test('JSON 포장의 마침표·중괄호와 trailing comma는 문자열 내용까지 바꾸지 않는다',()=>{
 const payload=JSON.stringify({note:'a,} b { c "quoted"',changes:{}}).replace(/}$/,',}');
 const value=parseJSON('Here is the result: '+payload+' Done.');
 assert.equal(value.note,'a,} b { c "quoted"');assert.deepEqual(value.changes,{});
});

test('진단 로그는 원문·원인·순서를 복사하고 비밀값과 저장 데이터는 분리한다',()=>{
 const events=[],logger=new DiagnosticLog({console:{groupCollapsed(){},info:v=>events.push(v),warn(){},error(){},groupEnd(){}}});
 const task=logger.start('scene',{chat:'a',apiKey:'secret'});task.event('response','응답 수신',{raw:'He is barefoot.',headers:{Authorization:'Bearer secret'},usage:{output_tokens:25}});
 const error=Error('failed',{cause:Error('root cause')});task.fail(error,'decision');logger.error(error);
 const copied=JSON.parse(logger.copy());assert.equal(copied.records.length,1);assert.equal(copied.records[0].events[1].data.raw,'He is barefoot.');assert.match(logger.copy(),/root cause/);assert.doesNotMatch(logger.copy(),/Bearer secret|"apiKey": "secret"/);assert.equal(events.length,3);assert.doesNotMatch(JSON.stringify(events),/Bearer secret|"apiKey":"secret"/);
 logger.clear();assert.equal(logger.list().length,0);
});
test('진단 로그는 개수·용량 제한을 지키고 잘림을 명시한다',()=>{
 const logs=new DiagnosticLog({limit:3,bytes:4096,console:null});
 for(let i=0;i<8;i++)logs.start('test',{n:i}).finish('completed','done');
 assert.equal(logs.list().length,3);
 const task=logs.start('scene');task.event('response','수신',{raw:'A'.repeat(30000)});task.finish('completed','done');
 assert.ok(new TextEncoder().encode(JSON.stringify(logs.records)).length<=4096);assert.equal(logs.list()[0].truncated,true);
});

test('Vertex 404는 응답 형식 복구로 재시도하지 않고 실제 연결 오류와 원인을 남긴다',async()=>{
 let calls=0;const root=Error('Google Vertex AI API returned error: 404 Not Found JSON publisher gemini-4-argon was not found or project has no access');
 const service={getProfile:()=>({}),validateProfile(){},sendRequest:async()=>{calls++;throw Error('API request failed',{cause:root});}};
 const logs=new DiagnosticLog({console:null}),host=createHost(()=>({}),service,{},{logs});
 await assert.rejects(host.request('p','Scene',{},new AbortController().signal,'scene'),e=>e.kind==='connection'&&e.status===404&&e.cause.cause===root);
 assert.equal(calls,1);assert.match(logs.copy(),/gemini-4-argon/);assert.match(logs.copy(),/모델 연결 실패/);
});

test('JSON 파싱 위치 404는 HTTP 404와 혼동하지 않는다',async()=>{
 let calls=0;const service={getProfile:()=>({}),validateProfile(){},async sendRequest(){if(++calls===1)throw new SyntaxError('Unexpected JSON at position 404');return {content:'{"ok":true}'};}};
 assert.deepEqual(await createHost(()=>({}),service,{}).request('p','JSON',{},new AbortController().signal,'test'),{ok:true});assert.equal(calls,2);
});

test('정상 changes 빈 응답과 Vertex 응답 포장은 형식 오류 없이 해석하고 수집된 상황을 표시한다',async()=>{
 let calls=0;const service={getProfile:()=>({}),validateProfile(){},async sendRequest(){calls++;return {candidates:[{content:{role:'model',parts:[{text:'{"changes":{}}',thoughtSignature:'do not collect'}]}}]};}};
 const result=await createHost(()=>({}),service,{}).request('p','Scene',{},new AbortController().signal,'scene');
 assert.equal(calls,1);assert.equal(result.outcome,'unchanged');assert.deepEqual(result.facts,{changes:{}});
 const summary=sceneSummary({people:{character:{context:{location:'home',phase:'resting',temperature:16,weather:'mild'}}},sceneKo:{}});
 assert.equal(summary.place,'집');assert.equal(summary.activity,'휴식');assert.equal(summary.weather,'온화 · 16℃');
});


test('콘솔은 동시 작업도 완료마다 한 묶음으로 출력하고 진행 로그는 즉시 보존한다',()=>{
 const calls=[],stack=[];
 const output={groupCollapsed(title){calls.push({kind:'group',title,depth:stack.length});stack.push(title);},groupEnd(){assert.ok(stack.length);stack.pop();}};
 for(const level of ['info','warn','error'])output[level]=data=>calls.push({kind:level,data,depth:stack.length});
 const logs=new DiagnosticLog({console:output}),a=logs.start('scene'),b=logs.start('storage');
 a.event('response','응답',{raw:'model result'});a.event('decision','매칭',{kept:true});
 assert.equal(calls.length,0);assert.equal(logs.list().find(row=>row.id===a.id).events.length,3);
 b.finish('saved','저장 완료');assert.equal(stack.length,0);
 a.event('parse','복구 성공',{attempt:1},'warn');a.finish('applied','완료');a.finish('applied','중복');
 const roots=calls.filter(c=>c.kind==='group'&&c.depth===0);
 assert.equal(roots.length,2);assert.match(roots[0].title,/서버 저장/);assert.match(roots[1].title,/장면 판독.*경고 1/);
 for(const category of ['수집·모델 응답','착장 판단','저장·결과','경고·오류'])assert.ok(calls.some(c=>c.kind==='group'&&c.depth===1&&c.title.startsWith(category)));
 assert.equal(stack.length,0);assert.equal(logs.list().find(row=>row.id===a.id).events.length,5);
});

test('콘솔 그룹 미지원과 출력 실패도 오류 원문 복사와 판독 완료를 막지 않는다',()=>{
 const calls=[],logs=new DiagnosticLog({console:{error:(...args)=>calls.push(args)}}),trace=logs.start('scene');
 trace.event('response','수신',{raw:'original'});const error=Error('connection failure');trace.fail(error);logs.error(error);
 assert.equal(calls.length,1);assert.match(calls[0][0],/오류 1/);assert.equal(calls[0][1].events[1].data.raw,'original');assert.match(logs.copy(),/connection failure/);
 const broken=new DiagnosticLog({console:{groupCollapsed(){throw Error('console unavailable');}}});
 assert.doesNotThrow(()=>broken.start('storage').finish('saved','완료'));assert.equal(broken.list()[0].outcome,'saved');
});

test('장면은 5000토큰과 원본 응답을 사용하고 한도 초과 시 원자료로 한 번만 다시 판독한다',async()=>{
 const seen=[],logs=new DiagnosticLog({console:null}),payload={people:{character:{name:'C'},persona:{name:'P'}},messages:[{role:'character',content:'Both people arrived.'}]};
 const service={getProfile:()=>({model:'gemini'}),validateProfile(){},async sendRequest(id,messages,tokens,options){seen.push({messages,tokens,options});return seen.length===1?{candidates:[{content:{parts:[{thought:true,text:'do not retain reasoning'},{text:'{"changes":{"character":'}]},finishReason:'MAX_TOKENS'}],usageMetadata:{thoughtsTokenCount:1343,candidatesTokenCount:53}}:{choices:[{message:{content:'{"changes":{"character":{"context":{"location":"outside"}},"persona":{"context":{"location":"outside"}}}}'},finish_reason:'stop'}],usage:{completion_tokens:70}};}};
 const result=await createHost(()=>({}),service,{},{logs}).request('p',SCENE,payload,new AbortController().signal,'scene');
 assert.equal(seen.length,2);assert.ok(seen.every(call=>call.tokens===5000&&call.options.extractData===false));assert.deepEqual(seen[0].messages,seen[1].messages);assert.equal(seen[1].messages[0].content,SCENE);assert.deepEqual(JSON.parse(seen[1].messages[1].content),payload);
 assert.equal(result.facts.changes.persona.context.location,'outside');const events=logs.list()[0].events;assert.ok(events.some(e=>e.stage==='response'&&e.data.finishReason==='MAX_TOKENS'&&e.data.usage.thoughtsTokenCount===1343));assert.doesNotMatch(logs.copy(),/do not retain reasoning/);
});

test('명시된 한도 초과와 메타정보 없는 잘린 JSON 모두 일부 복구를 적용하지 않는다',async()=>{
 for(const metadata of [true,false]){
  let count=0;const seen=[],service={getProfile:()=>({}),validateProfile(){},async sendRequest(id,messages){count++;seen.push(messages);return metadata?{choices:[{message:{content:'{"changes":{"character":{"actions":[{"op":"remove","category":"bottom","name":"jeans"}]}}}'},finish_reason:'length'}]}:{content:'{"changes":{"character":{"actions":[{"op":"remove"'};}};
  const host=createHost(()=>({}),service,{}),h=setup((_s,data,signal)=>host.request('p',SCENE,data,signal,'scene')),before=structuredClone(h.s.branch('c',h.id));
  assert.equal(await h.e.read('c',h.id,[msg('He changed clothes.')]),null);assert.equal(count,2);assert.deepEqual(seen[0],seen[1]);assert.deepEqual(h.s.branch('c',h.id),before);
 }
});

test('메타정보 없는 잘린 응답 뒤 전체 응답이 오면 페르소나를 포함해 해석한다',async()=>{
 let count=0;const seen=[],service={getProfile:()=>({}),validateProfile(){},async sendRequest(id,messages){seen.push(messages);return {content:++count===1?'{"changes":{"character":':'{"changes":{"persona":{"context":{"location":"home"}}}}'};}};
 const result=await createHost(()=>({}),service,{}).request('p',SCENE,{people:{persona:{name:'P'}}},new AbortController().signal,'scene');assert.equal(count,2);assert.deepEqual(seen[0],seen[1]);assert.equal(result.facts.changes.persona.context.location,'home');
});

test('원본 text completion 응답과 usage도 기존 JSON 계약으로 읽는다',async()=>{
 const service={getProfile:()=>({}),validateProfile(){},async sendRequest(){return {results:[{text:'{"ok":true}'}],usage:{completion_tokens:4}};}};
 assert.deepEqual(await createHost(()=>({}),service,{}).request('p','Return JSON.',{},new AbortController().signal,'test'),{ok:true});
});
