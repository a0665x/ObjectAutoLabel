import type {TrackedObject} from './StreamTrackingOverlay';

export const PIXEL_SCHEMA='bbox-appearance-v1';
export const PIXEL_LIMITS={workerBoxes:64,edge:80,interval:250,laplacian:20};
export type PixelFeatures={pixels:number;colors:number[];vector:number[];spatialColors:number[];meanRGB:number[];edgePixels:number;edgeColors:number[];edgeVector:number[];laplacianVariance:number};
export type PixelSource={id:string;classId:number;name:string;time:number;width:number;height:number;box:number[];cache_id?:string;frame_index?:number;detection_index?:number;origin?:'yolo-pre-tracker'};
export type PixelSample={version:string;index:string;source:PixelSource;features:PixelFeatures;parameters:typeof PIXEL_LIMITS};
const normalized=(values:number[],n:number)=>values.map(v=>n?v/n:0);

export function colorBin(r:number,g:number,b:number) {
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,v=max/255,s=max?d/max:0;
  let h=d===0?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  h=Math.min(11,Math.floor(h*2));
  const neutral=v<.15||s<.15;
  return {color:neutral?(v<.15?12:v>.8?14:13):h,
    feature:neutral?108+Math.min(7,Math.floor(v*8)):h*9+Math.min(2,Math.floor(s*3))*3+Math.min(2,Math.floor(v*3))};
}

/** Four-neighbor signed luminance Laplacian; mask colors stay original RGB. */
export function analyzePixels(rgba:Uint8ClampedArray,w:number,h:number,threshold:number=PIXEL_LIMITS.laplacian):PixelFeatures {
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<3||h<3||rgba.length!==w*h*4)throw new Error('Invalid pixel crop');
  const colors=Array(15).fill(0),vector=Array(116).fill(0),edgeColors=Array(15).fill(0),edgeVector=Array(116).fill(0),meanRGB=[0,0,0];
  const spatialColors=Array(60).fill(0),spatialCounts=[0,0,0,0];
  const gray=new Float32Array(w*h),bins=new Uint8Array(w*h),features=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){
    const p=i*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2],bin=colorBin(r,g,b);
    bins[i]=bin.color;features[i]=bin.feature;colors[bin.color]++;vector[bin.feature]++;
    const cell=Number(i%w>=w/2)+2*Number(Math.floor(i/w)>=h/2);spatialCounts[cell]++;spatialColors[cell*15+bin.color]++;
    meanRGB[0]+=r;meanRGB[1]+=g;meanRGB[2]+=b;gray[i]=.299*r+.587*g+.114*b;
  }
  let edgePixels=0,sum=0,sum2=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,lap=gray[i-1]+gray[i+1]+gray[i-w]+gray[i+w]-4*gray[i];
    sum+=lap;sum2+=lap*lap;
    if(Math.abs(lap)>=threshold){edgePixels++;edgeColors[bins[i]]++;edgeVector[features[i]]++;}
  }
  const interior=(w-2)*(h-2);
  return {pixels:w*h,colors:normalized(colors,w*h),vector:normalized(vector,w*h),spatialColors:spatialColors.map((v,i)=>v/spatialCounts[Math.floor(i/15)]),meanRGB:normalized(meanRGB,w*h),
    edgePixels,edgeColors:normalized(edgeColors,edgePixels),edgeVector:normalized(edgeVector,edgePixels),laplacianVariance:Math.max(0,sum2/interior-(sum/interior)**2)};
}
export function edgePixelsImage(rgba:Uint8ClampedArray,w:number,h:number):Uint8ClampedArray {
  const output=new Uint8ClampedArray(rgba.length),gray=(i:number)=>.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2];
  for(let i=3;i<output.length;i+=4)output[i]=255;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    if(Math.abs(gray(i-1)+gray(i+1)+gray(i-w)+gray(i+w)-4*gray(i))>=PIXEL_LIMITS.laplacian)output.set(rgba.subarray(i*4,i*4+4),i*4);
  }
  return output;
}
export function appearanceSimilarity(a:PixelFeatures,b:PixelFeatures) {
  const coefficient=(x:number[],y:number[])=>Math.min(1,Math.max(0,x.reduce((sum,v,i)=>sum+Math.sqrt(v*(y[i]??0)),0)));
  const color=coefficient(a.vector,b.vector),edge=a.edgePixels&&b.edgePixels?coefficient(a.edgeVector,b.edgeVector):null;
  return {score:edge===null?color:.8*color+.2*edge,color,edge};
}
export function makePixelSample(features:PixelFeatures,source:PixelSource):PixelSample {
  let hash=2166136261;
  for(const v of [...features.vector,...features.edgeVector,...features.spatialColors]){hash^=Math.round(v*10000);hash=Math.imul(hash,16777619);}
  return {version:PIXEL_SCHEMA,index:`px1-${(hash>>>0).toString(16).padStart(8,'0')}`,source,features,parameters:{...PIXEL_LIMITS}};
}
export function cropBox(box:number[],width:number,height:number,videoWidth:number,videoHeight:number):number[]|null {
  if(box.length!==4||!box.every(Number.isFinite)||width<=0||height<=0)return null;
  const x1=Math.max(0,Math.min(videoWidth,box[0]/width*videoWidth)),y1=Math.max(0,Math.min(videoHeight,box[1]/height*videoHeight));
  const x2=Math.max(0,Math.min(videoWidth,box[2]/width*videoWidth)),y2=Math.max(0,Math.min(videoHeight,box[3]/height*videoHeight));
  return x2-x1>=3&&y2-y1>=3?[x1,y1,x2-x1,y2-y1]:null;
}
export type PixelCrop={key:string;object:TrackedObject;source:number[];width:number;height:number;rgba:Uint8ClampedArray};
export type PixelResult={key:string;object:TrackedObject;source:number[];width:number;height:number;features:PixelFeatures;rgba?:Uint8ClampedArray;edges?:Uint8ClampedArray};
export function analyzePixelBatch(crops:PixelCrop[],selected:string):PixelResult[] {
  if(crops.length>PIXEL_LIMITS.workerBoxes)throw new Error('Too many crops');
  return crops.map(crop=>{
    if(crop.width>PIXEL_LIMITS.edge||crop.height>PIXEL_LIMITS.edge)throw new Error('Crop exceeds analysis bound');
    const features=analyzePixels(crop.rgba,crop.width,crop.height);
    const {rgba,...rest}=crop;
    return {...rest,features,...(crop.object.id===selected?{rgba,edges:edgePixelsImage(rgba,crop.width,crop.height)}:{})};
  });
}
