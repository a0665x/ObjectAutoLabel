import {expect,it} from 'vitest';
import {analyzePixels} from './pixelAppearance';
import {searchColorSample,type ColorSeed,type SampleBox} from './colorSampleTracking';
function image(box:SampleBox|null,w=100,h=60){const rgba=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const inside=box&&x>=box[0]*w&&x<box[2]*w&&y>=box[1]*h&&y<box[3]*h;rgba.set(inside?[255,0,0,255]:[0,0,255,255],(y*w+x)*4);}return rgba;}
const red=Uint8ClampedArray.from(Array.from({length:120},()=>[255,0,0,255]).flat());
const seed:ColorSeed={token:'sample:1',classId:0,name:'person',box:[.1,.2,.22,.5],features:analyzePixels(red,10,12),time:0,width:10,height:12};
it('follows a same-class detection without requiring a tracking ID',()=>{
  const box:SampleBox=[.6,.2,.72,.5],result=searchColorSample({rgba:image(null),width:100,height:60,seed,candidates:[{box,classId:0,id:null,detection_index:3,cache_id:'s:1:3',features:seed.features}],time:1});
  expect(result.mode).toBe('detection');expect(result.id).toBeNull();expect(result.detection_index).toBe(3);expect(result.box).toEqual(box);
  expect(result.cache_id).toBe('s:1:3');
});
it('does not promote an uncached delayed detector box to detector-backed evidence',()=>{
  const box:SampleBox=[.6,.2,.72,.5],result=searchColorSample({rgba:image(box),width:100,height:60,seed,candidates:[{box,classId:0,id:null,detection_index:3}],time:1});
  expect(result.mode).not.toBe('detection');expect(result.cache_id).toBeUndefined();
});
it('reacquires the sampled colors after a large camera-like jump with no detector boxes',()=>{
  const box:SampleBox=[.6,.2,.72,.5],result=searchColorSample({rgba:image(box),width:100,height:60,seed,candidates:[],time:1});
  expect(result.mode).toBe('search');expect(result.similarity).toBeGreaterThan(.9);expect(result.box[0]).toBeGreaterThan(.5);expect(result.box[2]).toBeLessThan(.8);
});
it('keeps an explicitly unconfirmed box when the sampled feature has left the image',()=>{
  const result=searchColorSample({rgba:image(null),width:100,height:60,seed,candidates:[],time:1});
  expect(result.mode).toBe('hold');expect(result.reason).toBe('weak');expect(result.box).toEqual(seed.box);expect(result.similarity).toBeLessThan(.72);
});
it('does not claim a different-class detection is a same-class model match',()=>{
  const box:SampleBox=[.6,.2,.72,.5],result=searchColorSample({rgba:image(box),width:100,height:60,seed,candidates:[{box,classId:1,id:'car:1'}],time:1});
  expect(result.mode).not.toBe('detection');expect(result.id).toBeNull();
});
it('bounds analysis dimensions and never changes the fixed reference features',()=>{
  const original=JSON.stringify(seed.features);searchColorSample({rgba:image(null),width:100,height:60,seed,candidates:[],time:1});expect(JSON.stringify(seed.features)).toBe(original);
  expect(()=>searchColorSample({rgba:new Uint8ClampedArray(300*10*4),width:300,height:10,seed,candidates:[],time:1})).toThrow('Invalid');
});
