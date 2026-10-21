import {useEffect,useRef,useState,type RefObject} from 'react';
import {frameAt,type TrackingFrame} from './StreamTrackingOverlay';
import type {ColorSeed,ColorEstimate,ColorSearchInput,SampleBox} from './colorSampleTracking';
import {pixelTrackingText,pixelText} from './pixelAppearanceText';
import type {Language} from '../types';
import {cachedCandidates} from './bboxSampleCache';

export function ColorSampleTracker({video,frames,seed,active,sessionKey,onEstimate,language='en',annotationSize=12}:{
  video:RefObject<HTMLVideoElement|null>;frames:RefObject<TrackingFrame[]>;seed:ColorSeed|null;active:boolean;sessionKey:number;
  onEstimate:(estimate:ColorEstimate|undefined)=>void;language?:Language;annotationSize?:number;
}) {
  const [estimate,setEstimate]=useState<ColorEstimate>();
  useEffect(()=>{
    setEstimate(undefined);onEstimate(undefined);
    const element=video.current;if(!active||!seed||!element)return;
    let closed=false,busy=false,halted=false,raf=0,lastClock=-Infinity,lastTime=-Infinity;
    let previous:ColorEstimate={box:seed.box,mode:'hold',similarity:1,reason:'weak',id:null,time:element.currentTime};
    setEstimate(previous);onEstimate(previous);
    const sample=document.createElement('canvas'),ctx=sample.getContext('2d',{willReadFrequently:true});
    let worker:Worker,timer:ReturnType<typeof setTimeout>|undefined;
    const fail=()=>{halted=true;busy=false;clearTimeout(timer);worker?.terminate();if(!closed){previous={...previous,mode:'hold',reason:'weak'};setEstimate(previous);onEstimate(previous);}};
    try{if(!ctx)throw new Error('No canvas');worker=new Worker(new URL('./colorSampleTracking.worker.ts',import.meta.url),{type:'module'});}catch{fail();return;}
    worker.onmessage=(event:MessageEvent<{result?:ColorEstimate;error?:string}>)=>{
      busy=false;clearTimeout(timer);if(closed)return;
      const next=event.data.result;if(!next){fail();return;}
      if(Math.abs(element.currentTime-next.time)>.6)return;
      previous=next;setEstimate(next);onEstimate(next);
    };
    worker.onerror=fail;
    const capture=(force=false)=>{
      if(closed||halted||busy||element.readyState<2||element.seeking||!element.videoWidth)return;
      const now=performance.now(),time=element.currentTime;
      if(!force&&(time===lastTime||now-lastClock<250))return;
      lastClock=now;lastTime=time;
      const scale=Math.min(1,240/Math.max(element.videoWidth,element.videoHeight));
      const width=Math.max(3,Math.round(element.videoWidth*scale)),height=Math.max(3,Math.round(element.videoHeight*scale));
      sample.width=width;sample.height=height;
      try{
        ctx!.drawImage(element,0,0,width,height);const rgba=ctx!.getImageData(0,0,width,height).data;
        const frame=frameAt(frames.current,time);
        const candidates=(frame?cachedCandidates(frame,seed.classId):[]).map(o=>({id:o.id,classId:o.class_id,detection_index:o.detection_index,features:o.features,cache_id:o.cache_id,box:[o.box[0]/frame!.width,o.box[1]/frame!.height,o.box[2]/frame!.width,o.box[3]/frame!.height] as SampleBox}));
        const input:ColorSearchInput={rgba,width,height,seed,previous,candidates,time};
        busy=true;timer=setTimeout(fail,8000);worker.postMessage(input,[rgba.buffer]);
      }catch{fail();}
    };
    const tick=()=>{capture();raf=requestAnimationFrame(tick);};
    const refresh=()=>capture(true);element.addEventListener('pause',refresh);tick();
    return()=>{closed=true;clearTimeout(timer);worker.terminate();cancelAnimationFrame(raf);element.removeEventListener('pause',refresh);sample.width=sample.height=0;};
  },[video,frames,seed,active,sessionKey,onEstimate]);
  if(!active||!seed||!estimate)return null;
  const [x1,y1,x2,y2]=estimate.box;
  const w=video.current?.videoWidth??640,h=video.current?.videoHeight??360,font=annotationSize*w/(video.current?.parentElement?.clientWidth||w);
  return <svg className="stream-color-sample-overlay" viewBox={`0 0 ${w} ${h}`} aria-label={pixelTrackingText(language,'title')}>
    <rect x={x1*w} y={y1*h} width={(x2-x1)*w} height={(y2-y1)*h} strokeDasharray={estimate.mode==='hold'?'8 5':undefined} data-color-sample-mode={estimate.mode}/>
    <text style={{fontSize:font}} x={Math.max(4,x1*w)} y={Math.max(font+2,y1*h-5)}>{seed.name} · {pixelTrackingText(language,estimate.mode)} · {pixelText(language,'score')} {(estimate.similarity*100).toFixed(0)}%</text>
  </svg>;
}
