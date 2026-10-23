// Reserved internal state must never reach rendered assistant text, including partial streams.
export function stripOutfitBlocks(value){const source=String(value??'');let depth=0,cursor=0,result='';const tags=/(?:<|&lt;)(\/?)(kikki_outfit)\b[^>]*?(?:>|&gt;)/gi;for(const match of source.matchAll(tags)){if(depth===0)result+=source.slice(cursor,match.index);if(match[1])depth=Math.max(0,depth-1);else depth++;cursor=match.index+match[0].length;}if(depth===0)result+=source.slice(cursor);return result
 .replace(/(?:<|&lt;)kikki_outfit\b[\s\S]*$/gi,'')
 .replace(/(?:<|&lt;)\/?k(?:i(?:k(?:k(?:i(?:_(?:o(?:u(?:t(?:f(?:i(?:t)?)?)?)?)?)?)?)?)?)?)?$/gi,'')
 .replace(/```(?:xml|html|text)?\s*```/gi,'');}
const IDS=['kikki-closet-output-display','kikki-closet-output-storage'];
export function installOutputGuard(context){const c=context();if(c.messageFormatter?.addHook){c.messageFormatter.addHook((mes,ctx)=>ctx.isUser?mes:stripOutfitBlocks(mes),{stage:c.messageFormatter.stage.BEFORE_REGEX,order:0});return {safe:()=>true,remove:()=>{}};}
// Older ST: use its built-in Regex extension. Do not require a server plugin.
const regex='/(?:```(?:xml|html|text)?\\s*)?(?:<|&lt;)kikki_outfit\\b[^>]*?(?:>|&gt;)[\\s\\S]*(?:<|&lt;)\\/kikki_outfit\\s*(?:>|&gt;)(?:\\s*```)?|(?:<|&lt;)\\/?k(?:i(?:k(?:k(?:i(?:_(?:o(?:u(?:t(?:f(?:i(?:t)?)?)?)?)?)?)?)?)?)?)?$|(?:<|&lt;)kikki_outfit\\b[\\s\\S]*$/gi';
function install(){const settings=context().extensionSettings;if(!settings)return;settings.regex??=[];settings.regex=settings.regex.filter(r=>!IDS.includes(r.id));for(let i=0;i<2;i++)settings.regex.push({id:IDS[i],scriptName:'끼끼의상실 · 내부 착장 숨김',findRegex:regex,replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:i===0,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null});}
install();return {safe:()=>!!context().extensionSettings&&!context().extensionSettings.disabledExtensions?.includes('regex'),remove:()=>{const c=context();if(c.extensionSettings?.regex){c.extensionSettings.regex=c.extensionSettings.regex.filter(r=>!IDS.includes(r.id));c.saveSettingsDebounced?.();}},install};}
export async function sanitizeSavedOutputs(context,{report=false,onlyInternal=false}={}){
 const c=context(),originals=new Map(),clean=value=>!onlyInternal||/(?:<|&lt;)\/?kikki_outfit\b/i.test(String(value))?stripOutfitBlocks(value):value;let changed=false,messages=0,swipes=0;
 for(const m of c.chat){if(m.is_user)continue;const previous={mes:m.mes,swipes:m.swipes};let touched=false;const cleaned=clean(m.mes);if(cleaned!==m.mes){m.mes=cleaned;changed=touched=true;}if(Array.isArray(m.swipes))m.swipes=m.swipes.map(s=>{const v=clean(s);if(v!==s){changed=touched=true;swipes++;}return v;});if(touched){originals.set(m,previous);messages++;}}
 if(changed)try{await c.saveChat?.();}catch(error){for(const [m,previous] of originals){m.mes=previous.mes;if(previous.swipes!==undefined)m.swipes=previous.swipes;}throw error;}
 return report?{changed,messages,swipes}:changed;
}
