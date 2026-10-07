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
 const engine=new Engine(s,async()=>{count++;return {scene:{place:'Home'},people:{character:{nude:true,items:[]},persona:{nude:false,items:[]}},newItems:{}};});
 const messages=[m(0,'At home.')],options={gate:true,onRequest:()=>notices++};await engine.read('c',bid,messages,options);
 messages.push(m(1,'He smiles and answers.'));await engine.read('c',bid,messages,options);await engine.read('c',bid,messages,options);
 assert.equal(count,1);assert.equal(notices,1);assert.equal(s.branch('c',bid).keys.length,2);
 messages[1].content='He puts on a shirt.';await engine.read('c',bid,messages,options);assert.equal(count,2);
 messages[1].content='He smiles and answers.';await engine.read('c',bid,messages,options);assert.equal(count,2);
});
test('주입은 짧은 착장과 강한 복사 금지 지시만 포함',()=>{
 const state=emptyState();state.people.character.items=[{name:'dress shirt',color:'white',features:['cotton twill','spread collar'],brand:'UNIQLO'}];
 const value=outfitInjection(state);assert.match(value,/NEVER reproduce/);assert.match(value,/NEVER add a clothing section/);assert.match(value,/Character: white dress shirt \(UNIQLO\)/);assert.doesNotMatch(value,/cotton|collar|weather|profiles/);
 assert.equal(outfitInjection(emptyState()),'');assert.deepEqual(savedOutfitForMessages({base:state,checkpoints:{}},[]),state);
});
