import {CATEGORIES,PROFILE_FIELDS,clone,outfitInjection,itemDescription,itemBrandLabel,hash} from './core.js';
import {REPORT_SECTIONS,FIELD_LABELS} from './profile-report.js';
import {visibleBounds,clampMascot,restoreMascot,rememberMascot} from './mascot-position.js';
import {WARDROBE_TABS,wardrobeLevel,wardrobeTargets,ownedItems} from './wardrobe.js';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loreKey=item=>JSON.stringify([item.book,String(item.uid)]);

export function createUI(api){
 const emptyDraft=()=>({target:'',sheet:{},available:{character:[],persona:[]},selected:{character:new Set(),persona:new Set()},status:{character:'',persona:''},busy:false});
 let dialog,sub,quick,bubble,notice,tab='actual',profileTab='character',lastFocus,sourceKey='';
 let draft=emptyDraft();
 const wardrobeLabels=new Map();
 const labelKey=item=>JSON.stringify([item.id,item.name,item.color]);
 const asset=name=>new URL('assets/'+name,api.base).href;
 const el=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
 const button=(label,action,cls='',attrs='')=>`<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
 const mascot=(cls='kc-inline-mascot')=>`<img class="${cls}" src="${asset('kikki-closed.webp')}" alt="">`;
 const title=label=>`<header><h3>${label}</h3>${button('×','sub-close','icon')}</header>`;
 const run=async fn=>{try{await fn();await api.flush();}catch(e){if(e.name!=='AbortError')error(e.message);}};

 async function copyText(value){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return;}catch{}}
  const input=document.createElement('textarea');input.value=value;input.style.cssText='position:absolute;opacity:0;width:1px;height:1px';(sub||dialog||document.body).append(input);input.select();const copied=document.execCommand('copy');input.remove();if(!copied)throw Error('자동 복사를 사용할 수 없습니다. 표시된 태그를 직접 복사하세요.');
 }
 function closeSub(){const old=sub;sub=null;old?.translationController?.abort();old?.close();old?.remove();}
 function popup(label,body){closeSub();const d=el('dialog','kc-dialog kc-sub');sub=d;d.innerHTML=title(label)+`<div class="kc-content">${body}</div>`;document.body.append(d);d.addEventListener('click',click);d.addEventListener('change',change);d.addEventListener('close',()=>{d.translationController?.abort();d.remove();if(sub===d)sub=null;});d.showModal();return d;}
 function error(message){const d=sub?.open?sub:dialog?.open?dialog.querySelector('.kc-main'):null;if(d){let n=d.querySelector('.kc-error');if(!n){n=el('p','kc-error');n.setAttribute('role','alert');d.append(n);}n.textContent=message;n.scrollIntoView({block:'nearest'});}else globalThis.toastr?.error(message,'끼끼의상실');}
 function sceneLabel(state){if(!state)return '아직 착장을 판독하지 않았어요.';return [state.scene.place,state.scene.activity,state.scene.time,state.scene.weather].filter(x=>x&&x!=='불명').join(' · ')||'현재 상황 정보 없음';}
 function itemLabel(item,settings){return itemDescription(item,settings.detail);}
 function outfits(){
  const {branch,settings}=api.state();if(!branch)return '<p class="kc-muted">취향 분석으로 시작하거나 사용할 브랜치를 연결하세요.</p>';
  return ['character','persona'].map(who=>{
   const person=branch.current.people[who];
   return `<article class="kc-person"><div class="kc-label">${who==='character'?'캐릭터':'페르소나'}</div>${person.nude?'<p class="kc-muted">완전 탈의 · 주입 중단</p>':`<dl>${CATEGORIES.map(category=>{
    const items=person.items.filter(item=>item.category===category);
    return `<div class="kc-item"><dt>${category}</dt><dd>${items.length?items.map(item=>`<span class="kc-worn-item"><span>${esc(itemLabel(item,settings))}</span>${settings.brands?`<small class="kc-worn-brand">${esc(itemBrandLabel(item))}</small>`:''}</span>`).join(''):'—'}</dd></div>`;
   }).join('')}</dl>`}</article>`;
  }).join('');
 }
 function select(name,label,values,value){return `<label class="kc-field">${label}<select name="${name}">${values.map(entry=>{const [id,text]=Array.isArray(entry)?entry:[entry,entry];return `<option value="${esc(id)}" ${String(value)===String(id)?'selected':''}>${esc(text)}</option>`;}).join('')}</select></label>`;}
 function checkbox(name,label,value){return `<label class="kc-check"><input type="checkbox" name="${esc(name)}" ${value?'checked':''}>${label}</label>`;}
 function ensureDraft(){const state=api.state(),identity=state.identity;const key=identity?`${identity.id}:${identity.chat}:${identity.personaKey}:${state.bid||''}`:'';if(key!==sourceKey){sourceKey=key;draft=emptyDraft();for(const who of ['character','persona'])draft.selected[who]=new Set(state.branch?.analysisSources?.selected?.[who]||[]);if(sub?.dataset.sourceTarget||sub?.profileDraft||sub?.peopleDraft)closeSub();}}

 function renderMain(){
  if(!dialog?.open)return;
  const probe=el('span','');probe.style.color='var(--SmartThemeBodyColor,#393744)';dialog.append(probe);const rgb=getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0,3).map(Number)||[57,55,68];probe.remove();dialog.classList.toggle('kc-dark-paper',(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)>150);
  ensureDraft();
  const {branch,injectionError}=api.state();
  const main=dialog.querySelector('.kc-main');
  main.innerHTML=tab==='actual'?`<p class="kc-scene">${esc(sceneLabel(branch?.current))}</p>${branch?.suspended?'<p class="kc-muted">데이터를 초기화했어요. 현재 옷 보기를 눌러 시작하세요.</p>':''}<div class="kc-outfits">${outfits()}</div><div class="kc-bottom">${button('현재 옷 보기','read','kc-read-now')}${button('옷장 · 착장 수정','edit')}${button('브랜치','branches')}</div>${injectionError?`<p class="kc-error">${esc(injectionError)}</p>`:''}`:options();
  dialog.querySelectorAll('[data-tab]').forEach(node=>{node.classList.toggle('active',node.dataset.tab===tab);node.setAttribute('aria-selected',node.dataset.tab===tab);});
 }
 function refresh(){const {settings}=api.state();renderMain();if(quick){quick.hidden=!settings.enabled||!settings.mascot;quick.querySelector('img').src=asset(bubble?.open?'kikki-open.webp':'kikki-closed.webp');placeQuick();}if(bubble?.open){bubble.querySelector('.kc-mini-content').innerHTML=`<p class="kc-scene">${esc(sceneLabel(api.state().branch?.current))}</p>${outfits()}`;placeBubble();}const enabled=document.querySelector('#kc-enabled');if(enabled)enabled.checked=settings.enabled;document.querySelectorAll('[name="mascotLocked"]').forEach(n=>n.checked=!!settings.mascotLocked);if(quick)quick.style.touchAction=settings.mascotLocked?'manipulation':'none';storageStatus();}

 function sourcePanel(who){
  const label=who==='character'?'캐릭터':'페르소나',sheet=draft.sheet[who],available=draft.available[who],selected=draft.selected[who];
  const groups=[...new Set(available.map(item=>item.book))].map(book=>{const entries=available.filter(item=>item.book===book);return `<details class="kc-lore-book"><summary>${esc(book)} · ${entries.filter(item=>selected.has(loreKey(item))).length}/${entries.length}</summary>${entries.map(item=>checkbox(`lore:${who}:${loreKey(item)}`,esc(item.title||`엔트리 ${item.uid}`),selected.has(loreKey(item)))).join('')}</details>`;}).join('');
  return `<section class="kc-source-panel"><div class="kc-source-card"><strong>${label} 시트</strong><p class="kc-muted">${sheet?`${esc(sheet.name)} · ${sheet.source.length}자 가져옴`:`${label} 시트를 아직 가져오지 않았습니다.`}</p><div class="kc-actions">${button(`${label} 시트 불러오기`,`sheet-load-${who}`)}${button('시트 보기',`sheet-view-${who}`,'',sheet?'':'disabled')}</div></div><div class="kc-source-card"><strong>${label} 연결 로어북</strong><p class="kc-muted">${draft.status[who]||'연결된 로어북을 불러온 뒤 필요한 엔트리만 체크하세요.'}</p><div class="kc-actions">${button(available.length?'연결 로어북 다시 읽기':'연결 로어북 불러오기',`lore-load-${who}`)}</div>${available.length?`<div class="kc-lore-list">${groups}<p class="kc-muted">${selected.size}개 엔트리 선택됨</p></div>`:''}</div></section>`;
 }
 function options(){
  const {settings,identity}=api.state();
  const targetLabel=draft.target==='character'?'캐릭터':draft.target==='persona'?'페르소나':'';
  const prepared=draft.target&&(draft.sheet[draft.target]?.source||draft.selected[draft.target].size);
  return `<div class="kc-analysis-head"><strong>${esc(identity?.name||'캐릭터 채팅을 여세요.')}</strong><span>대상을 고른 다음 그 대상의 자료만 불러옵니다.</span></div>${select('analysisTarget','분석 대상',[['','먼저 선택하세요'],['character','캐릭터'],['persona','페르소나']],draft.target)}${draft.target?`<div class="kc-source-summary"><strong>${targetLabel} 분석 자료</strong><span>${prepared?'자료 준비됨':'아직 가져오지 않음'}</span>${button('분석 자료 가져오기','open-sources','primary')}</div>`:'<p class="kc-muted">분석 대상을 선택해야 자료 가져오기 버튼이 열립니다.</p>'}<div class="kc-compact-options">${select('fixed','시트 평상복',[['false','스타일 예시'],['true','고정 착장']],String(settings.fixed))}${wardrobeSettings(settings)}${select('newItems','새 옷 추가',['적게','보통','많이'],settings.newItems)}${select('variety','조합 다양성',['적게','보통','많이'],settings.variety)}${select('detail','표시 디테일',[[1,'간단히 · 이름'],[2,'보통 · 색과 이름'],[3,'자세히 · 소재 포함']],settings.detail)}${checkbox('brands','브랜드 표시',settings.brands)}</div><p class="kc-muted">채팅과 기억은 취향 분석에 보내지 않습니다.</p><div class="kc-actions kc-analysis-actions">${button('취향 보기','taste')}${button('브랜치 관리','branches')}</div>`;
 }

 function sourcePicker(){if(!draft.target)return error('분석 대상을 먼저 선택하세요.');const who=draft.target,label=who==='character'?'캐릭터':'페르소나';popup(`${label} 분석 자료 가져오기`,'');sub.dataset.sourceTarget=who;renderSourcePopup();}
 function renderSourcePopup(){if(!sub?.open||sub.dataset.sourceTarget!==draft.target)return;const who=draft.target,ready=draft.sheet[who]?.source||draft.available[who].some(item=>draft.selected[who].has(loreKey(item)));const opened=[...sub.querySelectorAll('.kc-lore-book')].map(node=>node.open);sub.querySelector('.kc-content').innerHTML=`${sourcePanel(who)}<p class="kc-muted">가져온 시트와 체크한 엔트리만 분석 모델에 보냅니다.</p><div class="kc-actions kc-analysis-actions">${button(draft.busy?'취향 분석 중…':'이 자료로 취향 분석','analyze','primary',ready&&!draft.busy?'':'disabled')}</div>`;sub.querySelectorAll('.kc-lore-book').forEach((node,index)=>node.open=opened[index]||false);}

 function open(){lastFocus=document.activeElement;if(!dialog){dialog=el('dialog','kc-dialog');dialog.id='kikki-closet-dialog';dialog.innerHTML=`<div class="kc-paper"></div><div class="kc-shell"><header><div class="kc-title">${mascot('kc-title-icon')}<div><small>WARDROBE DIARY</small><h2>끼끼의상실</h2></div></div></header><nav>${button('현재 착장','tab-actual','tag')}${button('선택지','tab-options','tag')}<div class="kc-nav-tools">${button('⚙','settings','icon')}${button('×','close','icon')}</div></nav><main class="kc-main"></main></div>`;dialog.querySelector('[data-action="tab-actual"]').dataset.tab='actual';dialog.querySelector('[data-action="tab-options"]').dataset.tab='options';dialog.addEventListener('click',click);dialog.addEventListener('change',change);dialog.addEventListener('close',()=>lastFocus?.focus());document.body.append(dialog);}bubble?.close();dialog.showModal();refresh();}
 function taste(){
  const branch=api.state().branch;if(!branch)return error('취향을 먼저 분석하세요.');
  const d=popup('취향 분석 보고서',`<nav class="kc-profile-tabs">${button('캐릭터','profile-character','tag')}${button('페르소나','profile-persona','tag')}${button('번역하기','translate-profile','kc-translate')}</nav><div class="kc-report-status" role="status"></div><div class="kc-profile-grid"></div><div class="kc-actions kc-report-actions">${button('원문 수정','edit-profile')}${button('수정 저장','save-profile','primary')}${button('기본 프로필에 반영','promote')}</div>`);
  d.classList.add('kc-report');d.profileDraft=clone(branch.profiles);d.translations={};d.reportLanguage={character:'en',persona:'en'};d.reportEditing=false;
  for(const who of ['character','persona']){const source=d.profileDraft[who],saved=branch.reportTranslations?.[who];if(source&&saved?.signature===hash(JSON.stringify(source.fields))){d.translations[who]={signature:JSON.stringify(source.fields),profile:{...clone(source),fields:Object.fromEntries(Object.entries(source.fields).map(([key,field])=>[key,{...field,...saved.fields[key]}]))}};d.reportLanguage[who]=saved.language||'ko';}}
  renderProfile();
 }
 function renderProfile(){
  const d=sub;if(!d?.profileDraft)return;
  const source=d.profileDraft[profileTab],signature=JSON.stringify(source?.fields),cached=d.translations[profileTab];
  const korean=d.reportLanguage[profileTab]==='ko'&&cached?.signature===signature;
  const profile=korean?cached.profile:source;
  d.querySelector('.kc-report-status').textContent=d.translationController?'한국어로 번역하고 있습니다…':korean?'한국어 번역 · 저장된 원문은 유지됩니다.':'English original';
  const translate=d.querySelector('[data-action="translate-profile"]');translate.textContent=korean?'원문 보기':'번역하기';translate.disabled=!profile||!!d.translationController||d.reportEditing;
  d.querySelector('[data-action="edit-profile"]').textContent=d.reportEditing?'읽기 모드':'원문 수정';d.querySelector('[data-action="edit-profile"]').disabled=!profile||!!d.translationController;
  d.querySelector('[data-action="save-profile"]').hidden=!d.reportEditing;
  const certainty=korean?{'명시':'명시','추정':'추정','불명':'불명'}:{'명시':'Explicit','추정':'Inferred','불명':'Unknown'};
  d.querySelector('.kc-profile-grid').innerHTML=profile?REPORT_SECTIONS.map(section=>`<section class="kc-report-section"><h4>${esc(korean?section.ko:section.en)}</h4><dl>${section.keys.map(key=>{
   const field=profile.fields?.[key]||{};
   return `<div class="kc-report-field ${String(field.value||'').length>180?'kc-report-wide':''}"><dt>${esc(korean?key:FIELD_LABELS[key])}<small>${esc(certainty[field.certainty]||certainty['불명'])}</small></dt><dd>${d.reportEditing?`<textarea data-profile-field="${esc(key)}" aria-label="${esc(FIELD_LABELS[key])}" rows="2">${esc(field.value||'Unknown')}</textarea>`:`<p class="kc-report-value">${esc(field.value||(korean?'불명':'Unknown'))}</p>`}${field.evidence?`<p class="kc-report-evidence"><span>${korean?'근거':'Evidence'}</span> ${esc(field.evidence)}</p>`:''}</dd></div>`;
  }).join('')}</dl></section>`).join(''):'<p class="kc-muted">이 대상은 아직 분석하지 않았어요.</p>';
  d.querySelectorAll('[data-profile-field]').forEach(input=>{
   const resize=()=>{input.style.height='auto';input.style.height=input.scrollHeight+2+'px';};resize();
   input.addEventListener('input',()=>{source.fields[input.dataset.profileField]={value:input.value,certainty:'명시',evidence:'User edit',locked:true};delete d.translations[profileTab];resize();});
  });
  d.querySelectorAll('.kc-profile-tabs .tag').forEach(node=>{const selected=node.dataset.action==='profile-'+profileTab;node.classList.toggle('active',selected);node.setAttribute('aria-selected',String(selected));});
 }
 async function translateProfileView(){
  const d=sub,who=profileTab,source=d?.profileDraft?.[who];if(!source||d.translationController)return;
  if(d.reportLanguage[who]==='ko'){d.reportLanguage[who]='en';api.saveReportTranslation(who,source,null,'en');renderProfile();return;}
  const signature=JSON.stringify(source.fields);
  if(d.translations[who]?.signature===signature){d.reportLanguage[who]='ko';api.saveReportTranslation(who,source,null,'ko');renderProfile();return;}
  const controller=new AbortController();d.translationController=controller;renderProfile();
  try{
   const translated=await api.translateProfile(clone(source),controller.signal);
   if(sub!==d||!d.open||controller.signal.aborted||JSON.stringify(d.profileDraft[who].fields)!==signature)return;
   d.translations[who]={signature,profile:translated};d.reportLanguage[who]='ko';
   api.saveReportTranslation(who,source,translated,'ko');
  }catch(e){if(e.name!=='AbortError'&&sub===d)error(e.message);}
  finally{if(d.translationController===controller)d.translationController=null;if(sub===d)renderProfile();}
 }
 function settings(){const state=api.state();let profiles=[];try{profiles=api.profiles().map(p=>[p.id,(p.name||p.id)+' · '+(p.model||'')]);}catch{}popup('설정',`${checkbox('enabled','사용함',state.settings.enabled)}${select('profileId','SillyTavern 연결 프로필',[['','선택하세요'],...profiles],state.settings.profileId)}<div class="kc-actions">${button('프로필 새로고침','profiles-refresh')}${button('연결 확인','test')}</div><p class="kc-muted">모델·주소·키는 SillyTavern의 API 연결 메뉴에서 관리합니다.</p>${checkbox('auto','채팅 변화 자동 판독',state.settings.auto)}<label class="kc-field">읽을 최근 채팅 턴 수<input type="number" name="chatTurns" min="1" max="50" step="1" value="${esc(state.settings.chatTurns??8)}"></label><p class="kc-muted">1턴은 사용자 메시지와 이어지는 답변입니다. 최근 1~50턴을 읽으며, 저장된 착장 상태도 함께 참고합니다.</p>${checkbox('mascot','끼끼 빠른 확인 표시',state.settings.mascot)}${checkbox('mascotLocked','끼끼 위치 고정',state.settings.mascotLocked)}${button('끼끼 위치 초기화','mascot-reset')}<p class="kc-muted">PC와 모바일 위치를 따로 기억합니다. 고정해도 화면 밖으로 나가면 안쪽으로 맞춥니다.</p><div class="kc-section">주입 위치</div><p class="kc-muted">모델에게 전달되는 인포블록에서 원하는 위치에 아래 두 줄을 한 번 붙여넣으세요.</p><pre>&lt;kikki_outfit&gt;\n&lt;/kikki_outfit&gt;</pre>${button('태그 복사','copy')}<details><summary>주입 미리보기</summary><pre>${esc(outfitInjection(state.branch?.current)||'현재 착장 없음')}</pre></details><div class="kc-section">서버 저장소</div><p class="kc-storage-status kc-muted" role="status"></p><p class="kc-muted">설정과 판독 결과는 같은 실리 서버·계정에 자동 저장됩니다. 수동 착장·보고서 편집은 저장 버튼을 누르세요.</p><div class="kc-actions">${button('서버 다시 연결','storage-retry')}${state.legacyAvailable?button('이 브라우저의 이전 데이터 가져오기','storage-import'):''}</div><div class="kc-section">저장 데이터 관리</div><div class="kc-actions">${button('현재 채팅 데이터 삭제','delete-chat')}${button('캐릭터 전체 삭제','delete-character')}${button('전체 데이터 삭제','delete-all')}</div>`);}
 function branches(){const {character,bid}=api.state();popup('스토리 브랜치',`<div class="kc-actions">${button('기본으로 새 브랜치','new')}${button('현재 상태 복제','copy-branch')}</div>${character?Object.entries(character.branches).map(([id,b])=>`<div class="kc-branch"><span>${esc(b.name)}${id===bid?' · 현재':''}<small>연결 채팅 ${b.links.length}개</small></span><button data-action="use-branch" data-id="${esc(id)}">이어가기</button><button data-action="delete-branch" data-id="${esc(id)}">삭제</button></div>`).join(''):'<p class="kc-muted">취향 분석 후 브랜치를 만들 수 있어요.</p>'}`);}
 function wardrobeSettings(settings){
  return '<div class="kc-wardrobe-settings">'+select('wardrobeLevel','기본 옷장 구성',[['low','적게'],['medium','중간'],['high','많이']],wardrobeLevel(settings))+'<p class="kc-muted">생활패턴에 맞게 종류별로 배분합니다. 다음 분석·새로 채우기에 적용하며, 기존 옷은 자동 삭제하지 않습니다.</p></div>';
 }
 function edit(){
  const branch=api.state().branch;if(!branch)return error('브랜치를 먼저 연결하세요.');
  const d=popup('옷장 · 착장 수정','');d.classList.add('kc-wardrobe');
  d.peopleDraft=clone(branch.current.people);d.wardrobeWho='character';d.wardrobeCategory='top';renderWardrobe();
 }
 async function translateWardrobeView(items){
  const d=sub;if(!d?.peopleDraft||d.wardrobeBusy)return;
  const missing=items.filter(item=>!wardrobeLabels.has(labelKey(item))&&!d.failedLabels?.has(labelKey(item)));
  if(!missing.length)return;
  const signature=JSON.stringify(missing.map(labelKey));if(d.labelRequest===signature)return;
  d.translationController?.abort();const controller=new AbortController();d.translationController=controller;d.labelRequest=signature;
  try{
   const labels=await api.translateWardrobe(clone(missing),controller.signal);
   if(sub!==d||!d.open||controller.signal.aborted)return;
   for(const item of missing)wardrobeLabels.set(labelKey(item),labels[item.id]);
   while(wardrobeLabels.size>240)wardrobeLabels.delete(wardrobeLabels.keys().next().value);
  }catch(e){if(e.name!=='AbortError'&&sub===d){d.failedLabels??=new Set();for(const item of missing)d.failedLabels.add(labelKey(item));error(e.message);}}
  finally{if(d.translationController===controller){d.translationController=null;d.labelRequest='';if(sub===d)renderWardrobe();}}
 }
 async function refillSelectedWardrobe(){
  const d=sub;if(!d?.peopleDraft||d.wardrobeBusy)return;
  const who=d.wardrobeWho,category=d.wardrobeCategory;
  d.translationController?.abort();d.translationController=null;d.labelRequest='';d.wardrobeBusy=true;renderWardrobe();
  try{
   const changed=await api.refillWardrobe(who,category);
   if(changed&&sub===d){const branch=api.state().branch,available=new Set(ownedItems(branch,who).map(i=>i.id));d.peopleDraft[who].items=d.peopleDraft[who].items.filter(i=>available.has(i.id));d.failedLabels=new Set();}
  }finally{d.wardrobeBusy=false;if(sub===d)renderWardrobe();}
 }
 function renderWardrobe(){
  const d=sub;if(!d?.peopleDraft)return;
  d.shelfScroll??={};if(d.renderedShelf)d.shelfScroll[d.renderedShelf]=d.querySelector('.kc-wardrobe-shelf')?.scrollTop||0;
  const {branch,settings}=api.state(),who=d.wardrobeWho,person=d.peopleDraft[who],all=ownedItems(branch,who),active=WARDROBE_TABS.find(t=>t.id===d.wardrobeCategory);
  const items=all.filter(i=>i.category===active.category),target=wardrobeTargets(settings)[active.id],saved=new Set(branch.current.people[who].items.map(i=>i.id));
  d.querySelector('.kc-content').innerHTML=`<div class="kc-wardrobe-people" role="tablist" aria-label="옷장 인물">${['character','persona'].map(id=>button(id==='character'?'캐릭터':'페르소나','wardrobe-person','tag '+(id===who?'active':''),'role="tab" aria-selected="'+(id===who)+'" data-who="'+id+'"')).join('')}</div><nav class="kc-wardrobe-tabs" role="tablist" aria-label="옷장 종류">${WARDROBE_TABS.map(t=>button(t.label+' <small>'+all.filter(i=>i.category===t.category).length+'</small>','wardrobe-category','tag '+(t.id===active.id?'active':''),'role="tab" aria-selected="'+(t.id===active.id)+'" data-category="'+t.id+'"')).join('')}</nav><div class="kc-wardrobe-heading"><span>${esc(active.label)} · ${items.length}종</span><small>${target?'초기 구성 목표 '+target+'종':'필요한 종류만 보유'}</small></div><div class="kc-wardrobe-shelf" role="tabpanel">${items.length?items.map(item=>{
   const selected=person.items.some(i=>i.id===item.id);
   const label=wardrobeLabels.get(labelKey(item))||(d.failedLabels?.has(labelKey(item))?itemDescription(item,2):'한글 표시 불러오는 중…');
   return `<label class="kc-wardrobe-row ${selected?'is-worn':''}"><input type="checkbox" name="item:${esc(item.id)}" ${selected?'checked':''} aria-label="${esc(label)} 착용"><span class="kc-wardrobe-name">${esc(label)}${selected?`<small class="kc-wardrobe-badge">${saved.has(item.id)?'착용 중':'선택됨'}</small>`:''}</span><span class="kc-wardrobe-brand">${esc(itemBrandLabel(item))}</span></label>`;
  }).join(''):'<p class="kc-muted kc-wardrobe-empty">아직 이 종류의 옷이 없습니다.</p>'}</div><div class="kc-wardrobe-footer">${checkbox('nude','완전 탈의',person.nude)}<span class="kc-muted">선택한 옷 ${person.items.length}개</span><div class="kc-wardrobe-buttons">${button(d.wardrobeBusy?'새로 채우는 중…':'옷장 새로 채우기','refill-wardrobe','','title="선택한 인물의 '+esc(active.label)+' 목록만 교체" '+(branch.profiles[who]?'':'disabled'))}${button('착장 저장','save-outfit','primary')}</div></div>`;
  if(d.wardrobeBusy)d.querySelectorAll('.kc-content button,.kc-content input').forEach(node=>node.disabled=true);
  d.renderedShelf=who+':'+active.id;d.querySelector('.kc-wardrobe-shelf').scrollTop=d.shelfScroll[d.renderedShelf]||0;
  const tabs=d.querySelector('.kc-wardrobe-tabs'),selectedTab=tabs.querySelector('.active');
  if(selectedTab.offsetLeft+selectedTab.offsetWidth>tabs.scrollLeft+tabs.clientWidth)tabs.scrollLeft=selectedTab.offsetLeft+selectedTab.offsetWidth-tabs.clientWidth;
  else if(selectedTab.offsetLeft<tabs.scrollLeft)tabs.scrollLeft=selectedTab.offsetLeft;
  d.querySelector('[name="nude"]').addEventListener('change',event=>{person.nude=event.target.checked;if(person.nude)person.items=[];renderWardrobe();});
  d.querySelectorAll('[name^="item:"]').forEach(input=>input.addEventListener('change',()=>{
   const id=input.name.slice(5),item=all.find(i=>i.id===id);person.items=person.items.filter(i=>i.id!==id);
   if(input.checked){person.nude=false;person.items.push(clone(item));}renderWardrobe();
  }));
  void translateWardrobeView(items);
 }


 async function loadLore(who){const owner=draft;owner.status[who]='연결된 로어북을 읽는 중…';renderSourcePopup();const entries=await api.lore(who);ensureDraft();if(owner!==draft)return;draft.available[who]=entries;draft.selected[who]=new Set([...draft.selected[who]].filter(key=>entries.some(item=>loreKey(item)===key)));draft.status[who]=entries.length?`연결 로어북 ${new Set(entries.map(item=>item.book)).size}개 · 필요한 엔트리를 체크하세요.`:'연결된 로어북이 없습니다.';renderSourcePopup();}
 function buildSelection(){const who=draft.target;return {targets:[who],sources:{[who]:{sheet:draft.sheet[who]||null,lore:draft.available[who].filter(item=>draft.selected[who].has(loreKey(item))).map(item=>({book:item.book,uid:item.uid,title:item.title,content:item.content}))}}};}
async function click(event){const node=event.target.closest('button');if(!node||!node.dataset.action||node.disabled)return;await run(async()=>{const action=node.dataset.action;if(action==='close')dialog.close();else if(action==='sub-close')closeSub();else if(action==='tab-actual'){tab='actual';refresh();}else if(action==='tab-options'){tab='options';refresh();}else if(action==='settings'){settings();storageStatus();}else if(action==='storage-retry')await api.retryStorage();else if(action==='storage-import'){await api.importLegacy();settings();storageStatus();}else if(action==='mascot-reset')resetMascot();else if(action==='taste')taste();else if(action==='open-sources')sourcePicker();else if(action.startsWith('sheet-load-')){const who=action.slice(11);const owner=draft;const sheet=await api.sheet(who);ensureDraft();if(owner!==draft)return;draft.sheet[who]=sheet;renderSourcePopup();}else if(action.startsWith('sheet-view-')){const who=action.slice(11),sheet=draft.sheet[who];if(sheet){let preview=sub.querySelector('.kc-source-preview');if(preview){preview.remove();}else{preview=el('pre','kc-source-preview');preview.textContent=sheet.source;node.closest('.kc-source-card').append(preview);}}}else if(action.startsWith('lore-load-'))await loadLore(action.slice(10));else if(action==='analyze'){if(draft.busy)return;const owner=draft,who=draft.target;owner.busy=true;renderSourcePopup();try{const saved=await api.analyze(buildSelection());if(saved){profileTab=who;closeSub();taste();}}finally{owner.busy=false;renderSourcePopup();}}else if(action==='read'){const state=api.state();if(!state.settings.enabled)throw Error('설정에서 사용함을 켜세요.');if(!state.branch)throw Error('취향을 먼저 분석하거나 브랜치를 연결하세요.');state.branch.suspended=false;await api.read();}else if(action==='profile-character'||action==='profile-persona'){profileTab=action.slice(8);sub.reportEditing=false;renderProfile();}else if(action==='translate-profile')await translateProfileView();else if(action==='edit-profile'){sub.reportEditing=!sub.reportEditing;sub.reportLanguage[profileTab]='en';renderProfile();}else if(action==='save-profile'){api.saveProfiles(sub.profileDraft);closeSub();}else if(action==='promote'){if(confirm('이 취향을 기본 프로필에 반영할까요?')){api.saveProfiles(sub.profileDraft);api.promote();closeSub();}}else if(action==='branches')branches();else if(action==='new'||action==='copy-branch'){const name=prompt('브랜치 이름','새 스토리');if(name!==null){await api.newBranch(action==='new'?'new':'copy',name);closeSub();}}else if(action==='use-branch'){await api.newBranch('existing','',node.dataset.id);closeSub();}else if(action==='delete-branch'){if(confirm('이 브랜치와 연결된 착장 기록을 삭제할까요?')){api.remove('branch',node.dataset.id);branches();}}else if(action==='edit')edit();else if(action==='wardrobe-person'){sub.wardrobeWho=node.dataset.who;renderWardrobe();}else if(action==='wardrobe-category'){sub.wardrobeCategory=node.dataset.category;renderWardrobe();}else if(action==='refill-wardrobe')await refillSelectedWardrobe();else if(action==='save-outfit'){api.saveOutfit(sub.peopleDraft);closeSub();}else if(action==='profiles-refresh'){settings();}else if(action==='test'){await api.testConnection();node.textContent='연결 확인됨';}else if(action==='copy'){await copyText('<kikki_outfit>\n</kikki_outfit>');node.textContent='복사됨';}else if(['delete-chat','delete-character','delete-all'].includes(action)){const kind=action.slice(7);if(confirm(kind==='chat'?'현재 채팅의 착장 데이터를 초기화할까요? 공유 브랜치는 다른 채팅을 보존합니다.':kind==='character'?'이 캐릭터의 모든 프로필·옷장·브랜치를 삭제할까요?':'끼끼의상실의 설정과 저장 데이터 전부를 삭제할까요?')){api.remove(kind);wardrobeLabels.clear();closeSub();}}});}
 function change(event){return run(async()=>{if(event.target.closest('.kc-report'))return;const name=event.target.name;if(!name||name==='editWho'||name.startsWith('item:')||name==='nude')return;if(name==='analysisTarget'){draft.target=event.target.value;refresh();return;}if(name.startsWith('lore:')){const [,who,...rest]=name.split(':');const key=rest.join(':');event.target.checked?draft.selected[who].add(key):draft.selected[who].delete(key);renderSourcePopup();return;}let value=event.target.type==='checkbox'?event.target.checked:event.target.value;if(['detail','chatTurns'].includes(name))value=Number(value);if(name==='chatTurns'){value=Math.max(1,Math.min(50,Math.floor(value)||8));event.target.value=value;}if(name==='fixed')value=value==='true';api.updateSettings({[name]:value});});}

 function mini(){if(bubble?.open){bubble.close();refresh();return;}bubble??=el('dialog','kc-bubble');bubble.innerHTML=`<header><span>지금 입고 있는 옷</span>${button('×','mini-close','icon')}</header><div class="kc-mini-content"></div>${button('의상실 펼치기 ↗','mini-open')}`;if(!bubble.isConnected){document.body.append(bubble);bubble.addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.action;if(action==='mini-close')bubble.close();if(action==='mini-open'){bubble.close();open();}refresh();});bubble.addEventListener('close',refresh);}bubble.show();refresh();}
 function mascotMode(){return matchMedia('(max-width: 600px)').matches?'mobile':'desktop';}
 function screenBounds(){
  const style=getComputedStyle(quick),safe=Object.fromEntries(['top','right','bottom','left'].map(side=>[side,parseFloat(style.getPropertyValue('--kc-safe-'+side))||0]));
  return visibleBounds(window.visualViewport,innerWidth,innerHeight,safe);
 }
 function moveQuick(position){quick.style.right='auto';quick.style.bottom='auto';quick.style.left=position.x+'px';quick.style.top=position.y+'px';}
 function resetMascot(){const settings=api.state().settings;api.updateSettings({mascotPositions:{...settings.mascotPositions,[mascotMode()]:null},mascotPosition:null});}
 function placeQuick(){
  if(!quick||quick.hidden)return;
  const settings=api.state().settings,positions=settings.mascotPositions||{},mode=mascotMode();
  const position=Object.hasOwn(positions,mode)?positions[mode]:settings.mascotPosition;
  moveQuick(restoreMascot(position,quick.offsetWidth,quick.offsetHeight,screenBounds()));
 }
 function placeBubble(){
  if(!bubble?.open)return;
  const bounds=screenBounds(),rect=quick.getBoundingClientRect();
  const leftSide=rect.left>(bounds.left+bounds.right)/2,sideRoom=leftSide?rect.left-bounds.left-8:bounds.right-rect.right-8;
  const vertical=sideRoom<160,above=rect.top-bounds.top>bounds.bottom-rect.bottom;
  bubble.style.boxSizing='border-box';
  bubble.style.maxWidth=Math.max(1,vertical?bounds.right-bounds.left:sideRoom)+'px';
  bubble.style.maxHeight=Math.max(1,vertical?(above?rect.top-bounds.top-8:bounds.bottom-rect.bottom-8):bounds.bottom-bounds.top)+'px';
  const width=bubble.offsetWidth,height=bubble.offsetHeight;
  const {x,y}=clampMascot(vertical?rect.left+rect.width/2-width/2:leftSide?rect.left-width-8:rect.right+8,vertical?(above?rect.top-height-8:rect.bottom+8):rect.top+rect.height/2-height/2,width,height,bounds);
  bubble.classList.toggle('kc-bubble-vertical',vertical);
  bubble.style.inset='auto';bubble.style.left=x+'px';bubble.style.top=y+'px';
  bubble.style.setProperty('--kc-tail-x',(leftSide?x+width:x-9)+'px');
  bubble.style.setProperty('--kc-tail-y',Math.max(y+10,Math.min(y+height-10,rect.top+rect.height/2))+'px');
  bubble.style.setProperty('--kc-tail-direction',leftSide?'1':'-1');
 }
 function draggable(){
  let drag,suppress=false;quick.querySelector('img').draggable=false;
  quick.addEventListener('pointerdown',event=>{
   if(api.state().settings.mascotLocked||event.button!==0||!event.isPrimary)return;
   const rect=quick.getBoundingClientRect();
   drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};
   if(event.isTrusted)quick.setPointerCapture(event.pointerId);
  });
  quick.addEventListener('pointermove',event=>{
   if(!drag||drag.id!==event.pointerId)return;
   const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
   if(!drag.moved&&Math.hypot(dx,dy)<6)return;
   drag.moved=true;event.preventDefault();
   moveQuick(clampMascot(drag.left+dx,drag.top+dy,quick.offsetWidth,quick.offsetHeight,screenBounds()));placeBubble();
  });
  const finish=event=>{
   if(!drag||drag.id!==event.pointerId)return;
   const moved=drag.moved;drag=null;
   if(moved){
    suppress=true;const settings=api.state().settings;
    run(()=>api.updateSettings({mascotPositions:{...settings.mascotPositions,[mascotMode()]:rememberMascot(quick.getBoundingClientRect(),screenBounds())}}));
    setTimeout(()=>suppress=false,0);
   }
  };
  quick.addEventListener('pointerup',finish);quick.addEventListener('pointercancel',finish);quick.addEventListener('lostpointercapture',finish);
  quick.addEventListener('click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();}},true);
  const reposition=()=>{drag=null;placeQuick();placeBubble();};
  window.addEventListener('resize',reposition);window.addEventListener('orientationchange',reposition);
  window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
 }
 function toast(show){if(!show){notice?.remove();notice=null;return;}if(!notice){notice=el('button','kc-toast');notice.type='button';notice.textContent='의상을 맞춰보고 있습니다';notice.title='누르면 안내를 숨깁니다';notice.setAttribute('aria-label','의상을 맞춰보고 있습니다. 누르면 안내 숨기기');notice.addEventListener('click',()=>notice?.remove());}const parent=sub?.open?sub:dialog?.open?dialog:document.body;if(notice.parentElement!==parent)parent.append(notice);}
 function mount(){const settingsPanel=document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings');if(settingsPanel){const block=el('details','kc-extension-settings');block.innerHTML=`<summary>${mascot('kc-settings-icon')}<span>끼끼의상실</span></summary><label class="kc-check"><input id="kc-enabled" type="checkbox">사용함</label>${checkbox('mascotLocked','끼끼 위치 고정',api.state().settings.mascotLocked)}<button type="button" class="kc-open">의상실 열기</button><button type="button" class="kc-reset">끼끼 위치 초기화</button><p class="kc-storage-status kc-muted" role="status"></p>`;block.querySelector('#kc-enabled').addEventListener('change',event=>run(()=>api.updateSettings({enabled:event.target.checked})));block.querySelector('[name="mascotLocked"]').addEventListener('change',change);block.querySelector('.kc-open').addEventListener('click',open);block.querySelector('.kc-reset').addEventListener('click',()=>run(resetMascot));settingsPanel.append(block);}const menu=document.querySelector('#extensionsMenu');if(menu){const menuButton=el('button','list-group-item flex-container flexGap5 kc-menu-button');menuButton.type='button';menuButton.innerHTML=`${mascot('kc-menu-icon')}<span>끼끼의상실</span>`;menuButton.addEventListener('click',open);menu.append(menuButton);}quick=el('button','kc-mascot');quick.type='button';quick.setAttribute('aria-label','끼끼 현재 착장');quick.innerHTML=`<img src="${asset('kikki-closed.webp')}" alt="끼끼">`;quick.addEventListener('click',mini);document.body.append(quick);draggable();refresh();}
 function storageStatus(){document.querySelectorAll('.kc-storage-status').forEach(n=>n.textContent=api.state().storageStatus);}
 function remoteRefresh(){closeSub();wardrobeLabels.clear();sourceKey='';refresh();}
 return {mount,refresh,toast,error,open,storageStatus,remoteRefresh};
}
