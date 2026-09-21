// Export Hypergro Scene.jsx  v1.0
// Illustrator → scene bundle (scene.json + reference renders + assets/).
// Run with the .ai open: File > Scripts > Other Script…  Pick an output folder.
// Name an Illustrator item "#headline", "#cta", "#logo" … to force its role.
#target illustrator
(function(){
  var ASSET_SCALE=2, MAX_GROUP_PATHS=400, VERSION='1.0';
  if(!app.documents.length){ alert('Open an .ai document first.'); return; }
  var doc=app.activeDocument;
  var out=Folder.selectDialog('Choose where to save the scene bundle'); if(!out) return;
  var base=doc.name.replace(/\.[^.]+$/,'').replace(/[^\w\-]+/g,'-');
  var root=new Folder(out.fsName+'/'+base+'-scene'); if(!root.exists) root.create();
  var assetsDir=new Folder(root.fsName+'/assets'); if(!assetsDir.exists) assetsDir.create();

  // ---------- helpers
  function pad(n){ return (n<10?'00':n<100?'0':'')+n; }
  var counter=0; function nextId(p){ return p+'_'+pad(++counter); }
  function r2(n){ return Math.round(n*100)/100; }
  function hex2(n){ n=Math.max(0,Math.min(255,Math.round(n))); var s=n.toString(16); return s.length<2?'0'+s:s; }
  function rgbHex(r,g,b){ return ('#'+hex2(r)+hex2(g)+hex2(b)).toUpperCase(); }
  function colorHex(c){ if(!c) return null; try{ switch(c.typename){
    case 'RGBColor': return rgbHex(c.red,c.green,c.blue);
    case 'CMYKColor': return rgbHex(255*(1-c.cyan/100)*(1-c.black/100),255*(1-c.magenta/100)*(1-c.black/100),255*(1-c.yellow/100)*(1-c.black/100));
    case 'GrayColor': var v=255*(1-c.gray/100); return rgbHex(v,v,v);
    case 'SpotColor': return colorHex(c.spot.color);
    case 'GradientColor': return colorHex(c.gradient.gradientStops[0].color);
    default: return null; } }catch(e){ return null; } }
  function gradientInfo(c){ if(!c||c.typename!=='GradientColor') return null; try{ var g=c.gradient, stops=[]; for(var i=0;i<g.gradientStops.length;i++){ var s=g.gradientStops[i]; stops.push({offset:r2(s.rampPoint/100),color:colorHex(s.color),opacity:r2(s.opacity/100)}); } return {type:g.type===GradientType.RADIAL?'radial':'linear',angle:r2(c.angle),stops:stops}; }catch(e){ return null; } }
  function esc(s){ return String(s).replace(/[\\"\u0000-\u001f]/g,function(ch){ var m={'\\':'\\\\','"':'\\"','\n':'\\n','\r':'\\r','\t':'\\t'}; return m[ch]||'\\u'+('000'+ch.charCodeAt(0).toString(16)).slice(-4); }); }
  function toJSON(v,ind){ ind=ind||''; var nx=ind+'  ';
    if(v===null||v===undefined) return 'null'; if(typeof v==='number') return isFinite(v)?String(v):'null'; if(typeof v==='boolean') return String(v); if(typeof v==='string') return '"'+esc(v)+'"';
    if(v instanceof Array){ if(!v.length) return '[]'; var a=[]; for(var i=0;i<v.length;i++) a.push(nx+toJSON(v[i],nx)); return '[\n'+a.join(',\n')+'\n'+ind+']'; }
    var k=[]; for(var key in v){ if(v.hasOwnProperty(key)&&v[key]!==undefined&&typeof v[key]!=='function') k.push(nx+'"'+esc(key)+'": '+toJSON(v[key],nx)); } return k.length?'{\n'+k.join(',\n')+'\n'+ind+'}':'{}'; }
  function rotationOf(item){ try{ var m=item.matrix; return r2(-Math.atan2(m.mValueB,m.mValueA)*180/Math.PI)||0; }catch(e){ return 0; } }
  function roleFromName(name){ var m=/(^|\s)#([a-z]+)/i.exec(name||''); return m?m[2].toLowerCase():null; }
  function cleanName(name){ return (name||'').replace(/(^|\s)#[a-z]+/ig,'').replace(/^\s+|\s+$/g,''); }

  // ---------- artboards
  var artboards=[]; var ab0=doc.artboards[0].artboardRect;
  for(var i=0;i<doc.artboards.length;i++){ var ab=doc.artboards[i], r=ab.artboardRect;
    artboards.push({id:i,name:ab.name,left:r[0],top:r[1],x:r2(r[0]-ab0[0]),y:r2(ab0[1]-r[1]),width:r2(r[2]-r[0]),height:r2(r[1]-r[3]),reference:'reference-'+i+'.png'}); }
  var activeIdx=doc.artboards.getActiveArtboardIndex(); var active=artboards[activeIdx];
  function artboardFor(item){ var b=item.visibleBounds, cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2;
    for(var i=0;i<artboards.length;i++){ var a=artboards[i]; if(cx>=a.left&&cx<=a.left+a.width&&cy<=a.top&&cy>=a.top-a.height) return a; } return active; }
  function boundsOf(item,ab){ var b=item.visibleBounds; return {x:r2(b[0]-ab.left),y:r2(ab.top-b[1]),width:r2(b[2]-b[0]),height:r2(b[1]-b[3])}; }

  // reference renders (visual ground truth per artboard)
  for(var ri=0;ri<doc.artboards.length;ri++){ doc.artboards.setActiveArtboardIndex(ri);
    var ro=new ExportOptionsPNG24(); ro.artBoardClipping=true; ro.antiAliasing=true; ro.transparency=false; ro.horizontalScale=ro.verticalScale=100;
    doc.exportFile(new File(root.fsName+'/reference-'+ri+'.png'),ExportType.PNG24,ro); }
  doc.artboards.setActiveArtboardIndex(activeIdx);

  // ---------- asset export: duplicate the item alone into a temp document sized to its bounds
  var assetList=[];
  function withUnlocked(item,fn){ var wasLocked=false; try{ wasLocked=item.locked; if(wasLocked) item.locked=false; }catch(e){} try{ return fn(); } finally{ try{ if(wasLocked) item.locked=true; }catch(e){} } }
  function exportItem(item,name,svgToo){ var b=item.visibleBounds, w=Math.ceil(b[2]-b[0]), h=Math.ceil(b[1]-b[3]); if(w<1||h<1) return {};
    var tmp=app.documents.add(DocumentColorSpace.RGB,w,h); var res={};
    try{ var dup=withUnlocked(item,function(){ return item.duplicate(tmp.layers[0],ElementPlacement.PLACEATEND); });
      var ar=tmp.artboards[0].artboardRect, vb=dup.visibleBounds; dup.translate(ar[0]-vb[0],ar[1]-vb[1]);
      var po=new ExportOptionsPNG24(); po.transparency=true; po.artBoardClipping=true; po.antiAliasing=true; po.horizontalScale=po.verticalScale=ASSET_SCALE*100;
      tmp.exportFile(new File(assetsDir.fsName+'/'+name+'.png'),ExportType.PNG24,po); res.asset='assets/'+name+'.png'; assetList.push({path:res.asset,type:'image/png',scale:ASSET_SCALE,width:w*ASSET_SCALE,height:h*ASSET_SCALE});
      if(svgToo){ var so=new ExportOptionsSVG(); so.embedRasterImages=true; so.fontType=SVGFontType.OUTLINEFONT; so.coordinatePrecision=3; so.cssProperties=SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;
        tmp.exportFile(new File(assetsDir.fsName+'/'+name+'.svg'),ExportType.SVG,so); res.assetSvg='assets/'+name+'.svg'; assetList.push({path:res.assetSvg,type:'image/svg+xml'}); } }
    catch(e){ res.error=String(e); }
    finally{ tmp.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument=doc; }
    return res; }

  // ---------- text
  function textInfo(tf){ var ca=tf.textRange.characterAttributes; var font=null; try{ font=ca.textFont; }catch(e){}
    var lead=null; try{ lead=ca.autoLeading?null:ca.leading; }catch(e){}
    var just='left'; try{ var j=tf.paragraphs[0].paragraphAttributes.justification; just=j===Justification.CENTER?'center':j===Justification.RIGHT?'right':(j===Justification.FULLJUSTIFY||j===Justification.FULLJUSTIFYLASTLINELEFT||j===Justification.FULLJUSTIFYLASTLINECENTER||j===Justification.FULLJUSTIFYLASTLINERIGHT)?'justify':'left'; }catch(e){}
    var kind='point'; try{ kind=tf.kind===TextType.AREATEXT?'area':tf.kind===TextType.PATHTEXT?'path':'point'; }catch(e){}
    var mixed=false; try{ var n=tf.characters.length; if(n>1){ var a=tf.characters[0].characterAttributes, z=tf.characters[n-1].characterAttributes; mixed=a.size!==z.size||a.textFont.name!==z.textFont.name||colorHex(a.fillColor)!==colorHex(z.fillColor); } }catch(e){}
    var size=0; try{ size=ca.size; }catch(e){}
    var tracking=0; try{ tracking=ca.tracking||0; }catch(e){}
    return { content:tf.contents, fontFamily:font?font.family:null, fontStyle:font?font.style:null, postScriptName:font?font.name:null, fontSize:r2(size), lineHeight:lead!==null?r2(lead):null, letterSpacing:r2(tracking/1000*size), align:just, kind:kind, mixed:mixed, _fill:colorHex(ca.fillColor) }; }
  var fonts={}, fontList=[];
  function noteFont(t){ if(!t.postScriptName||fonts[t.postScriptName]) return; fonts[t.postScriptName]=1; fontList.push({family:t.fontFamily,style:t.fontStyle,postScriptName:t.postScriptName}); }

  // ---------- vectors
  function isRect(p){ try{ if(p.pathPoints.length!==4||!p.closed) return false; for(var i=0;i<4;i++){ var a=p.pathPoints[i].anchor, b=p.pathPoints[(i+1)%4].anchor; if(Math.abs(a[0]-b[0])>.5&&Math.abs(a[1]-b[1])>.5) return false; } return true; }catch(e){ return false; } }
  function pathOnlyCount(g){ var n=0; for(var i=0;i<g.pageItems.length;i++){ var it=g.pageItems[i], t=it.typename; if(t==='PathItem'||t==='CompoundPathItem') n++; else if(t==='GroupItem'){ var c=pathOnlyCount(it); if(c<0) return -1; n+=c; } else return -1; } return n; }
  function firstFilled(g){ for(var i=0;i<g.pageItems.length;i++){ var it=g.pageItems[i]; if(it.typename==='PathItem'&&it.filled) return colorHex(it.fillColor); if(it.typename==='CompoundPathItem'&&it.pathItems.length&&it.pathItems[0].filled) return colorHex(it.pathItems[0].fillColor); if(it.typename==='GroupItem'){ var c=firstFilled(it); if(c) return c; } } return null; }

  // ---------- walk
  var elements=[], z=0, errors=[];
  function common(item,ab,type,parentId,layerName){ var nm=item.name||''; var op=100; try{ op=item.opacity; }catch(e){} var bm='normal'; try{ bm=String(item.blendingMode).replace('BlendModes.','').toLowerCase(); }catch(e){}
    return { id:nextId(type==='group'?'group':'el'), type:type, name:cleanName(nm), parentId:parentId, artboardId:ab.id, zIndex:z++, bounds:boundsOf(item,ab), transform:{rotation:rotationOf(item),scaleX:1,scaleY:1}, opacity:r2(op/100), blendMode:bm, editable:type!=='group', locked:!!item.locked, visible:!item.hidden, role:roleFromName(nm), meta:{layer:layerName} }; }
  function walk(item,parentId,layerName){ var t=item.typename; if(item.hidden) return; if(t==='PathItem'&&item.guides) return; var ab=artboardFor(item), e;
    if(t==='GroupItem'){ var n=pathOnlyCount(item);
      if(n>0&&n<=MAX_GROUP_PATHS&&item.pageItems.length>1&&!item.clipped){ e=common(item,ab,'vector',parentId,layerName); e.name=e.name||('Vector group · '+n+' paths'); e.meta.pathCount=n; e.meta.collapsedGroup=true; e.fill=firstFilled(item); var ex=exportItem(item,'vector-'+e.id,true); e.asset=ex.asset||null; e.assetSvg=ex.assetSvg||null; if(ex.error) errors.push(e.id+': '+ex.error); elements.push(e); return; }
      var g=common(item,ab,'group',parentId,layerName); g.name=g.name||'Group'; g.meta.clipped=!!item.clipped; elements.push(g);
      for(var i=item.pageItems.length-1;i>=0;i--){ var ch=item.pageItems[i]; if(item.clipped&&ch.typename==='PathItem'&&ch.clipping){ g.clip=boundsOf(ch,ab); continue; } walk(ch,g.id,layerName); } return; }
    if(t==='TextFrame'){ e=common(item,ab,'text',parentId,layerName); var ti=textInfo(item); e.fill=ti._fill; delete ti._fill; e.text=ti; noteFont(ti); e.name=e.name||ti.content.replace(/\s+/g,' ').substring(0,24); elements.push(e); return; }
    if(t==='PlacedItem'||t==='RasterItem'){ e=common(item,ab,'image',parentId,layerName); e.name=e.name||(t==='PlacedItem'?'Placed image':'Embedded image'); var ex=exportItem(item,'image-'+e.id,false); e.asset=ex.asset||null; if(ex.error) errors.push(e.id+': '+ex.error);
      e.meta.embedded=t==='RasterItem'; if(t==='PlacedItem'){ try{ e.meta.source=item.file.fsName; }catch(x){ e.meta.source=null; } } elements.push(e); return; }
    if(t==='PathItem'||t==='CompoundPathItem'||t==='SymbolItem'||t==='MeshItem'||t==='PluginItem'||t==='GraphItem'||t==='NonNativeItem'){ e=common(item,ab,'vector',parentId,layerName); e.name=e.name||t.replace('Item','');
      var p=t==='CompoundPathItem'?(item.pathItems.length?item.pathItems[0]:null):(t==='PathItem'?item:null);
      if(p){ e.fill=p.filled?colorHex(p.fillColor):null; e.gradient=p.filled?gradientInfo(p.fillColor):null; e.stroke=p.stroked?{color:colorHex(p.strokeColor),width:r2(p.strokeWidth)}:null; e.meta.kind=t==='PathItem'?(isRect(p)?'rect':'path'):'compound'; } else e.meta.kind=t;
      var ex=exportItem(item,'vector-'+e.id,true); e.asset=ex.asset||null; e.assetSvg=ex.assetSvg||null; if(ex.error) errors.push(e.id+': '+ex.error); elements.push(e); return; }
    if(t==='LegacyTextItem'){ errors.push('Legacy text skipped: '+(item.name||'')); } }
  function walkLayer(L,parentId){ if(!L.visible) return; var wasLocked=L.locked; if(wasLocked) L.locked=false;
    var kids=[]; var i; for(i=0;i<L.layers.length;i++) kids.push({o:L.layers[i],layer:true,z:L.layers[i].zOrderPosition}); for(i=0;i<L.pageItems.length;i++) kids.push({o:L.pageItems[i],layer:false,z:L.pageItems[i].zOrderPosition});
    kids.sort(function(a,b){ return a.z-b.z; }); // bottom → top
    for(i=0;i<kids.length;i++){ if(kids[i].layer) walkLayer(kids[i].o,parentId); else walk(kids[i].o,parentId,L.name); }
    if(wasLocked) L.locked=true; }
  for(var li=doc.layers.length-1;li>=0;li--) walkLayer(doc.layers[li],null);

  // ---------- write
  var abOut=[]; for(var ai=0;ai<artboards.length;ai++){ var a=artboards[ai]; abOut.push({id:a.id,name:a.name,x:a.x,y:a.y,width:a.width,height:a.height,reference:a.reference}); }
  var scene={ version:VERSION, generator:'Export Hypergro Scene.jsx '+VERSION,
    source:{ file:(function(){ try{ return doc.fullName.fsName; }catch(e){ return doc.name; } })(), colorSpace:String(doc.documentColorSpace).replace('DocumentColorSpace.',''), units:'pt', exportedAt:new Date().toString(), illustrator:app.version },
    document:{ name:base, width:active.width, height:active.height, activeArtboard:active.id, artboards:abOut },
    fonts:fontList, assets:assetList, elements:elements, warnings:errors };
  var f=new File(root.fsName+'/scene.json'); f.encoding='UTF-8'; f.lineFeed='Unix'; f.open('w'); f.write(toJSON(scene)); f.close();
  alert('Scene exported\n\n'+root.fsName+'\n\n'+elements.length+' elements · '+assetList.length+' assets · '+fontList.length+' fonts'+(errors.length?'\n'+errors.length+' warnings (see scene.json → warnings)':''));
})();
