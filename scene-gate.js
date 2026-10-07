// Cheap conservative cues only. The reader model resolves intent and actual actions.
const clothingAction=/갈아입|갈아신|환복|탈의|착용|벗었|벗는다|벗어|벗고|입었|입는다|입고\s*(?:나|외출)|신었|신는다|신고\s*(?:나|외출)|걸쳤|걸친|챙겨\s*입|맨발|알몸|벌거벗|나체|샤워|목욕|세탁|드레스코드|(?:옷|셔츠|바지|치마|드레스|신발|구두|코트|재킷|자켓|속옷|브라|팬티|양말|장갑|모자|목걸이|귀걸이|안경|소매|단추|지퍼).{0,45}(?:입었|입어|입는|입고|벗|신었|신는|신고|갈아|풀|잠그|걷|접|젖|찢|묻|더러|벗겨|빼|끼|걸|바꾸)|\b(?:put(?:s|ting)? on|took off|take(?:s|n)? off|taking off|changed? (?:into|clothes|outfits)|changing (?:into|clothes)|dress(?:ed|ing)|undress(?:ed|ing)?|barefoot|naked|shower|bathe|laundry|unbutton(?:ed|s|ing)?|unzip(?:ped|s|ping)?|roll(?:ed|s)? up)\b|\b(?:shirt|trousers|pants|skirt|dress|shoes|coat|jacket|underwear|bra|socks|gloves|hat|necklace|earrings|glasses|sleeves|buttons|zipper)\b.{0,65}\b(?:wet|torn|dirty|stained|removed|loosened|fastened|off)\b/i;
const transition=/외출|출근|퇴근|등교|하교|귀가|도착|나섰|나갔|나간다|나가자|들어왔|돌아왔|(?:집|회사|학교|가게|식당|카페|파티|연회|무도회|침실|거리)(?:에|로|으로)\s*(?:가|갔|향|이동|돌아|도착)|(?:다음\s*날|이튿날|다음날|몇\s*시간|한참\s*뒤|시간이\s*흘|날이\s*밝|장면\s*전환)|\b(?:depart(?:ed|s|ure)?|arriv(?:e|ed|es|al)|head(?:ed|s|ing)? (?:out|to|home)|left (?:home|the|for)|leave (?:home|the|for)|going out|goes out|went out|returned (?:home|to)|next (?:day|morning|evening)|hours? later|time skip|scene change|snowstorm|rainstorm)\b/i;
function metadata(content){
 const out={};const source=content.replace(/<[^>]*>/g,'\n');
 for(const [key,re] of Object.entries({place:/(?:^|\n|\|)\s*(?:Loc|Location|장소)\s*[:：]\s*([^\n|]+)/i,date:/(?:^|\n|\|)\s*(?:Date|날짜)\s*[:：]\s*([^\n|]+)/i,time:/(?:^|\n|\|)\s*(?:Time|시간)\s*[:：]\s*(\d{1,2}:\d{2})/i,season:/(?:^|\n|\|)\s*(?:Season|계절)\s*[:：]\s*([^\n|]+)/i,weather:/(?:^|\n|\|)\s*(?:Weather|날씨)\s*[:：]\s*([^\n|]+)/i})){const match=source.match(re);if(match)out[key]=match[1].trim().toLowerCase();}
 return out;
}
export function needsOutfitRead(messages,start){
 if(start===0)return messages.length>0;
 let previous={};for(const m of messages.slice(0,start))previous={...previous,...metadata(m.content)};
 for(const m of messages.slice(start)){
  const next=metadata(m.content);
  for(const key of ['place','date','season','weather'])if(next[key]&&next[key]!==previous[key])return true;
  if(next.time&&previous.time){const minutes=s=>s.split(':').reduce((a,n)=>a*60+Number(n),0);const delta=minutes(next.time)-minutes(previous.time);if(delta<0||delta>=90)return true;}
  const narrative=m.content.replace(/<Scene_Info\b[^>]*>[\s\S]*?<\/Scene_Info>/gi,'');
  if(clothingAction.test(narrative)||transition.test(narrative))return true;
  previous={...previous,...next};
 }
 return false;
}
