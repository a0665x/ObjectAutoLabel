import {useRef, useState} from 'react';
import {ArrowRight, ArrowUpRight, Check, Plus, Trash2, X} from 'lucide-react';
import {api} from '../api/client';
import {stageNames, useWorkflow, VersionDetails, type Version} from './WorkflowState';
import {chooseVersion, inputStages, recipeFields, recipeIssue, sameRecipe, type InputStage} from './composition';

const hints:Record<InputStage,string>={pseudo:'Base labels',augmentation:'Transform · optional',open_data:'Add images · optional'};

export function CompositionBoard({disabled=false}:{disabled?:boolean}) {
  const runtime=useWorkflow();
  const [name,setName]=useState('');
  const [notice,setNotice]=useState('');
  const [localError,setLocalError]=useState('');
  const [dragging,setDragging]=useState<InputStage|null>(null);
  const [flash,setFlash]=useState({stages:[] as InputStage[],serial:0});
  const [expanded,setExpanded]=useState<Partial<Record<InputStage,boolean>>>({});
  const library=useRef<HTMLDivElement>(null);
  if(!runtime)return null;
  const {state,busy,error,change,projectId,draft,setDraft,saveDraft,viewVersion}=runtime;
  if(!state)return <section className="panel wide"><p>Loading source versions…</p>{error&&<p role="alert">{error}</p>}</section>;
  const locked=busy||disabled;
  const issue=recipeIssue(state,draft);
  const selected=(stage:InputStage)=>state.catalog[stage].find(item=>item.id===draft[recipeFields[stage]]);
  const total=(selected('augmentation')?.count??selected('pseudo')?.count??0)+(selected('open_data')?.count??0);
  const currentCombination=state.compositions.find(item=>!item.reason&&sameRecipe(item,draft));
  function select(stage:InputStage,id:string|null) {
    if(locked)return;
    const next=chooseVersion(state!,draft,stage,id);
    if(next===draft)return;
    setDraft(next);setLocalError('');
    const changed=inputStages.filter(key=>next[recipeFields[key]]!==draft[recipeFields[key]]);
    setFlash(current=>({stages:changed,serial:current.serial+1}));
    setNotice(stage==='augmentation'&&id?'Augment selected; its Pseudo source is linked automatically.':
      stage==='pseudo'&&draft.augmentation_run_id&&next.augmentation_run_id===null?'Pseudo changed; the previous Augment was removed.':'Inputs updated.');
  }
  function reveal(stage:InputStage) {
    setExpanded(current=>({...current,[stage]:true}));
    const target=library.current?.querySelector<HTMLElement>(`[data-library-stage="${stage}"]`);
    target?.scrollIntoView({block:'nearest',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    target?.focus({preventScroll:true});
  }
  function openButton(stage:InputStage,version:Version) {
    return <button type="button" className="secondary composition-open" title={`Open ${stageNames[stage]} · ${version.name}`}
      aria-label={`Open ${stageNames[stage]} version ${version.name}`} disabled={locked} onClick={()=>viewVersion(stage,version.id)}><ArrowUpRight size={17}/></button>;
  }
  return <section className="panel wide composition-board" aria-label="Dataset composition builder">
    <header className="composition-heading"><div><span className="composition-step">1 · Sources</span><h2>Choose your dataset inputs</h2>
      <p className="muted">Pseudo → optional Augment, plus optional Open Data. Then set ratios and build below.</p></div></header>
    <div className="composition-slots">{inputStages.map(stage=>{
      const version=selected(stage);
      return <article key={stage} data-stage={stage}
        className={`composition-slot ${dragging===stage?'is-drop-target':''}`}
        onDragOver={event=>{if(dragging===stage&&!locked)event.preventDefault();}}
        onDrop={event=>{
          event.preventDefault(); if(locked)return;
          try {const data=JSON.parse(event.dataTransfer.getData('application/x-workflow-version'));if(data.stage===stage)select(stage,data.id);}catch{/* Ignore unrelated drops. */}
          setDragging(null);
        }} aria-label={`${stageNames[stage]} slot`}>
        <div key={flash.stages.includes(stage)?flash.serial:'steady'} className={flash.stages.includes(stage)?'composition-slot-content is-linked':'composition-slot-content'}>
          <header><span className="composition-source-label">{stage==='augmentation'?<ArrowRight size={15}/>:stage==='open_data'?<Plus size={15}/>:null}{stageNames[stage]}</span>{version&&openButton(stage,version)}</header>
          <small>{hints[stage]}</small>
          <strong>{version?.name??(draft[recipeFields[stage]]?'Version unavailable':'Not included')}</strong>
          <span className="composition-count">{version?`${version.count.toLocaleString()} images`:'Choose a version below'}</span>
          {stage==='augmentation'&&version?.parent_id&&<small>From {selected('pseudo')?.name??version.parent_id}</small>}
          <footer><button type="button" className="secondary" disabled={locked} onClick={()=>reveal(stage)}>{version?'Change':'Choose'}</button>
            {draft[recipeFields[stage]]&&<button type="button" className="secondary composition-remove" disabled={locked} aria-label={`Remove ${stageNames[stage]}`} onClick={()=>select(stage,null)}><X size={16}/></button>}</footer>
        </div>
      </article>;
    })}</div>
    <div className="composition-summary"><strong>Split input · ≈ {total.toLocaleString()} images</strong><span>{draft.augmentation_run_id?'Augment replaces Pseudo; Open Data is added.':'Selected Pseudo + Open Data.'}</span></div>
    <p className="composition-feedback" role="status">{notice||'Choose cards below, or drag them into the matching source slot.'}</p>
    <div className="composition-library" ref={library}>{inputStages.map(stage=>{
      const versions=state.catalog[stage];
      const shown=expanded[stage]?versions:versions.filter((item,index)=>index<3||item.id===draft[recipeFields[stage]]);
      return <section key={stage} data-stage={stage} data-library-stage={stage} tabIndex={-1} aria-label={`${stageNames[stage]} versions`}>
        <header className="composition-library-heading"><h3>{stageNames[stage]}</h3><span>{versions.length} versions</span></header>
        {!versions.length&&<p className="muted">No saved version</p>}
        {shown.map(version=><article key={version.id} data-stage={stage} className={`version-module composition-version ${draft[recipeFields[stage]]===version.id?'is-selected':''}`}
          draggable={!version.reason&&!locked} onDragStart={event=>{event.dataTransfer.setData('application/x-workflow-version',JSON.stringify({stage,id:version.id}));event.dataTransfer.effectAllowed='copy';setDragging(stage);}} onDragEnd={()=>setDragging(null)}>
          <header><strong>{version.name}</strong>{openButton(stage,version)}</header>
          <span>{version.count.toLocaleString()} images · {version.created_at.slice(0,10)}</span>
          <details><summary>Details</summary><VersionDetails version={version}/></details>
          {version.reason&&<p className="review-error">{version.reason}</p>}
          <button type="button" className="secondary composition-use" aria-label={`Use version · ${version.name}`} aria-pressed={draft[recipeFields[stage]]===version.id}
            disabled={locked||Boolean(version.reason)} onClick={()=>select(stage,version.id)}>{draft[recipeFields[stage]]===version.id?<><Check size={15}/>Selected</>:'Use this version'}</button>
        </article>)}
        {versions.length>3&&<button type="button" className="secondary" onClick={()=>setExpanded(current=>({...current,[stage]:!current[stage]}))}>{expanded[stage]?'Show fewer':`Show all ${versions.length}`}</button>}
      </section>;
    })}</div>
    <section className="composition-history">
      <header><h3>Saved combinations</h3><small>Reuse a source selection.</small></header>
      <details className="composition-save"><summary>Save current combination</summary>
        <div className="inline-actions"><label><span>Combination name</span><input value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. Aerial + Open Data" maxLength={120}/></label>
          <button type="button" className="secondary" disabled={locked||!name.trim()||Boolean(issue)} onClick={async()=>{
            setLocalError('');try{const saved=await saveDraft(name.trim());setNotice(`Saved “${saved.name}”. Ready to build below.`);setName('');}catch(cause){setLocalError(String(cause));}
          }}>Save combination</button></div>
      </details>
      {!state.compositions.length&&<p className="muted">No saved combinations. Building a Split saves your inputs automatically.</p>}
      {state.compositions.map(item=><article key={item.id} className={`row-card composition-saved ${currentCombination?.id===item.id?'is-selected':''}`}>
        <div><strong>{item.name}</strong><div className="composition-recipe-chips">{inputStages.map(stage=>{
          const id=item[recipeFields[stage]];if(!id)return null;
          const version=state.catalog[stage].find(candidate=>candidate.id===id);
          return <span key={stage} data-stage={stage}>{stageNames[stage]} · {version?.name??'Unavailable'}</span>;
        })}</div>{item.reason&&<p className="review-error">{item.reason}</p>}</div>
        <div className="inline-actions"><button type="button" className="secondary" aria-pressed={currentCombination?.id===item.id} disabled={locked||Boolean(item.reason)} onClick={()=>{
          setDraft({pseudo_label_run_id:item.pseudo_label_run_id,augmentation_run_id:item.augmentation_run_id,open_data_import_id:item.open_data_import_id});
          setFlash(current=>({stages:[...inputStages],serial:current.serial+1}));setNotice(`Using “${item.name}”. Set ratios and build below.`);
        }}>{currentCombination?.id===item.id?'In use':'Use combination'}</button>
          <button type="button" className="secondary danger composition-remove" disabled={locked} aria-label={`Delete combination ${item.name}`} title="Delete saved combination" onClick={()=>{
            if(window.confirm(`Delete saved combination “${item.name}”? Existing Split snapshots and training results will be kept.`))void change(()=>api.deleteComposition(projectId,item.id));
          }}><Trash2 size={16}/></button></div>
      </article>)}
    </section>
    {(error||localError)&&<p className="review-error" role="alert">{localError||error}</p>}
  </section>;
}
