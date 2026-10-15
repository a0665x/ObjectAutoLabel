import {useEffect,useRef,type RefObject} from 'react';
import {createFlowWorker} from './opticalFlowWorker';
import {drawOpticalFlow} from './opticalFlowDraw';
import {makeFlowGrid,summarizeFlow,type FlowPoint,type FlowSettings,type FlowSnapshot,type FlowSummary} from './opticalFlowModel';

/** Analyze decoded playback pixels, never detector IDs or inference-ahead frames. */
export function StreamOpticalFlowOverlay({video,settings,active,fps,sessionKey,resetKey,onSummary}:{
  video:RefObject<HTMLVideoElement|null>;settings:FlowSettings;active:boolean;fps:number;sessionKey:number;resetKey:number;
  onSummary:(summary:FlowSummary|undefined)=>void;
}) {
  const canvas=useRef<HTMLCanvasElement>(null),snapshot=useRef<FlowSnapshot|undefined>(undefined);
  const view=useRef(settings);view.current=settings;
  const nominalFps=useRef(fps);nominalFps.current=fps;
  const analysisKey=JSON.stringify([settings.cols,settings.rows,settings.quality,settings.radius,settings.threshold]);
  useEffect(()=>{
    snapshot.current=undefined;onSummary(undefined);
    const element=video.current,overlay=canvas.current;
    if(!active||!settings.enabled||!element||!overlay)return;
    let closed=false,halted=false,busy=false,queued=false,needsReset=true,revision=0;
    let lastTime:number|null=null,lastCaptured=-Infinity,lastPresented=NaN,lastPublished=-Infinity;
    let points:FlowPoint[]=[],frameId=0,rafId=0;
    const sample=document.createElement('canvas'),ctx=sample.getContext('2d',{willReadFrequently:true});
    const fail=()=>{
      halted=true;overlay.getContext('2d')?.clearRect(0,0,overlay.width,overlay.height);
      onSummary({state:'error',valid:0,total:settings.cols*settings.rows,motion:0,speed:0,angle:null,dt:0,time:0,ms:0,width:0,height:0});
    };
    let worker:ReturnType<typeof createFlowWorker>;
    try{if(!ctx)throw new Error('Canvas unavailable');worker=createFlowWorker();}catch{fail();return;}
    async function capture() {
      if(closed||halted||element!.readyState<2||element!.seeking||!element!.videoWidth)return;
      if(busy){queued=true;return;}
      const time=Number.isFinite(lastPresented)?lastPresented:element!.currentTime;
      if(Math.abs(time-lastCaptured)<.00001)return;
      const scale=Math.min(1,settings.quality/Math.max(element!.videoWidth,element!.videoHeight));
      const w=Math.max(16,Math.round(element!.videoWidth*scale)),h=Math.max(16,Math.round(element!.videoHeight*scale));
      const maxGap=Math.max(.5,3/Math.max(1,nominalFps.current));
      const reset=needsReset||lastTime===null||time<=lastTime||time-lastTime>maxGap||sample.width!==w||sample.height!==h;
      if(sample.width!==w)sample.width=w;if(sample.height!==h)sample.height=h;
      const working=reset?makeFlowGrid(w,h,settings.cols,settings.rows):points.map(p=>p.valid===false?{...p,x:p.sx,y:p.sy,trail:[]}:p);
      const began=performance.now(),version=revision;
      busy=true;lastCaptured=time;needsReset=false;
      try {
        ctx!.drawImage(element!,0,0,w,h);
        const rgba=ctx!.getImageData(0,0,w,h).data,gray=new Float32Array(w*h);
        for(let i=0,j=0;i<gray.length;i++,j+=4)gray[i]=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];
        const result=await worker.analyze({gray,w,h,points:working.map(p=>({x:p.x,y:p.y})),reset,radius:settings.radius,threshold:settings.threshold});
        if(closed||version!==revision)return;
        // Do not leave a slow, stale result over unrelated playback pixels.
        if(element!.currentTime-time>maxGap*2){needsReset=true;onSummary(undefined);overlay!.getContext('2d')?.clearRect(0,0,overlay!.width,overlay!.height);return;}
        points=working.map((p,i)=>{
          const r=result[i],trail=r.valid===false?[]:[...p.trail,[r.x,r.y]].slice(-view.current.trailLength);
          return {...p,...r,trail};
        });
        const frame:FlowSnapshot={time,dt:reset?0:time-lastTime!,w,h,videoWidth:element!.videoWidth,videoHeight:element!.videoHeight,points,ms:performance.now()-began};
        snapshot.current=frame;lastTime=time;drawOpticalFlow(overlay!,frame,view.current);
        if(reset||element!.paused||performance.now()-lastPublished>=200){lastPublished=performance.now();onSummary(summarizeFlow(frame));}
      }catch{if(!closed)fail();}
      finally{busy=false;if(queued&&!closed&&!halted){queued=false;queueMicrotask(()=>void capture());}}
    }
    const tick:VideoFrameRequestCallback=(_now,metadata)=>{
      if(closed)return;lastPresented=metadata.mediaTime;void capture();frameId=element.requestVideoFrameCallback(tick);
    };
    const fallback=()=>{
      if(closed)return;
      if(Math.abs(element.currentTime-lastCaptured)>=.9/Math.max(1,nominalFps.current)){lastPresented=element.currentTime;void capture();}
      rafId=requestAnimationFrame(fallback);
    };
    const refresh=()=>{
      if(!Number.isFinite(lastPresented))lastPresented=element.currentTime;
      // A pause can land between throttled UI updates without a new video frame.
      if(element.paused&&snapshot.current)onSummary(summarizeFlow(snapshot.current));
      void capture();
    };
    const reset=()=>{
      revision++;needsReset=true;lastTime=null;lastCaptured=-Infinity;lastPresented=NaN;points=[];snapshot.current=undefined;
      overlay.getContext('2d')?.clearRect(0,0,overlay.width,overlay.height);onSummary(undefined);
    };
    element.addEventListener('loadeddata',refresh);element.addEventListener('pause',refresh);
    element.addEventListener('seeking',reset);element.addEventListener('seeked',refresh);
    if(typeof element.requestVideoFrameCallback==='function')frameId=element.requestVideoFrameCallback(tick);else fallback();
    refresh();
    return()=>{
      closed=true;worker.dispose();
      if(frameId)element.cancelVideoFrameCallback(frameId);if(rafId)cancelAnimationFrame(rafId);
      element.removeEventListener('loadeddata',refresh);element.removeEventListener('pause',refresh);
      element.removeEventListener('seeking',reset);element.removeEventListener('seeked',refresh);
      sample.width=sample.height=0;
    };
  },[active,settings.enabled,analysisKey,video,sessionKey,resetKey,onSummary]);
  useEffect(()=>{
    const frame=snapshot.current;
    if(active&&settings.enabled&&frame&&canvas.current){
      for(const p of frame.points)if(p.trail.length>settings.trailLength)p.trail.splice(0,p.trail.length-settings.trailLength);
      drawOpticalFlow(canvas.current,frame,settings);
    }
  },[settings,active]);
  return active&&settings.enabled?<canvas ref={canvas} className="stream-flow-overlay" aria-hidden="true"/>:null;
}
