import type {FlowResult} from './opticalFlowCore';

export type FlowSettings = {enabled:boolean;cols:number;rows:number;gain:number;trailLength:number;showTrails:boolean;showGrid:boolean;showPoints:boolean;
  vector:'flow'|'gradient';color:'magnitude'|'speed'|'direction'|'gradient'|'confidence';quality:number;radius:number;threshold:number};
export const defaultFlowSettings:FlowSettings={enabled:false,cols:12,rows:12,gain:3,trailLength:30,showTrails:true,showGrid:false,showPoints:true,vector:'flow',color:'magnitude',quality:640,radius:5,threshold:3};
export type FlowPoint=FlowResult&{sx:number;sy:number;trail:number[][]};
export type FlowSnapshot={time:number;dt:number;w:number;h:number;videoWidth:number;videoHeight:number;points:FlowPoint[];ms:number};
export type FlowSummary={state:'reference'|'measured'|'error';valid:number;total:number;motion:number;speed:number;angle:number|null;dt:number;time:number;ms:number;width:number;height:number};

export function flowUnits(p:FlowResult,frame:Pick<FlowSnapshot,'w'|'h'|'videoWidth'|'videoHeight'|'dt'>) {
  const sx=frame.videoWidth/frame.w,sy=frame.videoHeight/frame.h,dx=p.dx*sx,dy=p.dy*sy,gx=p.gx/sx,gy=p.gy/sy;
  return {dx,dy,magnitude:Math.hypot(dx,dy),speed:frame.dt>0?Math.hypot(dx,dy)/frame.dt:0,
    direction:(Math.atan2(dy,dx)*180/Math.PI+360)%360,gx,gy,gradient:Math.hypot(gx,gy)};
}
export function summarizeFlow(frame:FlowSnapshot):FlowSummary {
  const valid=frame.points.filter(p=>p.valid===true);let motion=0,speed=0,dx=0,dy=0;
  for(const p of valid){const u=flowUnits(p,frame);motion+=u.magnitude;speed+=u.speed;dx+=u.dx;dy+=u.dy;}
  return {state:frame.dt>0?'measured':'reference',valid:valid.length,total:frame.points.length,
    motion:valid.length?motion/valid.length:0,speed:valid.length?speed/valid.length:0,
    angle:valid.length&&Math.hypot(dx,dy)/valid.length>.01?(Math.atan2(dy,dx)*180/Math.PI+360)%360:null,
    dt:frame.dt,time:frame.time,ms:frame.ms,width:frame.w,height:frame.h};
}
export function makeFlowGrid(w:number,h:number,cols:number,rows:number):FlowPoint[] {
  return Array.from({length:cols*rows},(_,i)=>{
    const sx=(i%cols+.5)*w/cols,sy=(Math.floor(i/cols)+.5)*h/rows;
    return {sx,sy,x:sx,y:sy,dx:0,dy:0,gx:0,gy:0,valid:null,confidence:0,error:null,trail:[]};
  });
}
