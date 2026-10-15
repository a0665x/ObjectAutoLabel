/** Pyramidal Lucas–Kanade core adapted from the local Flow Lens workbench.
 * Gray values: 0–255. Positions/displacements: analysis pixels, x right/y down.
 * Forward/backward agreement rejects unreliable motion; texture is not accuracy.
 */
export type FlowInput = {gray:Float32Array;w:number;h:number;points:Array<{x:number;y:number}>;reset:boolean;radius:number;threshold:number};
export type FlowResult = {x:number;y:number;dx:number;dy:number;gx:number;gy:number;valid:boolean|null;confidence:number;error:number|null};
type Image = {d:Float32Array;w:number;h:number};

export function createFlowCore() {
  let previous:Image[]|null=null;
  function sample(im:Image,x:number,y:number):number {
    x=Math.max(0,Math.min(im.w-1.001,x));y=Math.max(0,Math.min(im.h-1.001,y));
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,k=iy*im.w+ix,d=im.d;
    return (d[k]*(1-fx)+d[k+1]*fx)*(1-fy)+(d[k+im.w]*(1-fx)+d[k+im.w+1]*fx)*fy;
  }
  function pyramid(d:Float32Array,w:number,h:number):Image[] {
    const result=[{d,w,h}];
    for(let l=1;l<4;l++) {
      const src=result[l-1],nw=Math.floor(src.w/2),nh=Math.floor(src.h/2);
      if(nw<16||nh<16)break;
      const next=new Float32Array(nw*nh);
      for(let y=0;y<nh;y++)for(let x=0;x<nw;x++) {
        let sum=0;
        for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=sample(src,2*x+i,2*y+j)*(i===0?2:1)*(j===0?2:1);
        next[y*nw+x]=sum/16;
      }
      result.push({d:next,w:nw,h:nh});
    }
    return result;
  }
  function track(a:Image[],b:Image[],x:number,y:number,r:number,threshold:number) {
    let dx=0,dy=0,eigen=0,error=Infinity,ok=false;
    for(let l=a.length-1;l>=0;l--) {
      if(l<a.length-1){dx*=2;dy*=2;}
      const src=a[l],dst=b[l],scale=2**l,px=x/scale,py=y/scale;
      const rad=Math.max(2,Math.round(r/Math.sqrt(scale))),margin=l===0?rad+2:1;
      if(px<margin||py<margin||px>=src.w-margin||py>=src.h-margin)continue;
      const template:number[]=[],gx:number[]=[],gy:number[]=[];let xx=0,xy=0,yy=0;
      for(let j=-rad;j<=rad;j++)for(let i=-rad;i<=rad;i++) {
        const tx=px+i,ty=py+j,ix=(sample(src,tx+1,ty)-sample(src,tx-1,ty))/2,iy=(sample(src,tx,ty+1)-sample(src,tx,ty-1))/2;
        template.push(sample(src,tx,ty));gx.push(ix);gy.push(iy);xx+=ix*ix;xy+=ix*iy;yy+=iy*iy;
      }
      const n=template.length,det=xx*yy-xy*xy;
      const ev=(xx+yy-Math.sqrt((xx-yy)**2+4*xy*xy))/(2*n);
      if(l===0)eigen=ev;
      if(ev<(l===0?threshold:Math.min(threshold,.025))||det<1e-6)continue;
      let levelOk=true;
      for(let iter=0;iter<15;iter++) {
        if(px+dx<margin||py+dy<margin||px+dx>=dst.w-margin||py+dy>=dst.h-margin){levelOk=false;break;}
        let bx=0,by=0,k=0;
        for(let j=-rad;j<=rad;j++)for(let i=-rad;i<=rad;i++,k++) {
          const difference=template[k]-sample(dst,px+dx+i,py+dy+j);bx+=gx[k]*difference;by+=gy[k]*difference;
        }
        const ux=(yy*bx-xy*by)/det,uy=(xx*by-xy*bx)/det;
        if(!Number.isFinite(ux+uy)||Math.hypot(ux,uy)>12){levelOk=false;break;}
        dx+=ux;dy+=uy;if(ux*ux+uy*uy<.0004)break;
      }
      if(l===0&&levelOk) {
        error=0;let k=0;
        for(let j=-rad;j<=rad;j++)for(let i=-rad;i<=rad;i++,k++)error+=Math.abs(template[k]-sample(dst,px+dx+i,py+dy+j));
        error/=n;
        ok=error<28&&Math.hypot(dx,dy)<100&&px+dx>=margin&&py+dy>=margin&&px+dx<dst.w-margin&&py+dy<dst.h-margin;
      }
    }
    return {dx:ok?dx:0,dy:ok?dy:0,valid:ok as boolean|null,confidence:Math.max(0,eigen)/(Math.max(0,eigen)+20),error:Number.isFinite(error)?error:null};
  }
  return {analyze({gray,w,h,points,reset,radius,threshold}:FlowInput):FlowResult[] {
    if(w<16||h<16||gray.length!==w*h)throw new Error('Invalid optical-flow image dimensions');
    const current=pyramid(gray,w,h),canTrack=!reset&&previous&&previous[0].w===w&&previous[0].h===h;
    const result=points.map(p=>{
      const flow=canTrack?track(previous!,current,p.x,p.y,radius,threshold):{dx:0,dy:0,valid:null,confidence:0,error:null};
      if(flow.valid===true) {
        const backward=track(current,previous!,p.x+flow.dx,p.y+flow.dy,radius,threshold);
        if(!backward.valid||Math.hypot(flow.dx+backward.dx,flow.dy+backward.dy)>1.2){flow.valid=false;flow.dx=0;flow.dy=0;}
      }
      const x=p.x+flow.dx,y=p.y+flow.dy,im=current[0];
      return {...flow,x,y,gx:(sample(im,x+1,y)-sample(im,x-1,y))/2,gy:(sample(im,x,y+1)-sample(im,x,y-1))/2};
    });
    previous=current;return result;
  }};
}
