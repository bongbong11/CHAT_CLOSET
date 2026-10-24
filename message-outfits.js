import {CATEGORIES,visibleMessages,prefixKeys,savedDisplay,displayKey,itemUiLabel,itemUiBrand,koreanDisplay,hash,displayLimit} from './core.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PEOPLE=['character','persona'];

export function collectedHtml(state,names={}){
 const labels={location:{home:'집',outside:'외부',work:'직장',school:'학교',hospital:'병원',other:'기타'},space:{private:'사적 공간',public:'공공 공간'},phase:{resting:'휴식',washing:'씻는 중',after_washing:'씻은 후',sleeping:'수면',preparing:'준비',outdoors:'외출',working:'업무',formal:'격식 있는 자리',care:'돌봄·치료'},season:{spring:'봄',summer:'여름',autumn:'가을',winter:'겨울'},weather:{mild:'온화',hot:'더움',cold:'추움',rain:'비',snow:'눈'},purpose:{casual:'일상',work:'업무',formal:'격식',care:'돌봄·치료'},exception:{barefoot:'명시된 맨발 유지',undressed:'명시된 탈의 유지',keep:'현재 상태 유지'}};
 const fields=[['location','장소'],['space','공간'],['phase','활동'],['conditions','신체 상태'],['needs','착용 제약'],['season','계절'],['temperature','기온'],['weather','날씨'],['purpose','용도'],['exception','현재 예외']];
 const people=PEOPLE.map(who=>{
  const context=state?.people?.[who]?.context||{};
  const rows=fields.map(([key,label])=>{const value=context[key];let shown;
   if(Array.isArray(value))shown=value.length?value.map(v=>({pregnant:'임신',Pregnant:'임신',Injured:'부상',injured:'부상'}[v]||v)).join(' · '):'확인된 내용 없음';
   else if(key==='temperature')shown=typeof value==='number'?value+'℃':'미확인';
   else if(key==='exception')shown=labels[key][value]||(value?'미확인':'명시된 예외 없음');
   else shown=labels[key]?.[value]||'미확인';
   return '<div><dt>'+label+'</dt><dd>'+escape(shown)+'</dd></div>';
  }).join('');
  return '<section><strong>'+escape(names[who]||(who==='character'?'캐릭터':'페르소나'))+'</strong><dl>'+rows+'</dl></section>';
 }).join('');
 return '<details class="kc-collected"><summary>수집된 상황 정보</summary><p class="kc-collected-note">착장 판단에 사용하는 현재 기준값입니다. 신체 상태·제약의 상세 원문은 영어로 표시될 수 있습니다.</p><div class="kc-collected-people">'+people+'</div></details>';
}

export function createMessageOutfits(api){
 const chat=document.querySelector('#chat'),local=new Map();let observer,themeObserver,frame=null,scope='';
 const asset=name=>new URL('assets/'+name,api.base).href;
 function schedule(){if(frame===null)frame=requestAnimationFrame(()=>{frame=null;render();});}
 function render(){
  if(!chat)return;
  const state=api.state(),identity=state.identity,currentScope=identity?identity.id+':'+identity.chat+':'+state.bid:'';
  if(currentScope!==scope){scope=currentScope;local.clear();chat.querySelectorAll('.kc-inline-card').forEach(node=>node.remove());}
  if(!state.settings.enabled||state.settings.displayMode!=='inline'||!identity){chat.querySelectorAll('.kc-inline-card').forEach(node=>node.remove());return;}
  const source=api.context().chat,messages=visibleMessages(source),prefixes=prefixKeys(messages),byIndex=new Map();let visible=0;
  source.forEach((message,index)=>{if(!message.is_system&&!message.is_hidden&&!message.extra?.is_hidden){byIndex.set(index,{message:messages[visible],prefix:prefixes[visible]});visible++;}});
  const eligible=[...byIndex].filter(([,entry])=>entry.message.role==='character').map(([index])=>index),latest=eligible.at(-1),kept=new Set(eligible.slice(-displayLimit(state.settings.displayLimit)));
  const localKeys=new Set([...kept].map(index=>displayKey(byIndex.get(index).message)));
  for(const key of local.keys())if(!localKeys.has(key))local.delete(key);
  for(const node of chat.querySelectorAll('.mes[mesid]')){
   const index=Number(node.getAttribute('mesid')),entry=byIndex.get(index),textNode=node.querySelector('.mes_text');
   let card=node.querySelector('.kc-inline-card');
   if(!kept.has(index)||!entry||entry.message.role!=='character'||!textNode||source[index]?.is_user){card?.remove();continue;}
   const saved=savedDisplay(state.branch,identity.chat,entry.message,entry.prefix),key=displayKey(entry.message);
   if(!saved&&index!==latest){card?.remove();continue;}
   const view=saved?.record||local.get(key)||{folded:false,tab:'character'};
   const busy=!!(state.pending||state.generating||state.backgroundTask),pending=busy&&index===latest;
   const ink=getComputedStyle(node).color;
   const signature=hash(JSON.stringify([scope,key,entry.prefix,saved?.state,view.folded,view.tab,state.settings.brands,identity.name,identity.userName,pending,busy,state.backgroundTask,ink]));
   if(card?.dataset.signature===signature)continue;
   if(!card){card=document.createElement('section');card.className='kc-inline-card';textNode.insertAdjacentElement('afterend',card);}
   card.dataset.signature=signature;card.dataset.viewKey=key;card.setAttribute('aria-label','착장정보');
   const color=ink.match(/[\d.]+/g)?.slice(0,3).map(Number)||[230,230,230];card.classList.toggle('kc-inline-dark',color[0]*.2126+color[1]*.7152+color[2]*.0722>150);
   const names={character:identity.name||'캐릭터',persona:identity.userName||'페르소나'};
   const bodyId='kc-outfit-'+index;
   const personHtml=who=>{
    const person=saved?.state.people[who];
    const content=!person?'<p class="kc-inline-empty">착장 확인 필요 · 현재 옷 보기로 확인할 수 있어요.</p>':person.nude?'<p class="kc-inline-empty">착용 없음</p>':!person.items.length?'<p class="kc-inline-empty">확인된 착장 없음</p>':`<dl>${CATEGORIES.map(category=>{
     const items=person.items.filter(item=>item.category===category);if(!items.length)return '';
     return `<div class="kc-inline-row"><dt>${category}</dt><dd>${items.map(item=>`<span class="kc-inline-item">${escape(itemUiLabel(item))}${state.settings.brands?`<small>${escape(itemUiBrand(item))}</small>`:''}${koreanDisplay(item.wearingKo)?`<em>${escape(item.wearingKo)}</em>`:''}</span>`).join('')}</dd></div>`;
    }).join('')}</dl>`;
    return `<section class="kc-inline-person" id="${bodyId}-${who}" data-who="${who}" data-active="${view.tab===who}"><h4>${escape(names[who])}</h4>${content}</section>`;
   };
   const scene=saved?.state.sceneKo||{},summary=[scene.place,scene.activity].filter(v=>koreanDisplay(v)).join(' · ');
   const collectedOpen=!!card.querySelector('.kc-collected')?.open;
   card.innerHTML=`<span class="kc-inline-tape" aria-hidden="true"></span><div class="kc-inline-head"><button type="button" class="kc-inline-toggle" aria-expanded="${!view.folded}" aria-controls="${bodyId}"><img src="${asset(view.folded?'kikki-closed.webp':'kikki-open.webp')}" alt="끼끼"><span>착장정보</span><span class="kc-inline-chevron" aria-hidden="true">${view.folded?'⌄':'⌃'}</span></button><div class="kc-inline-tools"><button type="button" data-kc-action="read" ${busy?'disabled':''}>현재 옷 보기</button><button type="button" data-kc-action="open">의상실 열기</button></div></div><div class="kc-inline-body" id="${bodyId}" ${view.folded?'hidden':''}>${saved?`<div class="kc-inline-tabs" role="tablist" aria-label="착장 인물">${PEOPLE.map(who=>`<button type="button" id="${bodyId}-tab-${who}" role="tab" aria-selected="${view.tab===who}" aria-controls="${bodyId}-${who}" data-who="${who}">${escape(names[who])}</button>`).join('')}</div><div class="kc-inline-people">${PEOPLE.map(personHtml).join('')}</div>${summary?`<footer>${escape(summary)}</footer>`:''}`:`<p class="kc-inline-empty" role="status">${pending?'착장을 확인하고 있어요.':'착장 확인 필요 · 현재 옷 보기로 확인할 수 있어요.'}</p>`}</div>`;
   if(saved){card.querySelector('.kc-inline-body').insertAdjacentHTML('beforeend',collectedHtml(saved.state,names));card.querySelector('.kc-collected').open=collectedOpen;}
   function update(patch){
    if(scope!==currentScope)return;
    if(saved)api.saveView(entry.message,entry.prefix,patch);
    else local.set(key,{...view,...patch});
    render();
   }
   card.querySelector('[data-kc-action="read"]').addEventListener('click',async event=>{event.stopPropagation();try{await api.read();}catch(error){api.error(error);}});
   card.querySelector('[data-kc-action="open"]').addEventListener('click',event=>{event.stopPropagation();api.open();});
   card.querySelector('.kc-inline-toggle').addEventListener('click',()=>update({folded:!view.folded}));
   card.querySelectorAll('.kc-inline-tabs button').forEach(button=>button.addEventListener('click',()=>update({tab:button.dataset.who})));
  }
 }
 function mount(){
  if(!chat)return;
  observer=new MutationObserver(changes=>{
   if(changes.some(change=>change.type==='attributes'||!change.target.closest?.('.kc-inline-card')&&[...change.addedNodes,...change.removedNodes].some(node=>node.nodeType!==1||!node.matches('.kc-inline-card'))))schedule();
  });
  observer.observe(chat,{childList:true,subtree:true,attributes:true,attributeFilter:['is_system','is_hidden']});
  themeObserver=new MutationObserver(schedule);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});themeObserver.observe(document.body,{attributes:true,attributeFilter:['style','class']});
  const {eventSource,eventTypes}=api.context();
  for(const name of ['CHARACTER_MESSAGE_RENDERED','MORE_MESSAGES_LOADED','CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED'])if(eventTypes[name])eventSource.on(eventTypes[name],schedule);
  schedule();
 }
 return {mount,refresh:schedule,destroy(){observer?.disconnect();themeObserver?.disconnect();if(frame!==null)cancelAnimationFrame(frame);chat?.querySelectorAll('.kc-inline-card').forEach(node=>node.remove());local.clear();}};
}
