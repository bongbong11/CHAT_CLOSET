// Cheap conservative cues only. The reader model resolves intent and actual actions.
const clothingAction=/갈아입|갈아신|환복|탈의|착용|벗었|벗는다|벗어|벗고|입었|입는다|입고\s*(?:나|외출)|신었|신는다|신고\s*(?:나|외출)|걸쳤|걸친|챙겨\s*입|맨발|알몸|벌거벗|나체|샤워|목욕|세탁|드레스코드|(?:옷|셔츠|바지|치마|드레스|신발|구두|코트|재킷|자켓|속옷|브라|팬티|양말|장갑|모자|목걸이|귀걸이|안경|소매|단추|지퍼).{0,45}(?:입었|입어|입는|입고|벗|신었|신는|신고|갈아|풀|잠그|걷|접|젖|찢|묻|더러|벗겨|빼|끼|걸|바꾸)|\b(?:put(?:s|ting)? on|took off|take(?:s|n)? off|taking off|changed? (?:into|clothes|outfits)|changing (?:into|clothes)|dress(?:ed|ing)|undress(?:ed|ing)?|barefoot|naked|shower|bathe|laundry|unbutton(?:ed|s|ing)?|unzip(?:ped|s|ping)?|roll(?:ed|s)? up)\b|\b(?:shirt|trousers|pants|skirt|dress|shoes|coat|jacket|underwear|bra|socks|gloves|hat|necklace|earrings|glasses|sleeves|buttons|zipper)\b.{0,65}\b(?:wet|torn|dirty|stained|removed|loosened|fastened|off)\b/i;
const transition=/외출|출근|퇴근|등교|하교|귀가|도착|나섰|나갔|나간다|나가자|들어왔|돌아왔|(?:집|회사|학교|가게|식당|카페|파티|연회|무도회|침실|거리)(?:에|로|으로)\s*(?:가|갔|향|이동|돌아|도착)|(?:다음\s*날|이튿날|다음날|몇\s*시간|한참\s*뒤|시간이\s*흘|날이\s*밝|장면\s*전환)|\b(?:depart(?:ed|s|ure)?|arriv(?:e|ed|es|al)|head(?:ed|s|ing)? (?:out|to|home)|left (?:home|the|for)|leave (?:home|the|for)|going out|goes out|went out|returned (?:home|to)|next (?:day|morning|evening)|hours? later|time skip|scene change|snowstorm|rainstorm)\b/i;
const movement=/(?:(?:이제|잠시\s*후|그\s*후|이후|다음\s*장면).{0,45}(?:로비|식당|거리|사무실|가게|카페)|자리(?:를|가)?\s*옮|장소(?:를|가)?\s*(?:옮|바꾸)|이동(?:했|한|한다|하자|해|한다)|방(?:을|에서)\s*(?:나|벗어나)|(?:침대|침실|방|소파)(?:에서|를)\s*(?:나와|나왔|떠나|일어나)|(?:로비|복도|거실|주방|부엌|식당|식당가|욕실|호텔|사무실|차량|차|정원|바깥|밖)(?:으로|로|에|까지)\s*(?:향|가|갔|이동|내려|올라|나|들어|걸어|도착)|계단(?:을|으로)?\s*(?:내려|올라)|(?:관계|정사|사적인\s*시간|샤워|목욕|휴식|수면)(?:가|를|을|이)?\s*(?:끝|마치)|\b(?:mov(?:e|ed|es|ing)|walk(?:ed|s|ing)?|went|go(?:es|ing)?|stepp(?:ed|ing)|step(?:s)?)\s+(?:to|into|out of|downstairs|upstairs|outside|away)|\b(?:got|get(?:s|ting)?) out of bed|\b(?:after|finished|ended) (?:their intimacy|sex|the shower|bathing|sleeping)\b)/i;
const conditionChange=/임신|부상|다쳤|다치고|깁스|입원|퇴원|회복|붓기|부종|허리.{0,15}(?:조이|끼|압박)|\b(?:pregnan\w*|injur\w*|hospitali[sz]\w*|admitted|discharged|recovered|healed|swollen|swelling|cast|too tight|waist pressure)\b/i;
const climateCue=/\b(?:rain(?:ed|ing)?|snow(?:ed|ing)?|overcast|cloudy|fog(?:gy)?|winter|summer|autumn|spring|freezing|temperature|degrees?)\b|비가|눈이|날씨|기온|한겨울|한여름|쌀쌀|폭염|한파/iu;
const climateChange=/\b(?:began|started|stopped|ended|turned|became|grew)\b.{0,40}\b(?:rain\w*|snow\w*|cold|hot|cloudy|clear)\b|\b(?:rain\w*|snow\w*)\b.{0,30}\b(?:began|started|stopped|ended)\b|(?:비가|눈이).{0,20}(?:내리|그쳤|시작|멎)|날씨가.{0,20}(?:바뀌|추워|더워)/iu;
function metadata(content){
 const out={};const source=content.replace(/<[^>]*>/g,'\n').replace(/\*\*|__/g,'');
 for(const [key,re] of Object.entries({place:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Loc|Location|장소|위치|현재\s*장소)\s*[:：]\s*([^\n|]+)/iu,date:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Date|날짜)\s*[:：]\s*([^\n|]+)/iu,time:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Time|시간)\s*[:：]\s*(\d{1,2}:\d{2})/iu,season:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Season|계절)\s*[:：]\s*([^\n|]+)/iu,weather:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Weather|날씨)\s*[:：]\s*([^\n|]+)/iu,condition:/(?:^|\n|\|)\s*[^\p{L}\p{N}\n|]{0,8}(?:Physical (?:state|condition)|Body condition|신체\s*상태)\s*[:：]\s*([^\n|]+)/iu})){const match=source.match(re);if(match)out[key]=match[1].trim().toLowerCase();}
 return {...out,...readEnvironment(content)};
}
export function needsOutfitRead(messages,start){
 if(start===0)return messages.length>0;
 let previous={};for(const m of messages.slice(0,start))previous={...previous,...metadata(m.content)};
 for(const m of messages.slice(start)){
  const next=metadata(m.content);
  for(const key of ['place','date','season','weather','condition'])if(next[key]&&next[key]!==previous[key])return true;
  if(typeof next.temperature==='number'&&(typeof previous.temperature!=='number'||Math.abs(next.temperature-previous.temperature)>=3||[12,26].some(edge=>(next.temperature>=edge)!==(previous.temperature>=edge))))return true;
  if(next.time&&previous.time){const minutes=s=>s.split(':').reduce((a,n)=>a*60+Number(n),0);const delta=minutes(next.time)-minutes(previous.time);if(delta<0||delta>=90)return true;}
  const narrative=m.content.replace(/<Scene_Info\b[^>]*>[\s\S]*?<\/Scene_Info>/gi,'');
  if(clothingAction.test(narrative)||transition.test(narrative)||movement.test(narrative)||conditionChange.test(narrative))return true;
  if(climateCue.test(narrative)&&(!Object.keys(readEnvironment(narrative)).length||climateChange.test(narrative)))return true;
  previous={...previous,...next};
 }
 return false;
}

export const WEATHER_LABELS={mild:'온화',hot:'더움',cold:'추움',rain:'비',snow:'눈',clear:'맑음',cloudy:'흐림',fog:'안개',windy:'바람',storm:'폭풍'};
const unavailable=/\b(?:unknown|unspecified|unconfirmed|n\/a|not|maybe|perhaps|forecast|tomorrow|yesterday)\b|미확인|불명|모름|예보|예상|내일|어제|가정|아니/iu;
function seasonValue(value){
 const text=String(value??'').trim();if(unavailable.test(text))return;
 for(const [season,re] of [['spring',/\bspring\b|봄|🌸/iu],['summer',/\bsummer\b|여름/iu],['autumn',/\b(?:autumn|fall)\b|가을|🍂|🍁/iu],['winter',/\bwinter\b|겨울|❄/iu]])if(re.test(text))return season;
}
function weatherValue(value){
 const text=String(value??'').trim();if(unavailable.test(text))return;
 for(const [weather,re] of [
  ['snow',/\b(?:snow(?:y|ing|fall|storm|s)?|blizzard|sleet)\b|(?:^|[\s,·/])눈(?=$|[\s,·/])|눈이|눈내림|눈보라|적설|설경|❄|🌨/iu],
  ['storm',/\b(?:storm\w*|thunder\w*|hurricane|typhoon)\b|폭풍|태풍|천둥|뇌우|⛈/iu],
  ['rain',/\b(?:rain(?:y|ing|fall|storm|s|ed)?|drizzle|shower)\b|(?:^|[\s,·/])비(?=$|[\s,·/])|비가|비내림|비오는|비내리는|소나기|강우|장마|🌧|☔/iu],
  ['fog',/\b(?:fog\w*|mist\w*|haze|hazy)\b|안개|박무/iu],
  ['cloudy',/\b(?:overcast|cloud(?:y|s|ed|iness)?)\b|흐림|흐린|구름|☁/iu],
  ['clear',/\b(?:clear|sunny|sunshine|fair|cloudless)\b|맑음|맑은|쾌청|☀/iu],
  ['windy',/\b(?:windy|gale)\b|강풍|바람/iu],
  ['cold',/\b(?:cold|freezing|chilly)\b|추움|추운|한파/iu],
  ['hot',/\b(?:hot|sweltering)\b|더움|더운|폭염/iu],
  ['mild',/\b(?:mild|temperate)\b|온화|선선/iu],
 ])if(re.test(text))return weather;
}
function temperatureValue(value,bare=false){
 const text=String(value??'').trim().replace(/[−–]/g,'-').replace(/\b(?:degrees?\s+)?celsius\b/gi,'°C').replace(/\b(?:degrees?\s+)?fahrenheit\b/gi,'°F');if(unavailable.test(text))return;
 const match=text.match(/([-+]?\d+(?:\.\d+)?)\s*(?:°\s*([CF])\b|([CF])\b|(℃)|(℉)|(도))/iu);
 let number=match?Number(match[1]):bare&&/^[-+]?\d+(?:\.\d+)?\s*°?$/.test(text)?parseFloat(text):NaN;
 if(match&&(String(match[2]||match[3]).toUpperCase()==='F'||match[5]))number=Math.round((number-32)*5/9*10)/10;
 if(Number.isFinite(number)&&number>=-80&&number<=65)return number;
}
export function environmentValues(value={}){
 const out={},season=seasonValue(value.season),weather=weatherValue(value.weather),temperature=temperatureValue(value.temperature,true)??temperatureValue(value.weather);
 if(season)out.season=season;if(weather)out.weather=weather;if(temperature!==undefined)out.temperature=temperature;return out;
}
export function environmentText(value,language='en'){
 return [value.weather&&(language==='ko'?WEATHER_LABELS[value.weather]:value.weather),typeof value.temperature==='number'?value.temperature+(language==='ko'?'℃':'°C'):''].filter(Boolean).join(' · ');
}
export function readEnvironment(content){
 if(/^\s*(?:\[OOC\]|OOC\s*:)/i.test(content||''))return {};
 const source=String(content||'').replace(/<ooc\b[^>]*>[\s\S]*?<\/ooc>/gi,'').replace(/<[^>]*>/g,'\n').replace(/&nbsp;|&#160;/gi,' ').replace(/&deg;|&#176;/gi,'°').replace(/&#8451;/g,'℃').replace(/```(?:json|yaml|yml|text|markdown|md)?|~~~(?:json|yaml|text)?/gi,'\n').replace(/__|\*\*/g,'').replace(/_/g,' ').replace(/[`*#\[\]]/g,'');
 const out={},labels=/(?:^|[^\p{L}\p{N}_])['"]?(?:(?:current|present)\s+|현재\s*)?(season|계절|weather|날씨|기상|(?:air\s+)?temperature|temp|기온|온도)['"]?\s*(?::|：|=|\||\n)\s*['"]?/gimu;
 for(const match of source.matchAll(labels)){
  const prefix=source.slice(source.lastIndexOf('\n',match.index)+1,match.index);if(/\b(?:forecast|example|template|tomorrow|yesterday)\b|\b(?:body|skin|water|bath|food|oven)\s*$|예보|예시|내일|어제/iu.test(prefix))continue;
  const raw=source.slice(match.index+match[0].length).split(/[\r\n|;}]/,1)[0].slice(0,160).split(/,\s*['"]?[\p{L}_][\p{L}\s_]{0,24}['"]?\s*:/u)[0].replace(/['"]\s*$/,'').trim();
  const key=/^(?:season|계절)$/i.test(match[1])?'season':/^(?:weather|날씨|기상)$/i.test(match[1])?'weather':'temperature';
  Object.assign(out,environmentValues({[key]:raw}));
 }
 return out;
}
