const clamp=(n,min,max)=>Math.max(min,Math.min(Math.max(min,max),n));
export function visibleBounds(view,width,height,safe={}){
 const x=view?.offsetLeft||0,y=view?.offsetTop||0,w=view?.width||width,h=view?.height||height;
 return {left:x+8+(safe.left||0),top:y+8+(safe.top||0),right:x+w-8-(safe.right||0),bottom:y+h-8-(safe.bottom||0)};
}
export function clampMascot(x,y,width,height,bounds){return {x:clamp(x,bounds.left,bounds.right-width),y:clamp(y,bounds.top,bounds.bottom-height)};}
export function restoreMascot(position,width,height,bounds){
 if(!Number.isFinite(position?.x)||!Number.isFinite(position?.y))return clampMascot(bounds.right-width-6,bounds.bottom-height-82,width,height,bounds);
 return clampMascot(bounds.left+clamp(position.x,0,1)*Math.max(0,bounds.right-bounds.left-width),bounds.top+clamp(position.y,0,1)*Math.max(0,bounds.bottom-bounds.top-height),width,height,bounds);
}
export function rememberMascot(rect,bounds){return {x:clamp((rect.left-bounds.left)/Math.max(1,bounds.right-bounds.left-rect.width),0,1),y:clamp((rect.top-bounds.top)/Math.max(1,bounds.bottom-bounds.top-rect.height),0,1)};}
