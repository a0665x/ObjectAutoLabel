import {StreamSwitch} from './StreamControls';
import {opticalFlowHelp,opticalFlowText,type FlowTextKey,type FlowHelpKey} from './opticalFlowText';
import {ParameterField,ParameterHelp} from './ParameterHelp';
import {ParameterNumberInput,parameterEditingHint} from './ParameterNumberInput';
import type {FlowSettings,FlowSummary} from './opticalFlowModel';
import type {Language} from '../types';

export function OpticalFlowPanel({settings,onChange,summary,onReset,terminal=false,language='en'}:{
  settings:FlowSettings;onChange:(settings:FlowSettings)=>void;summary?:FlowSummary;onReset:()=>void;terminal?:boolean;language?:Language;
}) {
  const t=(key:FlowTextKey)=>opticalFlowText(language,key);
  const h=(key:FlowHelpKey)=>opticalFlowHelp(language,key);
  const disabled=!settings.enabled||terminal;
  const number=(key:'cols'|'rows'|'gain'|'trailLength'|'quality'|'radius'|'threshold',value:number,min:number,max:number)=>{
    if(Number.isFinite(value)&&value>=min&&value<=max)onChange({...settings,[key]:value});
  };
  const measured=summary?.state==='measured'&&summary.valid>0;
  return <section className="stream-tracking-settings stream-flow-settings" aria-label={t('title')}>
    <div className="stream-control-with-help"><label className="stream-overlay-toggle"><input type="checkbox" checked={settings.enabled} disabled={terminal} onChange={e=>onChange({...settings,enabled:e.target.checked})}/>{t('show')}</label><ParameterHelp label={t('show')} help={h('show')} language={language}/></div>
    <p className="muted">{terminal?t('cli'):t('hint')}</p>
    {settings.enabled&&!terminal&&<>
      {summary?.state==='error'?<p className="review-error" role="alert">{t('error')}</p>:
        <p className="muted" role="status">{!summary?t('waiting'):summary.state==='reference'?t('reference'):
          `${summary.width} × ${summary.height} · t ${summary.time.toFixed(3)} s · Δt ${(summary.dt*1000).toFixed(0)} ms · ${summary.ms.toFixed(0)} ms`}</p>}
      <dl className="stream-stats stream-flow-stats">
        <div><dt>{t('valid')}</dt><dd>{summary?`${summary.valid} / ${summary.total}`:'—'}</dd></div>
        <div><dt>{t('meanMotion')}</dt><dd>{measured?`${summary.motion.toFixed(2)} px`:'—'}</dd></div>
        <div><dt>{t('meanSpeed')}</dt><dd>{measured?`${summary.speed.toFixed(1)} px/s`:'—'}</dd></div>
        <div><dt>{t('meanDirection')}</dt><dd>{measured&&summary.angle!==null?`${summary.angle.toFixed(1)}°`:'—'}</dd></div>
      </dl>
    </>}
    <details><summary>{t('settings')}</summary>
      <fieldset><legend className="stream-sr-only">{t('settings')}</legend>
        <small>{parameterEditingHint(language)}</small>
        <div className="stream-input-grid">
          {(['cols','rows'] as const).map(key=><ParameterField key={key} label={t(key)} help={h(key)} language={language}><ParameterNumberInput value={settings[key]} min={2} max={40} integer disabled={disabled} language={language} onCommit={value=>number(key,value,2,40)}/></ParameterField>)}
          <ParameterField label={t('vector')} help={h('vector')} language={language}><select disabled={disabled} aria-label={t('vector')} value={settings.vector} onChange={e=>onChange({...settings,vector:e.target.value as FlowSettings['vector']})}><option value="flow">{t('flow')}</option><option value="gradient">{t('gradientVector')}</option></select></ParameterField>
          <ParameterField label={t('color')} help={h('color')} language={language}><select disabled={disabled} aria-label={t('color')} value={settings.color} onChange={e=>onChange({...settings,color:e.target.value as FlowSettings['color']})}>{(['magnitude','speed','direction','gradient','confidence'] as const).map(key=><option value={key} key={key}>{t(key)}</option>)}</select></ParameterField>
        </div>
        <div className="stream-flow-legend" aria-hidden="true" style={{background:settings.color==='direction'?'linear-gradient(90deg,hsl(0 85% 70%),hsl(60 85% 70%),hsl(120 85% 70%),hsl(180 85% 70%),hsl(240 85% 70%),hsl(300 85% 70%),hsl(360 85% 70%))':undefined}}/>
        <small>{t('legend')}</small>
        <ParameterField label={t('gain')} help={h('gain')} language={language} className="stream-slider" output={<output>{settings.gain}×</output>}><input disabled={disabled} aria-label={t('gain')} type="range" min={1} max={12} step={.5} value={settings.gain} onChange={e=>number('gain',e.target.valueAsNumber,1,12)}/></ParameterField>
        <ParameterField label={t('trail')} help={h('trail')} language={language} className="stream-slider" output={<output>{settings.trailLength}</output>}><input disabled={disabled} aria-label={t('trail')} type="range" min={2} max={120} step={1} value={settings.trailLength} onChange={e=>number('trailLength',e.target.valueAsNumber,2,120)}/></ParameterField>
        <div className="stream-viz-grid">
          {([['showTrails','trails'],['showGrid','grid'],['showPoints','points']] as const).map(([key,label])=><StreamSwitch key={key} disabled={disabled} label={t(label)} help={h(label)} language={language} checked={settings[key]} onChange={checked=>onChange({...settings,[key]:checked})}/>)}
        </div>
        <div className="stream-input-grid">
          <ParameterField label={t('quality')} help={h('quality')} language={language}><select disabled={disabled} aria-label={t('quality')} value={settings.quality} onChange={e=>number('quality',Number(e.target.value),480,1280)}>{[480,640,960,1280].map(value=><option key={value} value={value}>{value} px</option>)}</select></ParameterField>
          {([['radius',3,12],['threshold',1,50]] as const).map(([key,min,max])=><ParameterField key={key} label={t(key)} help={h(key)} language={language}><ParameterNumberInput value={settings[key]} min={min} max={max} integer disabled={disabled} language={language} onCommit={value=>number(key,value,min,max)}/></ParameterField>)}
        </div>
        <button type="button" className="secondary" disabled={disabled} onClick={onReset}>{t('reset')}</button>
      </fieldset>
    </details>
    <small>{t('limits')}</small>
  </section>;
}
