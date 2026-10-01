"""Selected-target Osiris motion/topology adapter; no gimbal or appearance ReID.

Raw ByteTrack IDs remain untouched. Only the selected object's display identity
is retained through confirmed reassociation. All ages use decoded media time.
"""
from collections import deque
from copy import deepcopy
from dataclasses import asdict
import math
import numpy as np

from .tracking_motion import MotionConfig, PerTrackMotionStore
from .tracking_identity import (IdentityScoringConfig, CandidateEvidence,
    ReassociationConfirmation, rank_candidates, vector_motion_similarity, dynamic_anchor_similarity)
from .tracking_settings import TrackingSettings


def geometry(o):
    x1,y1,x2,y2=o['bbox']
    w,h=max(1e-6,x2-x1),max(1e-6,y2-y1)
    return ((x1+x2)/2,(y1+y2)/2,w*h,w/h)


def velocity(o):
    motion=o.get('motion') or {}
    v=motion.get('image_velocity') or {}
    return (v['vx_norm_per_s'],v['vy_norm_per_s']) if motion.get('valid') and v else None


class IdentityTracker:
    def __init__(self, settings: TrackingSettings, width, height):
        self.s=settings
        self.scale=[width,height,width,height]
        self.motion=PerTrackMotionStore(MotionConfig(max_prediction_ms=settings.prediction_ms,
            state_ttl_ms=max(600,settings.prediction_ms*2),
            max_measurement_innovation_norm=settings.TRACKING_ID_DIRECT_MAX_INNOVATION_NORM))
        self.scoring=IdentityScoringConfig(match_threshold=settings.TRACKING_ID_STABILIZER_MATCH_THRESHOLD,
            match_margin=settings.TRACKING_ID_STABILIZER_MATCH_MARGIN,
            direct_max_innovation_norm=settings.TRACKING_ID_DIRECT_MAX_INNOVATION_NORM,
            confirm_frames=settings.TRACKING_ID_STABILIZER_CONFIRM_FRAMES,
            low_evidence_confirm_frames=settings.TRACKING_ID_STABILIZER_LOW_EVIDENCE_CONFIRM_FRAMES)
        self.confirm=ReassociationConfirmation(self.scoring)
        self.snapshots=deque(maxlen=120)
        self.histories={}
        self.selected=None
        self.reference=None
        self.debug={}
        self.misses=0
        self.blend_from=None
        self.blend_remaining=0
        self.last_display=None
        self.last_time=None

    def select(self, identity, time):
        self.selected=None
        self.reference=None
        self.confirm.reset()
        self.debug={}
        self.misses=0
        self.blend_from=None
        self.blend_remaining=0
        self.last_display=None
        if identity is None:
            return
        # Reference the clicked video frame, not a later inferred frame.
        snapshot=next((items for t,items in reversed(self.snapshots) if abs(t-time)<.002),None)
        match=next((o for o in snapshot or [] if o['id']==identity),None)
        if match is not None and not match.get('predicted'):
            self.selected=identity
            self.reference=deepcopy(match)
            self.reference['time']=time
        else:
            self.debug={'state':'selection_expired','reason':'Clicked frame no longer available; select again'}

    def anchors(self, target, objects):
        x,y,area,_=geometry(target)
        v=velocity(target)
        found=[]
        for other in objects:
            if other['raw_id']==target['raw_id']: continue
            ox,oy,oa,aspect=geometry(other)
            dx,dy=ox-x,oy-y
            distance=math.hypot(dx,dy)
            if distance>self.s.TRACKING_ID_STABILIZER_ANCHOR_RADIUS_NORM: continue
            a=dict(raw_id=other['raw_id'],class_id=other['class_id'],dx_norm=dx,dy_norm=dy,
                   dist_norm=distance,area_ratio=oa/area,aspect_ratio=aspect)
            ov=velocity(other)
            if v is not None and ov is not None:
                a.update(relative_vx=ov[0]-v[0],relative_vy=ov[1]-v[1])
            found.append(a)
        return sorted(found,key=lambda a:(a['dist_norm'],a['raw_id']))[:self.s.TRACKING_ID_STABILIZER_MAX_ANCHORS]

    def static_score(self, reference, candidate):
        if not reference or not candidate: return None
        used=set(); total=0.; count=0
        maximum=max(1e-6,self.s.TRACKING_ID_STABILIZER_ANCHOR_RADIUS_NORM*.85)
        for a in reference:
            best=None; score=0.
            for i,b in enumerate(candidate):
                if i in used: continue
                position=max(0.,1-math.hypot(a['dx_norm']-b['dx_norm'],a['dy_norm']-b['dy_norm'])/maximum)
                area=max(0.,1-abs(math.log(max(1e-6,b['area_ratio'])/max(1e-6,a['area_ratio']))))
                value=.6*position+.25*area+.15*(1 if a['class_id']==b['class_id'] else .55)
                if value>score: best,score=i,value
            if best is not None: used.add(best); total+=score; count+=1
        return .75*total/count+.25*count/len(reference) if count else 0.

    def _evidence(self, objects, time):
        ref=self.reference
        x,y,area,aspect=geometry(ref)
        v=velocity(ref)
        if v:
            x=max(0.,min(1.,x+v[0]*(time-ref['time'])))
            y=max(0.,min(1.,y+v[1]*(time-ref['time'])))
        evidence=[]; candidates={}
        for o in objects:
            if o['class_id']!=ref['class_id']: continue
            cx,cy,ca,caspect=geometry(o)
            size=max(0.,1-(.6*abs(math.log(ca/area))+.4*abs(math.log(caspect/aspect))))
            raw=o['tracking_id_raw']; candidates[raw]=o
            evidence.append(CandidateEvidence(raw,math.exp(-math.hypot(cx-x,cy-y)/.1),
                vector_motion_similarity(v,velocity(o)),size,self.static_score(ref['anchors'],o['anchors']),
                dynamic_anchor_similarity(ref['anchors'],o['anchors'])))
        return candidates,evidence

    def _bridge(self,time):
        ref=self.reference
        age=(time-ref['time'])*1000
        if not self.s.TRACKING_BRIDGE_ENABLE or age>self.s.TRACKING_BRIDGE_TTL_MS or self.misses>self.s.TRACKING_BRIDGE_MAX_MISSES:
            return None
        bridge=deepcopy(ref)
        if self.s.TRACK_MOTION_KALMAN_ENABLE:
            prediction=self.motion.predict(ref['tracking_id_raw'],0)
            if not prediction or not prediction['valid']: return None
            bridge['bbox']=prediction['bbox']
        bridge['id']=self.selected
        bridge['box']=[v*s for v,s in zip(bridge['bbox'],self.scale)]
        bridge['predicted']=True
        bridge['score']*=self.s.TRACKING_BRIDGE_CONF_DECAY**self.misses
        start=self.s.TRACKING_BRIDGE_GAIN_SCALE
        end=min(start,self.s.TRACKING_BRIDGE_GAIN_END)
        gain=start+(end-start)*min(1.,age/max(1,self.s.prediction_ms)) if self.s.TRACK_MOTION_KALMAN_ENABLE else start
        bridge['bridge_gain']=gain
        bridge['anchors']=[]  # Never claim stale predicted links are observed.
        self.debug.update(bridge_age_ms=round(age,1),bridge_gain=round(gain,3))
        return bridge

    def update(self, objects, time):
        if self.last_time is not None and time<=self.last_time:
            raise ValueError('Tracking media time must advance; reset the tracker on seek')
        self.last_time=time
        current=[]
        for o in objects:
            o=deepcopy(o); raw=o['id']; cls,identity=map(int,raw.split(':'))
            o.update(raw_id=raw,tracking_id_raw=(cls<<48)+identity,
                     bbox=[v/s for v,s in zip(o['box'],self.scale)],time=time)
            current.append(o)
        if self.s.TRACK_MOTION_KALMAN_ENABLE:
            self.motion.update_observed(current,round(time*1e9))
        for o in current:
            o['anchors']=self.anchors(o,current)
            h=self.histories.setdefault(o['raw_id'],deque(maxlen=121))
            motion=o.get('motion') or {}
            filtered=(motion.get('prediction') or {}).get('bbox') if motion.get('valid') else None
            if filtered:
                h.append([time,(filtered[0]+filtered[2])/2*self.scale[0],(filtered[1]+filtered[3])/2*self.scale[1]])
            points=[p[1:] for p in h if time-p[0]<=2]
            o['trail']=points[::max(1,math.ceil(len(points)/24))]
            covariance=self.motion.position_covariance(o['tracking_id_raw']) if filtered else None
            if covariance is not None:
                scale=np.diag(self.scale[:2]); eigen,vectors=np.linalg.eigh(scale@covariance@scale)
                o['uncertainty']={'center':[(filtered[0]+filtered[2])/2*self.scale[0],(filtered[1]+filtered[3])/2*self.scale[1]],
                    'radii':(2*np.sqrt(np.maximum(0,eigen))).tolist(),
                    'angle':math.degrees(math.atan2(vectors[1,0],vectors[0,0]))}
            forecast=self.motion.predict(o['tracking_id_raw'],min(200,self.s.prediction_ms)) if self.s.TRACK_MOTION_KALMAN_ENABLE else None
            o['forecast']=forecast if forecast and forecast['valid'] else None
        self.histories={k:v for k,v in self.histories.items() if v and time-v[-1][0]<=2}
        if self.reference:
            ref=self.reference
            direct=next((o for o in current if o['raw_id']==ref['raw_id'] and o['class_id']==ref['class_id']),None)
            innovation=((direct or {}).get('motion') or {}).get('innovation') or {}
            distance=innovation.get('center_distance_norm')
            suspect=self.s.TRACKING_ID_STABILIZER_ENABLE and distance is not None and distance>self.s.TRACKING_ID_DIRECT_MAX_INNOVATION_NORM
            chosen=direct if not suspect else None
            self.debug={'state':'direct','reason':'direct_source_raw_match','score':1.,'selected':self.selected}
            if chosen:
                usable=distance is not None and bool((chosen.get('motion') or {}).get('valid'))
                self.debug.update(margin=1.,evidence_coverage=1. if usable else 0.,low_evidence=not usable,
                    center_innovation_norm=distance)
                self.confirm.reset()
            elif self.s.TRACKING_ID_STABILIZER_ENABLE and (time-ref['time'])*1000<=self.s.TRACKING_ID_STABILIZER_MAX_AGE_MS:
                candidates,evidence=self._evidence(current,time)
                decision=rank_candidates(evidence,self.scoring)
                confirmed=self.confirm.observe(decision)
                self.debug=dict(asdict(decision),state='reassociated' if confirmed else 'pending',
                    confirmation_count=self.confirm.count,confirmation_required=self.confirm._required_frames,
                    selected=self.selected,score=decision.best_score,direct_suspect=bool(suspect),
                    center_innovation_norm=distance,
                    components=[asdict(e) for e in evidence if e.raw_id==decision.best_raw_id])
                if confirmed:
                    chosen=candidates[decision.best_raw_id]
                    self.blend_from=self.last_display
                    self.blend_remaining=self.s.TRACKING_ID_STABILIZER_REACQUIRE_BLEND_FRAMES if self.blend_from else 0
                    self.confirm.reset()
            else:
                self.confirm.reset()
                self.debug={'state':'lost','reason':'reference_expired' if self.s.TRACKING_ID_STABILIZER_ENABLE else 'stabilizer_disabled','selected':self.selected}
            if chosen:
                self.misses=0
                chosen['id']=self.selected
                self.reference=deepcopy(chosen)  # Only a confirmed observation refreshes evidence.
                if self.blend_remaining:
                    alpha=1-(self.blend_remaining-1)/self.s.TRACKING_ID_STABILIZER_REACQUIRE_BLEND_FRAMES
                    chosen['observed_box']=chosen['box'][:]
                    chosen['box']=[a+(b-a)*alpha for a,b in zip(self.blend_from,chosen['box'])]
                    self.blend_remaining-=1
                self.last_display=chosen['box'][:]
            else:
                self.misses+=1
                bridge=self._bridge(time)
                self.debug.update(misses=self.misses,reference_age_ms=round((time-ref['time'])*1000,1))
                # A suspect raw match must not appear as the stable selected ID.
                for o in current:
                    if o['id']==self.selected: o['id']='raw:'+o['raw_id']
                if bridge:
                    current.append(bridge); self.last_display=bridge['box'][:]
                    self.debug['state']='bridge' if self.debug['state']=='lost' else self.debug['state']
                else:
                    self.debug['decision_state']=self.debug['state']; self.debug['state']='lost'
            if chosen:
                for o in current:
                    if o is not chosen and o['id']==self.selected: o['id']='raw:'+o['raw_id']
        self.snapshots.append((time,deepcopy(current)))
        # Bound diagnostic transport in crowded scenes; selected target always included.
        output=[]
        for i,o in enumerate(current):
            visible={k:v for k,v in o.items() if k not in {'bbox','tracking_id_raw','time'}}
            if i>=40 and o['id']!=self.selected:
                for k in ('motion','trail','forecast','anchors','uncertainty'): visible.pop(k,None)
            output.append(visible)
        return output
