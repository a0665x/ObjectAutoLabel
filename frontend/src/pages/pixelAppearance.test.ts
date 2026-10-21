import {expect,it} from 'vitest';
import {analyzePixels,analyzePixelBatch,appearanceSimilarity,cropBox,makePixelSample} from './pixelAppearance';
function pixels(w:number,h:number,color:(x:number,y:number)=>number[]){return Uint8ClampedArray.from(Array.from({length:w*h},(_,i)=>[...color(i%w,Math.floor(i/w)),255]).flat());}
it('normalizes color bins, includes achromatic pixels and does not invent edges in a flat crop',()=>{
  const a=analyzePixels(pixels(8,8,()=>[200,0,0]),8,8);
  expect(a.pixels).toBe(64);expect(a.colors.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  expect(a.colors[0]).toBe(1);expect(a.edgePixels).toBe(0);expect(a.edgeColors.every(x=>x===0)).toBe(true);expect(a.laplacianVariance).toBe(0);
  const gray=analyzePixels(pixels(8,8,()=>[128,128,128]),8,8);expect(gray.colors[13]).toBe(1);
  expect(appearanceSimilarity(a,gray).score).toBe(0);
});
it('rejects malformed or oversized pixel jobs instead of allowing unbounded allocation',()=>{
  expect(()=>analyzePixels(new Uint8ClampedArray(4),8,8)).toThrow();
  const crop={key:'a',object:{id:'a',box:[0,0,81,8],score:1,class_id:0,name:'person'},source:[0,0,81,8],width:81,height:8,rgba:new Uint8ClampedArray(81*8*4)};
  expect(()=>analyzePixelBatch([crop],'a')).toThrow('bound');expect(()=>analyzePixelBatch(Array(65).fill(crop),'a')).toThrow('Too many');
});
it('counts original colors on interior Laplacian edges, not the crop border or fake derivative colors',()=>{
  const a=analyzePixels(pixels(8,8,x=>x<4?[255,0,0]:[0,0,255]),8,8);
  expect(a.edgePixels).toBe(12);expect(a.edgeColors[0]).toBeCloseTo(.5);expect(a.edgeColors[8]).toBeCloseTo(.5);
  expect(a.laplacianVariance).toBeGreaterThan(0);expect(a.edgeColors.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
});
it('ranks identical appearances highest and uses color alone when edge evidence is absent',()=>{
  const a=analyzePixels(pixels(10,10,()=>[255,0,0]),10,10),b=analyzePixels(pixels(10,10,()=>[0,0,255]),10,10);
  expect(appearanceSimilarity(a,a)).toEqual({score:1,color:1,edge:null});expect(appearanceSimilarity(a,b).score).toBe(0);
});
it('clips metadata coordinates to decoded pixels without stretching and rejects invalid boxes',()=>{
  expect(cropBox([-10,5,60,40],100,50,200,100)).toEqual([0,10,120,70]);
  expect(cropBox([3,3,1,1],100,50,200,100)).toBeNull();expect(cropBox([NaN,0,10,10],100,50,200,100)).toBeNull();
});
it('exports the exact inference provenance instead of conflating a cache key with a track ID',()=>{
  const features=analyzePixels(pixels(8,8,()=>[255,0,0]),8,8);
  const source={id:'sample:1',classId:0,name:'person',time:2,width:8,height:8,box:[0,0,8,8],cache_id:'s:30:2',frame_index:30,detection_index:2,origin:'yolo-pre-tracker' as const};
  expect(makePixelSample(features,source).source).toEqual(source);
});
it('exports an explicit versioned numeric sample with stable index, never an identity guarantee',()=>{
  const features=analyzePixels(pixels(8,8,()=>[255,0,0]),8,8);
  const sample=makePixelSample(features,{id:'0:3',classId:0,name:'person',time:1.5,width:8,height:8,box:[1,2,9,10]});
  expect(sample.version).toBe('bbox-appearance-v1');expect(sample.index).toMatch(/^px1-[a-f0-9]{8}$/);
  expect(sample.features.vector).toHaveLength(116);expect(JSON.stringify(sample)).not.toContain('rgba');
  expect(makePixelSample(features,sample.source).index).toBe(sample.index);
});
