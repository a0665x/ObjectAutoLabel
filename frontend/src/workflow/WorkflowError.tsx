import {useWorkflow} from './WorkflowState';
import {workflowText} from './text';

// Preserve unknown server diagnostics behind a translated summary.
export function WorkflowError({message,announce=true}:{message?:string;announce?:boolean}) {
  const language=useWorkflow()?.language??'en';
  if(!message)return null;
  const w=workflowText(language);
  const key=/^(pseudo|augmentation|open_data|split) version is outdated; rebuild it before assigning$/.test(message)?'Outdated — rebuild required':
    /^(pseudo|augmentation|open_data|split) version is not complete$/.test(message)?'This version is not complete. Wait for the job to finish.':
    /^(pseudo|augmentation|open_data|split) version is no longer available in this project$/.test(message)?'A selected source is no longer available. Choose another version.':message;
  const translated=w(key);
  if(language==='en'||translated!==message)return <p role={announce?'alert':undefined} className="review-error">{language==='en'?message:translated}</p>;
  return <div className="review-error"><p role={announce?'alert':undefined}>{w('Operation could not be completed. Check details and retry.')}</p><details><summary>{w('Technical details')}</summary><p>{message}</p></details></div>;
}
