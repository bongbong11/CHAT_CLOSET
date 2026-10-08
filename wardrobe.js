export const MAIN_WARDROBE={top:{label:'상의',category:'상의',counts:[4,7,10]},bottom:{label:'하의',category:'하의',counts:[3,5,7]},outerwear:{label:'겉옷',category:'겉옷',counts:[1,3,5]},footwear:{label:'신발',category:'신발',counts:[2,3,5]}};
export const WARDROBE_TABS=[...Object.entries(MAIN_WARDROBE).map(([id,v])=>({id,...v})),{id:'underwear',label:'속옷',category:'속옷'},{id:'accessory',label:'액세서리·소품',category:'소품'}];
export function wardrobeLevels(settings={}){
 const legacy=settings.wardrobeSize<=10?'low':settings.wardrobeSize>=24?'high':'medium';
 return Object.fromEntries(Object.keys(MAIN_WARDROBE).map(key=>[key,['low','medium','high'].includes(settings.wardrobeLevels?.[key])?settings.wardrobeLevels[key]:legacy]));
}
export function wardrobeTargets(settings){const levels=wardrobeLevels(settings);return Object.fromEntries(Object.entries(MAIN_WARDROBE).map(([key,v])=>[key,v.counts[['low','medium','high'].indexOf(levels[key])]]));}
export function ownedItems(branch,who){return [...new Map([...(branch.profiles[who]?.wardrobe||[]),...(branch.extra[who]||[]),...(branch.current.people[who]?.items||[])].map(item=>[item.id,item])).values()].filter(item=>item.available!==false);}
const signature=item=>JSON.stringify([item.category,item.name?.trim().toLowerCase(),item.color?.trim().toLowerCase(),[...(item.features||[])].map(s=>s.trim().toLowerCase()).sort(),item.brand?.trim().toLowerCase()]);
export function mergeWardrobe(existing,added){
 const result=[...existing],ids=new Set(result.map(i=>i.id)),signatures=new Set(result.map(signature));
 for(const item of added){if(ids.has(item.id)||signatures.has(signature(item)))continue;result.push(item);ids.add(item.id);signatures.add(signature(item));}return result;
}
export function composeWardrobe(existing,generated,targets){
 const known=new Set(existing.map(i=>i.id)),counts=Object.fromEntries(Object.values(MAIN_WARDROBE).map(v=>[v.category,new Set(existing.filter(i=>i.category===v.category&&i.available!==false).map(signature)).size]));
 const limits=Object.fromEntries(Object.entries(MAIN_WARDROBE).map(([key,v])=>[v.category,targets[key]]));
 return mergeWardrobe(existing,generated).filter(item=>{if(known.has(item.id)||!Object.hasOwn(limits,item.category))return true;if(counts[item.category]>=limits[item.category])return false;counts[item.category]++;return true;});
}
export function wardrobeDeficits(profile,targets){
 return Object.fromEntries(Object.entries(MAIN_WARDROBE).flatMap(([key,v])=>{
  if(profile.wardrobeExceptions?.[key])return [];
  const count=new Set((profile.wardrobe||[]).filter(i=>i.available!==false&&i.category===v.category).map(signature)).size,missing=Math.max(0,targets[key]-count);
  return missing?[[key,missing]]:[];
 }));
}
