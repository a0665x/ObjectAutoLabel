"""Names/ranges match Osiris env_config.yaml; defaults snapshot 2026-09-29."""
from pydantic import BaseModel, ConfigDict, Field


class TrackingSettings(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    AI_TRACK_MINIMUM_MATCHING_THRESHOLD: float = Field(.70, ge=0, le=1, description='ByteTrack matching cost 上限；越高越容易續接，也更容易誤配。')
    TRACK_MOTION_KALMAN_ENABLE: bool = Field(True, description='啟用時間感知 Kalman；關閉時僅使用靜態 bridge。')
    TRACK_MOTION_MAX_PREDICTION_MS: int = Field(400, ge=0, le=5000, description='預測上限 ms；實際上限取與 bridge TTL 的較小值。')
    TRACKING_ID_STABILIZER_ENABLE: bool = Field(True, description='選中目標的 motion＋拓撲重關聯；不是外觀 ReID。')
    TRACKING_ID_DIRECT_MAX_INNOVATION_NORM: float = Field(.22, ge=.01, le=1, description='直接 ID 的創新距離門檻；x/y 各自除以影像寬高。')
    TRACKING_ID_STABILIZER_MAX_ANCHORS: int = Field(6, ge=0, le=16, description='每個物件附近最多採用的 anchor 數。')
    TRACKING_ID_STABILIZER_ANCHOR_RADIUS_NORM: float = Field(.30, ge=.05, le=1.5, description='鄰居搜尋半徑，normalized-image distance。')
    TRACKING_ID_STABILIZER_MATCH_THRESHOLD: float = Field(.65, ge=.05, le=1, description='重關聯最低分數；降低增加救回率與誤鎖風險。')
    TRACKING_ID_STABILIZER_MATCH_MARGIN: float = Field(.08, ge=0, le=1, description='第一、二名最低分差；不足時拒絕硬選。')
    TRACKING_ID_STABILIZER_CONFIRM_FRAMES: int = Field(3, ge=1, le=30, description='一般候選必須連續確認的 AI 幀數。')
    TRACKING_ID_STABILIZER_LOW_EVIDENCE_CONFIRM_FRAMES: int = Field(5, ge=1, le=60, description='motion/topology 證據不足的連續確認幀數。')
    TRACKING_ID_STABILIZER_REACQUIRE_BLEND_FRAMES: int = Field(3, ge=1, le=30, description='Demo 將復原紅框由 bridge 混合回觀測框；原專案用於雲台控制混合。')
    TRACKING_ID_STABILIZER_MAX_AGE_MS: int = Field(1600, ge=0, le=10000, description='最後可信 identity reference 保留時間，不由候選或 bridge 延長。')
    TRACKING_BRIDGE_ENABLE: bool = Field(True, description='短暫缺測顯示有期限的預測框（虛線）。')
    TRACKING_BRIDGE_TTL_MS: int = Field(400, ge=0, le=5000, description='Bridge 最大缺測時間 ms。')
    TRACKING_BRIDGE_MAX_MISSES: int = Field(8, ge=0, le=120, description='Bridge 最大缺測幀數；與 TTL 任一先到即停止。')
    TRACKING_BRIDGE_GAIN_SCALE: float = Field(.35, ge=0, le=1, description='僅顯示 autopilot bridge gain 診斷值；Demo 不控制雲台，也不改變配對分數。')
    TRACKING_BRIDGE_GAIN_END: float = Field(0., ge=0, le=1, description='僅 gain 診斷；effective end 不超過 start。')
    TRACKING_BRIDGE_CONF_DECAY: float = Field(.85, ge=0, le=1, description='每缺測幀的預測框信心衰減；不改變 bridge 壽命。')

    @property
    def prediction_ms(self):
        return min(self.TRACK_MOTION_MAX_PREDICTION_MS, self.TRACKING_BRIDGE_TTL_MS)
