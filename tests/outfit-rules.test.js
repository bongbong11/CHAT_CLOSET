import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,KEY,emptyState,recordDisplay,savedDisplay,pruneDisplayChat,prefixKeys,compactStoredData,updateOutfitMemory,restoreBranchForMessages,saveManualOutfit,savedOutfitForMessages,outfitInjection,reconcileDisplay,trustedTimeline,trimDisplay,displayLimit} from '../core.js';
import {needsOutfitRead} from '../scene-gate.js';
import {registerOutfitMacro,injectPayload} from '../host.js';
import {requireEnglishProfile,toModelData} from '../model-schema.js';
import {normalizeContext,normalizeSceneResponse,patchContext,validateSceneFacts,resolveOutfit,sceneRequest,satisfiesRequest,matchesGeneratedRequest} from '../outfit-rules.js';
import {itemTraits,underwearSlot,newItemPolicy,matchingGroup} from '../wardrobe.js';

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
 const a=message(1),b=message(2);recordDisplay(branch,'chat',[a],state,2);recordDisplay(branch,'chat',[a,b],state,2);
 assert.equal(Object.keys(branch.display.snapshots).length,1);
 assert.ok(savedDisplay(branch,'chat',a,prefixKeys([a])[0]));
 assert.equal(savedDisplay(branch,'chat',a,'edited-prefix'),null);
 assert.equal(savedDisplay(branch,'chat',{...a,swipe:1},prefixKeys([a])[0]),null);
 assert.equal(savedDisplay(branch,'other',a,prefixKeys([a])[0]),null);
 branch.display.snapshots.orphan={};const compact=compactStoredData({settings:{displayLimit:2},characters:{c:{branches:{b:branch}}}});assert.equal(compact.removed.display,1);
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
 const recovered=resolveOutfit(same.state,facts({resolvedConditions:['Pregnant'],resolvedNeeds:['Avoid waist pressure']}),stock);assert.deepEqual(recovered.state.people.character.context.conditions,[]);assert.ok(ids(recovered.state).includes('loose'));
 const advanced=resolveOutfit(state,facts({conditions:['32 weeks pregnant']}),stock);assert.ok(ids(advanced.state).includes('loose'));assert.ok(ids(advanced.state).includes('top'));
});
test('실제 목욕만 탈의하고 계절/기온은 필요한 겉옷만 조정한다',()=>{
 const state=home();assert.equal(resolveOutfit(state,facts({phase:'washing'}),owned).state.people.character.nude,true);
 const coat={id:'coat',category:'겉옷',name:'wool coat',brand:'COS'};
 const cold=resolveOutfit(state,facts({location:'outside',space:'public',phase:'outdoors',season:'winter',temperature:3}),{...owned,character:[...owned.character,coat]});assert.ok(ids(cold.state).includes('coat'));
 const warm=resolveOutfit(cold.state,facts({temperature:28}),owned);assert.ok(!ids(warm.state).includes('coat'));assert.ok(ids(warm.state).includes('top'));
});
test('부족한 범주만 요청하고 잘못된 사실·코디 전체 응답은 거절한다',()=>{
 const result=resolveOutfit(home(),facts({location:'outside',space:'public',phase:'outdoors'}),{character:[shirt,pants,briefs],persona:[]});assert.deepEqual(result.missing,[{requestId:'character-1',who:'character',category:'신발',reason:'public_coverage'}]);
 for(const invalid of [{people:{}},{changes:{character:{items:[]}}},{changes:{character:{context:{location:'Mars'}}}}])assert.equal(normalizeSceneResponse(invalid).outcome,'unusable');
 const request=sceneRequest(home(),[message(1)]);assert.deepEqual(Object.keys(request),['people','contextMessages','messages']);assert.equal(request.wardrobes,undefined);assert.equal(request.profiles,undefined);assert.equal(request.people.character.worn[0].id,undefined);
});
test('의상 요청 ID와 단복수 의복명 정규화로 생성 결과를 안정적으로 연결한다',()=>{
 const request={requestId:'persona-1',category:'신발',reason:'explicit',name:'low heels'};
 const item={category:'신발',name:'low heel pumps',color:'nude',brand:'CHARLES & KEITH'};
 assert.equal(satisfiesRequest(item,request,normalizeContext({location:'outside',phase:'formal'})),true);
 const missing=resolveOutfit(home(),facts({location:'outside',space:'public',phase:'outdoors'}),{character:[shirt,pants,briefs],persona:[]}).missing;
 assert.equal(missing[0].requestId,'character-1');
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
test('표시 기록은 최근 N개만 남기고 선택되지 않은 스와이프와 미참조 스냅샷을 정리한다',()=>{
 const branch={},state=home(),messages=Array.from({length:85},(_,i)=>message(i));
 for(let i=0;i<messages.length;i++)recordDisplay(branch,'chat',messages.slice(0,i+1),state,3);
 assert.equal(savedDisplay(branch,'chat',messages[0],prefixKeys(messages)[0]),null);assert.equal(Object.keys(branch.display.chats.chat).length,3);assert.equal(Object.keys(branch.display.snapshots).length,1);
 const raw=messages.map(m=>({send_date:m.id,is_user:false,mes:m.content,name:''}));
 const alt={...messages.at(-1),content:'Other outfit.',swipe:1};recordDisplay(branch,'chat',[...messages.slice(0,-1),alt],state,3);
 raw.at(-1).swipes=[raw.at(-1).mes,alt.content];
 pruneDisplayChat(branch,'chat',raw,3);assert.equal(savedDisplay(branch,'chat',alt,prefixKeys([...messages.slice(0,-1),alt]).at(-1)),null);
 assert.ok(Object.keys(branch.display.chats.chat).length<=3);trimDisplay(branch,1);assert.ok(Object.keys(branch.display.chats.chat).length<=1);
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


test('최근 N개 제한은 방별로 적용하고 줄이면 오래된 기록과 스냅샷을 지운다',()=>{
 const b={},messages=[message(1),message(2),message(3)],a=home(),n=emptyState();n.people.character.nude=true;
 recordDisplay(b,'a',messages.slice(0,1),a,2);recordDisplay(b,'a',messages.slice(0,2),n,2);recordDisplay(b,'a',messages,a,2);recordDisplay(b,'b',[message('b')],n,2);
 assert.equal(Object.keys(b.display.chats.a).length,2);assert.equal(Object.keys(b.display.chats.b).length,1);trimDisplay(b,1);assert.equal(Object.keys(b.display.chats.a).length,1);assert.equal(Object.keys(b.display.snapshots).length,2);
 assert.equal(displayLimit(-1),1);assert.equal(displayLimit(100),20);assert.equal(displayLimit(''),1);
});

test('새로고침에서 유효한 현재 판독은 최신 답변에 연결하고 모델을 부르지 않는다',async()=>{
 const storage=memory(),s=new Store(storage);s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);s.bind('c',bid,'chat');b.profiles.character={wardrobe:owned.character};b.base=home();b.current=home();
 const messages=[message(1)];const e=new Engine(s,async()=>({changes:{}}));await e.read('c',bid,messages,{chatId:'chat'});delete b.display.chats.chat;s.save();
 const loaded=new Store(storage),restored=loaded.branch('c',bid);assert.ok(reconcileDisplay(restored,'chat',messages,1));assert.ok(savedDisplay(restored,'chat',messages[0],prefixKeys(messages)[0]));assert.deepEqual(trustedTimeline(restored,messages,'chat').state,b.current);
});

test('삭제·수정·하이드는 무효 상태를 주입하지 않고 다음 판독은 신체·탈의 기억을 이어받지 않는다',async()=>{
 const s=new Store(memory());s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);s.bind('c',bid,'chat');b.base=home();b.current=home();b.profiles.character={wardrobe:owned.character};
 const before=[message(1),message(2,'He undresses.')];const e=new Engine(s,async()=>({changes:{character:{context:{conditions:['Pregnant']},actions:[{op:'nude'}]}}}));await e.read('c',bid,before,{chatId:'chat'});
 const remaining=[before[0]];reconcileDisplay(b,'chat',remaining,1);assert.equal(savedOutfitForMessages(b,remaining,'chat'),null);assert.equal(outfitInjection(savedOutfitForMessages(b,remaining,'chat')),'');
 restoreBranchForMessages(b,remaining,'chat');assert.deepEqual(b.current.people.character.context.conditions,[]);assert.deepEqual(b.outfitMemory,{});
 let request;const next=new Engine(s,async(_system,data)=>{request=data;return {changes:{}};});await next.read('c',bid,[...remaining,message(3)],{chatId:'chat',gate:true});
 assert.equal(request.people.character.nude,false);assert.deepEqual(request.people.character.worn,[]);assert.equal(request.people.character.context.conditions,undefined);assert.ok(trustedTimeline(b,[...remaining,message(3)],'chat'));
 const changed=[{...remaining[0],content:'Edited'},message(3)];reconcileDisplay(b,'chat',changed,1);assert.equal(savedOutfitForMessages(b,changed,'chat'),null);
});

test('사용자 입력 추가는 유효 착장을 유지하고 리롤은 보관된 이전 답변이 있을 때만 참고한다',async()=>{
 const s=new Store(memory());s.data.settings.displayLimit=2;s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);b.base=home();b.current=home();
 const messages=[message(1)],e=new Engine(s,async()=>({changes:{}}));await e.read('c',bid,messages,{chatId:'chat'});messages.push(message(2));await e.read('c',bid,messages,{chatId:'chat'});
 assert.ok(savedOutfitForMessages(b,[...messages,{id:'u',role:'user',content:'Next'}],'chat'));
 assert.ok(savedOutfitForMessages(b,messages.slice(0,-1),'chat'));trimDisplay(b,1);assert.equal(savedOutfitForMessages(b,messages.slice(0,-1),'chat'),null);
 const alt=[messages[0],{...messages[1],content:'Alternate',swipe:1}];reconcileDisplay(b,'chat',alt,1);assert.equal(savedOutfitForMessages(b,alt,'chat'),null);
});


test('판독 중 여러 답변 삭제 후 늦은 응답은 버리고 취향과 소유 옷은 보존한다',async()=>{
 const s=new Store(memory());s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);b.profiles.character={fields:{style:{value:'Casual'}},wardrobe:owned.character};
 const first=[message(1)];await new Engine(s,async()=>({changes:{}})).read('c',bid,first,{chatId:'chat'});
 let release;const engine=new Engine(s,()=>new Promise(resolve=>release=resolve));const work=engine.read('c',bid,[...first,message(2)],{chatId:'chat',force:true});
 reconcileDisplay(b,'chat',[],1);engine.cancel();release({changes:{character:{actions:[{op:'nude'}]}}});assert.equal(await work,null);
 assert.equal(savedOutfitForMessages(b,[],'chat'),null);assert.equal(b.profiles.character.fields.style.value,'Casual');assert.deepEqual(b.profiles.character.wardrobe,owned.character);
 assert.equal(Object.keys(b.display.chats.chat).length,0);assert.equal(Object.keys(b.display.snapshots).length,0);
});

test('마지막 사용자 입력을 삭제하면 답변 메모와 주입을 같은 유효 체크포인트로 맞춘다',async()=>{
 const s=new Store(memory());s.createCharacter('c','C');const bid=s.createBranch('c','B'),b=s.branch('c',bid);s.bind('c',bid,'chat');b.base=home();b.current=home();b.profiles.character={wardrobe:owned.character};
 const reply=message(1),messages=[reply],e=new Engine(s,async()=>({changes:{}}));await e.read('c',bid,messages,{chatId:'chat'});
 const changed=[reply,{id:'u',role:'user',content:'He removes all his clothes.'}];
 await new Engine(s,async()=>({changes:{character:{actions:[{op:'nude'}]}}})).read('c',bid,changed,{chatId:'chat'});
 assert.equal(savedDisplay(b,'chat',reply,prefixKeys(messages)[0]).state.people.character.nude,true);
 reconcileDisplay(b,'chat',messages,1);restoreBranchForMessages(b,messages,'chat');
 const shown=savedDisplay(b,'chat',reply,prefixKeys(messages)[0]).state;
 assert.equal(shown.people.character.nude,false);assert.deepEqual(shown.people.character.items,b.current.people.character.items);
 assert.equal(outfitInjection(shown),outfitInjection(savedOutfitForMessages(b,messages,'chat')));
});

test('숫자로만 된 표시 키도 최근 순서대로 보관하고 반복 복원은 저장을 바꾸지 않는다',async()=>{
 const messages=[message(1),message(1908),message(2)],b={};
 for(let i=0;i<messages.length;i++)recordDisplay(b,'chat',messages.slice(0,i+1),home(),2);
 const keys=prefixKeys(messages);assert.equal(savedDisplay(b,'chat',messages[0],keys[0]),null);
 assert.ok(savedDisplay(b,'chat',messages[1],keys[1]));assert.ok(savedDisplay(b,'chat',messages[2],keys[2]));
 const s=new Store(memory());s.createCharacter('c','C');const bid=s.createBranch('c','B'),branch=s.branch('c',bid);
 await new Engine(s,async()=>({changes:{}})).read('c',bid,messages,{chatId:'chat'});
 assert.equal(reconcileDisplay(branch,'chat',messages,1),false);assert.equal(reconcileDisplay(branch,'chat',messages,1),false);
});


test('표현·표시·추가 필드 차이는 정리하고 같은 실제 착장을 만든다',()=>{
 const variants=[
  {changes:{character:{context:{location:'outside',space:'public',phase:'outdoors'}}}},
  {reason:'ignored',Changes:{CHAR:{Context:{LOCATION:' Outside. ',SPACE:'PUBLIC',PHASE:'outdoor',temperature:'22°C'},Actions:null,transition:'true'}},sceneKo:{place:'Main Street'}},
  {result:{people:{Alex:{location:'outside',space:'public',phase:'outdoors',conditions:null}},extra:'ignored'}},
  'Character:\nLocation: outside\nSpace: public\nPhase: outdoors',
 ];
 for(const raw of variants){const result=normalizeSceneResponse(raw,{names:{character:'Alex'}});assert.notEqual(result.outcome,'unusable');assert.deepEqual(ids(resolveOutfit(home(),result.facts,owned).state),['top','bottom','briefs','shoes']);}
});
test('동일 답변의 탈의·재착용은 실제 순서대로 처리한다',()=>{
 const wear={op:'put on',category:'top',name:'Oxford shirt'};
 for(const [actions,nude,worn] of [[[{op:'nude',category:'',name:null},wear],false,['top']],[[wear,{op:'nude'}],true,[]]]){
  const packet=normalizeSceneResponse({changes:{character:{actions}}});assert.equal(packet.outcome,'applied');
  const result=resolveOutfit(home(),packet.facts,owned);assert.equal(result.state.people.character.nude,nude);assert.deepEqual(ids(result.state),worn);
 }
});
test('모호한 행동은 자동 환복을 보류하고 다른 인물의 확실한 행동은 살린다',()=>{
 const raw={changes:{character:{context:{location:'outside',phase:'outdoors'},actions:{op:'mystery'}},persona:{actions:{op:'nude'}}}};
 const parsed=normalizeSceneResponse(raw),initial=home();initial.people.character.items=[];initial.people.character.nude=true;
 const result=resolveOutfit(initial,parsed.facts,owned);assert.equal(parsed.outcome,'partial');assert.equal(result.state.people.character.nude,true);assert.equal(result.state.people.persona.nude,true);assert.deepEqual(result.missing,[]);
});

test('이름을 해석하지 못한 탈의는 범주 전체 벗기로 확대하지 않는다',()=>{
 const parsed=normalizeSceneResponse({changes:{character:{context:{location:'outside',phase:'outdoors'},actions:[{op:'remove',category:'top',name:'특정 셔츠'}]}}});
 const result=resolveOutfit(home(),parsed.facts,owned);assert.ok(ids(result.state).includes('top'));assert.deepEqual(result.missing,[]);assert.equal(parsed.outcome,'partial');
});
test('선택 착용 상태의 길이 차이 때문에 의미가 분명한 조정을 거절하지 않는다',()=>{
 const wearing='sleeves rolled to the elbow with the old fastening left loose';
 const parsed=normalizeSceneResponse({changes:{character:{actions:{op:'adjust',category:'top',name:'Oxford shirt',wearing:wearing+'. '+wearing}}}});
 const result=resolveOutfit(home(),parsed.facts,owned);assert.equal(result.state.people.character.items[0].wearing,wearing+'. '+wearing);
});

test('일상 활동 요약은 수집하지 않고 임신·입원·착용 제약을 인물별로 유지한다',()=>{
 const parsed=normalizeSceneResponse({changes:{character:{context:{location:'hospital',phase:'hospitalized',conditions:['Leg injury','Leg cast'],needs:['Easy leg access']}},persona:{context:{conditions:['Pregnant'],needs:['Avoid waist pressure']}}},scene:{activity:'Watching football and eating while checking blood pressure'},sceneKo:{activity:'경기 영상을 보며 식사 및 혈압 재측정 중'}});
 assert.equal(parsed.facts.scene?.activity,undefined);assert.equal(parsed.facts.sceneKo?.activity,undefined);
 assert.equal(parsed.facts.changes.character.context.phase,'care');assert.deepEqual(parsed.facts.changes.persona.context.conditions,['Pregnant']);assert.deepEqual(parsed.facts.changes.persona.context.needs,['Avoid waist pressure']);
});

test('신체 상태는 언급·빈 배열·새 상태 추가로 지워지지 않고 해소된 사실만 제거된다',()=>{
 const old=normalizeContext({conditions:['Pregnant','Leg injury'],needs:['Avoid waist pressure']});
 assert.deepEqual(patchContext(old,{conditions:[]}).conditions,['Pregnant','Leg injury']);
 const admitted=patchContext(old,{conditions:['Inpatient treatment']});assert.deepEqual(admitted.conditions,['Pregnant','Leg injury','Inpatient treatment']);
 const discharged=patchContext(admitted,{resolvedConditions:['Inpatient treatment']});assert.deepEqual(discharged.conditions,['Pregnant','Leg injury']);assert.deepEqual(discharged.needs,['Avoid waist pressure']);
 const healed=patchContext(discharged,{resolvedConditions:['leg injury'],resolvedNeeds:[]});assert.deepEqual(healed.conditions,['Pregnant']);
});

test('해제 항목은 context 내부나 인물 바로 아래에 와도 해석하고 퇴원만 적용한다',()=>{
 for(const part of [{context:{resolvedConditions:['Inpatient treatment']}},{context:{location:'home'},resolvedConditions:['Inpatient treatment']}]){
  const packet=normalizeSceneResponse({changes:{persona:part}}),state=home();state.people.persona.context=normalizeContext({conditions:['Pregnant','Inpatient treatment','Leg injury']});
  const result=resolveOutfit(state,packet.facts,owned);assert.deepEqual(result.state.people.persona.context.conditions,['Pregnant','Leg injury']);
 }
});


test('새 옷 추가의 옛 선택값은 삭제하지 않고 서버 설정으로 복원한다',()=>{
 for(const [value,expected] of [['적게','low'],['보통','medium'],['많이','high'],['off','off'],[false,'off']]){
  const storage=memory();storage.setItem(KEY,JSON.stringify({version:1,settings:{newItems:value},characters:{}}));
  const store=new Store(storage);assert.equal(store.data.settings.newItems,expected);store.save();assert.equal(new Store(storage).data.settings.newItems,expected);
 }
 assert.equal(newItemPolicy(undefined),'medium');
});
test('한글 레거시 브라·양말은 팬티가 아니고 상충하는 슬롯 태그도 믿지 않는다',()=>{
 assert.equal(underwearSlot({category:'속옷',name:'심리스 몰드컵 와이어리스 브라',traits:{slot:'briefs'}}),'bra');
 assert.equal(underwearSlot({category:'속옷',name:'흰색 양말'}),'socks');assert.equal(underwearSlot({category:'속옷',name:'속셔츠'}),'undershirt');
 assert.equal(underwearSlot({category:'속옷',name:'면 팬티'}),'briefs');
 assert.ok(itemTraits({category:'하의',name:'슬림 테일러드 울 슬랙스'}).use.includes('formal'));
 assert.ok(itemTraits({category:'하의',name:'허리 밴딩 조거 팬츠'}).fit.includes('adjustable'));
});
const legacyPersona=()=>{
 const state=emptyState();state.people.persona.context=normalizeContext({location:'home',space:'private',phase:'resting',conditions:['pregnant'],season:'autumn',temperature:16});
 state.people.persona.items=[{id:'old-shirt',category:'상의',name:'버튼다운 코튼 팝린 셔츠',brand:'',source:'추정 보유'},
 {id:'old-slacks',category:'하의',name:'슬림 테일러드 울 슬랙스',brand:'',source:'추정 보유'},
 {id:'old-bra',category:'속옷',name:'심리스 와이어리스 브라',brand:'UNIQLO',source:'추정 보유'}];return state;
};
const lounge={id:'lounge',category:'하의',name:'drawstring lounge trousers',brand:'UNIQLO',labelKo:'밴딩 라운지 바지',brandKo:'유니클로',traits:{use:['home'],fit:['adjustable']}};
test('변화 없는 정상 응답에서도 기존 추정 착장을 보정하고 적합한 옷과 임신 상태는 유지한다',()=>{
 const baseline=legacyPersona(),before=structuredClone(baseline),stock={character:[],persona:[...baseline.people.persona.items,lounge,{...briefs,id:'p-briefs'}]};
 const result=resolveOutfit(baseline,{changes:{}},stock);
 assert.deepEqual(result.state.people.persona.items.map(i=>i.id),['old-shirt','old-bra','lounge','p-briefs']);
 assert.deepEqual(result.missing,[]);assert.deepEqual(result.state.people.persona.context.conditions,['pregnant']);assert.deepEqual(baseline,before);
 const same=resolveOutfit(result.state,{changes:{}},stock);assert.deepEqual(same.state,result.state);assert.ok(same.decisions.some(d=>d.reason==='already_checked'));
 assert.doesNotMatch(outfitInjection(result.state),/origins|matchKey|pregnant|requirements|home_use/);
});
test('낮은 생성 설정도 보유한 적합한 대체품은 사용하고 중간부터 용도에 맞는 새 품목을 요청한다',()=>{
 for(const policy of ['off','low','medium','high']){
  const state=legacyPersona();state.people.persona.items.push({...briefs,id:'p-briefs'});const stock={character:[],persona:state.people.persona.items};
  const result=resolveOutfit(state,{changes:{}},stock,{}, {},{newItems:policy});
  assert.equal(result.missing.length,['medium','high'].includes(policy)?1:0);
  if(result.missing.length){assert.equal(result.missing[0].cause,'home_use');assert.deepEqual(result.missing[0].requirements,{use:['home','casual']});}
  else assert.ok(result.decisions.some(d=>d.action==='generation_skipped'));
  assert.ok(resolveOutfit(state,{changes:{}},{character:[],persona:[...stock.persona,lounge]}, {}, {},{newItems:policy}).state.people.persona.items.some(i=>i.id==='lounge'));
 }
});
test('생성 끄기는 자동 생성만 막고 이야기에서 실제 입은 새 옷의 기록은 허용한다',()=>{
 const state=home(),stock={character:[shirt,pants,briefs],persona:[]},packet=facts({location:'outside',space:'public',phase:'outdoors'});
 assert.equal(resolveOutfit(state,packet,stock,{}, {},{newItems:'off'}).missing.length,0);
 assert.equal(resolveOutfit(state,packet,stock,{}, {},{newItems:'low'}).missing[0].category,'신발');
 const explicit=validateSceneFacts({changes:{character:{actions:[{op:'wear',category:'겉옷',name:'raincoat'}]}}});
 assert.equal(resolveOutfit(state,explicit,stock,{}, {},{newItems:'off'}).missing[0].reason,'explicit');
});
test('일반 임신과 핏 미확인만으로 압박 금지나 새 의상을 만들지 않는다',()=>{
 const state=home();state.people.character.context.conditions=['pregnant'];
 const result=resolveOutfit(state,{changes:{}},owned);assert.deepEqual(ids(result.state),ids(state));assert.deepEqual(result.missing,[]);assert.deepEqual(result.state.people.character.context.needs,[]);
});
test('저장된 신체 제약은 변화 없는 응답에서도 반영하며 허리 제약으로 브라나 양말을 교체하지 않는다',()=>{
 const state=home(),tight={...pants,id:'tight',name:'slim rigid trousers'};state.people.character.items=[shirt,tight,briefs,{id:'bra',category:'속옷',name:'slim bra'},{id:'sock',category:'속옷',name:'compression socks'}];state.people.character.context.needs=['Avoid waist pressure'];
 const result=resolveOutfit(state,{changes:{}},{character:state.people.character.items,persona:[]},{},{},{newItems:'low'});
 assert.equal(result.missing.length,1);assert.equal(result.missing[0].category,'하의');assert.deepEqual(result.missing[0].requirements.fit,['loose','adjustable','maternity']);
});
test('명시된 옷과 수동 착장은 보정으로 덮지 않으며 실제 새 이동 이후에만 다시 비교한다',()=>{
 const state=legacyPersona();state.people.persona.origins={'old-slacks':'explicit'};state.people.persona.items.push({...briefs,id:'p-briefs'});
 const stock={character:[],persona:[...state.people.persona.items,lounge]};
 const kept=resolveOutfit(state,{changes:{}},stock);assert.ok(kept.state.people.persona.items.some(i=>i.id==='old-slacks'));
 const room=resolveOutfit(kept.state,validateSceneFacts({changes:{persona:{transition:true}}}),stock);assert.ok(room.state.people.persona.items.some(i=>i.id==='old-slacks'));
 const arrived=structuredClone(kept.state);arrived.people.persona.context=normalizeContext({location:'outside',space:'public',phase:'outdoors'});
 const moved=resolveOutfit(arrived,validateSceneFacts({changes:{persona:{transition:true,context:{location:'home',space:'private',phase:'resting'}}}}),stock);assert.ok(moved.state.people.persona.items.some(i=>i.id==='lounge'));
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);b.current=state;b.profiles.persona={wardrobe:stock.persona};
 saveManualOutfit(b,state.people,[message(1)],'chat');assert.equal(b.current.people.persona.origins['old-slacks'],'manual');assert.equal(b.current.people.persona.manualOutfit,true);
 assert.ok(resolveOutfit(b.current,{changes:{}},stock).state.people.persona.items.some(i=>i.id==='old-slacks'));
});
test('새 옷 허용값 변경은 재평가하되 같은 장면을 매번 새로 채우지 않는다',()=>{
 const state=legacyPersona();state.people.persona.items.push({...briefs,id:'p-briefs'});const stock={character:[],persona:state.people.persona.items};
 const off=resolveOutfit(state,{changes:{}},stock,{}, {},{newItems:'off'});
 const same=resolveOutfit(off.state,{changes:{}},stock,{}, {},{newItems:'off'});assert.deepEqual(same.missing,[]);assert.deepEqual(same.state,off.state);
 assert.equal(resolveOutfit(off.state,{changes:{}},stock,{}, {},{newItems:'medium'}).missing.length,1);
});
test('많이 설정도 실제 비가 오는 외출에만 방수 기능을 보충한다',()=>{
 const state=home();state.people.character.items.push(shoes);state.people.character.context=normalizeContext({location:'outside',space:'public',phase:'outdoors',weather:'rain',temperature:18});
 const high=resolveOutfit(state,{changes:{}},owned,{}, {},{newItems:'high'});assert.equal(high.missing[0].reason,'rain_protection');
 assert.deepEqual(resolveOutfit(state,{changes:{}},owned,{}, {},{newItems:'medium'}).missing,[]);
 const clear=structuredClone(state);clear.people.character.context.weather='mild';assert.deepEqual(resolveOutfit(clear,{changes:{}},owned,{}, {},{newItems:'high'}).missing,[]);
});
test('가능한 기존 겉옷의 여밈 조절은 신체 제약에 맞춰 같은 ID로 처리한다',()=>{
 const state=home(),jacket={id:'jacket',category:'겉옷',name:'button-front jacket',wearing:'fully buttoned'};state.people.character.items.push(jacket);state.people.character.context.needs=['Avoid abdominal pressure'];
 const result=resolveOutfit(state,{changes:{}},{character:[...owned.character,jacket],persona:[]});assert.equal(result.state.people.character.items.find(i=>i.id==='jacket').wearing,'worn open');assert.deepEqual(result.missing,[]);
});
test('부족한 홈웨어와 팬티만 생성하며 저장 재진입과 다음 판독에서 재사용한다',async()=>{
 const storage=memory(),store=new Store(storage);store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);b.base=legacyPersona();b.current=structuredClone(b.base);b.profiles.persona={fields:{'스타일':{value:'Restrained casual clothing'}},wardrobe:structuredClone(b.base.people.persona.items)};
 let count=0,seen;const generate=async request=>{count++;seen=request;return {newItems:{persona:request.missing.filter(n=>n.who==='persona').map(n=>n.slot==='briefs'?{...briefs,requestId:n.requestId,labelKo:'검정 팬티',brandKo:'유니클로'}:{...lounge,requestId:n.requestId})}};};
 const engine=new Engine(store,async()=>({changes:{}}),generate);await engine.read('c',bid,[message(1)],{force:true});
 assert.equal(count,1);assert.equal(seen.missing.length,2);assert.equal(new Set(seen.missing.map(n=>n.requestId)).size,2);assert.ok(seen.missing.some(n=>n.slot==='briefs'));assert.ok(seen.missing.some(n=>n.cause==='home_use'));assert.equal(b.extra.persona.length,2);
 assert.ok(b.current.people.persona.items.some(i=>i.name==='drawstring lounge trousers'));assert.equal(underwearSlot(b.current.people.persona.items.find(i=>i.name==='briefs')),'briefs');
 await engine.read('c',bid,[message(1),message(2)],{force:true});assert.equal(count,1);
 const restored=new Store(storage),next=new Engine(restored,async()=>({changes:{}}),generate);await next.read('c',bid,[message(1),message(2),message(3)],{force:true});assert.equal(count,1);assert.equal(restored.branch('c',bid).extra.persona.length,2);
 assert.deepEqual(b.current.people.character.context.conditions,[]);assert.deepEqual(Object.keys(store.data.characters),['c']);
});
test('생성이 다른 속옷 슬롯을 돌려주면 저장을 부분 변경하지 않는다',async()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);b.base=home();b.base.people.character.items=b.base.people.character.items.filter(i=>i.id!=='briefs');b.current=structuredClone(b.base);b.profiles.character={wardrobe:[shirt,pants,shoes]};
 const before=structuredClone(b),engine=new Engine(store,async()=>({changes:{character:{context:{location:'outside',space:'public',phase:'outdoors'}}}}),async()=>({newItems:{character:[{id:'wrong',category:'속옷',name:'bra',brand:'UNIQLO',labelKo:'브라',brandKo:'유니클로',traits:{slot:'briefs'}}]}}));
 await assert.rejects(engine.read('c',bid,[message(1)]),/요청과 연결/);assert.deepEqual(b,before);
});


test('옷장에 적합한 품목이 추가되면 같은 상황도 다시 비교하고 불필요한 생성은 하지 않는다',()=>{
 const state=legacyPersona();state.people.persona.items.push({...briefs,id:'p-briefs'});const stock={character:[],persona:state.people.persona.items};
 const checked=resolveOutfit(state,{changes:{}},stock,{}, {},{newItems:'off'});
 const updated=resolveOutfit(checked.state,{changes:{}},{character:[],persona:[...stock.persona,lounge]}, {}, {},{newItems:'off'});
 assert.ok(updated.state.people.persona.items.some(i=>i.id==='lounge'));assert.deepEqual(updated.missing,[]);
});
test('기존 추운 외출 상태는 얇은 겉옷을 억지로 고르지 않고 필요한 보온 기능을 요청한다',()=>{
 const state=home();state.people.character.items.push(shoes);state.people.character.context=normalizeContext({location:'outside',space:'public',phase:'outdoors',temperature:3});
 const thin={id:'thin',category:'겉옷',name:'linen blazer',traits:{climate:['hot']}};
 const result=resolveOutfit(state,{changes:{}},{character:[...owned.character,thin],persona:[]});assert.equal(result.missing[0].reason,'cold');assert.deepEqual(result.missing[0].requirements,{climate:['cold']});
 const coat={id:'warm',category:'겉옷',name:'wool coat'};assert.ok(ids(resolveOutfit(state,{changes:{}},{character:[...owned.character,thin,coat],persona:[]}).state).includes('warm'));
 state.people.character.items.push(thin);const replace=resolveOutfit(state,{changes:{}},{character:[...owned.character,thin,coat],persona:[]});assert.ok(ids(replace.state).includes('warm'));assert.ok(!ids(replace.state).includes('thin'));
});
test('매칭 확인용 내부 값만 추가된 턴은 착장 변경 이력으로 쌓지 않는다',async()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);b.base=home();b.current=home();b.profiles.character={wardrobe:owned.character};
 const engine=new Engine(store,async()=>({changes:{}}));await engine.read('c',bid,[message(1)],{force:true});assert.equal(b.history.length,0);assert.ok(b.current.people.character.matchKey);
});

test('생성 의상은 모든 모델에서 큰 카테고리와 공통 그룹으로 연결한다',()=>{
 for(const [category,requested,returned] of [['상의','shirt','linen blouse'],['하의','grey sweats','drawstring joggers'],['신발','shoes','Leather Loafers'],['신발','pumps','satin heels'],['겉옷','thick cardigan','cable knit jacket']]){
  assert.equal(matchesGeneratedRequest({category,name:returned,color:'heather grey',brand:'Other maker'},{category,reason:'explicit',name:requested,color:'grey',brand:'Requested maker'}),true);
 }
 assert.equal(matchesGeneratedRequest({category:'신발',name:'loafers'},{category:'상의',name:'shirt'}),false);
 for(const [name,group] of [['bralette','bra'],['sports bra','bra'],['boxer shorts','briefs'],['briefs','briefs'],['footies','socks'],['덧버선','socks'],['stockings','socks'],['camisole','undershirt'],['gold necklace','jewelry'],['silver ring','jewelry'],['leather belt','utility'],['tote bag','utility']])assert.equal(matchingGroup({category:['jewelry','utility'].includes(group)?'소품':'속옷',name}),group,name);
 assert.equal(matchesGeneratedRequest({category:'속옷',name:'bralette'},{category:'속옷',name:'bra',matchGroup:'bra'}),true);
 assert.equal(matchesGeneratedRequest({category:'속옷',name:'boxers'},{category:'속옷',name:'bra',matchGroup:'bra'}),false);
 assert.equal(matchesGeneratedRequest({category:'소품',name:'silver ring'},{category:'소품',name:'necklace',matchGroup:'jewelry'}),true);
 assert.equal(matchesGeneratedRequest({category:'소품',name:'tote bag'},{category:'소품',name:'necklace',matchGroup:'jewelry'}),false);
 assert.equal(matchesGeneratedRequest({category:'소품',name:'silver torc'},{category:'소품',name:'necklace',matchGroup:'jewelry'}),true);
});

test('카테고리로 통과한 생성품은 이름·색이 달라도 실제 착장까지 연결되고 재검증에서 탈락하지 않는다',async()=>{
 for(const withIds of [true,false]){
  const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B'),b=store.branch('c',bid);let calls=0,seen;
  const engine=new Engine(store,async()=>({changes:{character:{actions:[{op:'wear',category:'하의',name:'grey sweats',color:'grey'}]},persona:{actions:[{op:'wear',category:'신발',name:'shoes'},{op:'wear',category:'소품',name:'necklace'}]}}}),async request=>{
   calls++;seen=request;return {newItems:Object.fromEntries(['character','persona'].map(who=>[who,request.missing.filter(n=>n.who===who).map(n=>({...(withIds?{requestId:n.requestId}:{}),id:n.requestId,category:n.category,name:n.category==='하의'?'drawstring joggers':n.category==='신발'?'Leather Loafers':'silver bracelet',color:'heather grey',brand:'Maker',labelKo:'회색 의류',brandKo:'제작자',available:true}))]))};
  });
  await engine.read('c',bid,[message(1)]);assert.equal(calls,1);assert.equal(seen.missing.find(n=>n.category==='소품').matchGroup,'jewelry');assert.equal(b.current.people.character.items[0].name,'drawstring joggers');assert.ok(b.current.people.persona.items.some(i=>i.name==='Leather Loafers'));assert.ok(b.current.people.persona.items.some(i=>i.name==='silver bracelet'));assert.equal(b.extra.persona.length,2);
 }
});

test('같은 카테고리의 여러 생성품도 요청 ID에 연결된 착용 상태를 서로 바꾸지 않는다',async()=>{
 const store=new Store(memory());store.createCharacter('c','C');const bid=store.createBranch('c','B');store.data.settings.newItems='off';
 const engine=new Engine(store,async()=>({changes:{character:{actions:[{op:'wear',category:'상의',name:'linen shirt',wearing:'rolled sleeves',layer:true},{op:'wear',category:'상의',name:'cotton tee',wearing:'loose hem',layer:true}]}}}),async request=>({newItems:{character:request.missing.map((n,i)=>({requestId:n.requestId,id:n.requestId,category:'상의',name:i===0?'cotton tee':'linen shirt',brand:'Maker',labelKo:'상의',brandKo:'제작자'}))}}));
 await engine.read('c',bid,[message(1)]);const items=store.branch('c',bid).current.people.character.items;assert.equal(items.length,2);assert.equal(items.find(i=>i.name==='cotton tee').wearing,'rolled sleeves');assert.equal(items.find(i=>i.name==='linen shirt').wearing,'loose hem');
});
