import {collectedHtml} from './message-outfits.js';
import {CATEGORIES,clone,sceneSummary,outfitInjection,itemUiLabel,itemUiBrand,koreanDisplay,hash} from './core.js';
import {REPORT_SECTIONS,FIELD_LABELS} from './profile-report.js';
import {visibleBounds,clampMascot,restoreMascot,rememberMascot} from './mascot-position.js';
import {WARDROBE_TABS,wardrobeLevel,wardrobeTargets,ownedItems} from './wardrobe.js';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loreKey=item=>JSON.stringify([item.book,String(item.uid)]);

export function createUI(api){
 const emptyDraft=()=>({target:'',sheet:{},available:{character:[],persona:[]},selected:{character:new Set(),persona:new Set()},status:{character:'',persona:''},busy:false});
 let dialog,sub,quick,bubble,notice,tab='actual',profileTab='character',lastFocus,sourceKey='';
 let draft=emptyDraft();
 const asset=name=>new URL('assets/'+name,api.base).href;
 const el=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
 const button=(label,action,cls='',attrs='')=>`<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
 const mascot=(cls='kc-inline-mascot')=>`<img class="${cls}" src="${asset('kikki-closed.webp')}" alt="">`;
 const title=label=>`<header><h3>${label}</h3>${button('×','sub-close','icon')}</header>`;
 const run=async fn=>{try{await fn();await api.flush();}catch(e){if(e.name!=='AbortError')error(e);}};

 async function copyText(value){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return;}catch{}}
  const input=document.createElement('textarea');input.value=value;input.style.cssText='position:absolute;opacity:0;width:1px;height:1px';(sub||dialog||document.body).append(input);input.select();let copied=false;try{copied=document.execCommand('copy');}finally{input.remove();}if(!copied)throw Error('자동 복사를 사용할 수 없습니다. 표시된 내용을 직접 선택해 복사하세요.');
 }
 function closeSub(dismissed=true){const old=sub;sub=null;if(old&&dismissed)old.backgroundDismissed=true;old?.close();old?.remove();moveNotice();}
 function returnToChat(){closeSub();dialog?.close();bubble?.close();moveNotice();document.querySelector('#send_textarea')?.focus();}
 function moveNotice(){if(notice?.isConnected){const parent=sub?.open?sub:dialog?.open?dialog:document.body;if(notice.parentElement!==parent)parent.append(notice);}else if(notice?.parentElement?.matches('.kc-dialog'))document.body.append(notice);}
 function renderTasks(){
  const state=api.state(),busy=!!state.backgroundTask;
  for(const node of document.querySelectorAll('.kc-dialog [data-action="read"],.kc-bubble [data-action="mini-read"]'))node.disabled=busy||state.pending||state.generating;
  for(const d of [dialog,sub].filter(d=>d?.open)){
   d.querySelectorAll('[data-action="cleanup"]').forEach(node=>node.disabled=busy||state.pending||state.generating||!!d.cleanupBusy);
   d.querySelectorAll('[data-action="analyze"],[data-action="regenerate-start"],[data-action="refill-wardrobe"],[data-action="translate-profile"],[data-action="save-outfit"],[data-action="save-profile"],[data-action="promote"]').forEach(node=>{if(busy){if(!node.hasAttribute('data-job-disabled'))node.dataset.jobDisabled=String(node.disabled);node.disabled=true;}else if(node.hasAttribute('data-job-disabled')){node.disabled=node.dataset.jobDisabled==='true';delete node.dataset.jobDisabled;}});
  }
 }
 function popup(label,body){if(api.state().backgroundTask)notice?.remove();closeSub();const d=el('dialog','kc-dialog kc-sub');sub=d;d.innerHTML=title(label)+`<div class="kc-content">${body}</div>`;document.body.append(d);d.addEventListener('click',click);d.addEventListener('change',change);d.addEventListener('cancel',event=>{d.backgroundDismissed=true;if(api.state().backgroundTask||api.state().pending){event.preventDefault();returnToChat();}});d.addEventListener('close',()=>{d.remove();if(sub===d)sub=null;moveNotice();});d.showModal();renderTasks();moveNotice();return d;}
 function error(value){api.logError?.(value);const message=value?.message||String(value);const d=sub?.open?sub:dialog?.open?dialog.querySelector('.kc-main'):null;if(d){let n=d.querySelector('.kc-error');if(!n){n=el('p','kc-error');n.setAttribute('role','alert');d.append(n);}n.textContent=message;if(api.logs){const show=el('button','kc-log-error-link');show.type='button';show.dataset.action='logs';show.textContent='작업·오류 로그 보기';n.append(document.createElement('br'),show);}n.scrollIntoView({block:'nearest'});}else globalThis.toastr?.error(message,'끼끼의상실');}
 function sceneLabel(state){if(!state)return '아직 착장을 판독하지 않았어요.';const scene=sceneSummary(state);return [scene.place,scene.activity,scene.time,scene.weather].filter(x=>x&&x!=='불명'&&(koreanDisplay(x)||/^[\d\s:./°℃%–—-]+$/.test(x))).join(' · ')||'현재 상황 정보 없음';}
 function itemLabel(item){return itemUiLabel(item);}
 function outfits(){
  const {branch,settings,identity,outfitReady,outfitDetached}=api.state();if(!branch)return '<p class="kc-muted">취향 분석으로 시작하거나 사용할 브랜치를 연결하세요.</p>';
  if(outfitReady===false)return '<p class="kc-muted">착장 확인 필요 · 현재 옷 보기 또는 다음 답변 후 갱신됩니다.</p>'+collectedHtml(branch.current,{character:identity?.name,persona:identity?.userName});
  return (outfitDetached?'<p class="kc-muted">마지막 확인 착장 유지 중 · 다음 판독에서 변경 사항을 반영합니다.</p>':'')+['character','persona'].map(who=>{
   const person=branch.current.people[who];
   return `<article class="kc-person"><div class="kc-label">${esc(who==='character'?identity?.name||'캐릭터':identity?.userName||'페르소나')}</div>${person.nude?'<p class="kc-muted">완전 탈의 · 주입 중단</p>':`<dl>${CATEGORIES.map(category=>{
    const items=person.items.filter(item=>item.category===category);
    return `<div class="kc-item"><dt>${category}</dt><dd>${items.length?items.map(item=>`<span class="kc-worn-item"><span>${esc(itemLabel(item,settings))}${koreanDisplay(item.wearingKo)?' · '+esc(item.wearingKo):''}</span>${settings.brands?`<small class="kc-worn-brand">${esc(itemUiBrand(item))}</small>`:''}</span>`).join(''):'—'}</dd></div>`;
   }).join('')}</dl>`}</article>`;
  }).join('')+collectedHtml(branch.current,{character:identity?.name,persona:identity?.userName});
 }
 function select(name,label,values,value){return `<label class="kc-field">${label}<select name="${name}">${values.map(entry=>{const [id,text]=Array.isArray(entry)?entry:[entry,entry];return `<option value="${esc(id)}" ${String(value)===String(id)?'selected':''}>${esc(text)}</option>`;}).join('')}</select></label>`;}
 function checkbox(name,label,value){return `<label class="kc-check"><input type="checkbox" name="${esc(name)}" ${value?'checked':''}>${label}</label>`;}
 function ensureDraft(){const state=api.state(),identity=state.identity;const key=identity?`${identity.id}:${identity.chat}:${identity.personaKey}:${state.bid||''}`:'';if(key!==sourceKey){sourceKey=key;draft=emptyDraft();for(const who of ['character','persona'])draft.selected[who]=new Set(state.branch?.analysisSources?.selected?.[who]||[]);if(sub?.dataset.sourceTarget||sub?.profileDraft||sub?.peopleDraft)closeSub(false);}}

 function renderMain(){
  if(!dialog?.open)return;
  const probe=el('span','');probe.style.color='var(--SmartThemeBodyColor,#393744)';dialog.append(probe);const rgb=getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0,3).map(Number)||[57,55,68];probe.remove();dialog.classList.toggle('kc-dark-paper',(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)>150);
  ensureDraft();
  const {branch,injectionError}=api.state();
  const main=dialog.querySelector('.kc-main'),collectedOpen=!!main.querySelector('.kc-collected')?.open;
  main.innerHTML=tab==='actual'?`<p class="kc-scene">${esc(sceneLabel(branch?.current))}</p>${branch?.suspended?'<p class="kc-muted">데이터를 초기화했어요. 현재 옷 보기를 눌러 시작하세요.</p>':''}<div class="kc-outfits">${outfits()}</div><div class="kc-bottom">${button('현재 옷 보기','read','kc-read-now')}${button('옷장 · 착장 수정','edit')}${button('브랜치','branches')}</div>${injectionError?`<p class="kc-error">${esc(injectionError)}</p>`:''}`:options();
  if(main.querySelector('.kc-collected'))main.querySelector('.kc-collected').open=collectedOpen;
  dialog.querySelectorAll('[data-tab]').forEach(node=>{node.classList.toggle('active',node.dataset.tab===tab);node.setAttribute('aria-selected',node.dataset.tab===tab);});
 }
 function refresh(){const {settings}=api.state();renderMain();if(settings.displayMode==='inline'&&bubble?.open)bubble.close();if(quick){quick.hidden=!settings.enabled||!settings.mascot||settings.displayMode==='inline';quick.querySelector('img').src=asset(bubble?.open?'kikki-open.webp':'kikki-closed.webp');placeQuick();}if(bubble?.open){const collectedOpen=!!bubble.querySelector('.kc-collected')?.open;bubble.querySelector('.kc-mini-content').innerHTML=`<p class="kc-scene">${esc(sceneLabel(api.state().branch?.current))}</p>${outfits()}`;if(bubble.querySelector('.kc-collected'))bubble.querySelector('.kc-collected').open=collectedOpen;placeBubble();}const enabled=document.querySelector('#kc-enabled');if(enabled)enabled.checked=settings.enabled;document.querySelectorAll('[name="mascotLocked"]').forEach(n=>n.checked=!!settings.mascotLocked);if(quick)quick.style.touchAction=settings.mascotLocked?'manipulation':'none';storageStatus();renderTasks();moveNotice();api.refreshViews?.();}

 function sourcePanel(who){
  const label=who==='character'?'캐릭터':'페르소나',sheet=draft.sheet[who],available=draft.available[who],selected=draft.selected[who];
  const groups=[...new Set(available.map(item=>item.book))].map(book=>{const entries=available.filter(item=>item.book===book);return `<details class="kc-lore-book"><summary>${esc(book)} · ${entries.filter(item=>selected.has(loreKey(item))).length}/${entries.length}</summary>${entries.map(item=>checkbox(`lore:${who}:${loreKey(item)}`,esc(item.title||`엔트리 ${item.uid}`),selected.has(loreKey(item)))).join('')}</details>`;}).join('');
  return `<section class="kc-source-panel"><div class="kc-source-card"><strong>${label} 시트</strong><p class="kc-muted">${sheet?`${esc(sheet.name)} · ${sheet.source.length}자 가져옴`:`${label} 시트를 아직 가져오지 않았습니다.`}</p><div class="kc-actions">${button(`${label} 시트 불러오기`,`sheet-load-${who}`)}${button('시트 보기',`sheet-view-${who}`,'',sheet?'':'disabled')}</div></div><div class="kc-source-card"><strong>${label} 연결 로어북</strong><p class="kc-muted">${draft.status[who]||'연결된 로어북을 불러온 뒤 필요한 엔트리만 체크하세요.'}</p><div class="kc-actions">${button(available.length?'연결 로어북 다시 읽기':'연결 로어북 불러오기',`lore-load-${who}`)}</div>${available.length?`<div class="kc-lore-list">${groups}<p class="kc-muted">${selected.size}개 엔트리 선택됨</p></div>`:''}</div></section>`;
 }
 function options(){
  const {settings,identity}=api.state();
  const targetLabel=draft.target==='character'?'캐릭터':draft.target==='persona'?'페르소나':'';
  const prepared=draft.target&&(draft.sheet[draft.target]?.source||draft.selected[draft.target].size);
  return `<div class="kc-analysis-head"><strong>${esc(identity?.name||'캐릭터 채팅을 여세요.')}</strong><span>대상을 고른 다음 그 대상의 자료만 불러옵니다.</span></div>${select('analysisTarget','분석 대상',[['','먼저 선택하세요'],['character','캐릭터'],['persona','페르소나']],draft.target)}${draft.target?`<div class="kc-source-summary"><strong>${targetLabel} 분석 자료</strong><span>${prepared?'자료 준비됨':'아직 가져오지 않음'}</span>${button('분석 자료 가져오기','open-sources','primary')}</div>`:'<p class="kc-muted">분석 대상을 선택해야 자료 가져오기 버튼이 열립니다.</p>'}<div class="kc-compact-options">${select('fixed','시트 평상복',[['false','스타일 예시'],['true','고정 착장']],String(settings.fixed))}${wardrobeSettings(settings)}${select('newItems','새 옷 추가',[['off','자동 추가 끄기'],['low','적게'],['medium','보통'],['high','많이']],settings.newItems)}<p class="kc-muted">적게: 필수 보충 · 보통: 용도에 맞는 보충 · 많이: 필요한 전용 기능까지. 적합한 착장은 유지합니다. 끄기는 자동 추가만 막고 대화의 실제 착용은 기록합니다.</p>${checkbox('brands','브랜드 표시',settings.brands)}</div><p class="kc-muted">채팅과 기억은 취향 분석에 보내지 않습니다.</p><div class="kc-actions kc-analysis-actions">${button('취향 보기','taste')}${button('옷장만 새로 생성','regenerate-wardrobe')}${button('브랜치 관리','branches')}</div>`;
 }

 function sourcePicker(){if(!draft.target)return error('분석 대상을 먼저 선택하세요.');const who=draft.target,label=who==='character'?'캐릭터':'페르소나';popup(`${label} 분석 자료 가져오기`,'');sub.dataset.sourceTarget=who;renderSourcePopup();}
 function renderSourcePopup(){if(!sub?.open||sub.dataset.sourceTarget!==draft.target)return;const who=draft.target,ready=draft.sheet[who]?.source||draft.available[who].some(item=>draft.selected[who].has(loreKey(item)));const opened=[...sub.querySelectorAll('.kc-lore-book')].map(node=>node.open);sub.querySelector('.kc-content').innerHTML=`${sourcePanel(who)}<p class="kc-muted">가져온 시트와 체크한 엔트리만 분석 모델에 보냅니다.</p><div class="kc-actions kc-analysis-actions">${button(draft.busy?'취향 분석 중…':'이 자료로 취향 분석','analyze','primary',ready&&!draft.busy?'':'disabled')}</div>`;sub.querySelectorAll('.kc-lore-book').forEach((node,index)=>node.open=opened[index]||false);renderTasks();}

 function open(){lastFocus=document.activeElement;if(!dialog){dialog=el('dialog','kc-dialog');dialog.id='kikki-closet-dialog';dialog.innerHTML=`<div class="kc-paper"></div><div class="kc-shell"><header><div class="kc-title">${mascot('kc-title-icon')}<div><small>착장 기록</small><h2>끼끼의상실</h2></div></div></header><nav>${button('현재 착장','tab-actual','tag')}${button('선택지','tab-options','tag')}<div class="kc-nav-tools">${button('⚙','settings','icon')}${button('×','close','icon')}</div></nav><main class="kc-main"></main></div>`;dialog.querySelector('[data-action="tab-actual"]').dataset.tab='actual';dialog.querySelector('[data-action="tab-options"]').dataset.tab='options';dialog.addEventListener('click',click);dialog.addEventListener('change',change);dialog.addEventListener('close',()=>{lastFocus?.focus();moveNotice();});document.body.append(dialog);}bubble?.close();dialog.showModal();refresh();}
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
  d.querySelector('.kc-report-status').textContent=d.translationController?'한국어로 번역하고 있습니다…':korean?'한국어 번역 · 저장된 원문은 유지됩니다.':'영어 원문';
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
  const controller={};d.translationController=controller;renderProfile();
  try{
   const translated=await api.translateProfile(who,clone(source));
   if(!translated||sub!==d||!d.open||JSON.stringify(d.profileDraft[who].fields)!==signature)return;
   d.translations[who]={signature,profile:translated};d.reportLanguage[who]='ko';
  }catch(e){if(e.name!=='AbortError')throw e;}
  finally{if(d.translationController===controller)d.translationController=null;if(sub===d){renderProfile();renderTasks();}}
 }

 const logLabels={scene:'장면 판독',storage:'서버 저장',task:'의상 작업',error:'오류',analysis:'취향·옷장 생성',translation:'번역',items:'부족 의상 생성',test:'연결 확인'};
 const outcomeLabels={running:'진행 중',applied:'적용',partial:'일부 적용',unchanged:'유지',unusable:'내용 확인 보류',skipped:'생략',deferred:'대기',deduplicated:'중복 생략',cancelled:'취소',completed:'완료',received:'응답 처리',saved:'저장 완료',error:'실패'};
 function logsView(){const d=popup('작업·오류 로그','');d.dataset.logs='true';d.logFilter='all';renderLogs();}
 function renderLogs(){
  const d=sub;if(!d?.open||!d.dataset.logs)return;
  const content=d.querySelector('.kc-content'),scroll=content.scrollTop,opened=new Set([...content.querySelectorAll('details[open]')].map(node=>node.dataset.logId));
  const rows=(api.logs?.list()||[]).filter(row=>d.logFilter!=='issues'||['error','partial','unusable'].includes(row.outcome));
  content.innerHTML='<div class="kc-log-tools">'+select('logFilter','표시',[['all','전체 작업'],['issues','문제만']],d.logFilter)+'<div class="kc-actions">'+button('전체 로그 복사','logs-copy')+button('전체 복사본 보기','logs-text')+button('로그 비우기','logs-clear')+'</div></div><p class="kc-muted">최근 30개 작업 · 최대 2MiB · 새로고침 시 비워집니다. 전체 복사는 표시 필터·접힘 상태와 관계없이 현재 보관된 모든 작업을 포함합니다. 최근 판독 문맥과 모델 응답도 포함됩니다.</p><p class="kc-log-copy-status kc-muted" role="status"></p><div class="kc-log-list">'+(rows.length?rows.map(row=>'<details class="kc-log-row" data-log-id="'+esc(row.id)+'" '+(opened.has(row.id)?'open':'')+'><summary><span>'+esc(new Date(row.time).toLocaleTimeString())+' · '+esc(logLabels[row.type]||row.type)+'</span><strong class="kc-log-outcome" data-outcome="'+esc(row.outcome)+'">'+esc(outcomeLabels[row.outcome]||row.outcome)+'</strong></summary><div class="kc-actions">'+button('이 작업 복사','logs-copy-one','','data-id="'+esc(row.id)+'"')+'</div><p class="kc-muted">'+esc(row.id)+(row.truncated?' · 용량 초과로 일부 생략':'')+'</p><pre class="kc-log-context">'+esc(JSON.stringify(row.scope,null,2))+'</pre>'+row.events.map(event=>'<section class="kc-log-event"><b>'+esc(event.message)+' · '+esc(event.elapsedMs)+'ms</b><pre>'+esc(JSON.stringify(event.data,null,2)||'')+'</pre></section>').join('')+'</details>').join(''):'<p class="kc-muted">기록된 작업이 없습니다.</p>')+'</div>';
  content.scrollTop=scroll;
 }
 let logFrame;
 api.logs?.subscribe(()=>{if(!sub?.dataset.logs||logFrame)return;logFrame=requestAnimationFrame(()=>{logFrame=null;renderLogs();});});
 function logTextView(value=api.logs?.copy()||'',message='현재 보관된 로그를 한곳에 모았습니다. 이 복사본은 자동 갱신되지 않아 선택 중 내용이 바뀌지 않습니다.'){
  const d=popup('진단 로그 복사본','<div class="kc-actions">'+button('복사본 전체 복사','logs-copy')+button('전체 선택','logs-select')+button('작업별 보기','logs')+'</div><p class="kc-muted">'+esc(message)+'</p><textarea class="kc-log-export" readonly aria-label="진단 로그 전체 복사본" spellcheck="false"></textarea><p class="kc-log-copy-status kc-muted" role="status"></p>');
  d.logSnapshot=value;d.querySelector('.kc-log-export').value=value;
 }
 async function copyLogs(id){
  const value=sub?.logSnapshot??api.logs?.copy(id)??'';
  try{await copyText(value);}catch{logTextView(value,'자동 복사가 차단되었습니다. 전체 선택을 누른 뒤 직접 복사하세요.');return;}
  const status=sub?.querySelector('.kc-log-copy-status')||document.querySelector('.kc-extension-settings .kc-log-copy-status');
  if(status)status.textContent=(id?'선택한 작업 로그':'전체 진단 로그')+'를 복사했습니다.';
 }
 function refreshConnectionProfiles(){
  const select=sub?.querySelector('[name="profileId"]');if(!select)return;
  const selected=api.state().settings.profileId;let rows;
  try{rows=api.profiles().map(profile=>[profile.id,(profile.name||profile.id)+(profile.model?' · '+profile.model:'')]);}
  catch{const status=sub.querySelector('.kc-profile-status');if(status)status.textContent='연결 프로필 목록을 읽지 못했습니다. 실리 연결 프로필 설정을 확인하세요.';rows=[];}
  if(selected&&!rows.some(([id])=>id===selected))rows.push([selected,'저장된 연결 프로필 · 현재 목록에 없음']);
  const markup=[['','선택하세요'],...rows].map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
  if(select.innerHTML!==markup){select.innerHTML=markup;select.value=selected;}
 }
 function settings(){const state=api.state();const d=popup('설정',`${checkbox('enabled','사용함',state.settings.enabled)}${select('profileId','SillyTavern 연결 프로필',[['','선택하세요']],state.settings.profileId)}<div class="kc-actions">${button('연결 확인 (선택)','test')}</div><p class="kc-profile-status kc-muted" role="status">선택하면 바로 저장됩니다. 연결 확인은 선택 사항입니다.</p><p class="kc-muted">목록은 자동 갱신됩니다. 모델·주소·키는 SillyTavern의 API 연결 메뉴에서 관리합니다.</p>${checkbox('auto','채팅 변화 자동 판독',state.settings.auto)}<label class="kc-field">읽을 최근 채팅 턴 수<input type="number" name="chatTurns" min="1" max="50" step="1" value="${esc(state.settings.chatTurns??8)}"></label><p class="kc-muted">1턴은 사용자 메시지와 이어지는 답변이며, 이 설정은 읽을 최대 범위입니다. 평소에는 저장된 상태·새 대화와 직전 최대 1턴만 보냅니다. 최초 판독·기준점 소실·현재 옷 보기는 설정 범위를 읽습니다.</p>${select('displayMode','착장정보 표시 방식',[['floating','떠 있는 끼끼 아이콘'],['inline','답변 아래 메모']],state.settings.displayMode)}<p class="kc-muted">답변 아래 메모는 기본 펼침이며 끼끼를 누르면 접힙니다. PC는 좌우, 모바일은 두 인물을 위아래로 함께 표시합니다. 긴 글씨는 줄바꿈하고 브랜드는 작게 표시합니다. 표시 전환은 모델을 호출하지 않습니다.</p><label class="kc-field">과거 착장정보 보관 개수<input type="number" name="displayLimit" min="1" max="20" step="1" value="${esc(state.settings.displayLimit??1)}"></label><p class="kc-muted">과거 답변에 연결할 착장 기록을 1~20개 보관합니다. 기본 1개이며 초과 기록은 오래된 것부터 삭제합니다. 최신 판독·현재 착장은 이 개수와 별도로 유지하며 리롤·스와이프·답변 삭제로 비우지 않습니다. 개수를 늘려도 이미 삭제된 과거 기록은 복원하지 않습니다.</p><p class="kc-retention-status kc-muted" role="status"></p>${checkbox('mascot','끼끼 빠른 확인 표시',state.settings.mascot)}${checkbox('mascotLocked','끼끼 위치 고정',state.settings.mascotLocked)}${button('끼끼 위치 초기화','mascot-reset')}<p class="kc-muted">PC와 모바일 위치를 따로 기억합니다. 고정해도 화면 밖으로 나가면 안쪽으로 맞춥니다.</p><div class="kc-section">주입 위치</div><p class="kc-muted">모델에게 전달되는 인포블록의 원하는 위치에 아래 매크로를 한 번 붙여넣으세요. 현재 착장만 전달하며 별도 판독 지시문은 넣지 않습니다. 기존 착장 태그도 계속 사용할 수 있습니다.</p><pre>{{kikki_outfit}}</pre>${button('매크로 복사','copy')}<details><summary>주입 미리보기</summary><pre>${esc(outfitInjection(state.branch?.current)||'현재 착장 없음')}</pre></details><div class="kc-section">진단</div><div class="kc-actions">${button('작업·오류 로그','logs')}${button('전체 로그 복사','logs-copy')}</div><p class="kc-log-copy-status kc-muted" role="status"></p><div class="kc-section">서버 저장소</div><p class="kc-storage-status kc-muted" role="status"></p><p class="kc-muted">취향·옷장·브랜치는 캐릭터별 서버 파일에 자동 저장됩니다. 프리셋·연결 프로필·모델을 바꿔도 유지됩니다. 수동 착장·보고서 편집은 저장 버튼으로 확정하세요.</p><p class="kc-storage-file kc-muted"></p><div class="kc-actions">${button('서버 다시 연결','storage-retry')}${state.legacyAvailable?button('이 브라우저의 이전 데이터 가져오기','storage-import'):''}</div>${dataManagement()}`);const profileSelect=d.querySelector('[name="profileId"]');profileSelect.addEventListener('focus',refreshConnectionProfiles);profileSelect.addEventListener('pointerdown',refreshConnectionProfiles);refreshConnectionProfiles();}
 function dataManagement(){return `<div class="kc-section">저장 데이터 관리</div><p class="kc-muted">아래 삭제 버튼은 끼끼의상실 데이터만 지웁니다. 실리의 캐릭터 카드와 채팅 원문은 유지됩니다.</p><div class="kc-delete-options"><div>${button('현재 채팅 데이터 삭제','delete-chat','','aria-describedby="kc-delete-chat-help"')}<p id="kc-delete-chat-help" class="kc-muted">현재 채팅의 착장·판독 기록을 초기화합니다. 취향·기본 옷장과 다른 채팅은 유지됩니다.</p></div><div>${button('캐릭터 전체 삭제','delete-character','','aria-describedby="kc-delete-character-help"')}<p id="kc-delete-character-help" class="kc-muted">이 캐릭터의 취향·옷장·모든 브랜치와 전용 서버 파일을 삭제합니다. 다른 캐릭터와 공용 설정은 유지됩니다.</p></div><div>${button('전체 데이터 삭제','delete-all','','aria-describedby="kc-delete-all-help"')}<p id="kc-delete-all-help" class="kc-muted">모든 캐릭터의 생성 데이터·전용 서버 파일과 확장 설정을 삭제합니다.</p></div></div><div class="kc-section">불필요한 데이터 정리</div>${button('불필요한 데이터 정리','cleanup','','aria-describedby="kc-cleanup-help"')}<p id="kc-cleanup-help" class="kc-muted">확장이 기록한 미사용 파일·삭제 대기 파일, 만료된 번역·보관 한도를 넘은 기록, 현재 채팅과 스와이프의 내부 착장 태그를 정리합니다. 사용 중인 옷장·취향·착장은 유지됩니다.</p><p class="kc-muted">설치 폴더 전체나 다른 채팅 파일은 검색·삭제하지 않습니다. 정리할 때 모델은 호출하지 않습니다.</p><p class="kc-cleanup-result kc-muted" role="status" aria-live="polite"></p>`;}
 async function cleanupView(){
  const d=sub;if(!d||d.cleanupBusy)return;d.cleanupBusy=true;const node=d.querySelector('[data-action="cleanup"]'),status=d.querySelector('.kc-cleanup-result');node.disabled=true;node.textContent='정리 중…';status.textContent='사용 중인 자료를 확인하고 있습니다.';
  try{
   const result=await api.cleanup();if(sub!==d)return;
   if(result.cancelled){status.textContent='저장 정보가 바뀌어 정리를 중단했습니다. 최신 내용을 확인한 뒤 다시 정리해 주세요.';return;}
   const parts=[];if(result.files)parts.push('파일 '+result.files+'개');if(result.records)parts.push('저장 기록 '+result.records+'개');if(result.messages)parts.push('채팅 '+result.messages+'개 · 스와이프 '+result.swipes+'개');if(result.transactions)parts.push('저장·정리 작업 '+result.transactions+'건 완료');
   status.textContent=parts.length?'정리 완료 · '+parts.join(' / '):'정리할 불필요한 데이터가 없습니다.';
   if(result.skipped)status.textContent+=' 소유를 확인하지 못한 파일은 보존했습니다.';if(result.chatSkipped)status.textContent+=' 채팅이 진행되거나 바뀌어 채팅 내용은 건드리지 않았습니다.';
  }catch(error){if(sub===d)status.textContent='정리를 완료하지 못했습니다. 정리되지 않은 항목은 보존했으며 다시 시도할 수 있습니다.';throw error;}
  finally{d.cleanupBusy=false;node.textContent='불필요한 데이터 정리';if(sub===d){node.disabled=false;renderTasks();}}
 }
 function branches(){const {character,bid}=api.state();popup('스토리 브랜치',`<div class="kc-actions">${button('기본으로 새 브랜치','new')}${button('현재 상태 복제','copy-branch')}</div>${character?Object.entries(character.branches).map(([id,b])=>`<div class="kc-branch"><span>${esc(b.name)}${id===bid?' · 현재':''}<small>연결 채팅 ${b.links.length}개</small></span><button data-action="use-branch" data-id="${esc(id)}">이어가기</button><button data-action="delete-branch" data-id="${esc(id)}">삭제</button></div>`).join(''):'<p class="kc-muted">취향 분석 후 브랜치를 만들 수 있어요.</p>'}`);}
 function wardrobeSettings(settings){
  return '<div class="kc-wardrobe-settings">'+select('wardrobeLevel','기본 옷장 구성',[['low','적게'],['medium','중간'],['high','많이']],wardrobeLevel(settings))+'<p class="kc-muted">생활패턴에 맞게 종류별로 배분합니다. 다음 분석·새로 채우기에 적용하며, 기존 옷은 자동 삭제하지 않습니다.</p></div>';
 }
 function edit(who='character'){
  const branch=api.state().branch;if(!branch)return error('브랜치를 먼저 연결하세요.');
  const d=popup('옷장 · 착장 수정','');d.classList.add('kc-wardrobe');
  d.peopleDraft=clone(branch.current.people);d.wardrobeWho=who;d.wardrobeCategory='top';renderWardrobe();
 }
 function regenerateWardrobePopup(){
  const branch=api.state().branch;if(!branch)return error('취향을 먼저 분석하세요.');
  const targets=['character','persona'].filter(who=>branch.profiles[who]).map(who=>[who,who==='character'?'캐릭터':'페르소나']);
  if(!targets.length)return error('취향을 먼저 분석하세요.');
  popup('옷장만 새로 생성',select('regenerateWho','대상',targets,targets[0][0])+'<p class="kc-muted">선택한 인물의 전체 옷장을 저장된 취향으로 새로 만듭니다. 현재 입은 옷은 유지합니다.</p><div class="kc-actions">'+button('전체 옷장 생성','regenerate-start','primary')+'</div>');
 }
 async function regenerateWholeWardrobe(){
  const d=sub;if(!d||d.wardrobeBusy||api.state().backgroundTask)return;
  const who=d.querySelector('[name="regenerateWho"]').value;d.wardrobeBusy=true;d.querySelectorAll('.kc-content button,.kc-content select').forEach(node=>node.disabled=true);
  try{const changed=await api.refillWardrobe(who,'all');if(changed&&sub===d)edit(who);}
  finally{d.wardrobeBusy=false;if(sub===d)d.querySelectorAll('.kc-content button,.kc-content select').forEach(node=>node.disabled=false);renderTasks();}
 }
 async function refillSelectedWardrobe(){
  const d=sub;if(!d?.peopleDraft||d.wardrobeBusy||api.state().backgroundTask)return;
  const who=d.wardrobeWho,category=d.wardrobeCategory;
  d.wardrobeBusy=true;renderWardrobe();
  try{
   const changed=await api.refillWardrobe(who,category);
   if(changed&&sub===d){const branch=api.state().branch,available=new Set(ownedItems(branch,who).map(i=>i.id));d.peopleDraft[who].items=d.peopleDraft[who].items.filter(i=>available.has(i.id));}
  }finally{d.wardrobeBusy=false;if(sub===d){renderWardrobe();renderTasks();}}
 }
 function renderWardrobe(){
  const d=sub;if(!d?.peopleDraft)return;
  d.shelfScroll??={};if(d.renderedShelf)d.shelfScroll[d.renderedShelf]=d.querySelector('.kc-wardrobe-shelf')?.scrollTop||0;
  const {branch,settings}=api.state(),who=d.wardrobeWho,person=d.peopleDraft[who],all=ownedItems(branch,who),active=WARDROBE_TABS.find(t=>t.id===d.wardrobeCategory);
  const items=all.filter(i=>i.category===active.category),target=wardrobeTargets(settings)[active.id],saved=new Set(branch.current.people[who].items.map(i=>i.id));
  d.querySelector('.kc-content').innerHTML=`<div class="kc-wardrobe-people" role="tablist" aria-label="옷장 인물">${['character','persona'].map(id=>button(id==='character'?'캐릭터':'페르소나','wardrobe-person','tag '+(id===who?'active':''),'role="tab" aria-selected="'+(id===who)+'" data-who="'+id+'"')).join('')}</div><nav class="kc-wardrobe-tabs" role="tablist" aria-label="옷장 종류">${WARDROBE_TABS.map(t=>button(t.label+' <small>'+all.filter(i=>i.category===t.category).length+'</small>','wardrobe-category','tag '+(t.id===active.id?'active':''),'role="tab" aria-selected="'+(t.id===active.id)+'" data-category="'+t.id+'"')).join('')}</nav><div class="kc-wardrobe-heading"><span>${esc(active.label)} · ${items.length}종</span><small>${target?'초기 구성 목표 '+target+'종':'필요한 종류만 보유'}</small></div><div class="kc-wardrobe-shelf" role="tabpanel">${items.length?items.map(item=>{
   const selected=person.items.some(i=>i.id===item.id);
   const label=itemUiLabel(item);
   return `<label class="kc-wardrobe-row ${selected?'is-worn':''}"><input type="checkbox" name="item:${esc(item.id)}" ${selected?'checked':''} aria-label="${esc(label)} 착용"><span class="kc-wardrobe-name">${esc(label)}${selected?`<small class="kc-wardrobe-badge">${saved.has(item.id)?'착용 중':'선택됨'}</small>`:''}</span><span class="kc-wardrobe-brand">${esc(itemUiBrand(item))}</span></label>`;
  }).join(''):'<p class="kc-muted kc-wardrobe-empty">아직 이 종류의 옷이 없습니다.</p>'}</div><div class="kc-wardrobe-footer">${checkbox('nude','완전 탈의',person.nude)}<span class="kc-muted">선택한 옷 ${person.items.length}개</span><div class="kc-wardrobe-buttons">${button(d.wardrobeBusy?'새로 채우는 중…':'이 카테고리 새로 생성','refill-wardrobe','','title="선택한 인물의 '+esc(active.label)+' 목록만 교체" '+(branch.profiles[who]?'':'disabled'))}${button('착장 저장','save-outfit','primary')}</div></div>`;
  renderTasks();if(d.wardrobeBusy)d.querySelectorAll('.kc-content button,.kc-content input').forEach(node=>node.disabled=true);
  d.renderedShelf=who+':'+active.id;d.querySelector('.kc-wardrobe-shelf').scrollTop=d.shelfScroll[d.renderedShelf]||0;
  const tabs=d.querySelector('.kc-wardrobe-tabs'),selectedTab=tabs.querySelector('.active');
  if(selectedTab.offsetLeft+selectedTab.offsetWidth>tabs.scrollLeft+tabs.clientWidth)tabs.scrollLeft=selectedTab.offsetLeft+selectedTab.offsetWidth-tabs.clientWidth;
  else if(selectedTab.offsetLeft<tabs.scrollLeft)tabs.scrollLeft=selectedTab.offsetLeft;
  d.querySelector('[name="nude"]').addEventListener('change',event=>{person.nude=event.target.checked;if(person.nude)person.items=[];renderWardrobe();});
  d.querySelectorAll('[name^="item:"]').forEach(input=>input.addEventListener('change',()=>{
   const id=input.name.slice(5),item=all.find(i=>i.id===id);person.items=person.items.filter(i=>i.id!==id);
   if(input.checked){person.nude=false;person.items.push(clone(item));}renderWardrobe();
  }));

 }


 async function loadLore(who){const owner=draft;owner.status[who]='연결된 로어북을 읽는 중…';renderSourcePopup();const entries=await api.lore(who);ensureDraft();if(owner!==draft)return;draft.available[who]=entries;draft.selected[who]=new Set([...draft.selected[who]].filter(key=>entries.some(item=>loreKey(item)===key)));draft.status[who]=entries.length?`연결 로어북 ${new Set(entries.map(item=>item.book)).size}개 · 필요한 엔트리를 체크하세요.`:'연결된 로어북이 없습니다.';renderSourcePopup();}
 function buildSelection(){const who=draft.target;return {targets:[who],sources:{[who]:{sheet:draft.sheet[who]||null,lore:draft.available[who].filter(item=>draft.selected[who].has(loreKey(item))).map(item=>({book:item.book,uid:item.uid,title:item.title,content:item.content}))}}};}
async function click(event){const node=event.target.closest('button');if(!node||!node.dataset.action||node.disabled)return;await run(async()=>{const action=node.dataset.action;if(action==='logs')logsView();else if(action==='logs-text')logTextView();else if(action==='logs-select'){const input=sub.querySelector('.kc-log-export');input.focus();input.select();}else if(action==='logs-copy')await copyLogs();else if(action==='logs-copy-one')await copyLogs(node.dataset.id);else if(action==='logs-clear'){api.logs.clear();renderLogs();}else if(action==='close')returnToChat();else if(action==='sub-close'){if(api.state().backgroundTask||api.state().pending)returnToChat();else closeSub();}else if(action==='tab-actual'){tab='actual';refresh();}else if(action==='tab-options'){tab='options';refresh();}else if(action==='settings'){settings();storageStatus();}else if(action==='cleanup')await cleanupView();else if(action==='storage-retry')await api.retryStorage();else if(action==='storage-import'){await api.importLegacy();settings();storageStatus();}else if(action==='mascot-reset')resetMascot();else if(action==='taste')taste();else if(action==='open-sources')sourcePicker();else if(action.startsWith('sheet-load-')){const who=action.slice(11);const owner=draft;const sheet=await api.sheet(who);ensureDraft();if(owner!==draft)return;draft.sheet[who]=sheet;renderSourcePopup();}else if(action.startsWith('sheet-view-')){const who=action.slice(11),sheet=draft.sheet[who];if(sheet){let preview=sub.querySelector('.kc-source-preview');if(preview){preview.remove();}else{preview=el('pre','kc-source-preview');preview.textContent=sheet.source;node.closest('.kc-source-card').append(preview);}}}else if(action.startsWith('lore-load-'))await loadLore(action.slice(10));else if(action==='analyze'){if(draft.busy||api.state().backgroundTask)return;const owner=draft,who=draft.target,d=sub;owner.busy=true;renderSourcePopup();try{const saved=await api.analyze(buildSelection());if(saved&&dialog?.open&&!d.backgroundDismissed){profileTab=who;closeSub();taste();}}finally{owner.busy=false;renderSourcePopup();renderTasks();}}else if(action==='read'){const state=api.state();if(!state.settings.enabled)throw Error('설정에서 사용함을 켜세요.');if(!state.branch)throw Error('취향을 먼저 분석하거나 브랜치를 연결하세요.');state.branch.suspended=false;await api.read();}else if(action==='profile-character'||action==='profile-persona'){profileTab=action.slice(8);sub.reportEditing=false;renderProfile();}else if(action==='translate-profile')await translateProfileView();else if(action==='edit-profile'){sub.reportEditing=!sub.reportEditing;sub.reportLanguage[profileTab]='en';renderProfile();}else if(action==='save-profile'){api.saveProfiles(sub.profileDraft);closeSub();}else if(action==='promote'){if(confirm('이 취향을 기본 프로필에 반영할까요?')){api.saveProfiles(sub.profileDraft);api.promote();closeSub();}}else if(action==='branches')branches();else if(action==='new'||action==='copy-branch'){const name=prompt('브랜치 이름','새 스토리');if(name!==null){await api.newBranch(action==='new'?'new':'copy',name);closeSub();}}else if(action==='use-branch'){await api.newBranch('existing','',node.dataset.id);closeSub();}else if(action==='delete-branch'){if(confirm('이 브랜치와 연결된 착장 기록을 삭제할까요?')){api.remove('branch',node.dataset.id);branches();}}else if(action==='edit')edit();else if(action==='wardrobe-person'){sub.wardrobeWho=node.dataset.who;renderWardrobe();}else if(action==='wardrobe-category'){sub.wardrobeCategory=node.dataset.category;renderWardrobe();}else if(action==='regenerate-wardrobe')regenerateWardrobePopup();else if(action==='regenerate-start')await regenerateWholeWardrobe();else if(action==='refill-wardrobe')await refillSelectedWardrobe();else if(action==='save-outfit'){api.saveOutfit(sub.peopleDraft);closeSub();}else if(action==='test'){const owner=sub,profileId=api.state().settings.profileId;node.disabled=true;try{await api.testConnection(profileId);if(sub===owner&&api.state().settings.profileId===profileId)node.textContent='연결 확인됨';}finally{node.disabled=false;}}else if(action==='copy'){await copyText('{{kikki_outfit}}');node.textContent='복사됨';}else if(['delete-chat','delete-character','delete-all'].includes(action)){const kind=action.slice(7);if(confirm(kind==='chat'?'현재 채팅의 착장 데이터를 초기화할까요? 공유 브랜치는 다른 채팅을 보존합니다.':kind==='character'?'이 캐릭터의 취향·옷장·모든 브랜치와 전용 서버 파일을 삭제할까요? 다른 캐릭터와 공용 설정은 유지됩니다.':'모든 캐릭터의 생성 데이터·전용 서버 파일과 끼끼의상실 설정을 삭제할까요? 실리의 캐릭터 카드와 채팅 원문은 유지됩니다.')){api.remove(kind);closeSub();}}});}
 function change(event){return run(async()=>{if(event.target.closest('.kc-report'))return;const name=event.target.name;if(name==='profileId'){const owner=sub,value=event.target.value;api.updateSettings({profileId:value});owner.querySelector('[data-action="test"]').textContent='연결 확인 (선택)';await api.flush();if(sub===owner&&api.state().settings.profileId===value)owner.querySelector('.kc-profile-status').textContent=value?'선택한 프로필을 저장했습니다. 다음 작업부터 사용합니다.':'연결 프로필을 선택하세요.';return;}if(name==='logFilter'){sub.logFilter=event.target.value;renderLogs();return;}if(!name||name==='editWho'||name==='regenerateWho'||name.startsWith('item:')||name==='nude')return;if(name==='analysisTarget'){draft.target=event.target.value;refresh();return;}if(name.startsWith('lore:')){const [,who,...rest]=name.split(':');const key=rest.join(':');event.target.checked?draft.selected[who].add(key):draft.selected[who].delete(key);renderSourcePopup();return;}let value=event.target.type==='checkbox'?event.target.checked:event.target.value;if(['detail','chatTurns','displayLimit'].includes(name))value=Number(value);if(name==='chatTurns'){value=Math.max(1,Math.min(50,Math.floor(value)||8));event.target.value=value;}if(name==='displayLimit'){value=Math.max(1,Math.min(20,Math.floor(value)||1));event.target.value=value;}if(name==='fixed')value=value==='true';api.updateSettings({[name]:value});});}

 function mini(){if(bubble?.open){bubble.close();refresh();return;}bubble??=el('dialog','kc-bubble');bubble.innerHTML=`<header><span>착장정보</span><div class="kc-quick-tools">${button('현재 옷 보기','mini-read')}${button('의상실 열기','mini-open')}</div>${button('×','mini-close','icon')}</header><div class="kc-mini-content"></div>`;if(!bubble.isConnected){document.body.append(bubble);bubble.addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.action;if(action==='mini-read')run(()=>api.read());if(action==='mini-close')bubble.close();if(action==='mini-open'){bubble.close();open();}if(action)refresh();});bubble.addEventListener('close',refresh);}bubble.show();refresh();}
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
 function mount(){const settingsPanel=document.querySelector('#extensions_settings2')||document.querySelector('#extensions_settings');if(settingsPanel){const block=el('details','kc-extension-settings');block.innerHTML=`<summary>${mascot('kc-settings-icon')}<span>끼끼의상실</span></summary><label class="kc-check"><input id="kc-enabled" type="checkbox">사용함</label>${checkbox('mascotLocked','끼끼 위치 고정',api.state().settings.mascotLocked)}<button type="button" class="kc-open">의상실 열기</button><button type="button" class="kc-reset">끼끼 위치 초기화</button><button type="button" class="kc-logs-open">작업·오류 로그</button><button type="button" class="kc-logs-copy">전체 로그 복사</button><p class="kc-log-copy-status kc-muted" role="status"></p><p class="kc-storage-status kc-muted" role="status"></p>`;block.querySelector('#kc-enabled').addEventListener('change',event=>run(()=>api.updateSettings({enabled:event.target.checked})));block.querySelector('[name="mascotLocked"]').addEventListener('change',change);block.querySelector('.kc-open').addEventListener('click',open);block.querySelector('.kc-logs-open').addEventListener('click',logsView);block.querySelector('.kc-logs-copy').addEventListener('click',()=>run(()=>copyLogs()));block.querySelector('.kc-reset').addEventListener('click',()=>run(resetMascot));settingsPanel.append(block);}const menu=document.querySelector('#extensionsMenu');if(menu){const menuButton=el('button','list-group-item flex-container flexGap5 kc-menu-button');menuButton.type='button';menuButton.innerHTML=`${mascot('kc-menu-icon')}<span>끼끼의상실</span>`;menuButton.addEventListener('click',open);menu.append(menuButton);}quick=el('button','kc-mascot');quick.type='button';quick.setAttribute('aria-label','끼끼 현재 착장');quick.innerHTML=`<img src="${asset('kikki-closed.webp')}" alt="끼끼">`;quick.addEventListener('click',mini);document.body.append(quick);draggable();refresh();}
 function storageStatus(){const state=api.state();document.querySelectorAll('.kc-storage-status').forEach(n=>n.textContent=state.storageStatus);document.querySelectorAll('.kc-storage-file').forEach(n=>n.textContent=state.storageCharacterFile?'현재 캐릭터 저장 파일: '+state.storageCharacterFile:'이 캐릭터의 생성 데이터가 아직 없습니다.');document.querySelectorAll('.kc-retention-status').forEach(n=>n.textContent='현재 채팅의 답변별 기록: '+Object.keys(state.branch?.display?.chats?.[state.identity?.chat]||{}).length+' / '+state.settings.displayLimit+'개 · 최신 판독은 별도 유지');}
 function remoteRefresh(){closeSub();sourceKey='';refresh();}
 return {mount,refresh,toast,error,open,storageStatus,remoteRefresh,refreshConnectionProfiles};
}
