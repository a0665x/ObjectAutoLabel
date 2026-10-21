import {useEffect,useRef,useState,type RefObject} from 'react';
import {frameAt,type TrackingFrame} from './StreamTrackingOverlay';
import {ParameterHelp} from './ParameterHelp';
import {appearanceSimilarity,cropBox,makePixelSample,PIXEL_LIMITS,type PixelResult,type PixelSample} from './pixelAppearance';
import {createPixelWorker} from './pixelAppearanceWorker';
import {pixelText,pixelColor,pixelColorName,pixelTrackingText} from './pixelAppearanceText';
import type {Language} from '../types';
import type {ColorSeed,ColorEstimate} from './colorSampleTracking';
import {cachedCandidates,snapshotPixels,type ReadBboxSample} from './bboxSampleCache';

type Report={time:number;total:number;items:PixelResult[];reference:PixelSample;current?:PixelResult;missingMetadata?:boolean;missingCache?:boolean};
function paint(canvas:HTMLCanvasElement|null,pixels:Uint8ClampedArray|undefined,w=1,h=1) {
  if(!canvas)return;canvas.width=w;canvas.height=h;
  if(pixels){const image=canvas.getContext('2d')?.createImageData(w,h);if(image){image.data.set(pixels);canvas.getContext('2d')?.putImageData(image,0,0);}}
}
function ColorBar({values,label,language}:{values:number[];label:string;language:Language}) {
  const summary=values.map((v,i)=>v?`${pixelColorName(language,i)} ${(v*100).toFixed(1)}%`:'').filter(Boolean).join(', ');
  const dominant=values.map((value,index)=>({value,index})).filter(v=>v.value>0).sort((a,b)=>b.value-a.value).slice(0,3).map(v=>`${pixelColorName(language,v.index)} ${(v.value*100).toFixed(1)}%`).join(' · ');
  return <div className="stream-pixel-distribution"><small>{label}</small><div className="stream-pixel-histogram" role="img" aria-label={`${label}: ${summary||'—'}`}>
    {values.map((v,i)=>v>0?<span key={i} title={`${pixelColorName(language,i)} ${(v*100).toFixed(1)}%`} style={{width:`${v*100}%`,background:pixelColor(i)}}/>:null)}
  </div><small>{dominant||'—'}</small></div>;
}

/** Detector evidence comes only from immutable pre-tracker crops, never playback pixels. */
export function SelectedPixelInspector({video,frames,selected,active,sessionKey,timeOffset=0,context,language='en',onSelect,colorSeed,colorEstimate,onColorResample,readBboxSample}:{
  video:RefObject<HTMLVideoElement|null>;frames:RefObject<TrackingFrame[]>;selected:string|null;active:boolean;sessionKey:number;
  timeOffset?:number;context?:Record<string,unknown>;language?:Language;onSelect?:(id:string,time:number)=>void;
  colorSeed?:ColorSeed|null;colorEstimate?:ColorEstimate;onColorResample?:()=>void;
  readBboxSample?:ReadBboxSample;
}) {
  const [report,setReport]=useState<Report>(),[error,setError]=useState(false);
  const live=useRef<HTMLCanvasElement>(null),edge=useRef<HTMLCanvasElement>(null),reference=useRef<PixelSample|undefined>(undefined);
  const sourceContext=useRef(context);sourceContext.current=context;
  const capturedContext=useRef(context);
  const forceCapture=useRef<(()=>void)|null>(null);
  const resampleRequested=useRef(false);
  const colorView=useRef(colorEstimate);colorView.current=colorEstimate;
  const t=(key:Parameters<typeof pixelText>[1])=>pixelText(language,key);
  useEffect(()=>{
    resampleRequested.current=false;
    const evidence=colorSeed?.evidence;
    setReport(undefined);setError(false);reference.current=colorSeed?makePixelSample(colorSeed.features,{id:colorSeed.token,classId:colorSeed.classId,name:colorSeed.name,time:colorSeed.time,width:colorSeed.width,height:colorSeed.height,box:[...colorSeed.box],cache_id:evidence?.cache_id,frame_index:evidence?.frame_index,detection_index:evidence?.detection_index,origin:evidence?.origin}):undefined;
    if(colorSeed)capturedContext.current={...sourceContext.current,box_coordinates:'normalized YOLO input',tracker:'color-sample-v1',sampling:'yolo-pre-tracker',image_size:evidence?[evidence.image_width,evidence.image_height]:undefined};
    paint(live.current,undefined);paint(edge.current,undefined);
    const element=video.current;
    if(!active||!selected||!element)return;
    let closed=false,busy=false,queued=false,unavailable=false,raf=0,lastTime=-Infinity,lastClock=-Infinity;
    let crop:HTMLCanvasElement|undefined,worker:ReturnType<typeof createPixelWorker>|undefined;
    async function capture(force=false) {
      if(closed||element!.readyState<2||element!.seeking||!element!.videoWidth)return;
      if(busy){if(force)queued=true;return;}
      const time=element!.currentTime,now=performance.now();
      if(!force&&(time===lastTime||now-lastClock<PIXEL_LIMITS.interval))return;
      const resampling=resampleRequested.current;resampleRequested.current=false;
      let frame=frameAt(frames.current,time);
      const estimate=colorView.current;
      // A color result can lag playback by a few detector frames. Its preview
      // and comparison cohort must follow its cache key, not recrop newer video.
      if(colorSeed&&estimate?.mode==='detection'&&Math.abs(time-estimate.time)<.6){
        frame=frames.current.find(f=>f.raw_detections?.some(o=>o.cache_id===estimate.cache_id))??frame;
      }
      if(!frame&&colorSeed&&colorView.current)frame={time,width:element!.videoWidth,height:element!.videoHeight,objects:[]};
      if(!frame){
        if(!unavailable){unavailable=true;paint(live.current,undefined);paint(edge.current,undefined);setReport(reference.current?{time:time+timeOffset,total:0,items:[],reference:reference.current,missingMetadata:true}:undefined);}
        return;
      }
      unavailable=false;
      const observed=frame.objects.find(o=>o.id===selected&&!o.predicted&&o.tracked!==false);
      const classId=reference.current?.source.classId??observed?.class_id;
      const candidates=classId===undefined?[]:cachedCandidates(frame,classId);
      const total=classId===undefined?0:frame.raw_detection_counts?.[String(classId)]??candidates.length;
      const target=colorSeed?candidates.find(o=>estimate?.mode==='detection'&&o.cache_id===estimate.cache_id):candidates.find(o=>o.id===selected);
      if(!reference.current&&!target){setError(Boolean(observed));return;}
      lastClock=now;lastTime=time;
      busy=true;
      try{
        let items:PixelResult[]=candidates.map(object=>({key:object.cache_id,object,source:object.crop_box,width:object.width,height:object.height,features:object.features}));
        let current:PixelResult|undefined,missingCache=Boolean(colorSeed&&estimate?.mode==='detection'&&!target);
        if(target){
          const object={...target,id:selected!,appearance_mode:colorSeed?'detection' as const:undefined};
          try{
            if(!readBboxSample)throw new Error('Cache unavailable');
            const sample=await readBboxSample(target.cache_id,!reference.current||resampling);
            if(closed)return;
            current=snapshotPixels(sample,object);
            if(!reference.current||resampling){
              reference.current=makePixelSample(sample.features,{id:selected!,classId:sample.class_id,name:sample.name,time:sample.media_time,width:sample.width,height:sample.height,box:sample.box,cache_id:sample.cache_id,frame_index:sample.frame_index,detection_index:sample.detection_index,origin:sample.origin});
              capturedContext.current={...sourceContext.current,box_coordinates:'YOLO input pixels',image_size:[sample.image_width,sample.image_height],sampling:sample.origin};
            }
          }catch{missingCache=true;current={key:target.cache_id,object,source:target.crop_box,width:target.width,height:target.height,features:target.features};}
          items=items.map(item=>item.key===target.cache_id?current!:item);
        }else if(colorSeed&&estimate&&estimate.mode!=='detection'&&Math.abs(time-estimate.time)<.6){
          // Image-only search is visibly distinct and can NEVER become a new reference.
          const b=estimate.box,box=[b[0]*frame.width,b[1]*frame.height,b[2]*frame.width,b[3]*frame.height];
          const source=cropBox(box,frame.width,frame.height,element!.videoWidth,element!.videoHeight);
          if(source){
            crop??=document.createElement('canvas');const ctx=crop.getContext('2d',{willReadFrequently:true});
            if(!ctx)throw new Error('Canvas unavailable');
            const scale=Math.min(1,80/Math.max(source[2],source[3])),width=Math.floor(source[2]*scale),height=Math.floor(source[3]*scale);
            if(width>=3&&height>=3){
              crop.width=width;crop.height=height;ctx.drawImage(element!,...source as [number,number,number,number],0,0,width,height);
              const object={id:selected!,box,score:estimate.similarity,class_id:colorSeed.classId,name:colorSeed.name,appearance_estimated:true,appearance_mode:estimate.mode};
              worker??=createPixelWorker();
              [current]=await worker.analyze([{key:selected!,object,source,width,height,rgba:ctx.getImageData(0,0,width,height).data}],selected!);
              if(current)items=[current,...items];
            }
          }
        }
        if(closed)return;
        if(element!.seeking||Math.abs(element!.currentTime-time)>Math.max(.5,(frame.dt_ms??250)/500)){setReport(undefined);paint(live.current,undefined);paint(edge.current,undefined);return;}
        if(!reference.current){setError(true);return;}
        paint(live.current,current?.rgba,current?.width,current?.height);paint(edge.current,current?.edges,current?.width,current?.height);
        setError(false);setReport({time:target?.media_time??time+timeOffset,total,items,reference:reference.current,current,missingCache});
      }catch{if(!closed){setError(true);paint(live.current,undefined);paint(edge.current,undefined);}}
      finally{busy=false;if(queued&&!closed){queued=false;void capture(true);}}
    }
    const tick=()=>{void capture();raf=requestAnimationFrame(tick);};
    const refresh=()=>void capture(true);
    forceCapture.current=refresh;
    element.addEventListener('pause',refresh);element.addEventListener('loadeddata',refresh);
    tick();
    return()=>{closed=true;forceCapture.current=null;worker?.dispose();cancelAnimationFrame(raf);element.removeEventListener('pause',refresh);element.removeEventListener('loadeddata',refresh);if(crop)crop.width=crop.height=0;};
  },[active,selected,sessionKey,video,frames,timeOffset,colorSeed,readBboxSample]);
  useEffect(()=>{if(colorSeed&&video.current?.paused)forceCapture.current?.();},[colorEstimate,colorSeed,video]);
  const rows=report?.items.filter(item=>!item.object.appearance_estimated).map(item=>({...item,match:appearanceSimilarity(report.reference.features,item.features)})).sort((a,b)=>b.match.score-a.match.score||a.key.localeCompare(b.key))??[];
  const rank=rows.findIndex(row=>row.object.id===selected),current=report?.current;
  function average(key:'colors'|'edgeColors') {
    const items=report?.items.filter(item=>!item.object.appearance_estimated&&(key==='colors'||item.features.edgePixels>0))??[];
    return Array.from({length:15},(_,i)=>items.length?items.reduce((sum,item)=>sum+item.features[key][i],0)/items.length:0);
  }
  return <section className="stream-pixel-inspector" aria-label={t('title')}>
    <div className="stream-field-heading"><strong>{t('title')}</strong><ParameterHelp label={t('title')} help={t('help')} language={language}/></div>
    {!active||!selected?<p className="muted">{t('hint')}</p>:<>
      <p className="muted" role="status">{error||report?.missingCache?t('cacheExpired'):!report?t('waiting'):report.missingMetadata?t('sync'):!current?t('lost'):current.object.appearance_mode?`${pixelTrackingText(language,current.object.appearance_mode)} · t ${report.time.toFixed(3)} s`:`${current.object.name} #${selected} · t ${report.time.toFixed(3)} s`}</p>
      <div className="stream-pixel-previews"><figure><canvas ref={live} aria-label={t(current?.object.appearance_estimated?'estimatedCrop':'crop')}/><figcaption>{t(current?.object.appearance_estimated?'estimatedCrop':'crop')}</figcaption></figure><figure><canvas ref={edge} aria-label={t('contour')}/><figcaption>{t('contour')}</figcaption></figure></div>
      {report&&<>
        <label>{t('index')}<code className="stream-pixel-index" data-pixel-index={report.reference.index}>{report.reference.index}</code></label>
        <small>{report.reference.source.name} #{report.reference.source.id} · t {report.reference.source.time.toFixed(3)} s · {report.reference.version}</small>
        {report.reference.source.origin&&<small data-sample-origin={report.reference.source.origin}>{t('locked')} · frame {report.reference.source.frame_index} · bbox {report.reference.source.detection_index}</small>}
        <dl className="stream-pixel-stats"><div><dt>{t('analyzed')}</dt><dd>{rows.filter(row=>!row.object.appearance_estimated).length} / {report.total}</dd></div><div><dt>{t('rank')}</dt><dd>{rank>=0?`${rank+1} / ${rows.length}`:'—'}</dd></div>
          {current&&<><div><dt>{t('pixels')}</dt><dd>{current.features.pixels} / {current.features.edgePixels}</dd></div><div><dt>{t('variance')}</dt><dd>{current.features.laplacianVariance.toFixed(1)}</dd></div></>}
        </dl>
        {current&&<><strong>{t('colors')}</strong><ColorBar values={current.features.colors} label={t('selected')} language={language}/><ColorBar values={average('colors')} label={t('average')} language={language}/>
          <strong>{t('edges')}</strong><ColorBar values={current.features.edgeColors} label={t('selected')} language={language}/><ColorBar values={average('edgeColors')} label={t('average')} language={language}/></>}
        <details><summary>{t('comparisons')} ({rows.length})</summary><div className="stream-pixel-table"><table><thead><tr><th>ID</th><th>{t('colorScore')}</th><th>{t('score')}</th></tr></thead><tbody>{rows.map((row,i)=><tr key={row.key} aria-current={row.object.id===selected?'true':undefined}><td>{onSelect&&row.object.id&&row.object.tracked!==false?<button type="button" className="secondary" aria-label={`${t('choose')} #${row.object.id}`} disabled={row.object.id===selected} onClick={()=>onSelect(row.object.id!,report.time-timeOffset)}>{i+1}. {row.object.id}</button>:<>{i+1}. {row.object.id??`D${row.object.detection_index}`}</>}</td><td>{(row.match.color*100).toFixed(0)} / {row.match.edge===null?'—':(row.match.edge*100).toFixed(0)}</td><td>{(row.match.score*100).toFixed(1)}%</td></tr>)}</tbody></table></div></details>
      </>}
      <div className="stream-pixel-actions"><button type="button" className="secondary" disabled={Boolean(colorSeed&&(colorEstimate?.mode!=='detection'||!colorEstimate.cache_id||!current||report?.missingCache))} onClick={()=>{if(colorSeed)onColorResample?.();else{resampleRequested.current=true;forceCapture.current?.();}}}>{t('resample')}</button><button type="button" className="secondary" disabled={!report} onClick={()=>{
        if(!report)return;
        const data={...report.reference,context:capturedContext.current,color_estimate:colorSeed?colorView.current:undefined,comparison:{time:report.time,total:report.total,analyzed:rows.length,rows:rows.map(row=>({id:row.object.id,detection_index:row.object.detection_index,appearance_estimated:row.object.appearance_estimated??false,...row.match}))}};
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${report.reference.index}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>{t('export')}</button></div>
      <small>{t('limits')}</small>
    </>}
  </section>;
}
