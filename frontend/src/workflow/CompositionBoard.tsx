import { useEffect, useState } from "react";
import { api } from "../api/client";
import { stageNames, useWorkflow, VersionDetails, type Recipe, type Stage } from "./WorkflowState";

const stages = ["pseudo", "augmentation", "open_data"] as const;
const fields = { pseudo: "pseudo_label_run_id", augmentation: "augmentation_run_id", open_data: "open_data_import_id" } as const;
const empty: Recipe = { pseudo_label_run_id: null, augmentation_run_id: null, open_data_import_id: null };

export function CompositionBoard() {
  const runtime = useWorkflow();
  const [draft, setDraft] = useState<Recipe>(empty);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState<Stage | null>(null);
  const assigned = runtime?.state?.assignments;
  const signature = JSON.stringify(stages.map(stage => assigned?.[stage] ?? null));
  useEffect(() => { setDraft({ pseudo_label_run_id: assigned?.pseudo ?? null, augmentation_run_id: assigned?.augmentation ?? null, open_data_import_id: assigned?.open_data ?? null }); }, [signature]);
  if (!runtime) return null;
  const { state, busy, error, change, projectId } = runtime;
  if (!state) return <section className="panel wide"><p>Loading composition library…</p>{error && <p role="alert">{error}</p>}</section>;
  const select = (stage: typeof stages[number], id: string | null) => {
    const version = state.catalog[stage].find(v => v.id === id);
    if (id && (!version || version.reason)) return;
    setDraft(current => {
      const next = { ...current, [fields[stage]]: id };
      if (stage === "pseudo" && id !== current.pseudo_label_run_id) next.augmentation_run_id = null;
      if (stage === "augmentation" && version) next.pseudo_label_run_id = version.parent_id ?? null;
      return next;
    });
  };
  const total = (draft.augmentation_run_id ? state.catalog.augmentation.find(v => v.id === draft.augmentation_run_id)?.count : state.catalog.pseudo.find(v => v.id === draft.pseudo_label_run_id)?.count) ?? 0;
  const openCount = state.catalog.open_data.find(v => v.id === draft.open_data_import_id)?.count ?? 0;
  return <section className="panel wide composition-board" aria-label="Dataset composition builder">
    <header><h2>Compose dataset versions</h2><p className="muted">Drag a saved module into its slot, or use “Use version”. Augment brings its recorded Pseudo parent. Save & assign to make this recipe available across tabs.</p></header>
    <div className="composition-slots">{stages.map((stage, index) => {
      const version = state.catalog[stage].find(v => v.id === draft[fields[stage]]);
      return <div key={stage} className={`composition-slot ${dragging === stage ? "is-drop-target" : ""}`} onDragOver={event => { if (dragging === stage) event.preventDefault(); }} onDrop={event => {
        event.preventDefault();
        try { const data = JSON.parse(event.dataTransfer.getData("application/x-workflow-version")); if (data.stage === stage) select(stage, data.id); } catch { /* Ignore unrelated external drops. */ }
        setDragging(null);
      }} aria-label={`${stageNames[stage]} slot`}><span className="slot-step">{index === 0 ? "1" : index === 1 ? "→" : "+"} {stageNames[stage]}</span>{version ? <><strong>{version.name}</strong><VersionDetails version={version} /><button type="button" className="secondary" onClick={() => select(stage, null)}>Remove {stageNames[stage]}</button></> : <p className="muted">Drop {stageNames[stage]} here · optional</p>}</div>;
    })}</div>
    <p className="composition-total">→ Split · approximately {(total + openCount).toLocaleString()} labeled images before build</p>
    <div className="inline-actions"><label><span>Composition name</span><input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Aerial · x5 + Open Data" maxLength={120} /></label><button type="button" className="primary action-assign" disabled={busy || !name.trim() || !Object.values(draft).some(Boolean)} onClick={() => void change(() => api.saveComposition(projectId, { ...draft, name: name.trim() }))}>Save & assign composition</button></div>
    {error && <p className="review-error" role="alert">{error}</p>}
    <div className="composition-library">{stages.map(stage => <section key={stage}><h3>{stageNames[stage]} versions</h3>{!state.catalog[stage].length && <p className="muted">No saved version</p>}{state.catalog[stage].map(version => <article className={`version-module ${draft[fields[stage]] === version.id ? "is-selected" : ""}`} key={version.id} draggable={!version.reason && !busy} onDragStart={event => { event.dataTransfer.setData("application/x-workflow-version", JSON.stringify({ stage, id: version.id })); event.dataTransfer.effectAllowed = "copy"; setDragging(stage); }} onDragEnd={() => setDragging(null)}><header><strong>{version.name}</strong><span aria-hidden="true">⠿</span></header><VersionDetails version={version} />{version.reason && <p className="review-error">{version.reason}</p>}<button type="button" className="secondary action-assign" disabled={busy || Boolean(version.reason)} onClick={() => select(stage, version.id)}>Use version · {version.name}</button></article>)}</section>)}</div>
    <section className="composition-history"><h3>Saved combinations</h3><p className="muted">Deleting a recipe keeps its existing Split snapshots and training results.</p>{!state.compositions.length && <p>No saved combinations yet.</p>}{state.compositions.map(item => <article key={item.id} className={`row-card history-row ${state.composition_id === item.id ? "is-assigned" : ""}`}><div><strong>{item.name}{state.composition_id === item.id ? " · Assigned" : ""}</strong><span>{stages.map(stage => { const v = state.catalog[stage].find(v => v.id === item[fields[stage]]); return v ? `${stageNames[stage]} · ${v.name}` : item[fields[stage]] ? `${stageNames[stage]} · deleted` : null; }).filter(Boolean).join(" → ")}</span>{item.reason && <p className="review-error">{item.reason}</p>}</div><div className="inline-actions"><button type="button" className="secondary action-assign" disabled={busy || Boolean(item.reason)} onClick={() => { setDraft({ pseudo_label_run_id: item.pseudo_label_run_id, augmentation_run_id: item.augmentation_run_id, open_data_import_id: item.open_data_import_id }); void change(() => api.assignComposition(projectId, item.id)); }}>Assign combination</button><button type="button" className="secondary danger action-delete" disabled={busy} aria-label={`Delete combination ${item.name}`} onClick={() => { if (window.confirm(`Delete saved combination “${item.name}”? Existing Split snapshots and training results will be kept.`)) void change(() => api.deleteComposition(projectId, item.id)); }}>Delete</button></div></article>)}</section>
  </section>;
}
