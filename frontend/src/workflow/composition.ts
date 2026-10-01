import type {Recipe, Stage, WorkflowState} from './WorkflowState';

export const inputStages = ['pseudo','augmentation','open_data'] as const;
export type InputStage = typeof inputStages[number];
export const recipeFields = {pseudo:'pseudo_label_run_id',augmentation:'augmentation_run_id',open_data:'open_data_import_id'} as const;
export const sourcePages: Record<Stage,string> = {pseudo:'pseudo',augmentation:'augment',open_data:'open-data',split:'split',training:'train',conversion:'convert'};
export const emptyRecipe: Recipe = {pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:null};
export function assignedRecipe(state:WorkflowState|null):Recipe {
  return {pseudo_label_run_id:state?.assignments.pseudo??null,augmentation_run_id:state?.assignments.augmentation??null,open_data_import_id:state?.assignments.open_data??null};
}
export function sameRecipe(a:Recipe,b:Recipe) {return inputStages.every(stage=>a[recipeFields[stage]]===b[recipeFields[stage]]);}
export function chooseVersion(state:WorkflowState,draft:Recipe,stage:InputStage,id:string|null):Recipe {
  const version=state.catalog[stage].find(item=>item.id===id);
  if(id&&(!version||version.reason))return draft;
  const next={...draft,[recipeFields[stage]]:id};
  if(stage==='pseudo'&&id!==draft.pseudo_label_run_id)next.augmentation_run_id=null;
  if(stage==='augmentation'&&version)next.pseudo_label_run_id=version.parent_id??null;
  return next;
}
export function recipeIssue(state:WorkflowState|null,draft:Recipe):string {
  if(!state)return 'Loading sources…';
  if(!Object.values(draft).some(Boolean))return 'Choose at least one source version.';
  for(const stage of inputStages){
    const id=draft[recipeFields[stage]];
    if(!id)continue;
    const version=state.catalog[stage].find(item=>item.id===id);
    if(!version)return 'A selected source is no longer available. Choose another version.';
    if(version.reason)return version.reason;
  }
  const augment=state.catalog.augmentation.find(item=>item.id===draft.augmentation_run_id);
  if(augment&&(augment.parent_id??null)!==draft.pseudo_label_run_id)return 'Augment must use its recorded Pseudo source.';
  return '';
}
