# Regression fixtures ported from Osiris_ai_src/tests (2026-09-29).
import math
import time
import unittest

from backend.app.tracking_identity import (
    CandidateEvidence,
    IdentityScoringConfig,
    ReassociationConfirmation,
    dynamic_anchor_similarity,
    rank_candidates,
    vector_motion_similarity,
)


def evidence(raw_id, position, motion, size, static_topology, dynamic_topology):
    return CandidateEvidence(
        raw_id=raw_id,
        position_score=position,
        motion_score=motion,
        size_score=size,
        static_topology_score=static_topology,
        dynamic_topology_score=dynamic_topology,
    )


class IdentityScoringTests(unittest.TestCase):
    def setUp(self):
        self.config = IdentityScoringConfig(
            match_threshold=0.70,
            match_margin=0.10,
            confirm_frames=3,
            low_evidence_confirm_frames=5,
        )

    def test_motion_breaks_static_topology_tie(self):
        decision = rank_candidates(
            [
                evidence(101, 0.85, 0.90, 0.90, 0.80, 0.90),
                evidence(102, 0.85, 0.20, 0.90, 0.80, 0.20),
            ],
            self.config,
        )
        self.assertEqual(decision.state, "candidate")
        self.assertEqual(decision.best_raw_id, 101)
        self.assertGreaterEqual(decision.margin, 0.10)

    def test_small_best_second_margin_is_ambiguous(self):
        decision = rank_candidates(
            [
                evidence(101, 0.82, 0.80, 0.80, 0.80, 0.80),
                evidence(102, 0.80, 0.79, 0.80, 0.80, 0.80),
            ],
            self.config,
        )
        self.assertEqual(decision.state, "ambiguous")
        self.assertEqual(decision.reason, "candidate_margin_too_small")

    def test_missing_motion_reweights_available_evidence_and_marks_low_coverage(self):
        decision = rank_candidates(
            [evidence(201, 0.95, None, 0.90, None, None)],
            self.config,
        )
        self.assertEqual(decision.best_raw_id, 201)
        self.assertLess(decision.evidence_coverage, 0.75)
        self.assertTrue(decision.low_evidence)

    def test_confirmation_requires_same_candidate_consecutively(self):
        confirmation = ReassociationConfirmation(self.config)
        decision = rank_candidates(
            [evidence(301, 0.95, 0.95, 0.90, 0.90, 0.90)],
            self.config,
        )
        self.assertFalse(confirmation.observe(decision))
        self.assertFalse(confirmation.observe(decision))
        self.assertTrue(confirmation.observe(decision))

        other = rank_candidates(
            [evidence(302, 0.95, 0.95, 0.90, 0.90, 0.90)],
            self.config,
        )
        self.assertFalse(confirmation.observe(other))
        self.assertEqual(confirmation.candidate_raw_id, 302)
        self.assertEqual(confirmation.count, 1)

    def test_low_evidence_requires_longer_confirmation(self):
        confirmation = ReassociationConfirmation(self.config)
        decision = rank_candidates(
            [evidence(401, 0.95, None, 0.90, None, None)],
            self.config,
        )
        for _ in range(4):
            self.assertFalse(confirmation.observe(decision))
        self.assertTrue(confirmation.observe(decision))

    def test_non_candidate_resets_confirmation(self):
        confirmation = ReassociationConfirmation(self.config)
        candidate = rank_candidates(
            [evidence(501, 0.95, 0.95, 0.90, 0.90, 0.90)], self.config
        )
        self.assertFalse(confirmation.observe(candidate))
        self.assertFalse(confirmation.observe(candidate))
        self.assertFalse(confirmation.observe(rank_candidates([], self.config)))
        self.assertIsNone(confirmation.candidate_raw_id)
        self.assertEqual(confirmation.count, 0)

    def test_low_evidence_streak_cannot_finish_early_on_one_normal_frame(self):
        confirmation = ReassociationConfirmation(self.config)
        low_evidence = rank_candidates(
            [evidence(551, 0.95, None, 0.90, None, None)], self.config
        )
        normal_evidence = rank_candidates(
            [evidence(551, 0.95, 0.95, 0.90, 0.90, 0.90)], self.config
        )

        self.assertFalse(confirmation.observe(low_evidence))
        self.assertFalse(confirmation.observe(low_evidence))
        self.assertFalse(confirmation.observe(normal_evidence))
        self.assertFalse(confirmation.observe(normal_evidence))
        self.assertTrue(confirmation.observe(normal_evidence))

    def test_non_finite_score_is_treated_as_missing_evidence(self):
        decision = rank_candidates(
            [evidence(601, 0.95, math.nan, 0.90, math.inf, -math.inf)],
            self.config,
        )
        self.assertTrue(math.isfinite(decision.best_score))
        self.assertAlmostEqual(decision.evidence_coverage, 0.45)
        self.assertTrue(decision.low_evidence)

    def test_equal_scores_have_deterministic_lowest_raw_id_winner(self):
        left = evidence(702, 0.90, 0.90, 0.90, 0.90, 0.90)
        right = evidence(701, 0.90, 0.90, 0.90, 0.90, 0.90)
        first = rank_candidates([left, right], self.config)
        second = rank_candidates([right, left], self.config)
        self.assertEqual(first.best_raw_id, 701)
        self.assertEqual(second.best_raw_id, 701)
        self.assertEqual(first.state, "ambiguous")


class MotionSimilarityTests(unittest.TestCase):
    def test_vector_motion_similarity_handles_direction_and_magnitude(self):
        same = vector_motion_similarity((1.0, 0.0), (1.0, 0.0))
        opposite = vector_motion_similarity((1.0, 0.0), (-1.0, 0.0))
        faster = vector_motion_similarity((1.0, 0.0), (2.0, 0.0))
        self.assertAlmostEqual(same, 1.0)
        self.assertGreater(faster, opposite)
        self.assertLess(faster, same)

    def test_vector_motion_similarity_returns_none_for_invalid_vectors(self):
        self.assertIsNone(vector_motion_similarity(None, (1.0, 0.0)))
        self.assertIsNone(vector_motion_similarity((1.0,), (1.0, 0.0)))
        self.assertIsNone(vector_motion_similarity((math.nan, 0.0), (1.0, 0.0)))
        self.assertIsNone(vector_motion_similarity((1.0, 0.0), (math.inf, 0.0)))

    def test_zero_speed_behavior_is_bounded(self):
        self.assertEqual(vector_motion_similarity((0.0, 0.0), (0.0, 0.0)), 1.0)
        self.assertEqual(vector_motion_similarity((0.0, 0.0), (1.0, 0.0)), 0.5)

    def test_extreme_finite_vectors_do_not_overflow_direction_comparison(self):
        score = vector_motion_similarity(
            (1e308, 1e308),
            (1e308, -1e308),
        )
        self.assertTrue(math.isfinite(score))
        self.assertAlmostEqual(score, 0.675)

    def test_dynamic_anchor_similarity_rewards_relative_motion_and_geometry(self):
        reference = [
            {
                "class_id": 2,
                "dx_norm": 0.10,
                "dy_norm": -0.05,
                "relative_vx": 0.20,
                "relative_vy": 0.00,
            }
        ]
        good = [
            {
                "class_id": 2,
                "dx_norm": 0.11,
                "dy_norm": -0.05,
                "relative_vx": 0.19,
                "relative_vy": 0.01,
            }
        ]
        bad = [
            {
                "class_id": 2,
                "dx_norm": 0.40,
                "dy_norm": 0.30,
                "relative_vx": -0.20,
                "relative_vy": 0.00,
            }
        ]
        self.assertGreater(
            dynamic_anchor_similarity(reference, good),
            dynamic_anchor_similarity(reference, bad),
        )

    def test_dynamic_anchor_similarity_returns_none_for_missing_or_invalid_motion(self):
        valid = [
            {
                "class_id": 2,
                "dx_norm": 0.0,
                "dy_norm": 0.0,
                "relative_vx": 0.1,
                "relative_vy": 0.0,
            }
        ]
        invalid = [
            {
                "class_id": 2,
                "dx_norm": 0.0,
                "dy_norm": 0.0,
                "relative_vx": None,
                "relative_vy": 0.0,
            }
        ]
        self.assertIsNone(dynamic_anchor_similarity([], valid))
        self.assertIsNone(dynamic_anchor_similarity(valid, []))
        self.assertIsNone(dynamic_anchor_similarity(valid, invalid))

    def test_dynamic_anchor_similarity_is_invariant_to_candidate_order(self):
        reference = [
            {
                "class_id": 2,
                "dx_norm": 0.0,
                "dy_norm": 0.0,
                "relative_vx": 1.0,
                "relative_vy": 0.0,
            },
            {
                "class_id": 2,
                "dx_norm": 0.05,
                "dy_norm": 0.0,
                "relative_vx": 1.0,
                "relative_vy": 0.0,
            },
        ]
        candidates = [
            {
                "class_id": 2,
                "dx_norm": -0.05,
                "dy_norm": 0.0,
                "relative_vx": 1.0,
                "relative_vy": 0.0,
            },
            {
                "class_id": 2,
                "dx_norm": 0.05,
                "dy_norm": 0.0,
                "relative_vx": 1.0,
                "relative_vy": 0.0,
            },
        ]

        forward = dynamic_anchor_similarity(reference, candidates)
        reverse = dynamic_anchor_similarity(reference, list(reversed(candidates)))
        self.assertEqual(forward, reverse)

    def test_sixteen_anchor_assignment_is_fast_and_order_invariant(self):
        references = [
            {
                "class_id": index % 3,
                "dx_norm": index * 0.01,
                "dy_norm": (index % 5) * -0.015,
                "relative_vx": 0.1 + index * 0.003,
                "relative_vy": -0.04 + index * 0.002,
            }
            for index in range(16)
        ]
        candidates = [
            {
                "class_id": index % 3,
                "dx_norm": index * 0.01 + 0.002,
                "dy_norm": (index % 5) * -0.015 - 0.001,
                "relative_vx": 0.1 + index * 0.0035,
                "relative_vy": -0.04 + index * 0.0015,
            }
            for index in range(16)
        ]

        started = time.perf_counter()
        forward = dynamic_anchor_similarity(references, candidates)
        reverse = dynamic_anchor_similarity(references, list(reversed(candidates)))
        elapsed = time.perf_counter() - started

        self.assertIsNotNone(forward)
        self.assertEqual(forward, reverse)
        # O(n^3) work at n=16 should be far below this intentionally generous
        # real-time-loop regression limit even on a loaded development board.
        self.assertLess(elapsed, 0.5)


if __name__ == "__main__":
    unittest.main()
