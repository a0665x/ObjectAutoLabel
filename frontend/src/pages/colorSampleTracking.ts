import {analyzePixels,colorBin,type PixelFeatures} from './pixelAppearance';
import type {YoloEvidence} from './bboxSampleCache';
export type SampleBox=[number,number,number,number];
export type ColorSeed={token:string;classId:number;name:string;box:SampleBox;features:PixelFeatures;time:number;width:number;height:number;evidence?:YoloEvidence};
export type ColorCandidate={box:SampleBox;classId:number;id:string|null;detection_index?:number;features?:PixelFeatures;cache_id?:string};
export type ColorEstimate={box:SampleBox;mode:'detection'|'search'|'hold';similarity:number;reason:'matched'|'weak'|'ambiguous';id:string|null;detection_index?:number;cache_id?:string;time:number};
export type ColorSearchInput={rgba:Uint8ClampedArray;width:number;height:number;seed:ColorSeed;previous?:ColorEstimate;candidates:ColorCandidate[];time:number};
const overlap=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+Math.sqrt(v*(b[i]??0)),0);
const area=(b:SampleBox)=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
function iou(a:SampleBox,b:SampleBox){const n=area([Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])]);return n/Math.max(1e-9,area(a)+area(b)-n);}
function valid(box:SampleBox){return box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]<=1&&box[3]<=1&&area(box)>0;}
function crop(rgba:Uint8ClampedArray,w:number,h:number,box:SampleBox) {
  const x=Math.max(0,Math.floor(box[0]*w)),y=Math.max(0,Math.floor(box[1]*h)),cw=Math.min(w-x,Math.ceil(box[2]*w)-x),ch=Math.min(h-y,Math.ceil(box[3]*h)-y);
  if(cw<3||ch<3)return null;
  const scale=Math.min(1,80/Math.max(cw,ch)),width=Math.max(3,Math.floor(cw*scale)),height=Math.max(3,Math.floor(ch*scale)),pixels=new Uint8ClampedArray(width*height*4);
  for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
    const from=((y+Math.min(ch-1,Math.floor(yy/scale)))*w+x+Math.min(cw-1,Math.floor(xx/scale)))*4;
    pixels.set(rgba.subarray(from,from+4),(yy*width+xx)*4);
  }
  return analyzePixels(pixels,width,height);
}
/** Appearance evidence is independent of ByteTrack IDs, but never an identity guarantee. */
export function searchColorSample(input:ColorSearchInput):ColorEstimate {
  const {rgba,width:w,height:h,seed,previous,time}=input;
  if(w<3||h<3||w>240||h>240||rgba.length!==w*h*4||!valid(seed.box))throw new Error('Invalid color-search image');
  const last=previous?.box??seed.box,proximity=(b:SampleBox)=>Math.exp(-Math.hypot((b[0]+b[2]-last[0]-last[2])/2,(b[1]+b[3]-last[1]-last[3])/2)/.25);
  const appearance=(f:PixelFeatures)=>Math.min(1,.55*overlap(seed.features.colors,f.colors)+.25*overlap(seed.features.spatialColors,f.spatialColors)/4+.2*overlap(seed.features.vector,f.vector));
  type Scored={box:SampleBox;similarity:number;utility:number;id:string|null;detection_index?:number;cache_id?:string;mode:'detection'|'search'};
  const scored:Scored[]=[];
  function score(box:SampleBox,mode:'detection'|'search',id:string|null=null,detection_index?:number,features?:PixelFeatures,cache_id?:string){
    if(!valid(box))return;const f=features??(mode==='search'?crop(rgba,w,h,box):null);if(!f)return;
    const similarity=appearance(f),utility=.94*similarity+.06*proximity(box)-.04*Math.abs(Math.log(area(box)/area(seed.box)))+(mode==='detection'?.015:0);
    scored.push({box,similarity,utility,id,detection_index,cache_id,mode});
  }
  for(const c of input.candidates)if(c.classId===seed.classId&&c.cache_id)score(c.box,'detection',c.id,c.detection_index,c.features,c.cache_id);
  // A bounded 15-bin integral histogram cheaply searches the whole image.
  const stride=w+1,integral=new Uint32Array(stride*(h+1)*15);
  for(let y=0;y<h;y++){
    const sums=new Uint32Array(15);
    for(let x=0;x<w;x++){
      const p=(y*w+x)*4,bin=colorBin(rgba[p],rgba[p+1],rgba[p+2]).color;sums[bin]++;
      const dst=((y+1)*stride+x+1)*15,above=(y*stride+x+1)*15;
      for(let b=0;b<15;b++)integral[dst+b]=integral[above+b]+sums[b];
    }
  }
  const shortlist:{box:SampleBox;score:number}[]=[],step=Math.max(2,Math.ceil(Math.sqrt(w*h*5/10000)));
  const baseW=Math.max(3,(last[2]-last[0])*w),baseH=Math.max(3,(last[3]-last[1])*h);
  for(const scale of [.7,.85,1,1.2,1.45]){
    const cw=Math.min(w,Math.max(3,Math.round(baseW*scale))),ch=Math.min(h,Math.max(3,Math.round(baseH*scale)));
    for(let y=0;y<=h-ch;y+=step)for(let x=0;x<=w-cw;x+=step){
      const a=(y*stride+x)*15,b=(y*stride+x+cw)*15,c=((y+ch)*stride+x)*15,d=((y+ch)*stride+x+cw)*15;
      let match=0;for(let i=0;i<15;i++)match+=Math.sqrt(seed.features.colors[i]*(integral[d+i]-integral[b+i]-integral[c+i]+integral[a+i])/(cw*ch));
      const box:SampleBox=[x/w,y/h,(x+cw)/w,(y+ch)/h];match=.96*match+.04*proximity(box);
      if(shortlist.length<12||match>shortlist[shortlist.length-1].score){shortlist.push({box,score:match});shortlist.sort((a,b)=>b.score-a.score);if(shortlist.length>12)shortlist.pop();}
    }
  }
  score(last,'search');
  for(const item of shortlist)score(item.box,'search');
  // Refine the strongest coarse location by a few pixels, rather than fixing it to the grid.
  scored.sort((a,b)=>b.utility-a.utility);
  const coarse=scored[0];
  if(coarse?.mode==='search')for(let dy=-step;dy<=step;dy+=2)for(let dx=-step;dx<=step;dx+=2){
    const b=coarse.box;score([b[0]+dx/w,b[1]+dy/h,b[2]+dx/w,b[3]+dy/h],'search');
  }
  scored.sort((a,b)=>b.utility-a.utility);
  const best=scored[0],rival=best&&scored.find(c=>iou(best.box,c.box)<.15&&c.similarity>=.72);
  const ambiguous=Boolean(best&&rival&&best.utility-rival.utility<.025);
  if(!best||best.similarity<.72||ambiguous)return {box:last,mode:'hold',similarity:best?.similarity??0,reason:ambiguous?'ambiguous':'weak',id:null,time};
  return {...best,reason:'matched',time};
}
