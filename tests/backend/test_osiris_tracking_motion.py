# Regression fixtures ported from Osiris_ai_src/tests (2026-09-29).
import math
import unittest

from backend.app.tracking_motion import (
    CameraMotion,
    CameraMotionCompensator,
    MotionConfig,
    PerTrackMotionStore,
)


def obj(raw_id, cx, cy, width=0.10, height=0.20):
    return {
        "tracking_id": raw_id % 256,
        "tracking_id_raw": raw_id,
        "class": "people",
        "bbox": [
            cx - width / 2.0,
            cy - height / 2.0,
            cx + width / 2.0,
            cy + height / 2.0,
        ],
    }


class PerTrackMotionStoreTests(unittest.TestCase):
    def store(self):
        return PerTrackMotionStore(
            MotionConfig(
                max_prediction_ms=300,
                min_observations=3,
                state_ttl_ms=600,
            )
        )

    def test_constant_velocity_converges(self):
        store = self.store()
        last = None
        for index in range(20):
            pts_ns = index * 100_000_000
            objects = [obj(37, 0.20 + 0.02 * index, 0.40)]
            store.update_observed(objects, pts_ns)
            last = objects[0]["motion"]

        self.assertTrue(last["valid"])
        self.assertAlmostEqual(
            last["image_velocity"]["vx_norm_per_s"],
            0.20,
            delta=0.03,
        )
        self.assertAlmostEqual(
            last["image_velocity"]["vy_norm_per_s"],
            0.0,
            delta=0.02,
        )

    def test_filtered_velocity_is_less_noisy_than_two_frame_difference(self):
        store = self.store()
        centers = [0.50, 0.506, 0.497, 0.504, 0.498, 0.503, 0.499, 0.501]
        raw_velocity = []
        filtered_velocity = []
        for index, center in enumerate(centers):
            objects = [obj(7, center, 0.50)]
            store.update_observed(objects, index * 100_000_000)
            if index:
                raw_velocity.append((center - centers[index - 1]) / 0.1)
            motion = objects[0]["motion"]
            if motion["valid"]:
                filtered_velocity.append(motion["image_velocity"]["vx_norm_per_s"])

        raw_energy = sum(value * value for value in raw_velocity) / len(raw_velocity)
        filtered_energy = sum(value * value for value in filtered_velocity) / len(filtered_velocity)
        self.assertLess(filtered_energy, raw_energy)

    def test_backward_pts_does_not_emit_non_finite_velocity(self):
        store = self.store()
        first = [obj(4, 0.40, 0.40)]
        second = [obj(4, 0.45, 0.40)]
        store.update_observed(first, 200_000_000)
        store.update_observed(second, 100_000_000)

        motion = second[0]["motion"]
        self.assertFalse(motion["valid"])
        self.assertEqual(motion["reason"], "invalid_frame_delta")
        self.assertNotIn("NaN", str(motion))
        self.assertNotIn("inf", str(motion).lower())

    def test_duplicate_pts_does_not_count_as_an_observation(self):
        store = PerTrackMotionStore(MotionConfig(min_observations=2))
        first = [obj(4, 0.40, 0.40)]
        duplicate = [obj(4, 0.45, 0.40)]
        store.update_observed(first, 100_000_000)
        store.update_observed(duplicate, 100_000_000)

        motion = duplicate[0]["motion"]
        self.assertFalse(motion["valid"])
        self.assertEqual(motion["reason"], "invalid_frame_delta")

        next_frame = [obj(4, 0.41, 0.40)]
        store.update_observed(next_frame, 200_000_000)
        self.assertTrue(next_frame[0]["motion"]["valid"])

    def test_measurement_innovation_is_computed_before_kalman_update(self):
        store = self.store()
        for index in range(4):
            objects = [obj(8, 0.30 + index * 0.01, 0.40)]
            store.update_observed(objects, index * 100_000_000)
        jumped = [obj(8, 0.80, 0.40)]
        store.update_observed(jumped, 400_000_000)
        self.assertGreater(
            jumped[0]["motion"]["innovation"]["center_distance_norm"],
            0.40,
        )

    def test_prediction_expires_and_is_removed_after_ttl(self):
        store = self.store()
        for index in range(5):
            objects = [obj(11, 0.20 + index * 0.01, 0.40)]
            store.update_observed(objects, index * 100_000_000)

        predicted = store.predict(11, 200)
        self.assertIsNotNone(predicted)
        self.assertTrue(predicted["valid"])
        self.assertGreater(predicted["bbox"][0], objects[0]["bbox"][0])

        store.update_observed([], 1_100_000_000)
        self.assertIsNone(store.predict(11, 0))

    def test_rejected_measurements_reinitialize_after_ttl_for_raw_id_reuse(self):
        store = PerTrackMotionStore(
            MotionConfig(
                min_observations=2,
                state_ttl_ms=300,
                max_frame_delta_ms=1000,
            )
        )
        store.update_observed([obj(12, 0.20, 0.40)], 0)
        accepted = [obj(12, 0.21, 0.40)]
        store.update_observed(accepted, 100_000_000)
        self.assertTrue(accepted[0]["motion"]["valid"])

        rejected = [obj(12, 0.80, 0.40)]
        store.update_observed(rejected, 200_000_000)
        self.assertEqual(
            rejected[0]["motion"]["reason"],
            "measurement_innovation_rejected",
        )

        reused = [obj(12, 0.81, 0.40)]
        store.update_observed(reused, 500_000_000)
        self.assertFalse(reused[0]["motion"]["valid"])
        self.assertEqual(reused[0]["motion"]["reason"], "insufficient_observations")
        self.assertAlmostEqual(reused[0]["motion"]["prediction"]["bbox"][0], 0.76)

        confirmed = [obj(12, 0.82, 0.40)]
        store.update_observed(confirmed, 600_000_000)
        self.assertTrue(confirmed[0]["motion"]["valid"])

    def test_large_positive_frame_gap_reinitializes_from_current_measurement(self):
        store = PerTrackMotionStore(
            MotionConfig(min_observations=2, max_frame_delta_ms=200)
        )
        store.update_observed([obj(18, 0.20, 0.40)], 0)
        observed = [obj(18, 0.75, 0.40)]
        store.update_observed(observed, 500_000_000)

        motion = observed[0]["motion"]
        self.assertFalse(motion["valid"])
        self.assertEqual(motion["reason"], "insufficient_observations")
        self.assertAlmostEqual(motion["prediction"]["bbox"][0], 0.70)

    def test_non_finite_camera_motion_disables_compensation(self):
        store = PerTrackMotionStore(MotionConfig(min_observations=1))
        objects = [obj(22, 0.40, 0.40)]
        store.update_observed(
            objects,
            0,
            camera_motion=CameraMotion(
                vx_norm_per_s=float("nan"),
                vy_norm_per_s=0.0,
                valid=True,
                reason=None,
            ),
        )

        compensated = objects[0]["motion"]["camera_compensated_velocity"]
        self.assertFalse(compensated["valid"])
        self.assertEqual(compensated["reason"], "non_finite_camera_motion")
        self.assertNotIn("nan", str(objects[0]["motion"]).lower())

    def test_clear_removes_every_track(self):
        store = self.store()
        store.update_observed([obj(1, 0.3, 0.4), obj(2, 0.7, 0.4)], 0)
        store.clear("camera_switch")
        self.assertEqual(store.track_count, 0)
        self.assertEqual(store.last_reset_reason, "camera_switch")


class CameraMotionCompensatorTests(unittest.TestCase):
    def test_camera_pan_compensation_separates_stationary_and_moving_targets(self):
        compensator = CameraMotionCompensator(max_status_age_ms=500)
        store = PerTrackMotionStore(MotionConfig(min_observations=3))
        hfov_deg = 60.0
        hfov_rad = math.radians(hfov_deg)
        stationary_x = 0.60
        moving_x = 0.30
        last_stationary = None
        last_moving = None
        for index in range(12):
            timestamp = 10.0 + index * 0.1
            yaw = 0.10 + index * 0.01
            camera_motion = compensator.update(
                timestamp=timestamp,
                yaw_rad=yaw,
                pitch_rad=-0.40,
                hfov_deg=hfov_deg,
                vfov_deg=40.0,
                now_ts=timestamp,
            )
            if index:
                stationary_x += -0.01 / hfov_rad
                moving_x += (-0.01 / hfov_rad) + 0.005
            objects = [
                obj(40, stationary_x, 0.50),
                obj(41, moving_x, 0.50),
            ]
            store.update_observed(
                objects,
                index * 100_000_000,
                camera_motion=camera_motion,
            )
            last_stationary = objects[0]["motion"]
            last_moving = objects[1]["motion"]

        stationary_vx = last_stationary["camera_compensated_velocity"][
            "vx_norm_per_s"
        ]
        moving_vx = last_moving["camera_compensated_velocity"][
            "vx_norm_per_s"
        ]
        self.assertAlmostEqual(stationary_vx, 0.0, delta=0.03)
        self.assertGreater(moving_vx, stationary_vx + 0.02)

    def test_stationary_target_is_near_zero_after_yaw_compensation(self):
        compensator = CameraMotionCompensator(max_status_age_ms=500)
        store = PerTrackMotionStore(MotionConfig(min_observations=2))
        center_x = 0.60
        final_object = None
        final_camera_motion = None
        for index in range(12):
            timestamp = 10.0 + index * 0.1
            camera_motion = compensator.update(
                timestamp=timestamp,
                yaw_rad=0.10 + index * 0.005,
                pitch_rad=-0.40,
                hfov_deg=60.0,
                vfov_deg=40.0,
                now_ts=timestamp,
            )
            if camera_motion.valid:
                # A stationary world target moves in the image by precisely the
                # camera-induced velocity over this frame interval.
                center_x += camera_motion.vx_norm_per_s * 0.1
            objects = [obj(9, center_x, 0.50)]
            store.update_observed(
                objects,
                index * 100_000_000,
                camera_motion=camera_motion,
            )
            final_object = objects[0]
            final_camera_motion = camera_motion

        self.assertTrue(final_camera_motion.valid)
        compensated = final_object["motion"]["camera_compensated_velocity"]
        self.assertTrue(compensated["valid"])
        self.assertAlmostEqual(
            compensated["vx_norm_per_s"],
            0.0,
            delta=0.01,
        )

    def test_stale_status_disables_compensation(self):
        compensator = CameraMotionCompensator(max_status_age_ms=100)
        motion = compensator.update(
            timestamp=10.0,
            yaw_rad=0.1,
            pitch_rad=-0.4,
            hfov_deg=60.0,
            vfov_deg=40.0,
            now_ts=10.5,
        )

        self.assertFalse(motion.valid)
        self.assertEqual(motion.reason, "stale_gimbal_status")

    def test_future_status_is_rejected_without_advancing_history(self):
        compensator = CameraMotionCompensator(max_status_age_ms=500)
        first = compensator.update(10.0, 0.0, 0.0, 60.0, 40.0, 10.0)
        future = compensator.update(10.2, 0.02, 0.0, 60.0, 40.0, 10.0)
        recovered = compensator.update(10.1, 0.01, 0.0, 60.0, 40.0, 10.1)

        self.assertFalse(first.valid)
        self.assertFalse(future.valid)
        self.assertEqual(future.reason, "future_gimbal_status")
        self.assertTrue(recovered.valid)

    def test_implausible_yaw_and_pitch_changes_are_rejected(self):
        yaw = CameraMotionCompensator(max_status_age_ms=500)
        yaw.update(10.0, 0.0, 0.0, 60.0, 40.0, 10.0)
        yaw_glitch = yaw.update(10.1, 1.0, 0.0, 60.0, 40.0, 10.1)

        pitch = CameraMotionCompensator(max_status_age_ms=500)
        pitch.update(10.0, 0.0, 0.0, 60.0, 40.0, 10.0)
        pitch_glitch = pitch.update(10.1, 0.0, 1.0, 60.0, 40.0, 10.1)

        self.assertEqual(yaw_glitch.reason, "implausible_yaw_delta")
        self.assertEqual(pitch_glitch.reason, "implausible_pitch_delta")

    def test_implausible_yaw_and_pitch_rates_are_rejected(self):
        yaw = CameraMotionCompensator(max_status_age_ms=500)
        yaw.update(10.0, 0.0, 0.0, 60.0, 40.0, 10.0)
        yaw_glitch = yaw.update(10.01, 0.10, 0.0, 60.0, 40.0, 10.01)

        pitch = CameraMotionCompensator(max_status_age_ms=500)
        pitch.update(10.0, 0.0, 0.0, 60.0, 40.0, 10.0)
        pitch_glitch = pitch.update(10.01, 0.0, 0.10, 60.0, 40.0, 10.01)

        self.assertEqual(yaw_glitch.reason, "implausible_yaw_rate")
        self.assertEqual(pitch_glitch.reason, "implausible_pitch_rate")


if __name__ == "__main__":
    unittest.main()
