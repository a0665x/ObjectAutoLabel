import type {TrackedObject,TrackingFrame} from './StreamTrackingOverlay';
import type {PixelFeatures,PixelResult} from './pixelAppearance';
import {edgePixelsImage} from './pixelAppearance';

export type YoloEvidence=TrackedObject&{cache_id:string;frame_index:number;media_time:number;image_width:number;image_height:number;
  crop_box:number[];width:number;height:number;features:PixelFeatures;origin:'yolo-pre-tracker'};
export type BboxSnapshot=YoloEvidence&{rgba_base64:string};
export type ReadBboxSample=(cacheId:string,pin?:boolean)=>Promise<BboxSnapshot>;

/** Small bounded RPC queue; no fallback to unrelated playback pixels on a miss. */
export class BboxSampleClient {
  private sequence=0;
  private pending=new Map<number,{key:string;resolve:(sample:BboxSnapshot)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  request(socket:WebSocket|null,key:string,pin=false):Promise<BboxSnapshot> {
    if(!socket||socket.readyState!==WebSocket.OPEN||this.pending.size>=4)return Promise.reject(new Error('unavailable'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('expired'));},4000);
      this.pending.set(id,{key,resolve,reject,timer});
      try{socket.send(JSON.stringify({type:'bbox_sample',cache_id:key,request_id:id,pin}));}
      catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('unavailable'));}
    });
  }
  receive(message:{type:string;request_id?:number;sample?:BboxSnapshot;error?:string}) {
    if(message.type!=='bbox_sample')return false;
    const request=this.pending.get(message.request_id!);
    if(request){clearTimeout(request.timer);this.pending.delete(message.request_id!);if(message.sample?.cache_id===request.key)request.resolve(message.sample);else request.reject(new Error(message.error??'expired'));}
    return true;
  }
  clear() {for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('cancelled'));}this.pending.clear();}
}

export function cachedCandidates(frame:TrackingFrame,classId?:number) {
  return (frame.raw_detections??[]).filter(raw=>classId===undefined||raw.class_id===classId).map(raw=>{
    const tracked=frame.objects.find(o=>!o.predicted&&o.detection_index===raw.detection_index);
    return {...raw,id:tracked?.id??null,tracked:tracked?.tracked??false};
  });
}
export function snapshotPixels(sample:BboxSnapshot,object:TrackedObject=sample):PixelResult {
  if(sample.origin!=='yolo-pre-tracker'||sample.width<3||sample.height<3||sample.width>80||sample.height>80)throw new Error('Invalid cached crop');
  const binary=atob(sample.rgba_base64);
  if(binary.length!==sample.width*sample.height*4)throw new Error('Invalid cached pixels');
  const rgba=Uint8ClampedArray.from(binary,c=>c.charCodeAt(0));
  return {key:sample.cache_id,object,source:sample.crop_box,width:sample.width,height:sample.height,features:sample.features,rgba,edges:edgePixelsImage(rgba,sample.width,sample.height)};
}
