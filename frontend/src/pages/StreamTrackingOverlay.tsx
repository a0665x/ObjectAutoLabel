import { useEffect, useState, type RefObject } from "react";
import type { TrackingViz } from './TrackingSettingsPanel';
import type { Language } from '../types';
import { trackingText, trackingState, trackingReason } from './trackingText';

export type TrackedObject = { id: string; raw_id?:string; box: number[]; score: number; class_id: number; name: string;
  predicted?:boolean; trail?:number[][]; anchors?:Array<{raw_id:string;dx_norm:number;dy_norm:number}>;
  forecast?:{bbox:number[];horizon_ms:number}|null;
  uncertainty?:{center:number[];radii:number[];angle:number};
  motion?:{valid:boolean;dt_ms:number|null;reason?:string;innovation?:{center_distance_norm:number|null};image_velocity?:{speed_norm_per_s:number}};
};
export type TrackingFrame = { time: number; width: number; height: number; objects: TrackedObject[];dt_ms?:number;
  identity?:{state?:string;reason?:string;selected?:string;score?:number;margin?:number;evidence_coverage?:number;
    confirmation_count?:number;confirmation_required?:number;misses?:number;reference_age_ms?:number;bridge_gain?:number;direct_suspect?:boolean;center_innovation_norm?:number|null;low_evidence?:boolean};
};

export function frameAt(frames: TrackingFrame[], time: number): TrackingFrame | undefined {
  let lo = 0, hi = frames.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= time + .001) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const frame = frames[found];
  return frame && time - frame.time < (frame.dt_ms === undefined ? .25 : frame.dt_ms / 1000 + .05) ? frame : undefined;
}

export function StreamTrackingOverlay({ video, frames, selected, onSelect, onTime, active, viz, language='en' }: {
  video: RefObject<HTMLVideoElement | null>; frames: RefObject<TrackingFrame[]>;
  selected: string | null; onSelect: (id: string | null, time?:number) => void; onTime: (time: number) => void; active: boolean; viz?:TrackingViz; language?:Language;
}) {
  const [frame, setFrame] = useState<TrackingFrame>();
  useEffect(() => {
    if (!active) { setFrame(undefined); return; }
    let raf = 0;
    const tick = () => {
      const time = video.current?.currentTime ?? 0;
      setFrame(frameAt(frames.current, time));
      onTime(time);
      // Keep only recent metadata. A seek starts a fresh session, not old IDs.
      while (frames.current.length > 1 && frames.current[1].time < time - 10) frames.current.shift();
    };
    const loop = () => { tick(); raf = requestAnimationFrame(loop); };
    loop();
    const element = video.current;
    element?.addEventListener("timeupdate", tick);
    return () => { cancelAnimationFrame(raf); element?.removeEventListener("timeupdate", tick); };
  }, [active, video, frames, onTime]);
  if (!active) return null;
  const visible = frame?.objects ?? [];
  const t=(key:Parameters<typeof trackingText>[1])=>trackingText(language,key);
  const debug=frame?.identity;
  const target=visible.find(o=>o.id===selected);
  return <>
    <svg className="stream-tracking-overlay" viewBox={`0 0 ${frame?.width ?? 640} ${frame?.height ?? 360}`} aria-label={t('objects')}>
      {visible.map((object) => {
        const [x1, y1, x2, y2] = object.box;
        const chosen = selected === object.id;
        const cx=(x1+x2)/2,cy=(y1+y2)/2;
        const uncertainty=object.uncertainty;
        const predicted=object.forecast?.bbox;
        const w=frame?.width??640,h=frame?.height??360;
        return <g key={object.id} className={chosen ? "stream-track selected" : "stream-track"}>
          <g className="stream-motion-viz" aria-hidden="true">
            {viz?.topology && object.anchors?.map(a=><line className="stream-topology-link" key={a.raw_id} x1={cx} y1={cy} x2={cx+a.dx_norm*w} y2={cy+a.dy_norm*h}/>)}
            {viz?.trails && object.trail && <polyline className="stream-kalman-trail" points={object.trail.map(p=>p.join(',')).join(' ')}/>}
            {viz?.prediction && uncertainty && <ellipse className="stream-kalman-uncertainty" cx={uncertainty.center[0]} cy={uncertainty.center[1]} rx={uncertainty.radii[0]} ry={uncertainty.radii[1]} transform={`rotate(${uncertainty.angle} ${uncertainty.center.join(' ')})`}/>}
            {viz?.prediction && predicted && <><path className="stream-kalman-forecast" d={`M${predicted[0]*w},${predicted[1]*h} H${predicted[2]*w} V${predicted[3]*h} H${predicted[0]*w} Z`}/><line className="stream-kalman-forecast" x1={cx} y1={cy} x2={(predicted[0]+predicted[2])/2*w} y2={(predicted[1]+predicted[3])/2*h}/></>}
          </g>
          <rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)}
            strokeDasharray={object.predicted?'7 4':undefined}
            role="button" tabIndex={0} aria-pressed={chosen} aria-label={`${t('track')} ${object.name} ${object.id}`}
            onClick={() => onSelect(chosen ? null : object.id,frame?.time)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(chosen ? null : object.id,frame?.time); } }} />
          <text x={Math.max(2, x1)} y={Math.max(14, y1 - 5)}>{chosen ? `${t('selected')} · ` : ""}{object.name} #{object.id} · {object.score.toFixed(2)}</text>
          {viz?.diagnostics && <text className="stream-motion-label" x={Math.max(2,x1)} y={Math.min(h-4,y2+12)}>{t('raw')} {object.raw_id??object.id} · {object.predicted?t('bridge'):object.motion?.valid?'Kalman':t('warmup')} · Δt {object.motion?.dt_ms?.toFixed(0)??'—'} ms · v {object.motion?.image_velocity?.speed_norm_per_s.toFixed(2)??'—'} /s</text>}
        </g>;
      })}
    </svg>
    {selected && !viz?.diagnostics && <span className="stream-track-status" role="status">{visible.some((object) => object.id === selected) ? `${t('trackingActive')} #${selected}` : `#${selected} ${t('lost')}`}</span>}
    {viz?.diagnostics && selected && <div className="stream-identity-debug" aria-label={t('diagnostics')}>
      <div>SID {selected} · {t('raw')} {target?.raw_id??'—'} · {trackingState(language,debug?.state)} {debug?.direct_suspect?`· ${t('rejected')}`:''}</div>
      <div>{t('score')} {debug?.score?.toFixed(2)??'—'} · {t('margin')} {debug?.margin?.toFixed(2)??'—'} · {t('evidence')} {debug?.evidence_coverage?.toFixed(2)??'—'} · {t('confirm')} {debug?.confirmation_count??0}/{debug?.confirmation_required??0}</div>
      <div>Δt {frame?.dt_ms?.toFixed(1)??'—'} ms · {t('innovation')} {(debug?.center_innovation_norm??target?.motion?.innovation?.center_distance_norm)?.toFixed(3)??'—'} · {t('age')} {debug?.reference_age_ms??0} ms · {t('misses')} {debug?.misses??0} {debug?.low_evidence?`· ${t('lowEvidence')}`:''}</div>
      <small>{trackingReason(language,debug?.reason)} · {t('ellipse')}</small>
    </div>}
  </>;
}
