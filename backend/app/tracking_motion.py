# Ported from Osiris_ai_src/AI_Server/tracking_motion.py (2026-09-29); pure algorithm, no gimbal I/O.
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


@dataclass(frozen=True)
class MotionConfig:
    max_prediction_ms: int = 300
    min_observations: int = 3
    state_ttl_ms: int = 600
    measurement_noise: float = 0.0025
    position_process_noise: float = 0.0004
    velocity_process_noise: float = 0.04
    max_frame_delta_ms: int = 1000
    max_measurement_innovation_norm: float = 0.18


@dataclass(frozen=True)
class CameraMotion:
    vx_norm_per_s: float = 0.0
    vy_norm_per_s: float = 0.0
    valid: bool = False
    reason: str | None = "unavailable"


class CameraMotionCompensator:
    """Estimate image-plane motion caused by recent gimbal rotation."""

    def __init__(
        self,
        max_status_age_ms=2000,
        max_delta_ms=1000,
        max_future_skew_ms=50,
        max_yaw_delta_rad=math.radians(45.0),
        max_pitch_delta_rad=math.radians(45.0),
        max_yaw_rate_rad_per_s=math.radians(180.0),
        max_pitch_rate_rad_per_s=math.radians(180.0),
    ):
        self.max_status_age_ms = int(max_status_age_ms)
        self.max_delta_ms = int(max_delta_ms)
        self.max_future_skew_ms = int(max_future_skew_ms)
        self.max_yaw_delta_rad = float(max_yaw_delta_rad)
        self.max_pitch_delta_rad = float(max_pitch_delta_rad)
        self.max_yaw_rate_rad_per_s = float(max_yaw_rate_rad_per_s)
        self.max_pitch_rate_rad_per_s = float(max_pitch_rate_rad_per_s)
        self._last = None

    def clear(self):
        self._last = None

    @staticmethod
    def _normalize_angle(value):
        return math.atan2(math.sin(value), math.cos(value))

    def update(self, timestamp, yaw_rad, pitch_rad, hfov_deg, vfov_deg, now_ts):
        values = (timestamp, yaw_rad, pitch_rad, hfov_deg, vfov_deg, now_ts)
        if not all(
            isinstance(value, (int, float)) and math.isfinite(value)
            for value in values
        ):
            return CameraMotion(reason="invalid_gimbal_status")
        if (now_ts - timestamp) * 1000.0 > self.max_status_age_ms:
            return CameraMotion(reason="stale_gimbal_status")
        if (timestamp - now_ts) * 1000.0 > self.max_future_skew_ms:
            return CameraMotion(reason="future_gimbal_status")

        hfov_rad = math.radians(float(hfov_deg))
        vfov_rad = math.radians(float(vfov_deg))
        if hfov_rad <= 0.0 or vfov_rad <= 0.0:
            return CameraMotion(reason="invalid_camera_fov")

        current = (float(timestamp), float(yaw_rad), float(pitch_rad))
        previous = self._last
        if previous is None:
            self._last = current
            return CameraMotion(reason="missing_previous_gimbal_status")

        dt = current[0] - previous[0]
        if dt <= 0.0:
            return CameraMotion(reason="invalid_gimbal_delta")
        if dt * 1000.0 > self.max_delta_ms:
            # A long but forward-time gap is a discontinuity.  Rebase so the
            # next healthy sample can recover, but never emit compensation now.
            self._last = current
            return CameraMotion(reason="invalid_gimbal_delta")

        delta_yaw = self._normalize_angle(current[1] - previous[1])
        delta_pitch = current[2] - previous[2]
        if abs(delta_yaw) > self.max_yaw_delta_rad:
            return CameraMotion(reason="implausible_yaw_delta")
        if abs(delta_pitch) > self.max_pitch_delta_rad:
            return CameraMotion(reason="implausible_pitch_delta")
        if abs(delta_yaw / dt) > self.max_yaw_rate_rad_per_s:
            return CameraMotion(reason="implausible_yaw_rate")
        if abs(delta_pitch / dt) > self.max_pitch_rate_rad_per_s:
            return CameraMotion(reason="implausible_pitch_rate")

        # Only a fully validated attitude sample may become the next reference.
        # This prevents a one-frame quaternion glitch from poisoning recovery.
        self._last = current
        return CameraMotion(
            vx_norm_per_s=(-delta_yaw / hfov_rad) / dt,
            vy_norm_per_s=(delta_pitch / vfov_rad) / dt,
            valid=True,
            reason=None,
        )


class _KalmanBoxState:
    def __init__(self, measurement: np.ndarray, pts_ns: int, config: MotionConfig):
        self.config = config
        self.x = np.zeros((8, 1), dtype=np.float64)
        self.x[:4, 0] = measurement
        self.p = np.eye(8, dtype=np.float64)
        self.p[:4, :4] *= config.measurement_noise
        self.p[4:, 4:] *= 1.0
        self.last_pts_ns = int(pts_ns)
        self.last_observed_pts_ns = int(pts_ns)
        self.last_dt_ms = None
        self.last_center_innovation_norm = None
        self.last_update_reason = None
        self.age_frames = 1
        self.miss_frames = 0
        self.observations = 1

    def _transition(self, dt: float):
        matrix = np.eye(8, dtype=np.float64)
        for index in range(4):
            matrix[index, index + 4] = dt
        return matrix

    def predict_to(self, pts_ns: int):
        dt = (int(pts_ns) - self.last_pts_ns) / 1_000_000_000.0
        if dt <= 0.0 or dt * 1000.0 > self.config.max_frame_delta_ms:
            return False
        transition = self._transition(dt)
        process = np.diag(
            [self.config.position_process_noise * dt] * 4
            + [self.config.velocity_process_noise * dt] * 4
        )
        self.x = transition @ self.x
        self.p = transition @ self.p @ transition.T + process
        self.last_pts_ns = int(pts_ns)
        self.last_dt_ms = dt * 1000.0
        self.age_frames += 1
        return True

    def update(self, measurement: np.ndarray, pts_ns: int):
        # A duplicate PTS is not a new observation.  Counting it would make a
        # track become valid without any passage of time, while a backward PTS
        # could corrupt velocity.  Large positive gaps are rebuilt by the store
        # before reaching this method.
        if int(pts_ns) <= self.last_pts_ns:
            self.last_update_reason = "invalid_frame_delta"
            return False
        if not self.predict_to(pts_ns):
            self.last_update_reason = "invalid_frame_delta"
            return False
        observation = np.zeros((4, 8), dtype=np.float64)
        observation[:, :4] = np.eye(4, dtype=np.float64)
        noise = np.eye(4, dtype=np.float64) * self.config.measurement_noise
        innovation = measurement.reshape(4, 1) - observation @ self.x
        self.last_center_innovation_norm = math.hypot(
            float(innovation[0, 0]),
            float(innovation[1, 0]),
        )
        if self.last_center_innovation_norm > self.config.max_measurement_innovation_norm:
            self.miss_frames += 1
            self.last_update_reason = "measurement_innovation_rejected"
            return False
        covariance = observation @ self.p @ observation.T + noise
        gain = self.p @ observation.T @ np.linalg.inv(covariance)
        self.x = self.x + gain @ innovation
        self.p = (np.eye(8, dtype=np.float64) - gain @ observation) @ self.p
        self.last_observed_pts_ns = int(pts_ns)
        self.observations += 1
        self.miss_frames = 0
        self.last_update_reason = None
        return True


class PerTrackMotionStore:
    def __init__(self, config: MotionConfig | None = None):
        self.config = config or MotionConfig()
        self._states: dict[int, _KalmanBoxState] = {}
        self.last_reset_reason = None

    @property
    def track_count(self):
        return len(self._states)

    @staticmethod
    def _bbox_to_measurement(bbox):
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            return None
        try:
            x1, y1, x2, y2 = [float(value) for value in bbox]
        except (TypeError, ValueError):
            return None
        values = (x1, y1, x2, y2)
        if not all(math.isfinite(value) for value in values):
            return None
        width = x2 - x1
        height = y2 - y1
        if width <= 0.0 or height <= 0.0:
            return None
        return np.array([(x1 + x2) * 0.5, (y1 + y2) * 0.5, width, height])

    @staticmethod
    def _state_bbox(state_vector):
        cx, cy, width, height = [float(value) for value in state_vector[:4, 0]]
        width = max(1e-6, min(1.0, width))
        height = max(1e-6, min(1.0, height))
        return [
            max(0.0, min(1.0, cx - width * 0.5)),
            max(0.0, min(1.0, cy - height * 0.5)),
            max(0.0, min(1.0, cx + width * 0.5)),
            max(0.0, min(1.0, cy + height * 0.5)),
        ]

    def update_observed(self, objects, pts_ns, camera_motion: CameraMotion | None = None):
        frame_pts_ns = int(pts_ns) if isinstance(pts_ns, int) else None
        observed_ids = set()
        for item in objects:
            raw_id = item.get("tracking_id_raw")
            measurement = self._bbox_to_measurement(item.get("bbox"))
            if raw_id is None or measurement is None or frame_pts_ns is None:
                item["motion"] = self._invalid_motion("invalid_observation")
                continue
            raw_id = int(raw_id)
            observed_ids.add(raw_id)
            state = self._states.get(raw_id)
            if state is None:
                state = _KalmanBoxState(measurement, frame_pts_ns, self.config)
                self._states[raw_id] = state
                updated = True
            else:
                frame_delta_ms = (frame_pts_ns - state.last_pts_ns) / 1_000_000.0
                observed_age_ms = (
                    frame_pts_ns - state.last_observed_pts_ns
                ) / 1_000_000.0
                # An ID may be reused after a detector/tracker discontinuity.
                # Rebuild only for a forward-time gap: duplicate/backward PTS
                # must remain invalid and must never advance observations.
                should_reinitialize = frame_delta_ms > 0.0 and (
                    frame_delta_ms > self.config.max_frame_delta_ms
                    or observed_age_ms > self.config.state_ttl_ms
                )
                if should_reinitialize:
                    state = _KalmanBoxState(measurement, frame_pts_ns, self.config)
                    self._states[raw_id] = state
                    updated = True
                else:
                    updated = state.update(measurement, frame_pts_ns)
            item["motion"] = self._motion_record(
                state,
                camera_motion or CameraMotion(),
                valid=updated and state.observations >= self.config.min_observations,
                reason=None if updated else state.last_update_reason,
            )

        for raw_id, state in list(self._states.items()):
            if raw_id in observed_ids or frame_pts_ns is None:
                continue
            if frame_pts_ns > state.last_pts_ns:
                state.predict_to(frame_pts_ns)
                state.miss_frames += 1
            age_ms = (frame_pts_ns - state.last_observed_pts_ns) / 1_000_000.0
            if age_ms > self.config.state_ttl_ms:
                del self._states[raw_id]

    def predict(self, raw_id, horizon_ms):
        state = self._states.get(int(raw_id)) if raw_id is not None else None
        if state is None:
            return None
        horizon_ms = max(0, min(int(horizon_ms), self.config.max_prediction_ms))
        observed_age_ms = max(
            0.0,
            (state.last_pts_ns - state.last_observed_pts_ns) / 1_000_000.0,
        )
        total_age_ms = observed_age_ms + horizon_ms
        if total_age_ms > self.config.max_prediction_ms:
            return {
                "valid": False,
                "reason": "prediction_expired",
                "bbox": None,
                "horizon_ms": horizon_ms,
                "age_ms": round(total_age_ms, 3),
                "confidence": 0.0,
            }
        transition = state._transition(horizon_ms / 1000.0)
        predicted = transition @ state.x
        confidence = max(
            0.0,
            1.0 - total_age_ms / max(1, self.config.max_prediction_ms),
        )
        return {
            "valid": state.observations >= self.config.min_observations,
            "bbox": self._state_bbox(predicted),
            "horizon_ms": horizon_ms,
            "age_ms": round(total_age_ms, 3),
            "confidence": round(confidence, 6),
        }

    def clear(self, reason):
        self._states.clear()
        self.last_reset_reason = str(reason)

    def position_covariance(self, raw_id):
        """Diagnostic extension: posterior center covariance in normalized units."""
        state = self._states.get(int(raw_id))
        return state.p[:2, :2].copy() if state is not None else None

    @staticmethod
    def _invalid_motion(reason):
        return {
            "source": "osiris_kalman",
            "observed": False,
            "valid": False,
            "reason": str(reason),
            "age_frames": 0,
            "miss_frames": 0,
            "dt_ms": None,
            "image_velocity": None,
            "camera_compensated_velocity": {
                "vx_norm_per_s": None,
                "vy_norm_per_s": None,
                "valid": False,
                "reason": str(reason),
            },
            "prediction": None,
            "innovation": None,
        }

    def _motion_record(self, state, camera_motion, valid, reason):
        velocity = [float(value) for value in state.x[4:8, 0]]
        if not all(math.isfinite(value) for value in velocity):
            return self._invalid_motion("non_finite_kalman_state")
        vx, vy, vw, vh = velocity
        speed = math.hypot(vx, vy)
        image_velocity = {
            "vx_norm_per_s": round(vx, 6),
            "vy_norm_per_s": round(vy, 6),
            "vw_norm_per_s": round(vw, 6),
            "vh_norm_per_s": round(vh, 6),
            "speed_norm_per_s": round(speed, 6),
            "direction_rad": round(math.atan2(vy, vx), 6) if speed > 1e-9 else 0.0,
        }
        try:
            camera_vx = float(camera_motion.vx_norm_per_s)
            camera_vy = float(camera_motion.vy_norm_per_s)
            camera_velocity_is_finite = math.isfinite(camera_vx) and math.isfinite(
                camera_vy
            )
        except (TypeError, ValueError):
            camera_vx = 0.0
            camera_vy = 0.0
            camera_velocity_is_finite = False
        if camera_motion.valid and camera_velocity_is_finite:
            compensated = {
                "vx_norm_per_s": round(vx - camera_vx, 6),
                "vy_norm_per_s": round(vy - camera_vy, 6),
                "valid": True,
                "reason": None,
            }
        elif camera_motion.valid:
            compensated = {
                "vx_norm_per_s": None,
                "vy_norm_per_s": None,
                "valid": False,
                "reason": "non_finite_camera_motion",
            }
        else:
            compensated = {
                "vx_norm_per_s": None,
                "vy_norm_per_s": None,
                "valid": False,
                "reason": camera_motion.reason,
            }
        is_valid = bool(valid)
        invalid_reason = reason
        if not is_valid and invalid_reason is None:
            invalid_reason = "insufficient_observations"
        return {
            "source": "osiris_kalman",
            "observed": True,
            "valid": is_valid,
            "reason": invalid_reason,
            "age_frames": int(state.age_frames),
            "miss_frames": int(state.miss_frames),
            "dt_ms": round(float(state.last_dt_ms), 3) if state.last_dt_ms is not None else None,
            "image_velocity": image_velocity,
            "camera_compensated_velocity": compensated,
            "prediction": {
                "bbox": self._state_bbox(state.x),
                "horizon_ms": 0,
                "confidence": 1.0 if is_valid else 0.0,
            },
            "innovation": {
                "center_distance_norm": (
                    round(float(state.last_center_innovation_norm), 6)
                    if state.last_center_innovation_norm is not None
                    else None
                ),
            },
        }
