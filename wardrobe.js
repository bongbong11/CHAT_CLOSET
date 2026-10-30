export const MAIN_WARDROBE={top:{label:'상의',category:'상의',counts:[4,7,10]},bottom:{label:'하의',category:'하의',counts:[3,5,7]},outerwear:{label:'겉옷',category:'겉옷',counts:[1,3,5]},footwear:{label:'신발',category:'신발',counts:[2,3,5]}};
export const WARDROBE_TABS=[...Object.entries(MAIN_WARDROBE).map(([id,v])=>({id,...v})),{id:'underwear',label:'속옷',category:'속옷'},{id:'accessory',label:'액세서리·소품',category:'소품'}];
export function newItemPolicy(value){return ({'적게':'low','보통':'medium','많이':'high','끄기':'off',false:'off',true:'medium'})[value]||(['off','low','medium','high'].includes(value)?value:'medium');}
export function underwearSlot(item){
 if(item.category!=='속옷')return '';
 const name=item.name||'';
 if(/\b(?:socks?|stockings?|tights|pantyhose|footies|foot liners?|ankle liners?)\b|양말|스타킹|타이츠|덧버선|덧신|풋커버/i.test(name))return 'socks';
 if(/\bbra(?:lette)?s?\b|브라|브래지어/i.test(name))return 'bra';
 if(/\b(?:undershirts?|vests?|camisoles?|singlets?)\b|런닝|러닝셔츠|속셔츠|캐미솔/i.test(name))return 'undershirt';
 if(['bra','briefs','socks','undershirt'].includes(item.traits?.slot))return item.traits.slot;
 return 'briefs';
}
export function matchingGroup(item){
 if(item.category==='속옷')return ['bra','briefs','socks','undershirt'].includes(item.slot)?item.slot:underwearSlot(item);
 if(item.category==='소품'){
  const name=item.name||'';
  if(/^(?:accessor(?:y|ies)|소품)\s*$/i.test(name))return 'accessory';
  if(/\b(?:jewell?ery|necklaces?|pendants?|earrings?|rings?|bracelets?|bangles?|brooch(?:es)?|chains?|piercings?|watches|watch|timepieces?|cufflinks?|tie clips?)\b|목걸이|펜던트|귀걸이|반지|팔찌|브로치|피어싱|시계|장신구|귀금속/i.test(name))return 'jewelry';
  if(/\b(?:bags?|totes?|belts?|glasses|sunglasses|spectacles|scarves|scarf|ties|neckties|wallets?|pouches?|handkerchiefs?|backpacks?|caps?|hats?|gloves?|umbrellas?)\b|가방|벨트|안경|선글라스|스카프|넥타이|지갑|파우치|손수건|모자|장갑|우산/i.test(name))return 'utility';
  return 'accessory';
 }
 return ({상의:'top',하의:'bottom',겉옷:'outerwear',신발:'footwear'})[item.category]||item.category;
}
export function normalizeTraits(value={}){
 const result={};
 for(const [key,allowed] of Object.entries({use:['casual','work','formal','home','care'],climate:['hot','mild','cold','rain'],fit:['loose','adjustable','maternity','front_opening','flat','easy_on']})){
  const values=Array.isArray(value[key])?value[key]:[];result[key]=[...new Set(values.filter(v=>allowed.includes(v)))];
 }
 if(['upper','lower','full','feet','support'].includes(value.coverage))result.coverage=value.coverage;
 if(typeof value.temporary==='boolean')result.temporary=value.temporary;
 if(['bra','briefs','socks','undershirt'].includes(value.slot))result.slot=value.slot;
 return result;
}
export function itemTraits(item){
 const traits=normalizeTraits(item.traits),description=[item.name,...(item.features||[])].join(' ').toLowerCase();
 const add=(key,value)=>{if(!traits[key].includes(value))traits[key].push(value);};
 if(/\b(?:hospital|patient|surgical)\s+(?:gown|robe)|\bbath(?:ing)?\s+(?:towel|robe)|\btowel\b/.test(description))traits.temporary??=true;
 if(!traits.coverage)traits.coverage=/\b(?:dress(?!\s+shirt)|gown|jumpsuit|romper|robe)\b|원피스|드레스|점프수트/i.test(item.name||'')?'full':({'상의':'upper','하의':'lower','신발':'feet'}[item.category]||'support');
 if(/타월|수건|환자복/.test(description))traits.temporary??=true;
 if(/루즈|여유|오버사이즈|릴랙스/.test(description))add('fit','loose');
 if(/밴딩|허리.*(?:조절|고무)|드로스트링/.test(description))add('fit','adjustable');
 if(/임부|임산부/.test(description))add('fit','maternity');
 if(/버튼다운|앞.*(?:단추|지퍼)/.test(description))add('fit','front_opening');
 if(/운동화|스니커즈|슬리퍼|플랫/.test(description))add('fit','flat');
 if(/슬랙스|테일러드|수트|정장/.test(description))add('use','formal');
 if(/티셔츠|맨투맨|후드|청바지|조거|트레이닝/.test(description))add('use','casual');
 if(/홈웨어|실내복|라운지/.test(description))add('use','home');
 if(/\b(?:lounge|homewear|housewear|sweatpants|joggers)\b/.test(description))add('use','home');
 if(/\b(?:loose|relaxed|oversized|roomy)\b/.test(description))add('fit','loose');
 if(/\b(?:elastic|adjustable|drawstring)\b/.test(description))add('fit','adjustable');
 if(/\bmaternity\b/.test(description))add('fit','maternity');
 if(/\b(?:front.opening|button.front|zip.front|button.down)\b/.test(description))add('fit','front_opening');
 if(/\b(?:flat|sneakers|loafers|slippers)\b/.test(description))add('fit','flat');
 if(/\b(?:slip.on|easy.on|velcro)\b/.test(description))add('fit','easy_on');
 if(/\b(?:puffer|winter|insulated|thermal|wool coat|overcoat)\b/.test(description))add('climate','cold');
 if(/\b(?:raincoat|rain jacket|waterproof|rain boots)\b/.test(description))add('climate','rain');
 if(/\b(?:summer|shorts|sleeveless|linen)\b/.test(description))add('climate','hot');
 if(/\b(?:suit|tuxedo|evening|formal|dress shirt|tailored)\b/.test(description))add('use','formal');
 if(/\b(?:t.shirt|jeans|hoodie|sweatshirt|shorts)\b/.test(description))add('use','casual');
 if(/\b(?:uniform|scrubs|workwear|work shirt)\b/.test(description))add('use','work');
 if(traits.temporary&&/\b(?:hospital|patient|surgical)\b/.test(description))add('use','care');
 return traits;
}
export function wardrobeLevels(settings={}){
 const legacy=settings.wardrobeSize<=10?'low':settings.wardrobeSize>=24?'high':'medium';
 return Object.fromEntries(Object.keys(MAIN_WARDROBE).map(key=>[key,['low','medium','high'].includes(settings.wardrobeLevel)?settings.wardrobeLevel:['low','medium','high'].includes(settings.wardrobeLevels?.[key])?settings.wardrobeLevels[key]:legacy]));
}
export function wardrobeLevel(settings={}){const levels=Object.values(wardrobeLevels(settings));return [...levels].sort((a,b)=>levels.filter(v=>v===b).length-levels.filter(v=>v===a).length)[0];}
export function wardrobeTargets(settings){const levels=wardrobeLevels(settings);return Object.fromEntries(Object.entries(MAIN_WARDROBE).map(([key,v])=>[key,v.counts[['low','medium','high'].indexOf(levels[key])]]));}
export function ownedItems(branch,who){const registry=new Map();for(const item of [...(branch.profiles[who]?.wardrobe||[]),...(branch.extra[who]||[]),...(branch.current.people[who]?.items||[])])registry.set(item.id,{...item,labelKo:item.labelKo||registry.get(item.id)?.labelKo||'',brandKo:item.brandKo||registry.get(item.id)?.brandKo||''});return [...registry.values()].filter(item=>item.available!==false);}
export function requireKoreanLabels(items){if(items.some(item=>['labelKo','brandKo'].some(key=>typeof item[key]!=='string'||!/[가-힣]/.test(item[key])||/[A-Za-z]/.test(item[key])||item[key].length>120)))throw Error('생성된 의상의 한글 표시명이 누락됐습니다. 기존 데이터는 유지됩니다. 다시 생성해 주세요.');}
const validLabel=value=>typeof value==='string'&&/[가-힣]/.test(value)&&!/[A-Za-z]/.test(value)&&value.length<=120;
export function missingLabels(items){return items.filter(item=>!validLabel(item.labelKo)||!validLabel(item.brandKo));}
// Display repairs keep the original worn garment and its established English identity.
export function completeLabels(items,updates=[]){
 const byId=new Map(updates.filter(item=>item&&typeof item.id==='string').map(item=>[item.id,item]));
 return items.map(item=>{const update=byId.get(item.id);return {...item,labelKo:validLabel(item.labelKo)?item.labelKo:validLabel(update?.labelKo)?update.labelKo:'',brandKo:validLabel(item.brandKo)?item.brandKo:validLabel(update?.brandKo)?update.brandKo:''};});
}
export function applyLabels(branch,who,completed){
 const byId=new Map(completed.map(item=>[item.id,item]));
 const update=items=>{for(const item of items||[]){const value=byId.get(item.id);if(value){item.labelKo=value.labelKo;item.brandKo=value.brandKo;}}};
 update(branch.profiles[who]?.wardrobe);update(branch.extra[who]);update(branch.baseExtra?.[who]);
 for(const state of [branch.current,branch.base,...(branch.history||[])])update(state?.people[who]?.items);
 for(const cp of Object.values(branch.checkpoints||{})){update(cp.extra?.[who]);update(cp.state?.people[who]?.items);for(const state of cp.history||[])update(state?.people[who]?.items);}
 for(const snapshot of Object.values(branch.display?.snapshots||{}))update(snapshot.people?.[who]?.items);
}
const signature=item=>JSON.stringify([item.category,item.name?.trim().toLowerCase(),item.color?.trim().toLowerCase(),[...(item.features||[])].map(s=>s.trim().toLowerCase()).sort(),item.brand?.trim().toLowerCase()]);
export function mergeWardrobe(existing,added){
 const result=[...existing],ids=new Set(result.map(i=>i.id)),signatures=new Set(result.map(signature));
 for(const item of added){if(ids.has(item.id)){const n=result.findIndex(old=>old.id===item.id);result[n]={...result[n],labelKo:result[n].labelKo||item.labelKo||'',brandKo:result[n].brandKo||item.brandKo||''};continue;}if(signatures.has(signature(item)))continue;result.push(item);ids.add(item.id);signatures.add(signature(item));}return result;
}
export function composeWardrobe(existing,generated,targets){
 const known=new Set(existing.map(i=>i.id)),counts=Object.fromEntries(Object.values(MAIN_WARDROBE).map(v=>[v.category,new Set(existing.filter(i=>i.category===v.category&&i.available!==false).map(signature)).size]));
 const limits=Object.fromEntries(Object.entries(MAIN_WARDROBE).map(([key,v])=>[v.category,targets[key]]));
 return mergeWardrobe(existing,generated).filter(item=>{if(known.has(item.id)||!Object.hasOwn(limits,item.category))return true;if(counts[item.category]>=limits[item.category])return false;counts[item.category]++;return true;});
}
export function wardrobeDeficits(profile,targets){
 return Object.fromEntries(Object.entries(MAIN_WARDROBE).flatMap(([key,v])=>{
  if(!Number.isFinite(targets[key]))return [];
  if(profile.wardrobeExceptions?.[key])return [];
  const count=new Set((profile.wardrobe||[]).filter(i=>i.available!==false&&i.category===v.category).map(signature)).size,missing=Math.max(0,targets[key]-count);
  return missing?[[key,missing]]:[];
 }));
}
// Replacing stock does not change what the story currently says a person wears.
// Rebase the timeline so discarded stock cannot return through an old checkpoint.
export function replaceWardrobeCategory(branch,who,category,items,exception){
 const profile=branch.profiles[who];
 profile.wardrobe=[...(profile.wardrobe||[]).filter(i=>i.category!==category),...structuredClone(items)];
 profile.wardrobeExceptions??={};
 const key=WARDROBE_TABS.find(t=>t.category===category)?.id;
 if(exception)profile.wardrobeExceptions[key]=exception;else delete profile.wardrobeExceptions[key];
 const worn=branch.current.people[who].items.filter(i=>i.category===category);
 branch.extra[who]=mergeWardrobe((branch.extra[who]||[]).filter(i=>i.category!==category),worn);
 const allowed=new Set(ownedItems(branch,who).map(i=>i.id));
 for(const memory of [branch.outfitMemory,branch.baseMemory])if(memory?.[who])for(const k of ['lastDressed','beforeUndress'])memory[who][k]=(memory[who][k]||[]).filter(id=>allowed.has(id));
 branch.base=structuredClone(branch.current);branch.baseExtra=structuredClone(branch.extra);
 branch.baseMemory=structuredClone(branch.outfitMemory||{});
 const retained=new Set(Object.values(branch.display?.heads||{}).map(head=>head.key));
 branch.checkpoints=Object.fromEntries(Object.entries(branch.checkpoints||{}).filter(([key])=>retained.has(key)));
 for(const cp of Object.values(branch.checkpoints)){
  cp.extra??={character:[],persona:[]};
  cp.extra[who]=mergeWardrobe((cp.extra[who]||[]).filter(item=>item.category!==category),cp.state.people[who].items.filter(item=>item.category===category));
  const owned=new Set(ownedItems({...branch,extra:cp.extra},who).map(item=>item.id));
  if(cp.outfitMemory?.[who])for(const key of ['lastDressed','beforeUndress'])cp.outfitMemory[who][key]=(cp.outfitMemory[who][key]||[]).filter(id=>owned.has(id));
  cp.history=[];cp.outfits=[];
 }
 branch.keys=[];branch.history=[];branch.outfits=[];
}
