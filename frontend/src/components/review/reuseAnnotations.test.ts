import {expect,it} from 'vitest';
import {canReuseFromImage,reuseAnnotations} from './reuseAnnotations';
import type {Annotation,ProjectImage} from '../../types';
const image:ProjectImage={id:'a',project_id:'p',path:'a.jpg',review_status:'reviewed',source_asset_id:'s'};
const box:Annotation={id:'old',class_id:0,class_name:'car',x_center:.3,y_center:.4,width:.1,height:.2,confidence:.9,source_type:'pseudo',edited:false};
it('reuses normalized geometry with fresh ids, no confidence, no offsets or duplicate boxes',()=>{
  const result=reuseAnnotations([], [box],()=> 'fresh',new Set([0]));
  expect(result.annotations[0]).toMatchObject({...box,id:'fresh',confidence:null,source_type:'manual',edited:true});
  expect(result.selectedIds).toEqual(['fresh']);
  const repeated=reuseAnnotations(result.annotations,[box],()=> 'other',new Set([0]));
  expect(repeated.annotations).toEqual(result.annotations);expect(repeated.selectedIds).toEqual([]);
  expect(reuseAnnotations([], [box],()=> 'fresh',new Set([1])).annotations).toEqual([]);
});
it('never carries across source, origin or saved Augment/Open Data boundaries',()=>{
  expect(canReuseFromImage(image,{...image,id:'b'})).toBe(true);
  for(const changed of [{source_asset_id:'other'},{source_origin:'open_data' as const},{augmentation_run_id:'aug'},{open_data_import_id:'open'}])expect(canReuseFromImage(image,{...image,...changed,id:'b'})).toBe(false);
});
