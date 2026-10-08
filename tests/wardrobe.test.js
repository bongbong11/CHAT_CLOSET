import test from 'node:test';
import assert from 'node:assert/strict';
import {wardrobeLevels,wardrobeTargets,wardrobeDeficits,ownedItems,composeWardrobe} from '../wardrobe.js';
import {Store,KEY,emptyState,Engine,memoryFromStates,updateOutfitMemory,outfitInjection} from '../core.js';
import {needsOutfitRead} from '../scene-gate.js';
import {SCENE,ANALYSIS,WARDROBE_FILL} from '../prompts.js';
const garment=(id,category,name=id)=>({id,category,name,color:'navy',features:['cotton'],brand:'UNIQLO',available:true});
const shirt=garment('shirt','상의'),pants=garment('pants','하의'),shoe=garment('shoe','신발'),outfit=()=>{const s=emptyState();s.people.character.items=[shirt,pants,shoe];return s;};
const m=(id,content,swipe=0)=>({id:String(id),role:'character',content,swipe});
test('이전 전체 옷장 크기를 카테고리별 구성으로 이전하며 옷은 삭제하지 않음',()=>{
 const legacy={version:1,settings:{wardrobeSize:10},characters:{c:{profiles:{character:{wardrobe:[shirt]}},branches:{}}}};
 const s=new Store({getItem:()=>JSON.stringify(legacy)});assert.deepEqual(s.data.settings.wardrobeLevels,{top:'low',bottom:'low',outerwear:'low',footwear:'low'});assert.equal(Object.hasOwn(s.data.settings,'wardrobeSize'),false);assert.equal(s.character('c').profiles.character.wardrobe[0].id,'shirt');
 assert.deepEqual(wardrobeTargets({wardrobeLevels:{top:'high',bottom:'low',outerwear:'medium',footwear:'high'}}),{top:10,bottom:3,outerwear:3,footwear:5});assert.equal(wardrobeLevels({wardrobeSize:24}).top,'high');
});
test('부족 수량은 주요 의류만 세며 양말·벨트와 명시적 예외는 할당량을 채우지 않음',()=>{
 const p={wardrobe:[shirt,{...shirt,id:'duplicate'},garment('belt','소품'),garment('socks','속옷')],wardrobeExceptions:{outerwear:'The setting prohibits outerwear.'}};
 assert.deepEqual(wardrobeDeficits(p,{top:4,bottom:3,outerwear:1,footwear:2}),{top:3,bottom:3,footwear:2});
});
test('생성 목표보다 많은 새 옷은 초기 구성에서 제외하지만 이미 보유한 옷과 지원 품목은 유지',()=>{
 const newTops=Array.from({length:10},(_,i)=>garment('top'+i,'상의'));
 const result=composeWardrobe([shirt],newTops.concat(garment('belt','소품')),{top:4,bottom:3,outerwear:1,footwear:2});assert.equal(result.filter(i=>i.category==='상의').length,4);assert.ok(result.some(i=>i.id==='belt'));
 assert.equal(composeWardrobe(newTops,[],{top:4,bottom:3,outerwear:1,footwear:2}).length,10);
});
test('옷장 목록은 프로필·추가 옷·현재 옷을 합치고 같은 ID 브랜드 보완은 한 항목으로 표시',()=>{
 const branch={profiles:{character:{wardrobe:[shirt,shoe]}},extra:{character:[{...shoe,brand:'CONVERSE'}]},current:outfit()};
 // Current worn metadata matches the latest state and takes precedence.
 branch.current.people.character.items=[shirt,{...shoe,brand:'CONVERSE'},pants];const items=ownedItems(branch,'character');assert.equal(items.length,3);assert.equal(items.find(i=>i.id==='shoe').brand,'CONVERSE');
});
test('간접 이동·활동 종료를 판독하되 일반 대화는 건너뜀',()=>{
 for(const narrative of ['둘은 자리를 옮겼다.','그들은 로비로 내려갔다.','방을 나와 식당으로 향했다.','관계를 마치고 휴식을 취했다.','They walked downstairs.','They moved into the dining room.','She got out of bed.'])assert.equal(needsOutfitRead([m(0,'Naked in the bedroom.'),m(1,narrative)],1),true,narrative);
 assert.equal(needsOutfitRead([m(0,'At home.'),m(1,'He smiles and answers.')],1),false);
});
test('부분 탈의와 완전 탈의 뒤에도 처음 벗기 전 착장을 인물별로 기억',()=>{
 const dressed=outfit(),partial=emptyState(),nude=emptyState();partial.people.character.items=[pants,shoe];nude.people.character.nude=true;
 let memory=memoryFromStates([dressed]);memory=updateOutfitMemory(memory,dressed,partial);memory=updateOutfitMemory(memory,partial,nude);
 assert.deepEqual(memory.character.beforeUndress,['shirt','pants','shoe']);assert.deepEqual(memory.persona.beforeUndress,[]);
 const dress=emptyState();dress.people.persona.items=[garment('dress','상의','midi dress')];assert.equal(memoryFromStates([dress]).persona.lastDressed[0],'dress');
});
test('탈의 뒤 장소 이동은 판독 모델에 직전 착장을 보내고 스와이프는 해당 복원 정보로 되돌림',async()=>{
 const s=new Store({getItem:()=>null,setItem(){},removeItem(){}});s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);b.profiles.character={wardrobe:[shirt,pants,shoe]};b.base=outfit();b.current=outfit();b.baseMemory=memoryFromStates([b.base]);let received;
 const e=new Engine(s,async(_system,data)=>{received=data;const undress=data.messages.at(-1)?.content==='옷을 벗었다.';return {scene:{place:undress?'Bedroom':'Lobby'},people:{character:{nude:undress,items:undress?[]:data.outfitMemory.character.beforeUndress},persona:{nude:false,items:[]}},newItems:{}};});
 const messages=[m(0,'옷을 벗었다.')];await e.read('c',bid,messages,{gate:true});assert.equal(b.current.people.character.nude,true);messages.push(m(1,'둘은 로비로 내려갔다.'));await e.read('c',bid,messages,{gate:true});assert.deepEqual(received.outfitMemory.character.beforeUndress,['shirt','pants','shoe']);assert.equal(b.current.people.character.nude,false);
 messages[1]=m(1,'그는 미소 지었다.',1);await e.read('c',bid,messages,{gate:true});assert.equal(b.current.people.character.nude,true);assert.deepEqual(b.outfitMemory.character.beforeUndress,['shirt','pants','shoe']);
 s.resetChat('c','chat'); // no binding: use an explicit branch reset below.
 s.bind('c',bid,'chat');s.resetChat('c','chat');assert.deepEqual(b.outfitMemory.character.beforeUndress,[]);
});
test('주입은 이야기 우선과 서술 강제 금지를 명시하고 확장 모델만 생략된 재착용을 추론',()=>{
 const prompt=outfitInjection(outfit());assert.match(prompt,/current story input\/output take priority/);assert.match(prompt,/Never invent actions or reasons/);assert.match(SCENE,/BOTH user input and roleplay output/);assert.match(SCENE,/ordinary redressing/);assert.match(SCENE,/not an instruction to narrate redressing/);assert.match(ANALYSIS,/wardrobeTargets/);assert.doesNotMatch(ANALYSIS,/wardrobeSize/);assert.match(WARDROBE_FILL,/missingByCategory/);
});
