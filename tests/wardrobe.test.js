import test from 'node:test';
import assert from 'node:assert/strict';
import {wardrobeLevels,wardrobeTargets,wardrobeDeficits,ownedItems,composeWardrobe,replaceWardrobeCategory,requireKoreanLabels,mergeWardrobe,missingLabels,completeLabels,applyLabels} from '../wardrobe.js';
import {Store,KEY,emptyState,Engine,memoryFromStates,updateOutfitMemory,outfitInjection,normalizeProfile,validateState,itemUiLabel,itemUiBrand} from '../core.js';
import {needsOutfitRead} from '../scene-gate.js';
import {SCENE,ANALYSIS,WARDROBE_FILL} from '../prompts.js';
const garment=(id,category,name=id)=>({id,category,name,color:'navy',features:['cotton'],brand:'UNIQLO',available:true});
const shirt=garment('shirt','상의'),pants=garment('pants','하의'),shoe=garment('shoe','신발'),outfit=()=>{const s=emptyState();s.people.character.items=[shirt,pants,shoe];return s;};
const m=(id,content,swipe=0)=>({id:String(id),role:'character',content,swipe});
test('이전 전체 옷장 크기를 카테고리별 구성으로 이전하며 옷은 삭제하지 않음',()=>{
 const legacy={version:1,settings:{wardrobeSize:10},characters:{c:{profiles:{character:{wardrobe:[shirt]}},branches:{}}}};
 const s=new Store({getItem:()=>JSON.stringify(legacy)});assert.equal(s.data.settings.wardrobeLevel,'low');assert.equal(Object.hasOwn(s.data.settings,'wardrobeLevels'),false);assert.equal(Object.hasOwn(s.data.settings,'wardrobeSize'),false);assert.equal(s.character('c').profiles.character.wardrobe[0].id,'shirt');
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

test('하나의 기본 옷장 구성으로 기존 카테고리별 수량 기준을 적용',()=>{
 assert.deepEqual(wardrobeTargets({wardrobeLevel:'low'}),{top:4,bottom:3,outerwear:1,footwear:2});
 assert.deepEqual(wardrobeTargets({wardrobeLevel:'medium'}),{top:7,bottom:5,outerwear:3,footwear:3});
 assert.deepEqual(wardrobeTargets({wardrobeLevel:'high'}),{top:10,bottom:7,outerwear:5,footwear:5});
 const s=new Store({getItem:()=>JSON.stringify({version:1,characters:{},settings:{wardrobeLevels:{top:'low',bottom:'medium',outerwear:'medium',footwear:'medium'}}})});assert.equal(s.data.settings.wardrobeLevel,'medium');
});
test('한 인물의 선택 종류만 새 목록으로 교체하고 현재 옷과 다른 인물은 보존',()=>{
 const s=new Store({getItem:()=>null,setItem(){}});s.createCharacter('c','C');const b=s.branch('c',s.createBranch('c','B'));
 const old=garment('old-top','상의'),extra=garment('extra-top','상의');b.profiles.character={fields:{},wardrobe:[shirt,old,pants,shoe]};b.profiles.persona={wardrobe:[garment('p-top','상의')]};b.current=outfit();b.extra.character=[extra];b.outfitMemory={character:{lastDressed:['shirt','pants','old-top'],beforeUndress:['old-top','extra-top']},persona:{lastDressed:[],beforeUndress:[]}};
 b.history=[outfit()];b.checkpoints={old:{state:outfit(),extra:{character:[extra]}}};
 const before=structuredClone(b.current),other=structuredClone(b.profiles.persona),fresh=garment('new-top','상의','polo shirt');replaceWardrobeCategory(b,'character','상의',[fresh]);
 assert.deepEqual(b.current,before);assert.deepEqual(b.profiles.persona,other);assert.deepEqual(b.profiles.character.wardrobe.map(i=>i.id),['pants','shoe','new-top']);assert.deepEqual(b.extra.character.map(i=>i.id),['shirt']);assert.deepEqual(b.checkpoints,{});assert.deepEqual(b.history,[]);assert.deepEqual(b.outfitMemory.character.beforeUndress,[]);assert.deepEqual(b.outfitMemory.character.lastDressed,['shirt','pants']);
 assert.ok(!JSON.stringify(b).includes('old-top'));assert.ok(!JSON.stringify(b).includes('extra-top'));
});
import {toModelData,fromModelData} from '../model-schema.js';
test('생성한 영어 의상과 한글 표시명은 같이 저장하고 모든 모델 요청·주입에서 표시명은 제외',()=>{
 const g={...garment('g','상의','Oxford shirt'),labelKo:'남색 옥스퍼드 셔츠',brandKo:'유니클로'};
 const profile=normalizeProfile({character:{wardrobe:[g]}}).character;assert.equal(profile.wardrobe[0].labelKo,g.labelKo);requireKoreanLabels(profile.wardrobe);
 const s=outfit();s.people.character.items=[g];const payload={profiles:{character:profile},wardrobes:{character:[g]},baseline:{...s,sceneKo:{place:'집'}},recent:[s]};const model=toModelData(payload);
 assert.doesNotMatch(JSON.stringify(model),/labelKo|brandKo|sceneKo|남색 옥스퍼드|유니클로/);assert.equal(model.wardrobes.character[0].name,'Oxford shirt');assert.match(outfitInjection(s),/navy Oxford shirt/);assert.doesNotMatch(outfitInjection(s),/남색/);
 assert.equal(fromModelData({wardrobe:[g]}).wardrobe[0].labelKo,g.labelKo);assert.throws(()=>requireKoreanLabels([{...g,labelKo:''}]),/한글 표시명/);
 const merged=mergeWardrobe([{...g,labelKo:''}],[{...g,name:'changed canonical name'}]);assert.equal(merged[0].name,'Oxford shirt');assert.equal(merged[0].labelKo,g.labelKo);
});
test('일반 판독의 기존 표시명 보완은 영어 의상·기존 한글 표시명을 바꾸지 않음',()=>{
 const g=garment('g','상의','Oxford shirt');const raw={people:{character:{nude:false,items:['g']},persona:{nude:false,items:[]}},labelUpdates:{character:[{id:'g',labelKo:'남색 옥스퍼드 셔츠',brandKo:'유니클로'}]},newItems:{}};
 const result=validateState(raw,{character:[g],persona:[]});assert.equal(result.state.people.character.items[0].name,'Oxford shirt');assert.equal(result.state.people.character.items[0].labelKo,'남색 옥스퍼드 셔츠');assert.equal(result.added.character[0].id,'g');
 const existing={...g,labelKo:'기존 셔츠'};assert.equal(validateState(raw,{character:[existing],persona:[]}).state.people.character.items[0].labelKo,'기존 셔츠');
});
test('의상 UI는 저장된 한글 표시만 사용하고 구버전 영어 원문을 화면에 노출하지 않음',()=>{
 const garment={category:'상의',name:'Oxford shirt',brand:'UNIQLO'};assert.equal(itemUiLabel(garment),'상의 · 표시명 준비 전');assert.equal(itemUiBrand(garment),'브랜드 표시 준비 전');assert.equal(itemUiLabel({...garment,labelKo:'남색 셔츠'}),'남색 셔츠');assert.equal(itemUiBrand({...garment,brandKo:'유니클로'}),'유니클로');assert.equal(itemUiLabel({...garment,labelKo:'navy 셔츠'}),'상의 · 표시명 준비 전');
});
test('옷장 재생성은 구버전 착용 옷의 표시만 보완하고 영어 원문·ID·착용을 유지',()=>{
 const worn={...shirt,labelKo:'',brandKo:''},s=outfit();s.people.character.items=[worn];
 const b={profiles:{character:{wardrobe:[structuredClone(worn)],wardrobeExceptions:{}}},current:s,base:structuredClone(s),extra:{character:[],persona:[]},baseExtra:{character:[],persona:[]},history:[structuredClone(s)],checkpoints:{old:{state:structuredClone(s),extra:{character:[structuredClone(worn)]},history:[]}},keys:['old'],outfits:[]};
 const completed=completeLabels([worn],[{id:'shirt',name:'replacement',brand:'other',labelKo:'남색 셔츠',brandKo:'유니클로'}]);
 assert.equal(missingLabels(completed).length,0);assert.equal(completed[0].name,worn.name);assert.equal(completed[0].brand,worn.brand);applyLabels(b,'character',completed);
 for(const value of [b.current,b.base,...b.history,b.checkpoints.old.state])assert.equal(value.people.character.items[0].labelKo,'남색 셔츠');
 replaceWardrobeCategory(b,'character','상의',[{...shirt,id:'new-shirt',labelKo:'흰색 셔츠',brandKo:'무지'}]);
 assert.deepEqual(b.current.people.character.items.map(i=>i.id),['shirt']);assert.equal(ownedItems(b,'character').find(i=>i.id==='shirt').brandKo,'유니클로');assert.equal(itemUiLabel(b.current.people.character.items[0]),'남색 셔츠');
});
test('잘못된 보완 표시명은 저장하지 않으며 이미 유효한 표시명은 모델이 바꾸지 못함',()=>{
 const old={...shirt,labelKo:'원래 셔츠',brandKo:''};const original=structuredClone(old);
 const result=completeLabels([old],[{id:'shirt',labelKo:'바뀐 셔츠',brandKo:'UNIQLO'}]);
 assert.deepEqual(old,original);assert.equal(result[0].labelKo,'원래 셔츠');assert.equal(missingLabels(result).length,1);assert.throws(()=>requireKoreanLabels(result),/한글 표시명/);
 assert.equal(missingLabels([{...old,brandKo:'유니클로',labelKo:'English 셔츠'}]).length,1);
});
