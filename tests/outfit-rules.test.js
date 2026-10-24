import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,KEY,emptyState,recordDisplay,savedDisplay,pruneDisplayChat,prefixKeys,compactStoredData,updateOutfitMemory,restoreBranchForMessages,saveManualOutfit,savedOutfitForMessages,outfitInjection} from '../core.js';
import {needsOutfitRead} from '../scene-gate.js';
import {registerOutfitMacro,injectPayload} from '../host.js';
import {requireEnglishProfile,toModelData} from '../model-schema.js';
import {normalizeContext,validateSceneFacts,resolveOutfit,sceneRequest} from '../outfit-rules.js';
import {itemTraits} from '../wardrobe.js';

const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const message=(id,content='He smiles.',swipe=0)=>({id:String(id),content,role:'character',swipe});
const shirt={id:'top',category:'상의',name:'Oxford shirt',color:'white',brand:'UNIQLO'};
const pants={id:'bottom',category:'하의',name:'trousers',color:'navy',brand:'UNIQLO'};
const shoes={id:'shoes',category:'신발',name:'canvas sneakers',brand:'CONVERSE'};
const briefs={id:'briefs',category:'속옷',name:'briefs',brand:'UNIQLO'};
const owned={character:[shirt,pants,shoes,briefs],persona:[]};
const facts=context=>validateSceneFacts({changes:{character:{context}}});
const ids=state=>state.people.character.items.map(item=>item.id);
const home=()=>{const state=emptyState();state.people.character.context=normalizeContext({location:'home',space:'private',phase:'resting'});state.people.character.items=[shirt,pants,briefs];return state;};
test('기존 파일을 보존하며 장면 기준값과 표시 방식을 보완하고 새 파일을 만들지 않는다',()=>{
 const storage=memory(),source={version:1,settings:{profileId:'saved'},characters:{c:{name:'C',profiles:{character:{wardrobe:[shirt]}},branches:{b:{links:['chat'],base:{people:{character:{items:[shirt]},persona:{items:[]}}},current:{people:{character:{items:[shirt]},persona:{items:[]}}},history:[],checkpoints:{}}}}}};
 storage.setItem(KEY,JSON.stringify(source));const store=new Store(storage),branch=store.branch('c','b');
 assert.equal(store.data.settings.profileId,'saved');assert.equal(store.data.settings.displayMode,'floating');
 assert.equal(branch.current.people.character.context.location,'unknown');assert.deepEqual(store.character('c').profiles,source.characters.c.profiles);
 assert.equal(storage.getItem(KEY),JSON.stringify(source));
 const context=normalizeContext({conditions:['Pregnant'],temperature:20,phase:'resting'});assert.deepEqual(context.conditions,['Pregnant']);assert.equal(context.temperature,20);
});
test('답변별 표시 기록은 같은 결과를 공유하고 원문 prefix와 스와이프를 확인한다',()=>{
 const branch={},state=emptyState();state.people.character.items=[shirt];
 const a=message(1),b=message(2);recordDisplay(branch,'chat',[a],state);recordDisplay(branch,'chat',[a,b],state);
 assert.equal(Object.keys(branch.display.snapshots).length,1);
 assert.ok(savedDisplay(branch,'chat',a,prefixKeys([a])[0]));
 assert.equal(savedDisplay(branch,'chat',a,'edited-prefix'),null);
 assert.equal(savedDisplay(branch,'chat',{...a,swipe:1},prefixKeys([a])[0]),null);
 assert.equal(savedDisplay(branch,'other',a,prefixKeys([a])[0]),null);
 branch.display.snapshots.orphan={};const compact=compactStoredData({characters:{c:{branches:{b:branch}}}});assert.equal(compact.removed.display,1);
});
test('공유 채팅 삭제는 다른 채팅의 표시를 보존하며 새 브랜치는 과거 표시를 복사하지 않는다',()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B');store.bind('c',bid,'one');store.bind('c',bid,'two');
 const branch=store.branch('c',bid),state=emptyState(),m=message(1);recordDisplay(branch,'one',[m],state);recordDisplay(branch,'two',[m],state);
 store.deleteChat('c','one');assert.deepEqual(Object.keys(branch.display.chats),['two']);
 const copy=store.branch('c',store.createBranch('c','Copy',bid));assert.deepEqual(copy.display,{chats:{},snapshots:{}});
 store.resetChat('c','two');assert.deepEqual(branch.display,{chats:{},snapshots:{}});
});
test('타월·환자복은 정규 착장 기억을 덮지 않고 평상복 로브는 정상적으로 기억한다',()=>{
 const dressed=emptyState();dressed.people.character.items=[shirt,pants];const nude=emptyState();nude.people.character.nude=true;
 let remembered=updateOutfitMemory({},dressed,nude);const patient=emptyState();patient.people.character.items=[{id:'patient',name:'hospital gown',category:'상의'}];
 remembered=updateOutfitMemory(remembered,nude,patient);assert.deepEqual(remembered.character.lastDressed,[]);assert.deepEqual(remembered.character.beforeUndress,['top','bottom']);
 const robe=emptyState();robe.people.character.items=[{id:'robe',name:'wool robe',category:'상의'}];remembered=updateOutfitMemory(remembered,patient,robe);assert.deepEqual(remembered.character.lastDressed,['robe']);
 assert.equal(itemTraits({name:'dress shirt',category:'상의'}).coverage,'upper');
 assert.equal(itemTraits({name:'bath towel',category:'상의'}).temporary,true);
});
test('외출은 신발만 보충하고 명시된 현재 맨발 예외는 유지한다',()=>{
 const state=home(),out=facts({location:'outside',space:'public',phase:'outdoors'});
 const result=resolveOutfit(state,out,owned);assert.deepEqual(ids(result.state),['top','bottom','briefs','shoes']);assert.deepEqual(result.missing,[]);
 const exception=resolveOutfit(state,facts({location:'outside',space:'public',phase:'outdoors',exception:'barefoot'}),owned);assert.deepEqual(ids(exception.state),ids(state));
 // An old private exception is not carried forever into the next completed trip.
 state.people.character.context.exception='barefoot';assert.ok(ids(resolveOutfit(state,out,owned).state).includes('shoes'));
});
test('처음 확인한 일반 실내 장면은 보유 옷으로 시작하되 신발·목욕·탈의는 강제하지 않는다',()=>{
 const initial=emptyState(),context={location:'home',space:'private',phase:'resting'};
 assert.deepEqual(ids(resolveOutfit(initial,facts(context),owned).state),['top','bottom','briefs']);
 assert.deepEqual(ids(resolveOutfit(initial,facts({...context,phase:'after_washing'}),owned).state),[]);
 const nude=validateSceneFacts({changes:{character:{context,actions:[{op:'nude'}]}}});assert.deepEqual(ids(resolveOutfit(initial,nude,owned).state),[]);
});
test('nude/타월에서 명확한 외출 완료 때만 보유 옷을 복구한다',()=>{
 const state=home();state.people.character.items=[];state.people.character.nude=true;
 const washed=resolveOutfit(state,facts({phase:'after_washing'}),owned);assert.equal(washed.state.people.character.nude,true);assert.deepEqual(washed.missing,[]);
 const towel={id:'towel',category:'상의',name:'bath towel',brand:'MUJI'};state.people.character.items=[towel];state.people.character.nude=false;
 assert.deepEqual(ids(resolveOutfit(state,facts({phase:'resting'}),owned).state),['towel']);
 const result=resolveOutfit(state,facts({location:'outside',space:'public',phase:'outdoors'}),{...owned,character:[...owned.character,towel]});assert.deepEqual(ids(result.state),['top','bottom','briefs','shoes']);
});
test('현재 명시된 탈의·착용과 소매 상태는 자동 보충보다 우선하고 같은 ID를 유지한다',()=>{
 const state=home(),action={op:'adjust',category:'상의',name:'shirt',wearing:'sleeves rolled',wearingKo:'소매 걷음'};
 const result=resolveOutfit(state,validateSceneFacts({changes:{character:{actions:[action]}}}),owned);assert.equal(result.state.people.character.items[0].id,'top');assert.equal(result.state.people.character.items[0].wearing,'sleeves rolled');assert.equal(shirt.wearing,undefined);
 const nude=resolveOutfit(state,validateSceneFacts({changes:{character:{context:{location:'outside',space:'public',phase:'outdoors'},actions:[{op:'nude'}]}}}),owned);assert.equal(nude.state.people.character.nude,true);assert.deepEqual(nude.missing,[]);
});
test('신체 조건은 유지하고 명시된 착용 제약이 있을 때만 해당 의류를 바꾼다',()=>{
 const state=home(),tight={...pants,id:'tight',features:['slim non-stretch waist']},loose={...pants,id:'loose',features:['adjustable waist']};state.people.character.items=[shirt,tight,briefs];
 const stock={...owned,character:[...owned.character.filter(i=>i.id!=='bottom'),tight,loose]};
 const pregnant=resolveOutfit(state,facts({conditions:['Pregnant']}),stock);assert.deepEqual(ids(pregnant.state),['top','tight','briefs']);
 const adapted=resolveOutfit(pregnant.state,facts({needs:['Avoid waist pressure']}),stock);assert.ok(ids(adapted.state).includes('loose'));assert.ok(!ids(adapted.state).includes('tight'));
 const same=resolveOutfit(adapted.state,facts({needs:['Avoid waist pressure']}),stock);assert.deepEqual(same.state,adapted.state);assert.deepEqual(same.missing,[]);
 const recovered=resolveOutfit(same.state,facts({conditions:[],needs:[]}),stock);assert.deepEqual(recovered.state.people.character.context.conditions,[]);assert.ok(ids(recovered.state).includes('loose'));
 const advanced=resolveOutfit(state,facts({conditions:['32 weeks pregnant']}),stock);assert.ok(ids(advanced.state).includes('loose'));assert.ok(ids(advanced.state).includes('top'));
});
test('실제 목욕만 탈의하고 계절/기온은 필요한 겉옷만 조정한다',()=>{
 const state=home();assert.equal(resolveOutfit(state,facts({phase:'washing'}),owned).state.people.character.nude,true);
 const coat={id:'coat',category:'겉옷',name:'wool coat',brand:'COS'};
 const cold=resolveOutfit(state,facts({location:'outside',space:'public',phase:'outdoors',season:'winter',temperature:3}),{...owned,character:[...owned.character,coat]});assert.ok(ids(cold.state).includes('coat'));
 const warm=resolveOutfit(cold.state,facts({temperature:28}),owned);assert.ok(!ids(warm.state).includes('coat'));assert.ok(ids(warm.state).includes('top'));
});
test('부족한 범주만 요청하고 잘못된 사실·코디 전체 응답은 거절한다',()=>{
 const result=resolveOutfit(home(),facts({location:'outside',space:'public',phase:'outdoors'}),{character:[shirt,pants,briefs],persona:[]});assert.deepEqual(result.missing,[{who:'character',category:'신발',reason:'public_coverage'}]);
 for(const invalid of [{people:{}},{changes:{character:{items:[]}}},{changes:{character:{context:{location:'Mars'}}}},{changes:{character:{context:{conditions:['임신']}}}},{changes:{character:{actions:[{op:'nude'},{op:'wear',category:'상의',name:'shirt'}]}}}])assert.throws(()=>validateSceneFacts(invalid));
 const request=sceneRequest(home(),[message(1)]);assert.deepEqual(Object.keys(request),['people','contextMessages','messages']);assert.equal(request.wardrobes,undefined);assert.equal(request.profiles,undefined);assert.equal(request.people.character.worn[0].id,undefined);
});
test('변한 신체 인포는 읽고 같은 상태와 작은 시간 변화는 건너뛴다',()=>{
 const info=value=>'<Scene_Info>Loc: Home\nPhysical state: '+value+'\nTime: 14:00</Scene_Info>';
 assert.equal(needsOutfitRead([message(0,info('Healthy')),message(1,info('Pregnant'))],1),true);
 assert.equal(needsOutfitRead([message(0,info('Pregnant')),message(1,info('Pregnant').replace('14:00','14:03'))],1),false);
 assert.equal(needsOutfitRead([message(0,'At home.'),message(1,'He was discharged from hospital.')],1),true);
});
test('아이템 생성 실패와 생성 중 삭제는 판독 상태를 부분 저장하지 않는다',async()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);store.bind('c',bid,'chat');b.base=home();b.current=home();
 let profileSeen,signalSeen,release;const engine=new Engine(store,async(_s,request,_signal,profile)=>{profileSeen=profile;assert.equal(request.profiles,undefined);assert.equal(request.wardrobes,undefined);return {changes:{character:{context:{location:'outside',space:'public',phase:'outdoors'}}}};},(_request,signal,profile)=>{assert.equal(profile,profileSeen);signalSeen=signal;return new Promise(resolve=>release=resolve);});
 const before=structuredClone(b),pending=engine.read('c',bid,[message(1,'He went outside.')],{profileId:'captured'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(b,before);store.deleteCharacter('c');release({newItems:{character:[{...shoes,labelKo:'흰 운동화',brandKo:'컨버스'}]}});assert.equal(await pending,null);assert.equal(store.character('c'),undefined);
 assert.ok(signalSeen instanceof AbortSignal);
});
test('매크로는 활성 엔진에 등록되고 주입 시 예전 태그와 중복되지 않는다',async()=>{
 let handler,modern=0,legacy=0;
 await registerOutfitMacro(()=>({powerUserSettings:{experimental_macro_engine:true},registerMacro(){legacy++;}}),()=> 'Character: white shirt.',async()=>({macros:{register(name,options){assert.equal(name,'kikki_outfit');modern++;handler=options.handler;}}}));
 assert.equal(modern,1);assert.equal(legacy,0);assert.match(handler(),/white shirt/);
 await registerOutfitMacro(()=>({powerUserSettings:{},registerMacro(name,fn){legacy++;handler=fn;}}),()=> '');assert.equal(legacy,1);assert.match(handler(),/<kikki_outfit>/);const empty={prompt:handler()};injectPayload(empty,'');assert.equal(empty.prompt,'');
 const payload={messages:[{content:'{{kikki_outfit}}'},{content:'<kikki_outfit>OLD</kikki_outfit>'}]};injectPayload(payload,'Character: black coat.');
 assert.equal((JSON.stringify(payload).match(/black coat/g)||[]).length,1);assert.equal(payload.messages[1].content,'');assert.doesNotMatch(JSON.stringify(payload),/OLD|{{/);
});
test('같은 외부 분류라도 새 실제 이동이면 옛 맨발 예외를 종료하고 신발만 보충한다',()=>{
 const state=home();state.people.character.context=normalizeContext({location:'outside',space:'public',phase:'outdoors',exception:'barefoot'});
 const packet=validateSceneFacts({changes:{character:{transition:true}}});const result=resolveOutfit(state,packet,owned);
 assert.deepEqual(ids(result.state),['top','bottom','briefs','shoes']);assert.equal(result.state.people.character.context.exception,'');
});
test('명시적 소유 예외는 자동 보충에 반영하되 이야기의 실제 착용은 우선한다',()=>{
 const state=home(),policy={character:{wardrobeExceptions:{footwear:'This species cannot wear shoes.'}}};
 const next=facts({location:'outside',space:'public',phase:'outdoors'});assert.deepEqual(ids(resolveOutfit(state,next,owned,{},policy).state),ids(state));
 next.changes.character.actions=[{op:'wear',category:'신발',name:'sneakers'}];assert.ok(ids(resolveOutfit(state,next,owned,{},policy).state).includes('shoes'));
});
test('이미 입은 옷은 비슷한 새 옷보다 우선하며 소매 상태도 보존한다',()=>{
 const state=home();state.people.character.items[0]={...shirt,wearing:'sleeves rolled',wearingKo:'소매 걷음'};
 const other={...shirt,id:'new',name:'new Oxford shirt'};
 const packet=validateSceneFacts({changes:{character:{actions:[{op:'wear',category:'상의',name:'shirt'}]}}});
 const result=resolveOutfit(state,packet,{...owned,character:[other,...owned.character]});assert.deepEqual(result.state.people.character.items[0],state.people.character.items[0]);
});
test('오래된 답변 표시 기록은 체크포인트 한도와 별개이며 삭제한 스와이프만 정리한다',()=>{
 const branch={},state=home(),messages=Array.from({length:85},(_,i)=>message(i));
 for(let i=0;i<messages.length;i++)recordDisplay(branch,'chat',messages.slice(0,i+1),state);
 assert.ok(savedDisplay(branch,'chat',messages[0],prefixKeys(messages)[0]));assert.equal(Object.keys(branch.display.snapshots).length,1);
 const raw=messages.map(m=>({send_date:m.id,is_user:false,mes:m.content,name:''}));
 const alt=message(0,'Other outfit.',1);recordDisplay(branch,'chat',[alt],state);raw[0].swipes=[raw[0].mes,alt.content];raw[0].is_system=true;
 assert.equal(pruneDisplayChat(branch,'chat',raw),0);raw[0].swipes=[raw[0].mes];assert.equal(pruneDisplayChat(branch,'chat',raw),1);
 raw.pop();assert.equal(pruneDisplayChat(branch,'chat',raw),1);assert.equal(Object.keys(branch.display.snapshots).length,1);
});
test('모델의 한국어 원문은 거절하며 아이템 생성용 축약 프로필도 영어 키로 보낸다',()=>{
 assert.throws(()=>requireEnglishProfile({fields:{style:{value:'차분한 옷'}}}),/영어/);
 assert.doesNotThrow(()=>requireEnglishProfile({fields:{style:{value:'Quiet tailoring',evidence:'Selected source'}}}));
 const data=toModelData({profiles:{character:{fields:{'세계관':{value:'Wizarding Britain'},'고정 조건':{value:'Unknown'}}}}});
 assert.doesNotMatch(JSON.stringify(data),/[가-힣]/);assert.equal(data.profiles.character.fields.universe.value,'Wizarding Britain');
});


test('탈의 중 매크로도 위치를 남겨 리롤에서는 이전 착장을 한 번만 주입한다',async()=>{
 let handler;
 await registerOutfitMacro(()=>({registerMacro(_name,fn){handler=fn;}}),()=> '');
 const payload={messages:[{content:handler()},{content:handler()}]};
 injectPayload(payload,outfitInjection(home()));
 assert.match(payload.messages[0].content,/Oxford shirt/);assert.equal(payload.messages[1].content,'');
 await registerOutfitMacro(()=>({registerMacro(_name,fn){handler=fn;}}),()=>null);assert.equal(handler(),'');
});

test('공유 브랜치 채팅 전환은 해당 문맥의 착장·추가품·기억만 복원한다',()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);
 const a=[message('a','At home.')],other=[message('b','At work.')],keys=[prefixKeys(a)[0],prefixKeys(other)[0]];
 const first=home(),second=emptyState();second.people.character.nude=true;
 b.checkpoints[keys[0]]={state:first,extra:{character:[shirt],persona:[]},history:[],outfits:['a'],outfitMemory:{character:{beforeUndress:['top'],lastDressed:['top']}}};
 b.checkpoints[keys[1]]={state:second,extra:{character:[],persona:[]},history:[],outfits:['b'],outfitMemory:{}};
 restoreBranchForMessages(b,a);assert.equal(b.current.people.character.nude,false);assert.deepEqual(b.keys,[keys[0]]);assert.deepEqual(b.extra.character,[shirt]);
 restoreBranchForMessages(b,other);assert.equal(b.current.people.character.nude,true);assert.deepEqual(b.extra.character,[]);assert.deepEqual(b.outfits,['b']);
 restoreBranchForMessages(b,[message('new')]);assert.deepEqual(b.current,b.base);assert.deepEqual(b.keys,[]);
 assert.deepEqual(b.checkpoints[keys[0]].state,first);
});

test('수동 착장 저장은 메모와 매크로를 같이 갱신하고 다른 채팅 체크포인트를 보존한다',()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);
 b.current=home();b.profiles.character={wardrobe:owned.character};
 const messages=[message(1)],old=message('other'),oldKey=prefixKeys([old])[0];
 b.checkpoints[oldKey]={state:home(),extra:{character:[],persona:[]},history:[],outfits:[],outfitMemory:{}};
 const oldSnapshot=structuredClone(b.checkpoints[oldKey]);const people=structuredClone(b.current.people);people.character.items.push(shoes);
 saveManualOutfit(b,people,messages,'chat');const saved=savedDisplay(b,'chat',messages[0],prefixKeys(messages)[0]);
 assert.ok(saved.state.people.character.items.some(item=>item.id==='shoes'));assert.match(outfitInjection(savedOutfitForMessages(b,messages)),/sneakers/);
 assert.deepEqual(b.checkpoints[oldKey],oldSnapshot);assert.equal(b.current.people.character.context.location,'home');
 const before=structuredClone(b);people.character.items.push({id:'unknown'});assert.throws(()=>saveManualOutfit(b,people,messages,'chat'));assert.deepEqual(b,before);
});

test('브랜치 복제는 기본 프로필 대신 원본 페르소나 식별을 계승한다',()=>{
 const store=new Store(memory());store.createCharacter('c','C');store.character('c').personaKey='base-persona';
 const bid=store.createBranch('c','B');store.branch('c',bid).personaKey='story-persona';
 store.branch('c',bid).profiles.persona={fields:{style:{value:'Story preference'}},wardrobe:[]};
 const copied=store.createBranch('c','Copy',bid);assert.equal(store.branch('c',copied).personaKey,'story-persona');assert.deepEqual(store.branch('c',copied).profiles,store.branch('c',bid).profiles);
 store.bind('c',bid,'chat');const before=structuredClone(store.data);assert.throws(()=>store.bind('c','missing','chat'));assert.deepEqual(store.data,before);assert.throws(()=>store.createBranch('c','Broken','missing'));assert.deepEqual(store.data,before);
});


test('입원 중 환자복과 명시적으로 입은 임시 의복을 일반 외출복으로 덮지 않는다',()=>{
 const gown={id:'gown',category:'상의',name:'Patient Gown',brand:'Hospital issued',traits:{temporary:true,coverage:'full'}};
 const stock={...owned,character:[...owned.character,gown]};
 const state=home();state.people.character.items=[gown];
 const care=resolveOutfit(state,facts({location:'hospital',space:'public',phase:'care'}),stock);
 assert.deepEqual(ids(care.state),['gown']);assert.deepEqual(care.missing,[]);
 const explicit=validateSceneFacts({changes:{character:{context:{location:'outside',space:'public',phase:'outdoors'},actions:[{op:'wear',category:'상의',name:'Patient Gown'}]}}});
 const result=resolveOutfit(state,explicit,stock);assert.ok(ids(result.state).includes('gown'));assert.ok(!ids(result.state).includes('top'));assert.ok(!ids(result.state).includes('bottom'));
 assert.equal(itemTraits({category:'상의',name:'Evening Dress'}).coverage,'full');
 assert.equal(itemTraits({category:'상의',name:'Dress Shirt'}).coverage,'upper');
});


test('채팅 이벤트 없이 페르소나가 바뀌어도 지연된 판독은 저장하지 않는다',async()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);
 let release,current=true;const engine=new Engine(store,()=>new Promise(resolve=>release=resolve));const before=structuredClone(b);
 const work=engine.read('c',bid,[message(1)],{isCurrent:()=>current});current=false;release({changes:{character:{actions:[{op:'nude'}]}}});
 assert.equal(await work,null);assert.deepEqual(b,before);
});


test('공유 채팅 초기화는 선택된 페르소나·취향·번역을 유지하고 착장 이력만 분리한다',()=>{
 const store=new Store(memory());store.createCharacter('c','C');store.character('c').personaKey='default';
 const bid=store.createBranch('c','B'),b=store.branch('c',bid);b.personaKey='story';b.profiles.persona={fields:{style:{value:'Story'}},wardrobe:[]};b.reportTranslations.persona={signature:'saved',language:'ko',fields:{}};
 b.current=home();store.bind('c',bid,'a');store.bind('c',bid,'b');const original=structuredClone(b);
 store.resetChat('c','a');const [,fresh]=store.find('c','a');assert.equal(fresh.personaKey,'story');assert.deepEqual(fresh.profiles,original.profiles);assert.deepEqual(fresh.reportTranslations,original.reportTranslations);assert.deepEqual(fresh.current,emptyState());assert.equal(fresh.suspended,true);
 assert.deepEqual(store.find('c','b')[1].current,original.current);
});
