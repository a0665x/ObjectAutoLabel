import {Fragment, useEffect, useId, useRef, useState} from 'react';
import {ArrowRight, ArrowUpRight, Check, ChevronDown, Layers, Plus, SlidersHorizontal, Trash2, X} from 'lucide-react';
import {api} from '../api/client';
import {stageNames, useWorkflow, VersionDetails, type Version} from './WorkflowState';
import {chooseVersion, inputStages, recipeFields, recipeIssue, sameRecipe, type InputStage} from './composition';
import {workflowText} from './text';
import {WorkflowError} from './WorkflowError';
import './CompositionFlow.css';

const hints:Record<InputStage,string>={pseudo:'Base labels',augmentation:'Optional · uses its recorded Pseudo source',open_data:'Optional · adds images'};

export function CompositionBoard({disabled=false,onConfigureSplit}:{disabled?:boolean;onConfigureSplit?:()=>void}) {
  const runtime=useWorkflow();
  const [name,setName]=useState('');
  const [notice,setNotice]=useState<{key:string;name?:string}>({key:''});
  const [localError,setLocalError]=useState('');
  const [expanded,setExpanded]=useState<Partial<Record<InputStage,boolean>>>({});
  const [activeStage,setActiveStage]=useState<InputStage|null>(null);
  const flowRef=useRef<HTMLDivElement>(null);
  const panelRef=useRef<HTMLElement>(null);
  const triggers=useRef<Partial<Record<InputStage,HTMLButtonElement|null>>>({});
  const panelId=useId();
  useEffect(()=>{
    if(!activeStage)return;
    panelRef.current?.focus();
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Node&&!flowRef.current?.contains(event.target))setActiveStage(null);
    };
    document.addEventListener('pointerdown',dismiss);
    return ()=>document.removeEventListener('pointerdown',dismiss);
  },[activeStage]);
  if(!runtime)return null;
  const {state,busy,error,change,projectId,draft,setDraft,saveDraft,viewVersion,language}=runtime;
  const w=workflowText(language);
  if(!state)return <section className="panel wide"><p>{w('Loading source versions…')}</p><WorkflowError message={error}/></section>;
  const locked=busy||disabled;
  const issue=recipeIssue(state,draft);
  const selected=(stage:InputStage)=>state.catalog[stage].find(item=>item.id===draft[recipeFields[stage]]);
  const total=(selected('augmentation')?.count??selected('pseudo')?.count??0)+(selected('open_data')?.count??0);
  const currentCombination=state.compositions.find(item=>!item.reason&&sameRecipe(item,draft));
  function closePanel(){if(activeStage)triggers.current[activeStage]?.focus();setActiveStage(null);}
  function select(stage:InputStage,id:string|null) {
    if(locked)return;
    const next=chooseVersion(state!,draft,stage,id);
    if(next===draft)return;
    setDraft(next);setLocalError('');
    setNotice({key:stage==='augmentation'&&id?'Augment selected; its Pseudo source is linked automatically.':
      stage==='pseudo'&&draft.augmentation_run_id&&next.augmentation_run_id===null?'Pseudo changed; the previous Augment was removed.':'Inputs updated.'});
    closePanel();
  }
  function openButton(stage:InputStage,version:Version) {
    const label=w('Open {stage} version {name}',{stage:w(stageNames[stage]),name:version.name});
    return <button type="button" className="secondary composition-open" title={label} aria-label={label} disabled={locked}
      onClick={()=>viewVersion(stage,version.id)}><ArrowUpRight size={17}/></button>;
  }
  return <section className="panel wide composition-board" aria-label={w('Dataset sources')}>
    <header className="composition-heading"><h2>{w('Dataset sources')}</h2><p className="muted">{w('Click a step to switch versions.')}</p></header>
    <div ref={flowRef} className="composition-flow-workspace" onKeyDown={event=>{if(event.key==='Escape'&&activeStage){event.preventDefault();closePanel();}}}>
    <div className="composition-flow" aria-label={w('Dataset processing flow')}>
      {inputStages.map((stage,index)=>{
        const versions=state.catalog[stage],version=selected(stage),included=Boolean(draft[recipeFields[stage]]);
        const preview=versions.filter(item=>item.id!==version?.id).slice(0,2);
        return <Fragment key={stage}>
          {index>0&&<span key={JSON.stringify(draft)} className="composition-connector" aria-label={w(index===1?'Process':'Add images')} data-kind={index===1?'arrow':'plus'}>{index===1?<ArrowRight size={20}/>:<Plus size={20}/>}</span>}
          <button type="button" ref={node=>{triggers.current[stage]=node;}} data-flow-stage={stage} data-stage={stage}
            className="composition-flow-node" data-included={included} aria-expanded={activeStage===stage} aria-controls={panelId}
            aria-label={w('Choose {stage} version',{stage:w(stageNames[stage])})} aria-describedby={`${panelId}-${stage}-value ${panelId}-${stage}-count`} disabled={locked}
            onClick={()=>setActiveStage(current=>current===stage?null:stage)}>
            <span className="composition-stack" aria-hidden="true">{preview.slice().reverse().map((item,index)=><span className="composition-stack-back" data-depth={preview.length-index-1} key={item.id}><span>{item.name}</span></span>)}</span>
            <span className="composition-flow-face">
              <span className="composition-flow-label"><Layers size={17}/>{w(stageNames[stage])}<ChevronDown className="composition-flow-chevron" size={16}/></span>
              <strong id={`${panelId}-${stage}-value`} key={version?.id??'empty'} className="composition-flow-value">{version?.name??w(included?'Version unavailable':'Not included')}</strong>
              <span id={`${panelId}-${stage}-count`} className="composition-flow-meta">{version?w(stage==='pseudo'?'{count} labeled':'{count} images',{count:version.count.toLocaleString()}):w('Choose version')}</span>
              <span className="composition-flow-footer"><span>{versions.length===1?w('1 version'):w('{count} versions',{count:versions.length})}</span>{included&&<Check size={15} aria-label={w('Selected')}/>}</span>
            </span>
          </button>
        </Fragment>;
      })}
      <span key={JSON.stringify(draft)} className="composition-connector" data-kind="arrow" aria-label={w('Build')}><ArrowRight size={20}/></span>
      <button type="button" className="composition-flow-node composition-flow-result" data-stage="split" disabled={locked||!onConfigureSplit}
        aria-label={w('Set ratios & build')} onClick={()=>{setActiveStage(null);onConfigureSplit?.();}}>
        <span className="composition-flow-face"><span className="composition-flow-label"><SlidersHorizontal size={17}/>{w('Split')}<ArrowUpRight size={16}/></span>
          <strong>{w('New Split')}</strong><span className="composition-flow-meta">{w('Approx. {count} images',{count:total.toLocaleString()})}</span><span className="composition-flow-footer">{w('Set ratios')}</span></span>
      </button>
    </div>
    <div id={panelId} hidden={!activeStage}>
    {activeStage&&(()=>{const stage=activeStage;
      const versions=state.catalog[stage];
      const shown=expanded[stage]?versions:versions.filter((item,index)=>index<3||item.id===draft[recipeFields[stage]]);
      return <section ref={panelRef} tabIndex={-1} key={stage} className="composition-version-panel" data-stage={stage} data-library-stage={stage} aria-label={w(stageNames[stage])}>
        <header className="composition-library-heading"><h3>{w(stageNames[stage])}</h3><span>{w('{count} versions',{count:versions.length})}</span>
          {draft[recipeFields[stage]]&&<button type="button" className="secondary composition-remove" disabled={locked} title={w('Remove {stage}',{stage:w(stageNames[stage])})} aria-label={w('Remove {stage}',{stage:w(stageNames[stage])})} onClick={()=>select(stage,null)}><X size={16}/></button>}
          <button type="button" className="secondary composition-remove" aria-label={w('Close version picker')} title={w('Close version picker')} onClick={closePanel}><ChevronDown className="composition-close-chevron" size={18}/></button>
        </header>
        <small className="muted">{w(hints[stage])}</small>
        {draft[recipeFields[stage]]&&!selected(stage)&&<p className="review-error">{w('Version unavailable')}</p>}
        {!versions.length&&<p className="muted">{w('No saved version')}</p>}
        <div className="composition-version-options">{shown.map(version=><article key={version.id} data-stage={stage} className={'version-module composition-version '+(draft[recipeFields[stage]]===version.id?'is-selected':'')}>
          <header><strong>{version.name}</strong>{openButton(stage,version)}</header>
          <span>{w('{count} images',{count:version.count.toLocaleString()})} · {version.created_at.slice(0,10)}</span>
          {stage==='augmentation'&&version.parent_id&&<small className="muted">{w('From {name}',{name:state.catalog.pseudo.find(item=>item.id===version.parent_id)?.name??version.parent_id})}</small>}
          <details><summary>{w('Details')}</summary><VersionDetails version={version}/></details>
          <WorkflowError message={version.reason}/>
          <button type="button" className="secondary composition-use" aria-label={w('Use version · {name}',{name:version.name})} aria-pressed={draft[recipeFields[stage]]===version.id}
            disabled={locked||Boolean(version.reason)} onClick={()=>select(stage,version.id)}>{draft[recipeFields[stage]]===version.id?<><Check size={15}/>{w('Selected')}</>:w('Use this version')}</button>
        </article>)}</div>
        {versions.length>3&&<button type="button" className="secondary" onClick={()=>setExpanded(current=>({...current,[stage]:!current[stage]}))}>{expanded[stage]?w('Show fewer'):w('Show all {count}',{count:versions.length})}</button>}
      </section>;
    })()}</div></div>
    <p className="composition-feedback" role="status">{notice.key?w(notice.key,{name:notice.name??''}):w(draft.augmentation_run_id?'Augment replaces Pseudo; Open Data is added.':'Selected Pseudo + Open Data.')}</p>
    <details className="composition-history">
      <summary>{w('Saved combinations')} <span className="muted">({state.compositions.length})</span></summary>
      <details className="composition-save"><summary>{w('Save current combination')}</summary>
        <div className="inline-actions"><label><span>{w('Combination name')}</span><input value={name} onChange={event=>setName(event.target.value)} maxLength={120}/></label>
          <button type="button" className="secondary" disabled={locked||!name.trim()||Boolean(issue)} onClick={async()=>{
            setLocalError('');try{const saved=await saveDraft(name.trim());setNotice({key:'Saved “{name}”. Ready to build below.',name:saved.name});setName('');}catch(cause){setLocalError(cause instanceof Error?cause.message:String(cause));}
          }}>{w('Save combination')}</button></div>
      </details>
      {!state.compositions.length&&<p className="muted">{w('No saved combinations. Building a Split saves your inputs automatically.')}</p>}
      {state.compositions.map(item=><article key={item.id} className={'row-card composition-saved '+(currentCombination?.id===item.id?'is-selected':'')}>
        <div><strong>{item.name}</strong><div className="composition-recipe-chips">{inputStages.map(stage=>{
          const id=item[recipeFields[stage]];if(!id)return null;
          const version=state.catalog[stage].find(candidate=>candidate.id===id);
          return <span key={stage} data-stage={stage}>{w(stageNames[stage])} · {version?.name??w('Version unavailable')}</span>;
        })}</div><WorkflowError message={item.reason}/></div>
        <div className="inline-actions"><button type="button" className="secondary" aria-pressed={currentCombination?.id===item.id} disabled={locked||Boolean(item.reason)} onClick={()=>{
          setDraft({pseudo_label_run_id:item.pseudo_label_run_id,augmentation_run_id:item.augmentation_run_id,open_data_import_id:item.open_data_import_id});
          setNotice({key:'Using “{name}”. Set ratios and build below.',name:item.name});
        }}>{w(currentCombination?.id===item.id?'In use':'Use combination')}</button>
          <button type="button" className="secondary danger composition-remove" disabled={locked} aria-label={w('Delete combination {name}',{name:item.name})} title={w('Delete combination {name}',{name:item.name})} onClick={()=>{
            if(window.confirm(w('Delete saved combination “{name}”? Existing Split snapshots and training results will be kept.',{name:item.name})))void change(()=>api.deleteComposition(projectId,item.id));
          }}><Trash2 size={16}/></button></div>
      </article>)}
    </details>
    <WorkflowError message={localError||error}/>
  </section>;
}
