import {useEffect,useRef} from 'react';
import {ArrowLeft} from 'lucide-react';
import {stageNames,useWorkflow,VersionDetails} from './WorkflowState';
import {sourcePages} from './composition';
import {workflowText} from './text';
import {WorkflowError} from './WorkflowError';

// Browsing a saved output must never assign it or overwrite a generation draft.
export function VersionInspector({page}:{page:string}) {
  const runtime=useWorkflow();
  const w=workflowText(runtime?.language);
  const focus=runtime?.focus;
  const visible=focus&&sourcePages[focus.stage]===page;
  const version=visible?runtime?.state?.catalog[focus.stage].find(item=>item.id===focus.id):undefined;
  const panel=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!visible)return;
    panel.current?.focus({preventScroll:true});
    panel.current?.scrollIntoView?.({block:'start',behavior:'auto'});
  },[focus?.serial,page,version?.id]);
  if(!visible)return null;
  return <section ref={panel} tabIndex={-1} className="panel version-inspector" data-stage={focus.stage} aria-label={w('Selected source version')}>
    <header><div><small>{w('Viewing saved {stage} version',{stage:w(stageNames[focus.stage])})}</small><h2>{version?.name??w('Version unavailable')}</h2></div>
      <button type="button" className="secondary" onClick={runtime?.backToSplit}><ArrowLeft size={16}/>{w('Back to Split')}</button></header>
    {version?<><VersionDetails version={version}/><WorkflowError message={version.reason}/></>:<p role="alert">{w('This version is no longer available. Your Split inputs have not changed.')}</p>}
    <small>{w('Read-only history. Generation settings and Split inputs are unchanged.')}</small>
  </section>;
}
