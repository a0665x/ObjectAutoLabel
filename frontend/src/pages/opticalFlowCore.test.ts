import {describe,expect,it} from 'vitest';
import {createFlowCore,type FlowInput} from './opticalFlowCore';
import {flowUnits,makeFlowGrid,summarizeFlow,type FlowSnapshot} from './opticalFlowModel';
const w=192,h=144;
function texture() {
  let seed=42;
  const noise=Float32Array.from({length:w*h},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return 25+seed/2**32*205;});
  const result=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=noise[Math.max(0,Math.min(h-1,y+j))*w+Math.max(0,Math.min(w-1,x+i))];
    result[y*w+x]=sum/9;
  }
  return result;
}
function translate(src:Float32Array,dx:number,dy:number) {
  return Float32Array.from({length:w*h},(_,i)=>{
    const x=i%w,y=Math.floor(i/w),px=Math.max(0,Math.min(w-1.001,x-dx)),py=Math.max(0,Math.min(h-1.001,y-dy));
    const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,k=iy*w+ix;
    return (src[k]*(1-fx)+src[k+1]*fx)*(1-fy)+(src[k+w]*(1-fx)+src[k+w+1]*fx)*fy;
  });
}
const points=Array.from({length:48},(_,i)=>({x:30+(i%8)*18,y:25+Math.floor(i/8)*18}));
const payload=(gray:Float32Array,reset=false):FlowInput=>({gray,w,h,points,reset,radius:5,threshold:3});
describe('Flow Lens optical-flow core',()=>{
  it('establishes a reference without inventing motion',()=>{
    expect(createFlowCore().analyze(payload(texture(),true)).every(p=>p.valid===null&&p.dx===0&&p.dy===0)).toBe(true);
  });
  it.each([[3,2],[-3,2],[0,0],[9,-6],[1.5,-.75]])('recovers translation %s, %s',(dx,dy)=>{
    const core=createFlowCore(),src=texture();core.analyze(payload(src,true));
    const valid=core.analyze(payload(translate(src,dx,dy))).filter(p=>p.valid);
    expect(valid.length).toBeGreaterThanOrEqual(points.length*.8);
    expect(valid.reduce((n,p)=>n+Math.hypot(p.dx-dx,p.dy-dy),0)/valid.length).toBeLessThan(.25);
  });
  it('rejects low-texture patches instead of claiming reliable stationary tracks',()=>{
    const core=createFlowCore(),flat=new Float32Array(w*h).fill(100);core.analyze(payload(flat,true));
    expect(core.analyze(payload(flat)).every(p=>p.valid===false)).toBe(true);
  });
  it('resets history on a new image size or explicit reset',()=>{
    const core=createFlowCore();core.analyze(payload(texture(),true));
    expect(core.analyze(payload(new Float32Array(w*h),true)).every(p=>p.valid===null)).toBe(true);
    expect(core.analyze({...payload(new Float32Array(64*64)),w:64,h:64,points:[{x:30,y:30}]} )[0].valid).toBe(null);
  });
  it('keeps gradient direction distinct from optical motion and avoids NaN near borders',()=>{
    const gray=Float32Array.from({length:w*h},(_,i)=>(i%w)*.7+Math.floor(i/w)*.4);
    const core=createFlowCore();
    const p=core.analyze({...payload(gray,true),points:[{x:60,y:60}]})[0];
    expect(p.gx).toBeCloseTo(.7,4);expect(p.gy).toBeCloseTo(.4,4);
    const border=core.analyze({...payload(gray),points:[{x:0,y:0},{x:w-1,y:h-1},{x:2,y:40}]});
    expect(border.every(p=>p.valid===false&&Number.isFinite(p.x+p.y+p.gx+p.gy))).toBe(true);
  });
  it('scales flow and speed to decoded stream pixels using media time, excludes invalid points',()=>{
    const points=makeFlowGrid(100,50,2,2);Object.assign(points[0],{valid:true,dx:3,dy:4});
    Object.assign(points[1],{valid:false,dx:100,dy:100});
    const frame:FlowSnapshot={w:100,h:50,videoWidth:200,videoHeight:100,dt:.5,time:1,ms:2,points};
    expect(flowUnits(points[0],frame)).toMatchObject({magnitude:10,speed:20});
    expect(summarizeFlow(frame)).toMatchObject({valid:1,total:4,motion:10,speed:20});
    expect(summarizeFlow({...frame,dt:0}).state).toBe('reference');
  });
});
