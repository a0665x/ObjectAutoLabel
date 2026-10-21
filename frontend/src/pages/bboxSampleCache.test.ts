import {afterEach,expect,it,vi} from 'vitest';
import {BboxSampleClient,cachedCandidates,snapshotPixels,type BboxSnapshot} from './bboxSampleCache';
import {analyzePixels} from './pixelAppearance';
const rgba=Uint8ClampedArray.from(Array.from({length:9},()=>[255,0,0,255]).flat());
const sample:BboxSnapshot={id:null,tracked:false,box:[0,0,3,3],score:.9,class_id:0,name:'person',detection_index:4,cache_id:'s:1:4',frame_index:1,media_time:1,width:3,height:3,image_width:100,image_height:60,crop_box:[0,0,3,3],origin:'yolo-pre-tracker',features:analyzePixels(rgba,3,3),rgba_base64:btoa(String.fromCharCode(...rgba))};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function socket(){vi.stubGlobal('WebSocket',{OPEN:1});return {readyState:1,send:vi.fn()} as unknown as WebSocket;}
it('pins an exact cache key, routes replies by request ID and decodes lossless pixels',async()=>{
  const client=new BboxSampleClient(),ws=socket(),pending=client.request(ws,sample.cache_id,true);
  expect(JSON.parse(vi.mocked(ws.send).mock.calls[0][0] as string)).toMatchObject({cache_id:'s:1:4',pin:true,request_id:1});
  client.receive({type:'bbox_sample',request_id:1,sample});
  expect(snapshotPixels(await pending).rgba).toEqual(rgba);
});
it('reports expired cache explicitly without synthesizing a crop from the video',async()=>{
  const client=new BboxSampleClient(),pending=client.request(socket(),'gone');
  const verdict=expect(pending).rejects.toThrow('expired');
  client.receive({type:'bbox_sample',request_id:1,error:'expired'});await verdict;
});
it('bounds pending requests, times them out and cancels all on session exit',async()=>{
  vi.useFakeTimers();const client=new BboxSampleClient(),ws=socket();
  const requests=Array.from({length:4},()=>client.request(ws,'key').catch(e=>e.message));
  await expect(client.request(ws,'overflow')).rejects.toThrow('unavailable');
  await vi.advanceTimersByTimeAsync(4000);expect(await Promise.all(requests)).toEqual(Array(4).fill('expired'));
  const next=client.request(ws,'key').catch(e=>e.message);client.clear();expect(await next).toBe('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});
it('uses all raw same-class boxes without IDs, never tracker-smoothed coordinates',()=>{
  const raw=Array.from({length:160},(_,i)=>({...sample,cache_id:`s:1:${i}`,detection_index:i}));
  const candidates=cachedCandidates({time:0,width:100,height:60,objects:[{...sample,id:'0:1',tracked:true,box:[20,20,30,30]}],raw_detections:raw},0);
  expect(candidates).toHaveLength(160);expect(candidates[4].box).toEqual([0,0,3,3]);expect(candidates[4].id).toBe('0:1');
  expect(candidates[5].id).toBeNull();
});
it('rejects invalid cache pixel dimensions and payloads',()=>{
  expect(()=>snapshotPixels({...sample,rgba_base64:'AA=='})).toThrow('Invalid cached pixels');
  expect(()=>snapshotPixels({...sample,width:81})).toThrow('Invalid cached crop');
});
