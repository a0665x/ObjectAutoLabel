import {useUiText} from '../uiText';
import type {BoxAreaDistribution} from '../api/client';

export const areaToPosition=(area:number)=>Math.log10(1+area*10000)/Math.log10(10001)*100;
export const positionToArea=(position:number)=>(10001**(position/100)-1)/10000;
export const areaPercent=(area:number)=>(area*100).toLocaleString(undefined,{maximumFractionDigits:3});

export function BoxAreaRange({distribution,range,automatic,loading,error,onChange,onSuggest}:{
  distribution:BoxAreaDistribution|null;range:[number,number];automatic:boolean;loading:boolean;error:string;
  onChange:(range:[number,number])=>void;onSuggest:()=>void;
}) {
  const ui=useUiText(), [lower,upper]=range;
  const bins=distribution?.bins??[], peak=Math.max(1,...bins.map(bin=>bin.count));
  const kept=Math.round(bins.reduce((sum,bin)=>sum+bin.count*Math.max(0,Math.min(bin.upper,upper)-Math.max(bin.lower,lower))/(bin.upper-bin.lower),0));
  const change=(edge:0|1,position:number)=>{
    const value=positionToArea(position);
    onChange(edge===0?[Math.min(value,Math.max(0,upper-.000001)),upper]:[lower,Math.max(value,lower+.000001)]);
  };
  return <section className="box-area-range" aria-label={ui('Box area range')} aria-busy={loading}>
    <header><div><strong>{ui('Box area range')}</strong><span>{areaPercent(lower)}% – {areaPercent(upper)}%</span></div>
      <button type="button" className="secondary" onClick={onSuggest}>{ui(automatic?'Auto range':'Suggested range')}</button></header>
    <div className="box-area-legend"><span>{ui('Keep selected range')}</span><span>{ui('Exclude outside range')}</span></div>
    <svg className="box-area-chart" viewBox="0 0 500 90" preserveAspectRatio="none" role="img" aria-label={ui('Box count by percentage of image area')}>
      <rect x={areaToPosition(lower)*5} y="0" width={(areaToPosition(upper)-areaToPosition(lower))*5} height="90" className="area-selection"/>
      {bins.map((bin,index)=>{const selected=bin.upper>lower&&bin.lower<=upper;const height=bin.count?Math.max(3,Math.sqrt(bin.count/peak)*84):0;return <rect key={index} x={index*10+.5} y={90-height} width="9" height={height} className={selected?'area-bin kept':'area-bin excluded'}><title>{areaPercent(bin.lower)}% – {areaPercent(bin.upper)}%: {bin.count} {ui('boxes')}</title></rect>;})}
    </svg>
    <div className="box-area-slider" style={{'--range-start':`${areaToPosition(lower)}%`,'--range-end':`${areaToPosition(upper)}%`} as React.CSSProperties}>
      <div className="box-area-track"/>
      <input type="range" min="0" max="100" step="any" value={areaToPosition(lower)} aria-label={ui('Minimum box area')} aria-valuetext={`${areaPercent(lower)}%`} onChange={event=>change(0,Number(event.target.value))}/>
      <input type="range" min="0" max="100" step="any" value={areaToPosition(upper)} aria-label={ui('Maximum box area')} aria-valuetext={`${areaPercent(upper)}%`} onChange={event=>change(1,Number(event.target.value))}/>
    </div>
    <div className="box-area-ticks" aria-hidden="true">{[0,.0001,.001,.01,.1,1].map(area=><span key={area} style={{left:`${areaToPosition(area)}%`}}>{areaPercent(area)}%</span>)}</div>
    <p aria-live="polite">{loading?ui('Loading box distribution…'):distribution?.box_count?ui('≈ {kept} kept · {excluded} excluded',{kept:kept.toLocaleString(),excluded:(distribution.box_count-kept).toLocaleString()}):ui('No box statistics yet. The first run will compute its own suggested range.')}</p>
    {distribution?.box_count?<small>{ui(distribution.pre_filter?'Before filtering · {name}':'Retained labels only · {name}',{name:distribution.run_name??ui('Source labels')})}</small>:null}
    <small>{ui(automatic?'Auto finds a clear gap before the large-box cluster on each new run; otherwise it uses one third. Drag either handle to lock a manual range.':'Manual range applies to the next run. Boxes on the boundaries are kept; images are never removed.')}</small>
    <small>{ui('Area axis expands small boxes (log scale). Bar height represents box count.')}</small>
    {error?<p role="alert">{ui('Unable to load box distribution. You can still set a range or use Auto.')}</p>:null}
    {bins.some(bin=>bin.count)?<details><summary>{ui('Distribution details')}</summary><ul>{bins.filter(bin=>bin.count).map(bin=><li key={bin.lower}>{areaPercent(bin.lower)}% – {areaPercent(bin.upper)}%: {bin.count} {ui('boxes')}</li>)}</ul></details>:null}
  </section>;
}
