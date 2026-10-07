import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProfile,PROFILE_FIELDS,recentTurnStart,Store,Engine,itemDescription,itemBrandLabel,validateState} from '../core.js';
import {translateReport} from '../profile-report.js';
import {candidates} from '../prompts.js';

test('기본 착장은 색과 이름만 표시하고 브랜드 누락을 구분',()=>{
 const item={name:'dress shirt',color:'white',features:['cotton twill','spread collar'],brand:''};
 assert.equal(itemDescription(item),'white dress shirt');assert.equal(itemDescription(item,1),'dress shirt');assert.equal(itemDescription(item,3),'white dress shirt (cotton twill, spread collar)');
 assert.equal(itemBrandLabel(item),'Brand pending');assert.equal(itemBrandLabel({...item,brand:'UNIQLO'}),'UNIQLO');assert.equal(itemBrandLabel({...item,brand:'Local tailor'}),'Local tailor');
 assert.deepEqual(item.features,['cotton twill','spread collar']);
});

test('보고서의 긴 원문과 근거를 500자에서 자르지 않는다',()=>{
 const value='A detailed wardrobe profile. '.repeat(50),evidence='Source evidence. '.repeat(60);
 const p=normalizeProfile({character:{fields:{'스타일':{value,evidence,certainty:'명시'}}}}).character;
 assert.equal(p.fields['스타일'].value,value.trim());assert.equal(p.fields['스타일'].evidence,evidence.trim());
});
test('빠진 브랜드를 보완해 저장하고 이미 있는 브랜드 변경은 거절',async()=>{
 const shirt={id:'shirt',category:'상의',name:'shirt',color:'white',features:[],brand:'',available:true};
 const raw={scene:{},people:{character:{nude:false,items:['shirt']},persona:{nude:false,items:[]}},newItems:{},brandUpdates:{character:[{id:'shirt',brand:'UNIQLO'}],persona:[]}};
 const result=validateState(raw,{character:[shirt],persona:[]});assert.equal(result.state.people.character.items[0].brand,'UNIQLO');assert.equal(shirt.brand,'');
 assert.throws(()=>validateState(raw,{character:[{...shirt,brand:'ZARA'}],persona:[]}),/변경/);
 const s=new Store({getItem:()=>null,setItem(){},removeItem(){}});s.createCharacter('c','C');s.character('c').profiles={character:{fields:{},wardrobe:[shirt]}};const bid=s.createBranch('c','B');s.bind('c',bid,'chat');
 let calls=0;const engine=new Engine(s,async()=>++calls===1?raw:{...raw,brandUpdates:{}});
 const messages=[{id:'1',role:'user',content:'Leave home'}];await engine.read('c',bid,messages);await engine.read('c',bid,messages,{force:true});
 assert.equal(s.branch('c',bid).current.people.character.items[0].brand,'UNIQLO');assert.equal(s.branch('c',bid).extra.character.length,1);
});
test('번역은 원문·옷장·확실성을 변경하지 않는 별도 보기',async()=>{
 const p=normalizeProfile({character:{fields:{'스타일':{value:'Soft tailoring',evidence:'The sheet',certainty:'추정'}}}}).character;
 const original=structuredClone(p);let received;
 const translated=await translateReport(p,async(_system,data)=>{received=data;return {texts:data.texts.map(v=>v?'자연스러운 한국어':'')};});
 assert.equal(received.texts.length,PROFILE_FIELDS.length*2);assert.deepEqual(p,original);
 assert.equal(translated.fields['스타일'].certainty,'추정');assert.equal(translated.fields['스타일'].value,'자연스러운 한국어');assert.deepEqual(translated.wardrobe,p.wardrobe);
 await assert.rejects(()=>translateReport(p,async()=>({texts:['일부']})),/누락/);
});
test('최근 턴은 사용자와 이어지는 답변을 함께 포함',()=>{
 const messages=[{role:'character',content:'Opening'},...Array.from({length:5},(_,i)=>[{role:'user',content:'u'+i},{role:'character',content:'a'+i}]).flat()];
 assert.equal(recentTurnStart(messages,2),7);assert.equal(recentTurnStart(messages,1),9);assert.equal(recentTurnStart(messages,50),0);
});
test('미리 판독은 최근 문맥을 다시 보내되 이미 반영한 행동과 분리',async()=>{
 const storage={getItem:()=>null,setItem(){},removeItem(){}};const s=new Store(storage);s.createCharacter('c','C');const id=s.createBranch('c','B');s.bind('c',id,'chat');s.data.settings.chatTurns=2;
 const calls=[],e=new Engine(s,async(_sys,data)=>{calls.push(data);return {scene:{},people:{character:{nude:false,items:[]},persona:{nude:false,items:[]}},newItems:{}};});
 const messages=Array.from({length:5},(_,i)=>[{id:'u'+i,role:'user',content:'u'+i},{id:'a'+i,role:'character',content:'a'+i}]).flat();
 await e.read('c',id,messages);assert.deepEqual(calls[0].messages,messages.slice(-4));assert.equal(calls[0].omittedEarlierMessages,6);
 await e.read('c',id,messages,{force:true});assert.deepEqual(calls[1].messages,[]);assert.deepEqual(calls[1].contextMessages,messages.slice(-4));
 messages.at(-1).content='Changed swipe';await e.read('c',id,messages);assert.equal(calls[2].messages.at(-1).content,'Changed swipe');
});
test('영어 세계관에서도 시대와 문화권 후보를 구분',()=>{
 const make=value=>({character:{fields:{'배경·복식 문화':{value}}}});
 assert.equal(candidates(()=>0,make('Premodern Joseon Korea')).character.picks[0].type,'jeogori');
 assert.equal(candidates(()=>0,make('Pre-modern medieval Europe')).character.picks[0].type,'tunic');
 assert.equal(candidates(()=>0,make('Modern urban Japan')).character.picks[0].type,'henley shirt');
});
