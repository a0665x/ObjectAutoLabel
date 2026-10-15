import { useId } from 'react';
import {ParameterHelp} from './ParameterHelp';
import type {Language} from '../types';

// Native radio/checkbox semantics preserve keyboard navigation and form disabling.
export function StreamSegments({label, value, options, onChange, disabled=false, hideLabel=false}: {
  label: string; value: string; options: {value:string; label:string; disabled?:boolean}[];
  onChange:(value:string)=>void; disabled?:boolean; hideLabel?:boolean;
}) {
  const name=useId();
  return <fieldset className="stream-segments" disabled={disabled}>
    <legend className={hideLabel?'stream-sr-only':undefined}>{label}</legend>
    <div className="stream-segments-options">
      {options.map(option=><label key={option.value}>
        <input type="radio" name={name} value={option.value} checked={value===option.value}
          disabled={option.disabled} onChange={()=>onChange(option.value)}/>
        <span>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

export function StreamSwitch({label, checked, onChange, disabled=false, ariaLabel,help,language='en',technicalKey}: {
  label:string; checked:boolean; onChange:(checked:boolean)=>void; disabled?:boolean; ariaLabel?:string;help?:string;language?:Language;technicalKey?:string;
}) {
  const control=<label className="stream-switch">
    <span>{label}</span>
    <input type="checkbox" role="switch" aria-label={ariaLabel??label} checked={checked}
      disabled={disabled} onChange={event=>onChange(event.target.checked)}/>
    <span className="stream-switch-track" aria-hidden="true"/>
  </label>;
  return help?<div className="stream-switch-with-help">{control}<ParameterHelp label={label} help={help} language={language} technicalKey={technicalKey}/></div>:control;
}
