export const MAIN_WARDROBE={top:{label:'상의',category:'상의',counts:[4,7,10]},bottom:{label:'하의',category:'하의',counts:[3,5,7]},outerwear:{label:'겉옷',category:'겉옷',counts:[1,3,5]},footwear:{label:'신발',category:'신발',counts:[2,3,5]}};
export const WARDROBE_TABS=[...Object.entries(MAIN_WARDROBE).map(([id,v])=>({id,...v})),{id:'underwear',label:'속옷',category:'속옷'},{id:'accessory',label:'액세서리·소품',category:'소품'}];
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
 branch.checkpoints={};branch.keys=[];branch.history=[];branch.outfits=[];
}
