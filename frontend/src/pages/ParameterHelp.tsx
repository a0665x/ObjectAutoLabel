import {cloneElement,useId,useState,type ReactElement,type ReactNode} from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type {Language} from '../types';

const names={en:'Help',zh:'參數說明',ja:'設定の説明',ko:'설정 도움말'};

// Portal and collision handling keep help readable beside narrow settings cards.
export function ParameterHelp({label,help,language='en',technicalKey}:{label:string;help:string;language?:Language;technicalKey?:string}) {
  const [open,setOpen]=useState(false);
  return <Tooltip.Provider delayDuration={150}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild>
      <button type="button" className="stream-help-trigger" aria-label={`${names[language]}: ${label}`}
        onClick={event=>{event.preventDefault();setOpen(true);}}>?</button>
    </Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="stream-help-content" side="top" sideOffset={6} collisionPadding={12}>
      <strong>{label}</strong><p>{help}</p>{technicalKey&&<code>{technicalKey}</code>}
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

export function ParameterField({label,help,children,language='en',technicalKey,output,className=''}:{
  label:string;help:string;children:ReactElement<{id?:string}>;language?:Language;technicalKey?:string;output?:ReactNode;className?:string;
}) {
  const id=useId();
  return <div className={`stream-parameter-field ${className}`}>
    <div className="stream-field-heading"><label htmlFor={id}>{label}</label>
      <ParameterHelp label={label} help={help} language={language} technicalKey={technicalKey}/>{output}
    </div>{cloneElement(children,{id})}
  </div>;
}
