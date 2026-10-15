import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {api, type SplitBucket, type SplitCoverage as Coverage, type SplitCoverageCounts, type SplitCoverageGroup, type SplitCoverageSample} from '../api/client';
import type {Language} from '../types';
import {workflowText} from '../workflow/text';

const buckets:SplitBucket[]=['train','valid','test'];
const bucketLabel=(bucket:SplitBucket)=>bucket==='valid'?'Validation':bucket==='train'?'Train':'Test';
const count=(counts:SplitCoverageCounts)=>buckets.reduce((sum,bucket)=>sum+counts[bucket],0);
const percent=(value:number)=>`${(value*100).toLocaleString(undefined,{maximumFractionDigits:1})}%`;

export function coverageBatches(data:Coverage):SplitCoverageGroup[] {
  const merged=new Map<string,SplitCoverageGroup>();
  for(const group of data.groups){
    const key=JSON.stringify([group.kind,group.pseudo_label_run_id,group.augmentation_run_id,group.open_data_import_id]);
    const previous=merged.get(key);
    if(!previous){merged.set(key,{...group,counts:{...group.counts},bucket_share:{...group.bucket_share}});continue;}
    previous.total+=group.total;
    previous.source_name=[...new Set([...(previous.source_name?.split(' / ')??[]),...(group.source_name?[group.source_name]:[])])].join(' / ')||null;
    for(const bucket of buckets){previous.counts[bucket]+=group.counts[bucket];previous.bucket_share[bucket]=data.all_counts[bucket]?previous.counts[bucket]/data.all_counts[bucket]:0;}
  }
  return [...merged.values()];
}

export function coverageBucketAt(position:number,counts:SplitCoverageCounts) {
  const total=count(counts);if(!total)return null;
  let index=Math.min(.999999999,Math.max(0,position))*total;
  for(const bucket of buckets) {
    if(index<counts[bucket])return {bucket,position:Math.round(index/counts[bucket]*100)/100};
    index-=counts[bucket];
  }
  return null;
}

/** Inspect immutable membership; all image pixels are lazy and bounded. */
export function SplitCoverage({projectId,splitId,language='en'}:{projectId:string;splitId:string;language?:Language}) {
  const w=workflowText(language),key=`${projectId}/${splitId}`;
  const [control,setControl]=useState({key,groupId:'',range:[0,100] as [number,number]});
  const current=control.key===key?control:{key,groupId:'',range:[0,100] as [number,number]};
  const [lower,upper]=current.range,groupId=current.groupId;
  const baseKey=`${key}/${groupId}`,queryKey=`${baseKey}/${lower}/${upper}`;
  const [loaded,setLoaded]=useState<{baseKey:string;queryKey:string;data:Coverage}>();
  const [error,setError]=useState<{key:string;message:string}>();
  const [retry,setRetry]=useState(0);
  const data=loaded?.baseKey===baseKey?loaded.data:undefined;
  const batches=data?coverageBatches(data):[];
  const loading=loaded?.queryKey!==queryKey;
  const [cursor,setCursor]=useState(0);
  const [hover,setHover]=useState<{key:string;bucket:SplitBucket;position:number;left:number;top:number}|null>(null);
  const [preview,setPreview]=useState<{key:string;sample:SplitCoverageSample;url:string}|null>(null);
  const [previewError,setPreviewError]=useState('');
  const sampleCache=useRef(new Map<string,SplitCoverageSample>());
  const imageCache=useRef(new Map<string,string>());
  const allocation=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const controller=new AbortController();let cancelled=false;
    const timer=window.setTimeout(()=>{
      api.datasetSplitCoverage(projectId,splitId,{group_id:groupId||undefined,start:lower/100,end:upper/100,bins:64},controller.signal)
        .then(data=>{if(!cancelled){setLoaded({baseKey,queryKey,data});setError(undefined);}})
        .catch(reason=>{if(!cancelled&&reason?.name!=='AbortError')setError({key:queryKey,message:String(reason)});});
    },lower===0&&upper===100?0:180);
    return()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};
  },[projectId,splitId,groupId,lower,upper,baseKey,queryKey,retry]);

  useEffect(()=>{
    const samples=sampleCache.current,images=imageCache.current;
    setHover(null);setPreview(null);
    return()=>{for(const url of images.values())URL.revokeObjectURL(url);images.clear();samples.clear();};
  },[key]);

  useEffect(()=>{
    if(!hover||!data||loading)return;
    const controller=new AbortController();let cancelled=false;
    setPreviewError('');
    const timer=window.setTimeout(async()=>{
      try {
        let sample=sampleCache.current.get(hover.key);
        if(!sample) {
          sample=await api.datasetSplitCoverageSample(projectId,splitId,hover.bucket,hover.position,groupId||undefined,controller.signal);
          if(cancelled)return;
          sampleCache.current.set(hover.key,sample);
          while(sampleCache.current.size>32)sampleCache.current.delete(sampleCache.current.keys().next().value!);
        }
        let url=imageCache.current.get(sample.image_id);
        if(url){imageCache.current.delete(sample.image_id);imageCache.current.set(sample.image_id,url);}
        else {
          const response=await fetch(sample.thumbnail_url,{signal:controller.signal,cache:'no-store'});
          if(!response.ok)throw new Error('Thumbnail unavailable');
          const blob=await response.blob();if(cancelled)return;
          url=URL.createObjectURL(blob);imageCache.current.set(sample.image_id,url);
          while(imageCache.current.size>8){const oldest=imageCache.current.keys().next().value!;URL.revokeObjectURL(imageCache.current.get(oldest)!);imageCache.current.delete(oldest);}
        }
        if(!cancelled)setPreview({key:hover.key,sample,url});
      } catch(reason) {if(!cancelled&&(reason as Error)?.name!=='AbortError')setPreviewError(hover.key);}
    },180);
    return()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};
  },[hover?.key,projectId,splitId,groupId,loading,data]);

  function inspect(value:number) {
    if(!data||loading)return;
    const next=coverageBucketAt(value/100,data.counts);if(!next)return;
    const bounds=allocation.current?.getBoundingClientRect();
    const width=Math.min(280,window.innerWidth-32),height=260;
    const center=(bounds?.left??0)+(bounds?.width??0)*value/100;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,center-width/2));
    const bottom=bounds?.bottom??0;
    const top=bottom+height+8<=window.innerHeight?bottom+8:Math.max(8,(bounds?.top??0)-height-8);
    const token=`${baseKey}/${next.bucket}/${next.position}`;
    setCursor(value);
    setHover(old=>old?.key===token?old:{key:token,...next,left,top});
  }
  function range(edge:0|1,value:number) {
    const next:[number,number]=edge===0?[Math.min(value,upper-1),upper]:[lower,Math.max(value,lower+1)];
    setControl({key,groupId,range:next});setHover(null);
  }
  const shown=hover&&preview?.key===hover.key?preview:null;
  const failure=error?.key===queryKey;

  return <section className="split-coverage" aria-label={w('Source coverage')} aria-busy={loading}>
    <header className="coverage-header"><div><h3>{w('Source coverage')}</h3><p>{data?.split_name??w('Loading saved allocation…')}</p></div>
      <small>{w('Saved membership · inspection only')}</small></header>
    {failure?<p role="alert">{w('Unable to load saved coverage. Select another Split or retry.')} <button type="button" className="secondary" onClick={()=>{setLoaded(undefined);setError(undefined);setRetry(value=>value+1);}}>{w('Retry')}</button></p>:null}
    {!data?<p className="muted">{w('Loading saved allocation…')}</p>:<>
      <p className="muted">{w('Hover, focus or tap the allocation bar for one saved image. Thumbnails are loaded on demand.')}</p>
      <div className="coverage-allocation" ref={allocation}>
        <div className="ratio-visual coverage-ratio-bar" aria-hidden="true">{buckets.filter(bucket=>data.counts[bucket]>0).map(bucket=><span key={bucket} className={`ratio-${bucket==='valid'?'val':bucket}`} style={{width:`${data.counts[bucket]/Math.max(1,data.total)*100}%`}}>{data.counts[bucket]/Math.max(1,data.total)>=.12?`${w(bucketLabel(bucket))} ${percent(data.counts[bucket]/data.total)}`:null}</span>)}</div>
        <input type="range" min="0" max="100" step="1" value={cursor} aria-label={w('Preview saved allocation')} disabled={loading||!data.total}
          aria-valuetext={percent(cursor/100)} onChange={event=>inspect(Number(event.target.value))} onFocus={()=>inspect(cursor)}
          onPointerMove={event=>{if(event.pointerType==='touch')return;const bounds=allocation.current!.getBoundingClientRect();if(bounds.width)inspect(Math.round(Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100))));}}
          onPointerDown={event=>{const bounds=allocation.current!.getBoundingClientRect();if(bounds.width)inspect(Math.round(Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100))));}}
          onPointerLeave={event=>{if(event.pointerType!=='touch')setHover(null);}} onBlur={()=>setHover(null)} onKeyDown={event=>{if(event.key==='Escape')setHover(null);}}/>
      </div>
      <dl className="coverage-counts">{buckets.map(bucket=><div key={bucket}><dt>{w(bucketLabel(bucket))}</dt><dd>{data.counts[bucket].toLocaleString()} · {percent(data.counts[bucket]/Math.max(1,data.total))}</dd></div>)}</dl>
      <div className="coverage-window-header"><strong>{w('Coverage window')}</strong><span>{lower}% – {upper}%</span><button type="button" className="secondary" onClick={()=>setControl({key,groupId,range:[0,100]})}>{w('Full range')}</button></div>
      <p className="muted">{w('Left to right: original image order. Three rows show Train / Validation / Test; darker cells mean more images in that interval.')}</p>
      <div className="coverage-spread"><div className="coverage-row-labels">{buckets.map(bucket=><span key={bucket}>{w(bucketLabel(bucket))}</span>)}</div>
        <svg className="coverage-chart" viewBox="0 0 640 42" preserveAspectRatio="none" role="img" aria-label={w('Train, validation and test across source filename order')}>{data.bins.map((bin,index)=>{
          const total=count(bin.counts),width=640/Math.max(1,data.bins.length);
          return <g key={index}>{buckets.map((bucket,row)=><rect key={bucket} x={index*width+.25} y={row*14} width={Math.max(0,width-.5)} height={12} opacity={bin.counts[bucket]>0&&total>0 ? .25+.75*bin.counts[bucket]/total : 0} className={`coverage-bin ratio-${bucket==='valid'?'val':bucket}`}><title>{`${bin.first_index}–${bin.last_index}: ${w(bucketLabel(bucket))} ${bin.counts[bucket]}`}</title></rect>)}</g>;
        })}</svg>
      </div>
      <div className="box-area-slider coverage-window-slider" style={{'--range-start':`${lower}%`,'--range-end':`${upper}%`} as CSSProperties}><div className="box-area-track"/>
        <input type="range" min="0" max="100" step="1" value={lower} aria-label={w('Coverage start')} aria-valuetext={`${lower}%`} onChange={event=>range(0,Number(event.target.value))}/>
        <input type="range" min="0" max="100" step="1" value={upper} aria-label={w('Coverage end')} aria-valuetext={`${upper}%`} onChange={event=>range(1,Number(event.target.value))}/></div>
      <p className="coverage-window-summary" aria-live="polite">{loading?w('Loading selected window…'):w('Images {first}–{last} · {count} images',{first:data.window.first_index,last:data.window.last_index,count:data.window.count.toLocaleString()})} · {buckets.map(bucket=>`${w(bucketLabel(bucket))} ${data.window_counts[bucket]}`).join(' / ')}</p>
      <small>{w('Ordered by source group, then filename. Dragging only zooms the inspection window; it never changes membership.')}</small>
      <details className="coverage-batches"><summary>{w('Batch distribution for this Split')} ({batches.length})</summary>
      <div className="coverage-source-list">{batches.map(group=><article className="coverage-source" key={group.id}>
        <div className="coverage-source-name"><strong>{group.name}</strong>{group.source_name?<span>{group.source_name}</span>:null}</div>
        <dl className="coverage-counts">{buckets.map(bucket=><div key={bucket}><dt>{w(bucketLabel(bucket))}</dt><dd>{group.counts[bucket].toLocaleString()}<small>{w('{share} of bucket',{share:percent(group.bucket_share[bucket])})}</small></dd></div>)}</dl>
      </article>)}</div></details>
      <small>{w('Open Data keeps its official train/validation groups. Combined actual ratios can differ from the local ratio settings.')}</small>
      <small>{w('Coverage is not a guarantee against leakage between similar frames or augmentations.')}</small>
      {data.provenance==='legacy'?<small>{w('Legacy Split: provenance reconstructed from retained history; missing names remain unknown.')}</small>:<small>{w('Frozen source versions · shuffle seed {seed}',{seed:data.seed??'—'})}</small>}
    </>}
    {hover&&data&&!loading?<div className="coverage-preview" role="tooltip" popover="manual" ref={node=>{if(node?.showPopover)node.showPopover();}} style={{left:hover.left,top:hover.top,width:Math.min(280,window.innerWidth-32)}}>
      {shown?<><img src={shown.url} width="256" height="160" alt={w('Saved Split preview {name}',{name:shown.sample.file_name})}/><strong>{shown.sample.file_name}</strong><span>{w(bucketLabel(shown.sample.bucket))} · {shown.sample.index}/{shown.sample.total}</span><small>{shown.sample.group_name}</small></>:<span>{w(previewError===hover.key?'Preview unavailable. Saved membership is unchanged.':'Loading thumbnail…')}</span>}
    </div>:null}
  </section>;
}
