import {visibleMessages} from '../core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {needsOutfitRead} from '../scene-gate.js';
import {Store,Engine,outfitInjection,savedOutfitForMessages,emptyState} from '../core.js';

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
