import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import {assignedRecipe, recipeIssue, sameRecipe, sourcePages} from './composition';

export type Stage = "pseudo" | "augmentation" | "open_data" | "split" | "training" | "conversion";
export type Recipe = { pseudo_label_run_id: string | null; augmentation_run_id: string | null; open_data_import_id: string | null };
export type Version = { id: string; name: string; count: number; settings: Record<string, unknown>; reason: string; parent_id?: string | null; created_at: string };
export type Composition = Recipe & { id: string; name: string; reason: string; created_at: string };
export type WorkflowState = { project_id: string; assignments: Partial<Record<Stage, string>>; composition_id: string | null; compositions: Composition[]; catalog: Record<Stage, Version[]> };
export const stageNames: Record<Stage, string> = { pseudo: "Pseudo", augmentation: "Augment", open_data: "Open Data", split: "Split", training: "Train", conversion: "Convert" };
export type VersionFocus = {stage:Stage; id:string; serial:number};
type Runtime = { state: WorkflowState | null; busy: boolean; error: string; reload: () => Promise<void>; change: (operation: () => Promise<WorkflowState>) => Promise<WorkflowState|null>; projectId: string;
  draft:Recipe; setDraft:(draft:Recipe)=>void; saveDraft:(name?:string)=>Promise<Composition>;
  focus:VersionFocus|null; viewVersion:(stage:Stage,id:string)=>void; backToSplit:()=>void;
  useSplitForTraining:(id:string)=>Promise<void>;
};
const Context = createContext<Runtime | null>(null);
export const useWorkflow = () => useContext(Context);

export function WorkflowProvider({ projectId, revision, children, onNavigate }: { projectId: string; revision: string; children: ReactNode; onNavigate?:(page:string)=>void }) {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const locked = useRef(false);
  const [draftOverride,setDraftOverride]=useState<Recipe|null>(null);
  const [focus,setFocus]=useState<VersionFocus|null>(null);
  const draft=draftOverride??assignedRecipe(state);
  const reload = useCallback(async () => {
    if (!projectId || locked.current) return;
    const ticket = ++sequence.current;
    try {
      const next = await api.workflowState(projectId);
      if (ticket === sequence.current) { setState(next); setError(""); }
    } catch (cause) { if (ticket === sequence.current) setError(String(cause)); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload, revision]);
  useEffect(() => { const timer = window.setInterval(() => void reload(), 5000); return () => { sequence.current++; window.clearInterval(timer); }; }, [reload]);
  async function change(operation: () => Promise<WorkflowState>) {
    if (locked.current) return null;
    locked.current = true;
    const ticket = ++sequence.current;
    setBusy(true); setError("");
    try { const next = await operation(); if (ticket === sequence.current) {setState(next);return next;} return null; }
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
    if(!state?.catalog[stage].some(item=>item.id===id))return;
    setFocus(current=>({stage,id,serial:(current?.serial??0)+1}));
    onNavigate?.(sourcePages[stage]);
  }
  return <Context.Provider value={{ state, busy, error, reload, change, projectId, draft, setDraft:setDraftOverride, saveDraft, focus, viewVersion,
    backToSplit:()=>{setFocus(null);onNavigate?.('split');},
    useSplitForTraining:async id=>{const next=await change(()=>api.assignWorkflow(projectId,'split',id));if(next)onNavigate?.('train');}
  }}>{children}</Context.Provider>;
}

export function VersionDetails({ version }: { version: Version }) {
  return <><span>{version.count.toLocaleString()} images · {version.created_at.slice(0, 16).replace("T", " ")}</span><dl className="version-settings">{Object.entries(version.settings).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></>;
}

export function AssignmentFooter({ page, onDeleted }: { page: string; onDeleted: () => Promise<void> }) {
  const runtime = useWorkflow();
  const stage = ({ pseudo: "pseudo", review: "pseudo", augment: "augmentation", "open-data": "open_data", split: "split", train: "training", validate: "training", convert: "conversion", "stream-demo": "conversion" } as Record<string, Stage>)[page];
  if (!runtime || !stage) return null;
  const { state, busy, error, change, projectId } = runtime;
  const versions = state?.catalog[stage] ?? [];
  const selected = state?.assignments[stage];
  return <section className="panel assignment-footer" aria-label={`${stageNames[stage]} assignment and history`}>
    <div className="sidebar-header"><div><h2>{stageNames[stage]} · Assign & history</h2><p className="muted">Assign a saved version for downstream tabs. Changing an upstream assignment clears dependent assignments.</p></div><span className="assigned-badge">Assigned: {versions.find(v => v.id === selected)?.name ?? "None"}</span></div>
    {error && <p className="review-error" role="alert">{error}</p>}
    {!state ? <p>Loading project assignments…</p> : !versions.length ? <p className="muted">No saved {stageNames[stage]} versions yet.</p> : <div className="version-library">{versions.map(version => <article key={version.id} className={`version-module ${version.id === selected ? "is-assigned" : ""}`}><header><strong>{version.name}</strong>{version.id === selected && <span className="assigned-badge">Assigned</span>}</header><VersionDetails version={version} />{version.reason && <p className="review-error">{version.reason}</p>}<footer className="inline-actions"><button type="button" className="secondary action-assign" disabled={busy || Boolean(version.reason)} onClick={() => void change(() => api.assignWorkflow(projectId, stage, version.id))}>Assign {stageNames[stage]}</button><button type="button" className="secondary danger action-delete" disabled={busy} aria-label={`Delete saved ${stage} ${version.name}`} onClick={() => {
      if (!window.confirm(`Delete ${stageNames[stage]} “${version.name}” and all dependent build, training and export history? Raw inputs and shared caches are preserved.`)) return;
      void change(async () => { await api.deleteHistory(projectId, stage, version.id); await onDeleted(); return api.workflowState(projectId); });
    }}>Delete</button></footer></article>)}</div>}
    {selected && <button type="button" className="secondary" disabled={busy} onClick={() => void change(() => api.assignWorkflow(projectId, stage, null))}>Clear assignment</button>}
  </section>;
}
