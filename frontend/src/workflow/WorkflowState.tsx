import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import {assignedRecipe, recipeIssue, sameRecipe, sourcePages} from './composition';
import type {Language} from '../types';
import {workflowText} from './text';
import {uiText} from '../uiText';
import {WorkflowError} from './WorkflowError';

export type Stage = "source" | "pseudo" | "augmentation" | "open_data" | "split" | "training" | "conversion";
export type SourceBranch = {pseudo_label_run_id:string|null;augmentation_run_id:string|null};
export type Recipe = SourceBranch & { open_data_import_id: string | null; branches?:SourceBranch[] };
export type Version = { id: string; name: string; count: number; settings: Record<string, unknown>; reason: string; parent_id?: string | null; created_at: string };
export type Composition = Recipe & { id: string; name: string; reason: string; created_at: string };
export type WorkflowState = { project_id: string; assignments: Partial<Record<Stage, string>>; composition_id: string | null; compositions: Composition[]; catalog: Record<Exclude<Stage,'source'>, Version[]> & {source?:Version[]} };
export const stageNames: Record<Stage, string> = { source:'Source', pseudo: "Pseudo", augmentation: "Augment", open_data: "Open Data", split: "Split", training: "Train", conversion: "Convert" };
export type VersionFocus = {stage:Stage; id:string; serial:number};
export type SplitView = {mode:'new'} | {mode:'history';id:string};
type Runtime = { state: WorkflowState | null; busy: boolean; error: string; reload: () => Promise<void>; change: (operation: () => Promise<WorkflowState>) => Promise<WorkflowState|null>; projectId: string;
  draft:Recipe; setDraft:(draft:Recipe)=>void; saveDraft:(name?:string)=>Promise<Composition>;
  focus:VersionFocus|null; viewVersion:(stage:Stage,id:string)=>void; backToSplit:()=>void;
  useSplitForTraining:(id:string)=>Promise<void>;
  language:Language;
  reviewDirty:boolean;setReviewDirty:(dirty:boolean)=>void;
  splitView:SplitView; selectSplit:(id:string)=>void; newSplit:()=>void;
};
const Context = createContext<Runtime | null>(null);
export const useWorkflow = () => useContext(Context);
const assignmentKey=(state:WorkflowState|null)=>JSON.stringify([state?.composition_id,...Object.keys(stageNames).map(stage=>state?.assignments[stage as Stage]??null)]);

export function WorkflowProvider({ projectId, revision, children, onNavigate, language='en' }: { projectId: string; revision: string; children: ReactNode; onNavigate?:(page:string)=>void; language?:Language }) {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewDirty,setReviewDirty]=useState(false);
  const sequence = useRef(0);
  const locked = useRef(false);
  const priorAssignments=useRef<string|null>(null);
  const [draftOverride,setDraftOverride]=useState<Recipe|null>(null);
  const [focus,setFocus]=useState<VersionFocus|null>(null);
  const [splitOverride,setSplitOverride]=useState<SplitView|null>(null);
  const splitView=splitOverride??(state?.assignments.split?{mode:'history' as const,id:state.assignments.split}:{mode:'new' as const});
  const draft=draftOverride??assignedRecipe(state);
  const reload = useCallback(async () => {
    if (!projectId || locked.current) return;
    const ticket = ++sequence.current;
    try {
      const next = await api.workflowState(projectId);
      if (ticket === sequence.current) {
        if(priorAssignments.current!==null&&priorAssignments.current!==assignmentKey(next)){
          setFocus(null);
          setDraftOverride(null);setSplitOverride(next.assignments.split?{mode:'history',id:next.assignments.split}:{mode:'new'});
        }
        priorAssignments.current=assignmentKey(next);setState(next);setError("");
      }
    } catch (cause) { if (ticket === sequence.current) setError(String(cause)); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload, revision]);
  useEffect(() => { const timer = window.setInterval(() => void reload(), 5000); return () => { sequence.current++; window.clearInterval(timer); }; }, [reload]);
  async function change(operation: () => Promise<WorkflowState>) {
    if (locked.current) return null;
    locked.current = true;
    const ticket = ++sequence.current;
    setBusy(true); setError("");
    try { const next = await operation(); if (ticket === sequence.current) {
      if(assignmentKey(next)!==assignmentKey(state)) {
        setFocus(null);
        setDraftOverride(null);
        setSplitOverride(next.assignments.split?{mode:'history',id:next.assignments.split}:{mode:'new'});
      }
      priorAssignments.current=assignmentKey(next);setState(next);return next;
    } return null; }
    catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : String(cause)); return null; }
    finally { locked.current = false; setBusy(false); }
  }
  async function saveDraft(name?:string):Promise<Composition> {
    if(locked.current)throw new Error('Wait for the current operation to finish.');
    const issue=recipeIssue(state,draft);
    if(issue)throw new Error(issue);
    const existing=state!.compositions.find(item=>!item.reason&&sameRecipe(item,draft)&&(!name||item.name===name));
    if(existing)return existing;
    let number=state!.compositions.length+1;
    while(state!.compositions.some(item=>item.name===`Combination ${number}`))number++;
    const next=await change(()=>api.saveComposition(projectId,{...draft,name:name?.trim()||`Combination ${number}`}));
    const saved=next?.compositions.find(item=>item.id===next.composition_id&&sameRecipe(item,draft));
    if(!saved)throw new Error('Could not save these inputs. Check the source versions and retry.');
    return saved;
  }
  function viewVersion(stage:Stage,id:string) {
    if(!state?.catalog[stage]?.some(item=>item.id===id))return;
    setFocus(current=>({stage,id,serial:(current?.serial??0)+1}));
    onNavigate?.(sourcePages[stage]);
  }
  return <Context.Provider value={{ state, busy, error, reload, change, projectId, draft,
    setDraft:next=>{setDraftOverride(next);setSplitOverride({mode:'new'});}, saveDraft, focus, viewVersion, language,reviewDirty,setReviewDirty,
    splitView,selectSplit:id=>setSplitOverride({mode:'history',id}),newSplit:()=>setSplitOverride({mode:'new'}),
    backToSplit:()=>{setFocus(null);onNavigate?.('split');},
    useSplitForTraining:async id=>{const next=await change(()=>api.assignWorkflow(projectId,'split',id));if(next)onNavigate?.('train');}
  }}>{children}</Context.Provider>;
}

export function WorkflowInputs({stages}:{stages:Stage[]}) {
  const runtime=useWorkflow(),w=workflowText(runtime?.language),ui=uiText(runtime?.language??'en');
  if(!runtime)return null;
  return <section className="panel workflow-inputs" aria-label={w('Input versions')}><h2>{w('Input versions')}</h2>
    <div className="field-row">{stages.map(stage=><label key={stage}><span>{w('{stage} input version',{stage:w(stageNames[stage])})}</span>
      <select value={runtime.state?.assignments[stage]??''} disabled={!runtime.state||runtime.busy} onChange={event=>{
        if(runtime.reviewDirty&&!window.confirm(ui('You have unsaved review changes. Switch anyway?')))return;
        void runtime.change(()=>api.assignWorkflow(runtime.projectId,stage,event.target.value||null));
      }}><option value="">{w('Not assigned')}</option>{runtime.state?.catalog[stage]?.map(version=><option key={version.id} value={version.id} disabled={Boolean(version.reason)}>{version.name} · {w('{count} images',{count:version.count.toLocaleString()})} · {version.id.slice(0,8)}</option>)}</select></label>)}</div>
    <WorkflowError message={runtime.error}/>
  </section>;
}

export function VersionDetails({ version }: { version: Version }) {
  const w=workflowText(useWorkflow()?.language);
  return <><span>{w('{count} images',{count:version.count.toLocaleString()})} · {version.created_at.slice(0, 16).replace("T", " ")}</span><dl className="version-settings">{Object.entries(version.settings).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt title={key}>{w(key.replaceAll("_", " "))}</dt><dd>{key.endsWith('box_area_ratio')&&typeof value==='number'?`${(value*100).toLocaleString(undefined,{maximumFractionDigits:3})}%`:typeof value === "object" ? JSON.stringify(value) : typeof value === 'boolean' ? w(String(value)) : String(value)}</dd></div>)}</dl></>;
}

export function AssignmentFooter({ page, onDeleted }: { page: string; onDeleted: () => Promise<void> }) {
  const runtime = useWorkflow();
  const ui=uiText(runtime?.language??'en');
  const w=workflowText(runtime?.language);
  const stage = ({ pseudo: "pseudo", review: "pseudo", augment: "augmentation", "open-data": "open_data", split: "split", train: "training", validate: "training", convert: "conversion", "stream-demo": "conversion" } as Record<string, Exclude<Stage,'source'>>)[page];
  if (!runtime || !stage) return null;
  const { state, busy, error, change, projectId } = runtime;
  const assign=(id:string|null)=>{
    if(page==='review'&&runtime.reviewDirty&&!window.confirm(ui('You have unsaved review changes. Switch anyway?')))return;
    void change(()=>api.assignWorkflow(projectId,stage,id)).then(next=>{if(next&&stage==='split'&&id)runtime.selectSplit(id);});
  };
  const versions = state?.catalog[stage] ?? [];
  const selected = state?.assignments[stage];
  return <section className="panel assignment-footer workflow-history" aria-label={ui('{stage} assignment and history',{stage:ui(stageNames[stage])})}>
    <div className="sidebar-header"><div><h2>{ui('{stage} · Assign & history',{stage:ui(stageNames[stage])})}</h2><p className="muted">{ui('Assign a saved version for downstream tabs. Changing an upstream assignment clears dependent assignments.')}</p></div><span className="assigned-badge">{ui('Assigned: {name}',{name:versions.find(v => v.id === selected)?.name ?? ui('None')})}</span></div>
    {error && <p className="review-error" role="alert">{error}</p>}
{!state ? <p>{ui('Loading project assignments…')}</p> : !versions.length ? <p className="muted">{ui('No saved {stage} versions yet.',{stage:ui(stageNames[stage])})}</p> : <div className="version-library">{versions.map(version => <article key={version.id} className={`version-module ${version.id === selected ? "is-assigned" : ""}`}><header><strong>{version.name}</strong>{version.id === selected && <span className="assigned-badge">{ui('Assigned')}</span>}</header><VersionDetails version={version} />{version.reason && <p className="review-error">{version.reason}</p>}<footer className="inline-actions">{stage==='split'&&<button type="button" className="secondary" onClick={()=>runtime.selectSplit(version.id)}>{workflowText(runtime.language)('View Split {name}',{name:version.name})}</button>}<button type="button" className="secondary action-assign" disabled={busy || Boolean(version.reason)} onClick={() => assign(version.id)}>{ui('Assign {stage}',{stage:ui(stageNames[stage])})}</button><button type="button" className="secondary danger action-delete" disabled={busy} aria-label={stage==='split'?w('Delete split history {name}',{name:version.name}):ui('Delete saved {stage} {name}',{stage:ui(stage),name:version.name})} onClick={() => {
      if (!window.confirm(stage==='split'?w('Delete Split “{name}” and dependent training/export history? Raw sources are preserved.',{name:version.name}):ui('Delete {stage} “{name}” and all dependent build, training and export history? Raw inputs and shared caches are preserved.',{stage:ui(stageNames[stage]),name:version.name}))) return;
      void change(async () => { await api.deleteHistory(projectId, stage, version.id); await onDeleted(); return api.workflowState(projectId); });
    }}>{ui('Delete')}</button></footer></article>)}</div>}
    {selected && <button type="button" className="secondary" disabled={busy} onClick={() => assign(null)}>{ui('Clear assignment')}</button>}
  </section>;
}
