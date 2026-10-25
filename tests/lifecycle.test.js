import {visibleMessages} from '../core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {needsOutfitRead} from '../scene-gate.js';
import {Store,Engine,DiagnosticLog,outfitInjection,savedOutfitForMessages,emptyState,recentTurnStart} from '../core.js';

const m=(id,content)=>({id:String(id),role:'character',content});
const info=time=>`<Scene_Info><small>Time: ${time} | Date: 2026.10.07\nLoc: Living room\nWeather: Clear · 20°C\n🔥: 20%</small></Scene_Info>`;
test('같은 장소의 일반 대화와 분 단위 인포 변화는 판독하지 않음',()=>{
 const messages=[m(0,'집에서 대화한다.'+info('14:00')),m(1,'그는 미소 지으며 질문에 답했다.'+info('14:03'))];
 assert.equal(needsOutfitRead(messages,1),false);assert.equal(needsOutfitRead(messages,0),true);
 assert.equal(needsOutfitRead([m(0,'At the party.'),m(1,'Her blue dress caught the light as she smiled.')],1),false);
});
test('같은 장소의 환복·출발·장소·큰 시간 변화는 판독',()=>{
 for(const change of ['그는 셔츠를 벗었다.','외출 준비를 마치고 현관으로 나섰다.','He took off his shoes.','다음 날 아침이 되었다.',info('16:00'),info('14:03').replace('Living room','Office')])assert.equal(needsOutfitRead([m(0,info('14:00')),m(1,change)],1),true,change);
});
test('변화 없는 메시지를 저장하고 중복 이벤트는 모델 호출하지 않음',async()=>{
 const s=new Store({getItem:()=>null,setItem(){},removeItem(){}});s.createCharacter('c','C');const bid=s.createBranch('c','B');s.bind('c',bid,'chat');let count=0,notices=0;
 const engine=new Engine(s,async()=>{count++;return {scene:{place:'Home'},changes:{character:{actions:[{op:'nude'}]}}};});
 const messages=[m(0,'At home.')],options={gate:true,onRequest:()=>notices++};await engine.read('c',bid,messages,options);
 messages.push(m(1,'He smiles and answers.'));await engine.read('c',bid,messages,options);await engine.read('c',bid,messages,options);
 assert.equal(count,1);assert.equal(notices,1);assert.equal(s.branch('c',bid).keys.length,2);
 messages[1].content='He puts on a shirt.';await engine.read('c',bid,messages,options);assert.equal(count,2);
 messages[1].content='He smiles and answers.';await engine.read('c',bid,messages,options);assert.equal(count,2);
});
test('주입은 현재 착장만 포함하며 내부 규칙·상태·설명은 넣지 않는다',()=>{
 const state=emptyState();state.people.character.items=[{name:'dress shirt',color:'white',features:['cotton twill','spread collar'],brand:'UNIQLO'}];
 const value=outfitInjection(state);assert.equal(value,'Character: white dress shirt (UNIQLO).');assert.doesNotMatch(value,/cotton|collar|weather|profiles|Never|priority|conditions/);
 assert.equal(outfitInjection(emptyState()),'');assert.deepEqual(savedOutfitForMessages({base:state,checkpoints:{}},[]),state);
});

test('장식된 인포블록의 현재 장소를 읽고 긴 답변 끝의 인포도 보존한다',()=>{
 const before=m(0,'<Scene_Info>📍 **Location:** Home</Scene_Info>');
 const after=m(1,'<Scene_Info>📍 **Location:** Street</Scene_Info>');
 assert.equal(needsOutfitRead([before,after],1),true);
 const [long]=visibleMessages([{is_user:false,mes:'긴 본문'.repeat(4000)+'<Scene_Info>Location: Street</Scene_Info>'}]);
 assert.match(long.content,/<Scene_Info>Location: Street/);assert.ok(long.content.length<12100);
});

test('현재 옷 보기는 이미 처리한 답변도 실제 판독 대상으로 보내고 이전 행동은 배경으로 분리한다',async()=>{
 const s=new Store({getItem:()=>null,setItem(){},removeItem(){}});s.createCharacter('c','C');const bid=s.createBranch('c','B');s.bind('c',bid,'chat');
 const messages=[m(0,'Earlier reply.'),{id:'u',role:'user',content:'Next'},m(1,'Current scene.'+info('14:00'))];let captured;
 const e=new Engine(s,async(_system,data)=>{captured=data;return {changes:{}};});await e.read('c',bid,messages,{chatId:'chat'});await e.read('c',bid,messages,{chatId:'chat',force:true});
 assert.equal(captured.reread,true);assert.deepEqual(captured.messages,[messages.at(-1)]);assert.deepEqual(captured.contextMessages,messages.slice(0,-1));
});
test('미해석 응답은 상태와 성공 체크포인트를 바꾸지 않고 중복 호출을 막는다',async()=>{
 const s=new Store({getItem:()=>null,setItem(){},removeItem(){}});s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);s.bind('c',bid,'chat');const before=structuredClone(b);let calls=0;
 const e=new Engine(s,async()=>{calls++;return {sceneResult:true,outcome:'unusable',facts:{changes:{}},unresolved:['unclear']};}),messages=[m(1,'He leaves.')];
 assert.equal(await e.read('c',bid,messages,{chatId:'chat'}),null);assert.deepEqual(b,before);
 await e.read('c',bid,messages,{chatId:'chat'});assert.equal(calls,1);await e.read('c',bid,messages,{chatId:'chat',force:true});assert.equal(calls,2);
});

function readHarness(turns=8){
 const store=new Store({getItem:()=>null,setItem(){},removeItem(){}});store.createCharacter('c','C');const bid=store.createBranch('c','B');store.bind('c',bid,'chat');
 Object.assign(store.data.settings,{chatTurns:turns,newItems:'off'});
 const calls=[],replies=[],logs=new DiagnosticLog({console:null});
 const engine=new Engine(store,async(system,data)=>{calls.push(structuredClone(data));return replies.shift()||{changes:{}};});
 return {store,bid,calls,replies,logs,async read(messages,options={}){const trace=logs.start('scene');const value=await engine.read('c',bid,messages,{chatId:'chat',gate:true,...options,trace});trace.finish('completed','test');return value;}};
}
const turn=(n,answer='He answers quietly.')=>[{id:'u'+n,role:'user',content:'Question '+n},{id:'a'+n,role:'character',content:answer}];
const longHistory=()=>Array.from({length:55},(_,i)=>turn(i,'Earlier conversation '+i+'. '+('background detail '.repeat(30)))).flat();

test('자동 판독은 새 원문과 직전 최대 1턴만 보내고 설정 1·2·8·50턴 상한을 지킨다',async()=>{
 for(const count of [1,2,8,50]){
  const h=readHarness(count),messages=longHistory();await h.read(messages);const previous=structuredClone(messages),next=turn(55,'He went out.');messages.push(...next);
  await h.read(messages);const request=h.calls.at(-1);
  assert.equal(h.calls.length,2);assert.deepEqual(request.messages,next);assert.deepEqual(request.contextMessages,count===1?[]:previous.slice(-2));assert.equal(request.reread,undefined);
  const configured=messages.slice(recentTurnStart(messages,count));assert.ok([...request.contextMessages,...request.messages].every(message=>configured.some(value=>value.id===message.id)));
  const context=h.logs.list()[0].events.find(event=>event.stage==='context').data;assert.equal(context.mode,'incremental');assert.equal(context.newMessages,2);assert.equal(context.backgroundMessages,count===1?0:2);assert.equal(context.newCharacters,next.reduce((sum,message)=>sum+message.content.length,0));
  assert.equal(context.backgroundCharacters,request.contextMessages.reduce((sum,message)=>sum+message.content.length,0));assert.equal(context.maxTurns,count);
  if(count===8){
   const oldRequest={...request,contextMessages:messages.slice(recentTurnStart(messages,count),previous.length)};
   assert.ok(JSON.stringify(request).length<JSON.stringify(oldRequest).length);assert.equal(context.omittedProcessedMessages,12);
  }
 }
});

test('여러 새 답변이 밀려도 설정 범위 안의 미처리 대화와 행동 순서를 전부 보낸다',async()=>{
 for(const count of [1,2,8,50]){
  const h=readHarness(count),messages=longHistory();await h.read(messages);const previous=structuredClone(messages),added=[...turn(55,'He took off his shoes.'),...turn(56,'He showers.'),...turn(57,'He leaves home.')];messages.push(...added);
  await h.read(messages);const request=h.calls.at(-1),expected=added.slice(-Math.min(added.length,count*2));
  assert.deepEqual(request.messages,expected);assert.deepEqual(request.contextMessages,count<=3?[]:previous.slice(-2));
  assert.equal(request.omittedEarlierMessages,count<=3?added.length-expected.length:undefined);assert.equal(h.calls.length,2);
 }
});

test('최초 판독과 현재 옷 보기는 설정된 전체 범위를 유지하며 수동 재판독은 추가 확장하지 않는다',async()=>{
 for(const count of [1,2,8,50]){
  const h=readHarness(count),messages=longHistory(),bounded=messages.slice(-count*2);await h.read(messages);
  assert.deepEqual(h.calls[0].messages,bounded);assert.deepEqual(h.calls[0].contextMessages,[]);assert.equal(h.logs.list()[0].events.find(event=>event.stage==='context').data.mode,'full');
  await h.read(messages,{force:true});const request=h.calls[1];assert.equal(h.calls.length,2);assert.equal(request.reread,true);assert.deepEqual(request.messages,messages.slice(-1));assert.deepEqual(request.contextMessages,bounded.slice(0,-1));
  assert.equal(h.logs.list()[0].events.find(event=>event.stage==='context').data.mode,'manual');
 }
});

test('축소 문맥에서도 지속 상태를 전달하고 새 증거로 해소된 상태만 제거한다',async()=>{
 const h=readHarness(),messages=longHistory();messages[100].content='Pregnancy and an arm injury requiring front-opening clothes were established.';
 h.replies.push({changes:{character:{context:{conditions:['Pregnant','Arm injury'],needs:['Front-opening clothes']}},persona:{context:{conditions:['Inpatient treatment']}}}});await h.read(messages);
 h.replies.push({changes:{character:{context:{resolvedConditions:['Arm injury'],resolvedNeeds:['Front-opening clothes']}}}});
 messages.push(...turn(55,'The arm injury has healed.'));await h.read(messages);const request=h.calls.at(-1);
 assert.deepEqual(request.people.character.context.conditions,['Pregnant','Arm injury']);assert.deepEqual(request.people.persona.context.conditions,['Inpatient treatment']);
 assert.doesNotMatch(JSON.stringify([...request.contextMessages,...request.messages]),/Pregnancy and an arm injury/);
 const state=h.store.branch('c',h.bid).current;assert.deepEqual(state.people.character.context.conditions,['Pregnant']);assert.deepEqual(state.people.character.context.needs,[]);assert.deepEqual(state.people.persona.context.conditions,['Inpatient treatment']);
});

test('삭제·수정·스와이프·하이드로 기준점이 무효화되면 전체 범위를 읽고 지워진 상태는 보내지 않는다',async()=>{
 for(const kind of ['delete','edit','swipe','hide']){
  const h=readHarness(),messages=longHistory();h.replies.push({changes:{character:{context:{conditions:['Arm injury']}}}});await h.read(messages);let remaining=structuredClone(messages);
  if(kind==='delete')remaining.splice(3,2);
  if(kind==='edit')remaining[3].content='A different earlier event.';
  if(kind==='swipe'){remaining[3].swipe=1;remaining[3].content='A different swipe.';}
  if(kind==='hide')remaining=remaining.filter((_,index)=>index!==3);
  await h.read(remaining);const request=h.calls.at(-1);assert.deepEqual(request.messages,remaining.slice(-16));assert.deepEqual(request.contextMessages,[]);assert.equal(request.people.character.context.conditions,undefined);assert.equal(h.logs.list()[0].events.find(event=>event.stage==='context').data.mode,'full');
 }
});

test('무변화·중복 답변은 호출하지 않고 정상 변화 없음 응답도 넓은 문맥으로 재호출하지 않는다',async()=>{
 const h=readHarness(),messages=longHistory();await h.read(messages);messages.push(...turn(55));await h.read(messages);await h.read(messages);assert.equal(h.calls.length,1);
 assert.ok(h.logs.list()[0].events.some(event=>event.stage==='gate'));assert.equal(h.logs.list()[0].events.some(event=>event.stage==='context'),false);
 messages.push(...turn(56,'He went out.'));await h.read(messages);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].contextMessages,messages.slice(-4,-2));await h.read(messages);assert.equal(h.calls.length,2);
});

test('처리 기준점이 사용자 입력 뒤에 있어도 그 입력을 새 답변의 문맥으로 유지한다',async()=>{
 const h=readHarness(),messages=longHistory();messages.push({id:'pending-user',role:'user',content:'I leave home after the shower.'});await h.read(messages,{force:true});
 const reply={id:'pending-answer',role:'character',content:'He went out with her.'};messages.push(reply);await h.read(messages);const request=h.calls.at(-1);
 assert.deepEqual(request.messages,[reply]);assert.deepEqual(request.contextMessages,[messages.at(-2)]);assert.equal(request.reread,undefined);
});
