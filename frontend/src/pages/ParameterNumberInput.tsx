import {useEffect,useId,useState} from 'react';
import type {Language} from '../types';

const text={
  en:{integer:'Whole number',number:'Number',apply:'Enter or leave the field to apply; Esc restores the last value.'},
  zh:{integer:'整數',number:'數值',apply:'按 Enter 或移開焦點套用；Esc 還原上一個值。'},
  ja:{integer:'整数',number:'数値',apply:'Enter またはフォーカス移動で適用。Esc で元の値に戻します。'},
  ko:{integer:'정수',number:'숫자',apply:'Enter 또는 포커스 이동으로 적용합니다. Esc로 이전 값을 복원합니다.'},
};
export const parameterEditingHint=(language:Language)=>text[language].apply;

// Do not validate away transient text (empty, "1", "0.") while someone types.
// Only committed, finite, in-range numbers reach the worker/session settings.
export function ParameterNumberInput({value,onCommit,min,max,integer=false,disabled=false,language='en',id,ariaLabel,onValidityChange}:{
  value:number;onCommit:(value:number)=>void;min?:number;max?:number;integer?:boolean;disabled?:boolean;language?:Language;id?:string;ariaLabel?:string;onValidityChange?:(valid:boolean)=>void;
}) {
  const [draft,setDraft]=useState(String(value));
  const description=useId(),number=Number(draft);
  const valid=draft.trim()!==''&&Number.isFinite(number)&&(!integer||Number.isInteger(number))&&(min===undefined||number>=min)&&(max===undefined||number<=max);
  useEffect(()=>{setDraft(String(value));},[value]);
  useEffect(()=>{onValidityChange?.(valid);},[valid,onValidityChange]);
  const apply=()=>{if(valid){setDraft(String(number));if(number!==value)onCommit(number);}};
  return <div className="stream-number-field" data-invalid={!valid||undefined}>
    <input id={id} aria-label={ariaLabel} aria-invalid={!valid||undefined} aria-describedby={description} type="number"
      min={min} max={max} step={integer?1:.01} value={draft} disabled={disabled}
      onChange={event=>setDraft(event.target.value)} onBlur={apply} onKeyDown={event=>{
        if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(String(value));}
      }}/>
    <small id={description}>{text[language][integer?'integer':'number']} · {min??'−∞'}–{max??'∞'}</small>
  </div>;
}
