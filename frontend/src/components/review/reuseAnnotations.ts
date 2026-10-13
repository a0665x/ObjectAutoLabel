import type {Annotation,ProjectImage} from '../../types';
import {clipAnnotation} from '../../annotation/geometry';
import {annotationIou} from '../../annotation/reducer';

export function canReuseFromImage(current:ProjectImage,previous:ProjectImage):boolean {
  // Never bridge independent source groups/versions simply because they are adjacent.
  return current.project_id===previous.project_id && (current.source_asset_id??null)===(previous.source_asset_id??null) &&
    (current.source_origin??'project')===(previous.source_origin??'project') &&
    (current.augmentation_run_id??null)===(previous.augmentation_run_id??null) &&
    (current.open_data_import_id??null)===(previous.open_data_import_id??null);
}

export function reuseAnnotations(current:Annotation[],previous:Annotation[],createId:()=>string,allowedClassIds:Set<number>,iouThreshold=.8):{annotations:Annotation[];selectedIds:string[];skippedOverlaps:number;skippedUnsupported:number} {
  const next=[...current], selectedIds:string[]=[];
  let skippedOverlaps=0,skippedUnsupported=0;
  for(const original of previous){
    if(!allowedClassIds.has(original.class_id)){skippedUnsupported++;continue;}
    const box=clipAnnotation(original);
    const identical=next.some(item=>item.class_id===box.class_id&&(['x_center','y_center','width','height'] as const).every(key=>Math.abs(item[key]-box[key])<.000001));
    // Suppress against original destination boxes, not other incoming boxes:
    // an empty destination must receive the source's whole label group.
    if(identical||current.some(item=>item.class_id===box.class_id&&annotationIou(item,box)-iouThreshold>1e-9)){skippedOverlaps++;continue;}
    const copy:Annotation={id:createId(),class_id:box.class_id,class_name:box.class_name,
      x_center:box.x_center,y_center:box.y_center,width:box.width,height:box.height,
      source_descriptor:box.source_descriptor,confidence:null,source_type:'manual',edited:true};
    next.push(copy);selectedIds.push(copy.id);
  }
  return {annotations:next,selectedIds,skippedOverlaps,skippedUnsupported};
}
