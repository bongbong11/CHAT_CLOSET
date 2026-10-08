// English model contract; existing Korean storage and UI remain compatible.
const fields={ageRange:'나이대',occupation:'직업',standardOfLiving:'생활수준',livingEnvironment:'생활환경',universe:'세계관',clothingRules:'복식 규칙',clothingCulture:'배경·복식 문화',brandPreferences:'브랜드 성향',selectionPreferences:'선택 성향',fashionInterest:'패션 관심도',style:'스타일',colors:'색상',fitAndMaterials:'핏·소재',footwearAndAccessories:'신발·소품',careHabits:'관리 습관',fixedConstraints:'고정 조건'};
const categories={top:'상의',bottom:'하의',underwear:'속옷',footwear:'신발',outerwear:'겉옷',accessory:'소품'};
const certainty={explicit:'명시',inferred:'추정',unknown:'불명'};
const source={assumedOwned:'추정 보유',alreadyOwned:'기존 보유',purchased:'구매',borrowedOrIssued:'대여·지급'};
const levels={low:'적게',medium:'보통',high:'많이'};
const reverse=map=>Object.fromEntries(Object.entries(map).map(([a,b])=>[b,a]));
const outbound={fields:reverse(fields),category:reverse(categories),certainty:reverse(certainty),source:reverse(source),newItems:reverse(levels),variety:reverse(levels)};
const inbound={fields,category:categories,certainty,source};
function convert(value,maps){
 if(Array.isArray(value))return value.map(v=>convert(v,maps));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>maps!==outbound||!['labelKo','brandKo','sceneKo'].includes(key)).map(([key,v])=>{
  if(key==='fields'&&v&&typeof v==='object'&&!Array.isArray(v))return [key,Object.fromEntries(Object.entries(v).map(([name,field])=>[maps.fields[name]||name,convert(field,maps)]))];
  if(typeof v==='string'&&maps[key])return [key,maps[key][v]||v];
  return [key,convert(v,maps)];
 }));
}
export const toModelData=value=>convert(value,outbound);
export const fromModelData=value=>convert(value,inbound);
