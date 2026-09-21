// Hypergro Scene Format helpers. Pure functions, no DOM: normalize → understand → applyOps.
export const VERSION='1.0';
export const ROLES=['background','logo','headline','subhead','offer','cta','product','disclaimer','body','image','shape','decoration'];

export function normalize(raw){
  const doc=raw.document||{}; const W=+doc.width||1080, H=+doc.height||1080;
  const elements=(raw.elements||[]).map((e,i)=>{
    const type=e.type||'vector';
    return { id:e.id||'el_'+String(i+1).padStart(3,'0'), type, name:e.name||type, parentId:e.parentId||null, artboardId:e.artboardId??0, zIndex:e.zIndex??i,
      bounds:{x:0,y:0,width:0,height:0,...(e.bounds||{})}, transform:{rotation:0,scaleX:1,scaleY:1,...(e.transform||{})},
      text:type==='text'?{content:'',fontFamily:null,fontStyle:'Regular',fontSize:16,lineHeight:null,letterSpacing:0,align:'left',kind:'point',...(e.text||{})}:undefined,
      fill:e.fill===undefined?(type==='text'?'#000000':null):e.fill, gradient:e.gradient||null, stroke:e.stroke||null, opacity:e.opacity??1, blendMode:e.blendMode||'normal',
      asset:e.asset||null, assetSvg:e.assetSvg||null, clip:e.clip||null, renderMode:e.renderMode||null,
      editable:e.editable??(type!=='group'), locked:!!e.locked, visible:e.visible??true,
      role:e.role||null, layout:e.layout||null, semanticGroup:e.semanticGroup||null, meta:e.meta||{} }; });
  return { version:VERSION, generator:raw.generator||null, source:raw.source||null,
    document:{ name:doc.name||'Untitled', width:W, height:H, activeArtboard:doc.activeArtboard??0, artboards:doc.artboards||[{id:0,name:'Artboard 1',x:0,y:0,width:W,height:H,reference:null}] },
    fonts:raw.fonts||[], assets:raw.assets||[], elements, warnings:raw.warnings||[], ingest:raw.ingest||null };
}

const area=e=>e.bounds.width*e.bounds.height;
const center=e=>({x:e.bounds.x+e.bounds.width/2,y:e.bounds.y+e.bounds.height/2});
const containsCenter=(a,b,pad=0)=>{ const c=center(b); return c.x>=a.bounds.x-pad&&c.x<=a.bounds.x+a.bounds.width+pad&&c.y>=a.bounds.y-pad&&c.y<=a.bounds.y+a.bounds.height+pad; };
const near=(a,b,d)=>a.bounds.x<b.bounds.x+b.bounds.width+d&&b.bounds.x<a.bounds.x+a.bounds.width+d&&a.bounds.y<b.bounds.y+b.bounds.height+d&&b.bounds.y<a.bounds.y+a.bounds.height+d;
const OFFER=/(\d+(\.\d+)?\s?%|₹|\bRs\.?|\$|€|£|\boff\b|cashback|free|save|bonus|discount|p\.a\.|emi|rate)/i;

// Design intelligence: roles, semantic groups, brand locks. Explicit roles from the file are kept.
export function understand(scene){
  const {width:W,height:H}=scene.document; const A=W*H;
  const els=scene.elements.map(e=>({...e,role:e.role&&ROLES.includes(e.role)?e.role:null}));
  const ab=scene.document.activeArtboard??0;
  const leaves=els.filter(e=>e.type!=='group'&&e.visible&&(e.artboardId??0)===ab);
  const texts=leaves.filter(e=>e.type==='text'&&(e.text.content||'').trim()), gfx=leaves.filter(e=>e.type!=='text');
  const cx=e=>center(e).x/W, cy=e=>center(e).y/H;
  const free=list=>list.filter(e=>!e.role);
  free(gfx).filter(e=>area(e)>A*.8&&!(e.type==='image'&&!e.meta?.collapsedGroup)).forEach(e=>e.role='background');
  // logo: small graphic in the top or bottom band, nearest a corner; an adjacent short uppercase text is its wordmark
  const logo=free(gfx).filter(e=>area(e)<A*.08&&area(e)>A*.0005&&(cy(e)<.3||cy(e)>.7)).sort((a,b)=>Math.min(cx(a),1-cx(a))-Math.min(cx(b),1-cx(b)))[0];
  if(logo){ logo.role='logo'; const word=free(texts).find(t=>{ const s=t.text.content.trim(); return s.split(/\s+/).length<=3&&s===s.toUpperCase()&&near(t,logo,logo.bounds.height); }); if(word){ word.role='logo'; word.semanticGroup=logo.semanticGroup='sg_logo_'+logo.id; } }
  // cta: a short text sitting on a small filled shape → one semantic group
  free(texts).forEach(t=>{ if(t.text.content.trim().split(/\s+/).length>4) return; const btn=free(gfx).find(g=>g.type==='vector'&&(g.fill||g.gradient)&&area(g)<A*.15&&area(g)>area(t)&&containsCenter(g,t,2)); if(btn){ t.role=btn.role='cta'; t.semanticGroup=btn.semanticGroup='sg_cta_'+t.id; } });
  free(gfx).filter(e=>e.type==='image'&&area(e)>A*.06).sort((a,b)=>area(b)-area(a)).slice(0,1).forEach(e=>e.role='product');
  const byFs=free(texts).sort((a,b)=>b.text.fontSize*Math.sqrt(area(b))-a.text.fontSize*Math.sqrt(area(a)));
  const hl=byFs[0]; if(hl) hl.role='headline';
  free(texts).filter(t=>cy(t)>.8&&t.text.fontSize<=Math.max(12,(hl?hl.text.fontSize:40)*.4)).forEach(t=>t.role='disclaimer');
  free(texts).filter(t=>OFFER.test(t.text.content)).forEach(t=>t.role='offer');
  const sub=free(texts).sort((a,b)=>b.text.fontSize-a.text.fontSize)[0]; if(sub&&hl&&sub.bounds.y>=hl.bounds.y&&sub.text.fontSize<hl.text.fontSize) sub.role='subhead';
  free(texts).forEach(t=>t.role='body');
  free(gfx).forEach(e=>e.role=e.type==='image'?'image':(area(e)<A*.02?'decoration':'shape'));
  // photos (hero images included) stay replaceable: only page artwork rasters and flat backgrounds are brand-locked
  els.forEach(e=>{ if(e.type==='image'&&!e.meta?.collapsedGroup&&e.role==='background'){ e.role='image'; if(e.meta?.lockedBy==='guardrail'){ e.locked=false; const m={...e.meta}; delete m.lockedBy; e.meta=m; } } });
  els.forEach(e=>{ if(e.type==='group') return; if(e.meta?.lockedBy===undefined&&['logo','disclaimer','background'].includes(e.role)&&!e.locked){ e.locked=true; e.meta={...(e.meta||{}),lockedBy:'guardrail'}; } });
  return {...scene,elements:els};
}

// The single mutation path for click and chat edits.
export function applyOps(scene,ops){
  const map=new Map(scene.elements.map(e=>[e.id,e]));
  (ops||[]).forEach(o=>{ const e=map.get(o.id); if(!e||!o.set) return; const p=o.set, n={...e};
    if(p.bounds) n.bounds={...e.bounds,...p.bounds}; if(p.text&&e.text){ n.text={...e.text,...p.text}; if(p.text.content!==undefined&&p.text.content!==e.text.content&&p.text.runs===undefined) n.text.runs=null; /* new words from anywhere but the rich editor: the old bold/italic ranges no longer point at the right letters */ } if(p.transform) n.transform={...e.transform,...p.transform}; if(p.meta) n.meta={...(e.meta||{}),...p.meta};
    ['fill','opacity','visible','locked','name','role','zIndex','asset','assetSvg','renderMode','semanticGroup','stroke','gradient','editable'].forEach(k=>{ if(p[k]!==undefined) n[k]=p[k]; });
    map.set(o.id,n); });
  return {...scene,elements:[...map.values()]};
}

// Remove elements (undo restores them because history snapshots whole scenes).
export function deleteElements(scene,ids){ const set=new Set(ids); return {...scene,elements:scene.elements.filter(e=>!set.has(e.id))}; }
// Duplicate elements 24px down-right; a duplicated semantic group becomes a new group so the copies move together.
export function duplicateElements(scene,ids){
  const set=new Set(ids); const src=scene.elements.filter(e=>set.has(e.id)&&e.type!=='group'); if(!src.length) return {scene,ids:[]};
  const taken=new Set(scene.elements.map(e=>e.id)); const fresh=id=>{ let n=2,c=`${id}_copy`; while(taken.has(c)) c=`${id}_copy${n++}`; taken.add(c); return c; };
  const maxZ=Math.max(...scene.elements.map(e=>e.zIndex))+1; const groups={};
  const copies=src.map((e,i)=>{ let sg=e.semanticGroup; if(sg){ groups[sg]=groups[sg]||`${sg}_copy_${maxZ}`; sg=groups[sg]; }
    return {...e,id:fresh(e.id),name:e.name+' copy',bounds:{...e.bounds,x:e.bounds.x+24,y:e.bounds.y+24},zIndex:maxZ+i,semanticGroup:sg,locked:false}; });
  return {scene:{...scene,elements:[...scene.elements,...copies]},ids:copies.map(c=>c.id)};
}
// Z-order ops. Backgrounds stay at the bottom so nothing can disappear behind the artwork.
export function reorderOps(scene,ids,action){
  const set=new Set(ids); const leaves=[...scene.elements].filter(e=>e.type!=='group').sort((a,b)=>a.zIndex-b.zIndex);
  const fixed=leaves.filter(e=>e.role==='background').map(e=>e.id); let order=leaves.filter(e=>e.role!=='background').map(e=>e.id);
  if(action==='front') order=[...order.filter(i=>!set.has(i)),...order.filter(i=>set.has(i))];
  else if(action==='back') order=[...order.filter(i=>set.has(i)),...order.filter(i=>!set.has(i))];
  else if(action==='forward'){ for(let i=order.length-2;i>=0;i--) if(set.has(order[i])&&!set.has(order[i+1])) [order[i],order[i+1]]=[order[i+1],order[i]]; }
  else if(action==='backward'){ for(let i=1;i<order.length;i++) if(set.has(order[i])&&!set.has(order[i-1])) [order[i],order[i-1]]=[order[i-1],order[i]]; }
  return [...fixed,...order].map((id,z)=>({id,set:{zIndex:z}}));
}

// ---- Operations layer shared by the in-app chat and the editor MCP server (mcp/editor-server.mjs).
// `target` is an element id ("el_014") or a role ("headline", "cta"). Every tool returns {scene, result}.
export const TOOLS=[
  {name:'list_elements',description:'List every element with id, role, type, text, colour, bounds and anchor.',input_schema:{type:'object',properties:{}}},
  {name:'set_text',description:'Change copy, font size or alignment of a text element.',input_schema:{type:'object',properties:{target:{type:'string'},content:{type:'string'},fontSize:{type:'number'},align:{type:'string',enum:['left','center','right']}},required:['target']}},
  {name:'set_fill',description:'Set the colour (hex) of a text or shape element. For a CTA, "cta" targets the button shape; use the label id for its text.',input_schema:{type:'object',properties:{target:{type:'string'},color:{type:'string'}},required:['target','color']}},
  {name:'move_element',description:'Move an element to x,y or by dx,dy (px). Members of its semantic group move with it.',input_schema:{type:'object',properties:{target:{type:'string'},x:{type:'number'},y:{type:'number'},dx:{type:'number'},dy:{type:'number'}},required:['target']}},
  {name:'resize_element',description:'Set width/height (px) of an element; text scales its font proportionally when scaleText is true.',input_schema:{type:'object',properties:{target:{type:'string'},width:{type:'number'},height:{type:'number'},scaleText:{type:'boolean'}},required:['target']}},
  {name:'set_visibility',description:'Show or hide an element (and its semantic group).',input_schema:{type:'object',properties:{target:{type:'string'},visible:{type:'boolean'}},required:['target','visible']}},
  {name:'set_role',description:'Override the detected role of an element.',input_schema:{type:'object',properties:{target:{type:'string'},role:{type:'string',enum:ROLES}},required:['target','role']}},
  {name:'set_font',description:'Change the font family and/or style (Regular, Bold, Italic…) of a text element.',input_schema:{type:'object',properties:{target:{type:'string'},fontFamily:{type:'string'},fontStyle:{type:'string'}},required:['target']}},
  {name:'set_order',description:'Change stacking order: front, back, forward or backward. Backgrounds always stay at the bottom.',input_schema:{type:'object',properties:{target:{type:'string'},action:{type:'string',enum:['front','back','forward','backward']}},required:['target','action']}},
  {name:'duplicate_element',description:'Duplicate an element (and its semantic group) 24px down-right; returns the new ids.',input_schema:{type:'object',properties:{target:{type:'string'}},required:['target']}},
  {name:'delete_element',description:'Delete an element from the creative (undoable).',input_schema:{type:'object',properties:{target:{type:'string'}},required:['target']}},
  {name:'set_lock',description:'Lock or unlock an element. Locked elements are brand-controlled (logo, disclaimer, background by default) and refuse edits until unlocked.',input_schema:{type:'object',properties:{target:{type:'string'},locked:{type:'boolean'}},required:['target','locked']}},
];
export function resolve(scene,ref){ if(!ref) return []; const byId=scene.elements.find(e=>e.id===ref); if(byId) return [byId];
  const byRole=scene.elements.filter(e=>e.type!=='group'&&e.role===ref); if(byRole.length) return byRole;
  const byName=scene.elements.filter(e=>e.type!=='group'&&(e.name||'').toLowerCase()===String(ref).toLowerCase()); return byName; }
const groupOf=(scene,e)=>e.semanticGroup?scene.elements.filter(x=>x.semanticGroup===e.semanticGroup):[e];
const MUTATING=['set_text','set_fill','move_element','resize_element','set_visibility','set_font','set_order','delete_element'];
export function runTool(scene,name,args={}){
  let els=resolve(scene,args.target); let names=els.map(e=>e.name).join(', ');
  if(name==='list_elements') return {scene,result:JSON.stringify(summarize(scene))};
  if(!els.length) return {scene,result:`No element matches "${args.target}". Use list_elements.`};
  if(MUTATING.includes(name)){ const locked=els.filter(e=>e.locked), free=els.filter(e=>!e.locked);
    if(!free.length) return {scene,result:`${locked.map(e=>e.name).join(', ')} is locked (brand-controlled). Unlock it first with set_lock if the user explicitly wants it changed.`};
    els=free; names=els.map(e=>e.name).join(', '); }
  // Text typed in a legacy Indic font stores keystrokes, not letters: new characters would show as the wrong glyphs.
  if((name==='set_text'&&args.content!=null)||(name==='set_font'&&args.fontFamily)){ const legacy=els.filter(e=>e.text?.encoding==='legacy'); if(legacy.length){ const e=legacy[0]; const sc=e.meta?.legacyScript||'Indic'; return {scene,result:`${legacy.map(x=>x.name).join(', ')} is typed in a legacy ${sc} font (${e.text.fontFamily}); letters typed here would show as the wrong characters, so its words and font cannot be changed in this tool. Size, colour and position can. Ask the designer to retype it, or convert the creative to Unicode fonts.`}; } }
  switch(name){
    case 'set_text':{ const t=els.filter(e=>e.type==='text'); if(!t.length) return {scene,result:`${names} is not text`}; const set={text:{}}; if(args.content!=null) set.text.content=String(args.content).replace(/\\n/g,'\n'); if(args.fontSize) set.text.fontSize=args.fontSize; if(args.align) set.text.align=args.align;
      const lh=e=>args.fontSize&&e.text.lineHeight?{lineHeight:Math.round(e.text.lineHeight*args.fontSize/e.text.fontSize*100)/100}:{};
      return {scene:applyOps(scene,t.map(e=>({id:e.id,set:{text:{...set.text,...lh(e)}}}))),result:`Updated text of ${t.map(e=>e.name).join(', ')}`}; }
    case 'set_fill':{ const pick=els.length>1?(els.find(e=>e.type!=='text')||els[0]):els[0]; const set={fill:args.color}; if(pick.type!=='text') set.renderMode='css';
      return {scene:applyOps(scene,[{id:pick.id,set}]),result:`${pick.name} → ${args.color}`}; }
    case 'move_element':{ const e=els[0]; const dx=args.x!=null?args.x-e.bounds.x:(args.dx||0), dy=args.y!=null?args.y-e.bounds.y:(args.dy||0);
      return {scene:applyOps(scene,groupOf(scene,e).map(m=>({id:m.id,set:{bounds:{x:m.bounds.x+dx,y:m.bounds.y+dy}}}))),result:`Moved ${e.name} by ${Math.round(dx)},${Math.round(dy)}`}; }
    case 'resize_element':{ const e=els[0]; const w=args.width??e.bounds.width, h=args.height??e.bounds.height; const set={bounds:{width:w,height:h}}; if(e.text&&args.scaleText) set.text={fontSize:e.text.fontSize*w/e.bounds.width,...(e.text.lineHeight?{lineHeight:e.text.lineHeight*w/e.bounds.width}:{})};
      return {scene:applyOps(scene,[{id:e.id,set}]),result:`Resized ${e.name} to ${Math.round(w)}×${Math.round(h)}`}; }
    case 'set_visibility':{ const all=els.flatMap(e=>groupOf(scene,e)); return {scene:applyOps(scene,all.map(m=>({id:m.id,set:{visible:!!args.visible}}))),result:`${args.visible?'Showing':'Hid'} ${names}`}; }
    case 'set_role': return {scene:applyOps(scene,els.map(e=>({id:e.id,set:{role:args.role}}))),result:`${names} → ${args.role}`};
    case 'set_font':{ const t=els.filter(e=>e.type==='text'); if(!t.length) return {scene,result:`${names} is not text`}; const set={text:{}}; if(args.fontFamily) set.text.fontFamily=args.fontFamily; if(args.fontStyle) set.text.fontStyle=args.fontStyle;
      return {scene:applyOps(scene,t.map(e=>({id:e.id,set}))),result:`Font of ${t.map(e=>e.name).join(', ')} → ${[args.fontFamily,args.fontStyle].filter(Boolean).join(' ')}`}; }
    case 'set_order': return {scene:applyOps(scene,reorderOps(scene,els.map(e=>e.id),args.action)),result:`${names} → ${args.action}`};
    case 'duplicate_element':{ const out=duplicateElements(scene,els.flatMap(e=>groupOf(scene,e)).map(e=>e.id)); return {scene:out.scene,result:`Duplicated ${names} (new ids: ${out.ids.join(', ')})`}; }
    case 'delete_element':{ const all=[...new Map(els.flatMap(e=>groupOf(scene,e)).map(e=>[e.id,e])).values()]; return {scene:deleteElements(scene,all.map(e=>e.id)),result:`Deleted ${all.map(e=>e.name).join(', ')}`}; }
    case 'set_lock': return {scene:applyOps(scene,els.map(e=>({id:e.id,set:{locked:!!args.locked}}))),result:`${args.locked?'Locked':'Unlocked'} ${names}`};
    default: return {scene,result:`Unknown tool ${name}`}; } }

export const summarize=scene=>scene.elements.filter(e=>e.type!=='group').map(e=>({id:e.id,name:e.name,type:e.type,role:e.role,text:e.text?.content,font:e.text?[e.text.fontFamily,e.text.fontStyle].filter(Boolean).join(' '):undefined,fontSize:e.text?.fontSize,fill:e.fill,visible:e.visible,locked:e.locked||undefined,bounds:e.bounds,group:e.semanticGroup||undefined,encoding:e.text?.encoding||undefined,note:e.text?.encoding==='legacy'?`typed in a legacy ${e.meta?.legacyScript||'Indic'} font: do not rewrite or translate`:undefined}));
