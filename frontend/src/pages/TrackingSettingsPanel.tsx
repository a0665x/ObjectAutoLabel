import { useEffect, useState } from 'react';
import { streamRequest } from '../api/streamDemo';
import type { Language } from '../types';
import { trackingText, trackingHelp, trackingParameterName,trackingVisualizationHelp } from './trackingText';
import { StreamSegments, StreamSwitch } from './StreamControls';
import {ParameterField,ParameterHelp} from './ParameterHelp';
import {ParameterNumberInput,parameterEditingHint} from './ParameterNumberInput';

export type TrackingSettings = Record<string, number | boolean>;
export type TrackingViz = { enabled: boolean; trails: boolean; prediction: boolean; topology: boolean; diagnostics: boolean };
export type TrackingDisplayStatus = { detections:number; tracks:number; motion:number; links:number; forecasts:number };
type Property = {type: string; description?: string; minimum?: number; maximum?: number};
type SettingsSchema = {defaults: TrackingSettings; properties: Record<string, Property>};

export function TrackingSettingsPanel({settings,onChange,onValidityChange,busy,viz,onViz,fps,tracking=true,status,language='en'}: {
  settings: TrackingSettings; onChange: (value:TrackingSettings)=>void; busy:boolean;
  onValidityChange?:(valid:boolean)=>void;
  viz: TrackingViz; onViz:(value:TrackingViz)=>void; fps:number; tracking?:boolean; status?:TrackingDisplayStatus; language?:Language;
}) {
  const [schema,setSchema]=useState<SettingsSchema>();
  const [category,setCategory]=useState('TRACKING_ID_');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [invalidDrafts,setInvalidDrafts]=useState<Record<string,boolean>>({});
  const [resetVersion,setResetVersion]=useState(0);
  const t=(key:Parameters<typeof trackingText>[1])=>trackingText(language,key);
  useEffect(()=>{
    let cancelled=false;
    streamRequest<SettingsSchema>('/api/stream-demo/tracking-settings').then(data=>{
      if (!cancelled && data.defaults && data.properties) setSchema(data);
    }).catch(()=>{if(!cancelled)setError('loadError');});
    return ()=>{cancelled=true;};
  },[]);
  const values={...schema?.defaults,...settings};
  const invalidKeys=Object.entries(schema?.properties??{}).filter(([key,p])=>{
    const value=values[key];
    return p.type==='boolean'?typeof value!=='boolean':typeof value!=='number'||!Number.isFinite(value)||
      (p.type==='integer'&&!Number.isInteger(value))||(p.minimum!==undefined&&value<p.minimum)||(p.maximum!==undefined&&value>p.maximum);
  }).map(([key])=>key);
  const valid=invalidKeys.length===0&&!Object.values(invalidDrafts).some(Boolean);
  useEffect(()=>{onValidityChange?.(valid);},[valid,onValidityChange]);
  const groups=[['AI_TRACK_','ByteTrack'],['TRACK_MOTION_',t('motion')],['TRACKING_ID_',t('identity')],['TRACKING_BRIDGE_',t('bridge')]];
  const labels: Record<Exclude<keyof TrackingViz,'enabled'>,string>={trails:t('trails'),prediction:t('prediction'),topology:t('topology'),diagnostics:t('diagnostics')};
  return <details className="stream-tracking-settings"><summary>{t('title')}</summary>
    <p className="muted">{t('intro')}</p>
    <div className="stream-control-with-help"><label className="stream-overlay-toggle"><input type="checkbox" checked={viz.enabled} onChange={e=>onViz({...viz,enabled:e.target.checked})}/>{t('overlay')}</label><ParameterHelp label={t('overlay')} help={trackingVisualizationHelp(language,'enabled')} language={language}/></div>
    <p className="muted" role="status">{!viz.enabled?t('overlayOff'):!tracking?t('trackingOff'):!status?t('waitingFrames'):status.tracks===0?t('waitingIds'):`${t('displayed')}: ${status.detections} ${t('detections')} · ${status.tracks} ID · ${status.motion} Kalman · ${status.forecasts} ${t('forecasts')} · ${status.links} ${t('links')}`}</p>
    {viz.enabled&&tracking&&1000/fps>Math.max(600,2*Math.min(Number(values.TRACK_MOTION_MAX_PREDICTION_MS??800),Number(values.TRACKING_BRIDGE_TTL_MS??800)))&&<p className="muted">{t('slowMotion')}</p>}
    <fieldset className="stream-viz-settings"><legend>{t('viz')}</legend>
      <div className="stream-viz-grid">{(Object.keys(labels) as (Exclude<keyof TrackingViz,'enabled'>)[]).map(key=>
        <StreamSwitch key={key} label={labels[key]} help={trackingVisualizationHelp(language,key)} language={language} disabled={!viz.enabled} checked={viz[key]} onChange={checked=>onViz({...viz,[key]:checked})}/>)}</div>
      <small>{t('legend')}</small>
    </fieldset>
    <fieldset>
      <legend>{t('parameters')}</legend>
      <small>{parameterEditingHint(language)}</small>
      <StreamSegments label={t('group')} value={category} onChange={setCategory} disabled={busy||!schema}
        options={groups.map(([value,label])=>({value,label}))}/>
      <div className="stream-parameter-grid">
      {Object.entries(schema?.properties??{}).filter(([key])=>trackingHelp(language,key)).map(([key,property])=><div className="stream-tracking-parameter" key={key} hidden={!key.startsWith(category)}>
        {property.type==='boolean' ? <StreamSwitch label={trackingParameterName(language,key)} help={trackingHelp(language,key)} language={language} technicalKey={key} disabled={busy||!schema} ariaLabel={key} checked={Boolean(values[key])} onChange={checked=>onChange({...values,[key]:checked})}/> :
          <ParameterField label={trackingParameterName(language,key)} help={trackingHelp(language,key)!} language={language} technicalKey={key}>
            <ParameterNumberInput key={resetVersion} ariaLabel={key} value={Number(values[key])} min={property.minimum} max={property.maximum} integer={property.type==='integer'} disabled={busy||!schema} language={language}
              onCommit={value=>onChange({...values,[key]:value})} onValidityChange={ok=>setInvalidDrafts(previous=>previous[key]===!ok?previous:{...previous,[key]:!ok})}/>
          </ParameterField>}
      </div>)}
      </div>
      <button className="secondary" type="button" disabled={busy||!schema} onClick={()=>{onChange(schema?.defaults??{});setInvalidDrafts({});setResetVersion(value=>value+1);setNotice('resetDone');}}>{t('reset')}</button>
    </fieldset>
    <button type="button" className="secondary" disabled={!schema} onClick={()=>{
      const text=JSON.stringify(values,null,2)+'\n';
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='stream-tracking.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>{t('export')}</button>
    <small>{t('dt')}: {(1000/fps).toFixed(1)} ms · {t('horizon')} ≤ {Math.min(Number(values.TRACK_MOTION_MAX_PREDICTION_MS??800),Number(values.TRACKING_BRIDGE_TTL_MS??800))} ms · {t('confirm')} {Number(values.TRACKING_ID_STABILIZER_CONFIRM_FRAMES??3)} {t('frames')} ≈ {(1000*Number(values.TRACKING_ID_STABILIZER_CONFIRM_FRAMES??3)/fps).toFixed(0)} ms</small>
    {!valid&&<p role="alert" className="review-error">{t('invalidParameters')}</p>}
    {notice&&<p role="status">{t('resetDone')}</p>}{error&&<p role="alert" className="review-error">{t('loadError')}</p>}
  </details>;
}
