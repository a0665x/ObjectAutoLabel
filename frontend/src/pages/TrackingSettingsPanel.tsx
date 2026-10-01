import { useEffect, useState } from 'react';
import { streamRequest } from '../api/streamDemo';
import type { Language } from '../types';
import { trackingText, trackingHelp, trackingParameterName } from './trackingText';
import { StreamSegments, StreamSwitch } from './StreamControls';

export type TrackingSettings = Record<string, number | boolean>;
export type TrackingViz = { trails: boolean; prediction: boolean; topology: boolean; diagnostics: boolean };
type Property = {type: string; description?: string; minimum?: number; maximum?: number};
type SettingsSchema = {defaults: TrackingSettings; properties: Record<string, Property>};

export function TrackingSettingsPanel({settings,onChange,busy,viz,onViz,fps,language='en'}: {
  settings: TrackingSettings; onChange: (value:TrackingSettings)=>void; busy:boolean;
  viz: TrackingViz; onViz:(value:TrackingViz)=>void; fps:number; language?:Language;
}) {
  const [schema,setSchema]=useState<SettingsSchema>();
  const [category,setCategory]=useState('TRACKING_ID_');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const t=(key:Parameters<typeof trackingText>[1])=>trackingText(language,key);
  useEffect(()=>{
    let cancelled=false;
    streamRequest<SettingsSchema>('/api/stream-demo/tracking-settings').then(data=>{
      if (!cancelled && data.defaults && data.properties) setSchema(data);
    }).catch(()=>{if(!cancelled)setError('loadError');});
    return ()=>{cancelled=true;};
  },[]);
  const values={...schema?.defaults,...settings};
  const groups=[['AI_TRACK_','ByteTrack'],['TRACK_MOTION_',t('motion')],['TRACKING_ID_',t('identity')],['TRACKING_BRIDGE_',t('bridge')]];
  const labels: Record<keyof TrackingViz,string>={trails:t('trails'),prediction:t('prediction'),topology:t('topology'),diagnostics:t('diagnostics')};
  return <details className="stream-tracking-settings"><summary>{t('title')}</summary>
    <p className="muted">{t('intro')}</p>
    <fieldset className="stream-viz-settings"><legend>{t('viz')}</legend>
      <div className="stream-viz-grid">{(Object.keys(labels) as (keyof TrackingViz)[]).map(key=>
        <StreamSwitch key={key} label={labels[key]} checked={viz[key]} onChange={checked=>onViz({...viz,[key]:checked})}/>)}</div>
      <small>{t('legend')}</small>
    </fieldset>
    <fieldset disabled={busy || !schema}>
      <legend>{t('parameters')}</legend>
      <StreamSegments label={t('group')} value={category} onChange={setCategory}
        options={groups.map(([value,label])=>({value,label}))}/>
      <div className="stream-parameter-grid">
      {Object.entries(schema?.properties??{}).filter(([key])=>key.startsWith(category)&&trackingHelp(language,key)).map(([key,property])=><div className="stream-tracking-parameter" key={key}>
        {property.type==='boolean' ? <StreamSwitch label={trackingParameterName(language,key)} ariaLabel={key} checked={Boolean(values[key])} onChange={checked=>onChange({...values,[key]:checked})}/> :
          <label><span>{trackingParameterName(language,key)}</span><input aria-label={key} type="number" min={property.minimum} max={property.maximum} step={property.type==='integer'?1:.01} value={Number(values[key])} onChange={e=>{
            const value=e.target.valueAsNumber;
            if(Number.isFinite(value)) onChange({...values,[key]:value});
          }} /></label>}
        <details className="stream-parameter-help"><summary>{t('parameterDetails')}</summary><code>{key}</code><p>{trackingHelp(language,key)}</p></details>
      </div>)}
      </div>
      <button className="secondary" type="button" onClick={()=>{onChange(schema?.defaults??{});setNotice('resetDone');}}>{t('reset')}</button>
    </fieldset>
    <button type="button" className="secondary" disabled={!schema} onClick={()=>{
      const text=JSON.stringify(values,null,2)+'\n';
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='stream-tracking.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>{t('export')}</button>
    <small>{t('dt')}: {(1000/fps).toFixed(1)} ms · {t('horizon')} ≤ {Math.min(Number(values.TRACK_MOTION_MAX_PREDICTION_MS??400),Number(values.TRACKING_BRIDGE_TTL_MS??400))} ms · {t('confirm')} {Number(values.TRACKING_ID_STABILIZER_CONFIRM_FRAMES??3)} {t('frames')} ≈ {(1000*Number(values.TRACKING_ID_STABILIZER_CONFIRM_FRAMES??3)/fps).toFixed(0)} ms</small>
    {notice&&<p role="status">{t('resetDone')}</p>}{error&&<p role="alert" className="review-error">{t('loadError')}</p>}
  </details>;
}
