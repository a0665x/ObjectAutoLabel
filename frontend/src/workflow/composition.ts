import type {Recipe, SourceBranch, Stage, WorkflowState} from './WorkflowState';

export const inputStages = ['pseudo','augmentation','open_data'] as const;
export type InputStage = typeof inputStages[number];
export const recipeFields = {pseudo:'pseudo_label_run_id',augmentation:'augmentation_run_id',open_data:'open_data_import_id'} as const;
export const sourcePages: Record<Stage,string> = {source:'sources',pseudo:'pseudo',augmentation:'augment',open_data:'open-data',split:'split',training:'train',conversion:'convert'};
export const emptyRecipe: Recipe = {pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:null};
export function assignedRecipe(state:WorkflowState|null):Recipe {
  const composition=state?.compositions.find(item=>item.id===state.composition_id&&!item.reason);
  if(composition?.branches)return withBranches(composition,sourceBranches(composition));
  return {pseudo_label_run_id:state?.assignments.pseudo??null,augmentation_run_id:state?.assignments.augmentation??null,open_data_import_id:state?.assignments.open_data??null};
}
export function sourceBranches(recipe:Recipe):SourceBranch[] {return recipe.branches??[{pseudo_label_run_id:recipe.pseudo_label_run_id,augmentation_run_id:recipe.augmentation_run_id}];}
export function withBranches(recipe:Recipe,branches:SourceBranch[]):Recipe {
  const first=branches[0]??{pseudo_label_run_id:null,augmentation_run_id:null};
  return {...first,open_data_import_id:recipe.open_data_import_id,...(branches.length>1?{branches}: {})};
}
export function sameRecipe(a:Recipe,b:Recipe) {return a.open_data_import_id===b.open_data_import_id&&JSON.stringify(sourceBranches(a))===JSON.stringify(sourceBranches(b));}
export function chooseVersion(state:WorkflowState,draft:Recipe,stage:InputStage,id:string|null,branchIndex=0):Recipe {
  const version=state.catalog[stage].find(item=>item.id===id);
  if(id&&(!version||version.reason))return draft;
  if(stage==='open_data')return {...draft,open_data_import_id:id};
  const branches=sourceBranches(draft).map(branch=>({...branch}));
  const next=branches[branchIndex];
  if(!next)return draft;
  if(stage==='pseudo'&&id!==next.pseudo_label_run_id)next.augmentation_run_id=null;
  next[recipeFields[stage]]=id;
  if(stage==='augmentation'&&version)next.pseudo_label_run_id=version.parent_id??null;
  return withBranches(draft,branches);
}
export function recipeIssue(state:WorkflowState|null,draft:Recipe):string {
  if(!state)return 'Loading sources…';
  const branches=sourceBranches(draft);
  if(!branches.some(branch=>branch.pseudo_label_run_id||branch.augmentation_run_id)&&!draft.open_data_import_id)return 'Choose at least one source version.';
  const seen=new Set<string>();
  for(const branch of branches){
    if(branches.length>1&&!branch.pseudo_label_run_id&&!branch.augmentation_run_id)return 'Choose a Pseudo or Augment version for every source group';
    const key=branch.augmentation_run_id?`augmentation:${branch.augmentation_run_id}`:branch.pseudo_label_run_id?`pseudo:${branch.pseudo_label_run_id}`:'';
    if(key&&seen.has(key))return 'The same source version cannot be added twice';
    if(key)seen.add(key);
    for(const stage of inputStages){
      const id=stage==='open_data'?draft.open_data_import_id:branch[recipeFields[stage]];
      if(!id)continue;
      const version=state.catalog[stage].find(item=>item.id===id);
      if(!version)return 'A selected source is no longer available. Choose another version.';
      if(version.reason)return version.reason;
    }
    const augment=state.catalog.augmentation.find(item=>item.id===branch.augmentation_run_id);
    if(augment&&(augment.parent_id??null)!==branch.pseudo_label_run_id)return 'Augment must use its recorded Pseudo source.';
  }
  return '';
}
