import {flowUnits,type FlowSettings,type FlowSnapshot} from './opticalFlowModel';

export function drawOpticalFlow(canvas:HTMLCanvasElement,frame:FlowSnapshot,settings:FlowSettings) {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  if(canvas.width!==frame.videoWidth)canvas.width=frame.videoWidth;
  if(canvas.height!==frame.videoHeight)canvas.height=frame.videoHeight;
  const w=canvas.width,h=canvas.height,sx=w/frame.w,sy=h/frame.h;
  const line=w/(canvas.getBoundingClientRect().width||w);
  ctx.clearRect(0,0,w,h);
  const magnitude=(p:typeof frame.points[number])=>settings.color==='confidence'?p.confidence:flowUnits(p,frame)[settings.color];
  const max=settings.color==='direction'?360:settings.color==='confidence'?1:
    Math.max(settings.color==='speed'?30:settings.color==='gradient'?5:1,...frame.points.filter(p=>p.valid).map(magnitude));
  function color(p:typeof frame.points[number]) {
    if(settings.color==='direction')return `hsl(${flowUnits(p,frame).direction} 85% 70%)`;
    const t=Math.max(0,Math.min(1,magnitude(p)/max)),stops=[[101,198,255],[129,228,205],[255,210,125],[255,107,119]];
    const n=Math.min(2,Math.floor(t*3)),f=t*3-n;
    return `rgb(${stops[n].map((v,i)=>Math.round(v+(stops[n+1][i]-v)*f)).join(',')})`;
  }
  function arrow(x:number,y:number,dx:number,dy:number) {
    const length=Math.hypot(dx,dy);if(length<.4)return;
    const a=Math.atan2(dy,dx),head=Math.min(length*.4,6*line);
    ctx!.beginPath();ctx!.moveTo(x,y);ctx!.lineTo(x+dx,y+dy);ctx!.stroke();
    ctx!.beginPath();ctx!.moveTo(x+dx,y+dy);ctx!.lineTo(x+dx-head*Math.cos(a-.48),y+dy-head*Math.sin(a-.48));
    ctx!.lineTo(x+dx-head*Math.cos(a+.48),y+dy-head*Math.sin(a+.48));ctx!.closePath();ctx!.fill();
  }
  if(settings.showGrid){
    ctx.strokeStyle='#ffffff40';ctx.lineWidth=line*.7;ctx.beginPath();
    for(let x=1;x<settings.cols;x++){ctx.moveTo(x*w/settings.cols,0);ctx.lineTo(x*w/settings.cols,h);}
    for(let y=1;y<settings.rows;y++){ctx.moveTo(0,y*h/settings.rows);ctx.lineTo(w,y*h/settings.rows);}
    ctx.stroke();
  }
  for(const p of frame.points) {
    const x=p.x*sx,y=p.y*sy;ctx.strokeStyle=ctx.fillStyle=p.valid===false?'#ffc078':color(p);ctx.lineWidth=line;
    if(settings.showTrails&&p.trail.length>1){
      ctx.globalAlpha=.7;ctx.beginPath();p.trail.slice(-settings.trailLength).forEach((q,i)=>i?ctx.lineTo(q[0]*sx,q[1]*sy):ctx.moveTo(q[0]*sx,q[1]*sy));ctx.stroke();ctx.globalAlpha=1;
    }
    if(p.valid===false){
      if(settings.showPoints){const r=3*line;ctx.beginPath();ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.stroke();}
      continue;
    }
    if(settings.vector==='gradient'){
      const u=flowUnits(p,frame),n=Math.max(1,u.gradient);arrow(x,y,u.gx/n*Math.min(25,u.gradient)*settings.gain*line,u.gy/n*Math.min(25,u.gradient)*settings.gain*line);
    }else if(p.valid)arrow(x,y,p.dx*sx*settings.gain,p.dy*sy*settings.gain);
    if(settings.showPoints){ctx.beginPath();ctx.arc(x,y,2*line,0,Math.PI*2);ctx.fill();}
  }
}
