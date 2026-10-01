# Ported from Osiris_ai_src/AI_Server/tracking_identity.py (2026-09-29); pure algorithm, no gimbal I/O.
"""Pure scoring primitives for motion-aware tracking-ID reassociation.

This module deliberately has no runtime or gimbal dependencies.  It ranks the
evidence available for an observed raw ID, while treating missing or invalid
signals as reduced confidence rather than a definite mismatch.  The caller can
therefore require a longer confirmation window before changing control targets.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Mapping, Sequence


@dataclass(frozen=True)
class IdentityScoringConfig:
    match_threshold: float = 0.70
    match_margin: float = 0.10
    direct_max_innovation_norm: float = 0.18
    confirm_frames: int = 3
    low_evidence_confirm_frames: int = 5
    low_evidence_threshold: float = 0.65
    position_weight: float = 0.30
    motion_weight: float = 0.25
    size_weight: float = 0.15
    static_topology_weight: float = 0.15
    dynamic_topology_weight: float = 0.15


@dataclass(frozen=True)
class CandidateEvidence:
    raw_id: int
    position_score: float | None
    motion_score: float | None
    size_score: float | None
    static_topology_score: float | None
    dynamic_topology_score: float | None


@dataclass(frozen=True)
class IdentityDecision:
    state: str
    reason: str
    best_raw_id: int | None
    best_score: float
    second_score: float
    margin: float
    evidence_coverage: float
    low_evidence: bool


def _finite_float(value: object) -> float | None:
    try:
        converted = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return converted if math.isfinite(converted) else None


def _clamp_score(value: object) -> float | None:
    converted = _finite_float(value)
    if converted is None:
        return None
    return max(0.0, min(1.0, converted))


def _weighted_fields(
    evidence: CandidateEvidence, config: IdentityScoringConfig
) -> tuple[tuple[float | None, float], ...]:
    return (
        (_clamp_score(evidence.position_score), config.position_weight),
        (_clamp_score(evidence.motion_score), config.motion_weight),
        (_clamp_score(evidence.size_score), config.size_weight),
        (_clamp_score(evidence.static_topology_score), config.static_topology_weight),
        (_clamp_score(evidence.dynamic_topology_score), config.dynamic_topology_weight),
    )


def _valid_weight(value: object) -> float:
    converted = _finite_float(value)
    return converted if converted is not None and converted > 0.0 else 0.0


def _score(
    evidence: CandidateEvidence, config: IdentityScoringConfig
) -> tuple[float, float]:
    fields = tuple(
        (value, _valid_weight(weight))
        for value, weight in _weighted_fields(evidence, config)
    )
    total_weight = sum(weight for _value, weight in fields)
    available = [
        (value, weight)
        for value, weight in fields
        if value is not None and weight > 0.0
    ]
    available_weight = sum(weight for _value, weight in available)
    if available_weight <= 0.0 or total_weight <= 0.0:
        return 0.0, 0.0
    score = sum(value * weight for value, weight in available) / available_weight
    coverage = available_weight / total_weight
    return score, max(0.0, min(1.0, coverage))


def rank_candidates(
    candidates: Iterable[CandidateEvidence], config: IdentityScoringConfig
) -> IdentityDecision:
    """Rank candidates without letting input order decide equal-score ties."""

    ranked = []
    for evidence in candidates:
        score, coverage = _score(evidence, config)
        ranked.append((score, int(evidence.raw_id), coverage))
    # Highest score wins; a lower raw ID is the stable diagnostic winner for a
    # tie.  The zero margin still marks that result ambiguous, so it cannot be
    # used to switch the controlled target.
    ranked.sort(key=lambda item: (-item[0], item[1]))
    if not ranked:
        return IdentityDecision(
            "none", "no_candidate", None, 0.0, 0.0, 0.0, 0.0, True
        )

    best_score, best_raw_id, coverage = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    margin = max(0.0, best_score - second_score)
    low_evidence = coverage < config.low_evidence_threshold
    if best_score < config.match_threshold:
        state, reason = "rejected", "score_below_threshold"
    elif margin < config.match_margin:
        state, reason = "ambiguous", "candidate_margin_too_small"
    else:
        state, reason = "candidate", "candidate_passed"
    return IdentityDecision(
        state,
        reason,
        best_raw_id,
        best_score,
        second_score,
        margin,
        coverage,
        low_evidence,
    )


class ReassociationConfirmation:
    """Require consecutive observed decisions before accepting a new raw ID."""

    def __init__(self, config: IdentityScoringConfig):
        self.config = config
        self.candidate_raw_id: int | None = None
        self.count = 0
        self._required_frames = 0

    def reset(self) -> None:
        self.candidate_raw_id = None
        self.count = 0
        self._required_frames = 0

    def observe(self, decision: IdentityDecision) -> bool:
        if decision.state != "candidate" or decision.best_raw_id is None:
            self.reset()
            return False
        observed_required = max(
            1,
            int(
                self.config.low_evidence_confirm_frames
                if decision.low_evidence
                else self.config.confirm_frames
            ),
        )
        if decision.best_raw_id != self.candidate_raw_id:
            self.candidate_raw_id = decision.best_raw_id
            self.count = 1
            self._required_frames = observed_required
        else:
            self.count += 1
            # Evidence quality can flicker while the raw ID remains the same.
            # Keep the strictest requirement seen in this streak so one clean
            # frame cannot prematurely authorize a target switch.
            self._required_frames = max(self._required_frames, observed_required)
        return self.count >= self._required_frames


def _vector_pair(vector: object) -> tuple[float, float] | None:
    if vector is None:
        return None
    try:
        first, second = vector  # type: ignore[misc]
    except (TypeError, ValueError):
        return None
    first_value = _finite_float(first)
    second_value = _finite_float(second)
    if first_value is None or second_value is None:
        return None
    return first_value, second_value


def vector_motion_similarity(
    reference: object, candidate: object
) -> float | None:
    """Compare 2-D direction and speed, or return None without valid motion."""

    reference_pair = _vector_pair(reference)
    candidate_pair = _vector_pair(candidate)
    if reference_pair is None or candidate_pair is None:
        return None
    reference_motion = _normalized_motion(reference_pair)
    candidate_motion = _normalized_motion(candidate_pair)
    ref_unit_x, ref_unit_y, ref_log_speed, ref_stopped = reference_motion
    cand_unit_x, cand_unit_y, cand_log_speed, cand_stopped = candidate_motion
    if ref_stopped and cand_stopped:
        return 1.0
    if ref_stopped or cand_stopped:
        return 0.5
    # Unit components avoid overflow from multiplying raw finite values such as
    # 1e308.  Log speeds likewise avoid overflowing the vector magnitude.
    cosine = ref_unit_x * cand_unit_x + ref_unit_y * cand_unit_y
    if not math.isfinite(cosine):
        return None
    cosine = max(-1.0, min(1.0, cosine))
    direction_score = max(0.0, min(1.0, (cosine + 1.0) * 0.5))
    log_speed_delta = abs(cand_log_speed - ref_log_speed)
    magnitude_score = math.exp(-log_speed_delta)
    combined = 0.65 * direction_score + 0.35 * magnitude_score
    if not all(
        math.isfinite(value)
        for value in (direction_score, magnitude_score, combined)
    ):
        return None
    return max(0.0, min(1.0, combined))


def _normalized_motion(
    vector: tuple[float, float],
) -> tuple[float, float, float, bool]:
    """Return safe unit components, log speed, and stopped state."""

    x_value, y_value = vector
    scale = max(abs(x_value), abs(y_value))
    if scale == 0.0:
        return 0.0, 0.0, float("-inf"), True
    scaled_x = x_value / scale
    scaled_y = y_value / scale
    scaled_norm = math.hypot(scaled_x, scaled_y)
    log_speed = math.log(scale) + math.log(scaled_norm)
    stopped = log_speed < math.log(1e-6)
    return (
        scaled_x / scaled_norm,
        scaled_y / scaled_norm,
        log_speed,
        stopped,
    )


def _anchor_number(anchor: Mapping[str, object], key: str) -> float | None:
    return _finite_float(anchor.get(key))


def _anchor_pair(
    anchor: Mapping[str, object], first_key: str, second_key: str
) -> tuple[float, float] | None:
    first = _anchor_number(anchor, first_key)
    second = _anchor_number(anchor, second_key)
    if first is None or second is None:
        return None
    return first, second


def dynamic_anchor_similarity(
    reference_anchors: Sequence[Mapping[str, object]] | None,
    candidate_anchors: Sequence[Mapping[str, object]] | None,
) -> float | None:
    """Greedily compare relative anchor position/motion with bounded output."""

    if not reference_anchors or not candidate_anchors:
        return None
    valid_references = []
    for reference in reference_anchors:
        if not isinstance(reference, Mapping):
            continue
        reference_position = _anchor_pair(reference, "dx_norm", "dy_norm")
        reference_motion = _anchor_pair(
            reference, "relative_vx", "relative_vy"
        )
        if reference_position is None or reference_motion is None:
            continue
        valid_references.append((reference, reference_position, reference_motion))

    valid_candidates = []
    for candidate in candidate_anchors:
        if not isinstance(candidate, Mapping):
            continue
        candidate_position = _anchor_pair(candidate, "dx_norm", "dy_norm")
        candidate_motion = _anchor_pair(candidate, "relative_vx", "relative_vy")
        if candidate_position is None or candidate_motion is None:
            continue
        valid_candidates.append((candidate, candidate_position, candidate_motion))

    if not valid_references or not valid_candidates:
        return None

    # Canonical ordering makes tie handling independent of detector list order.
    # The assignment score is mathematically order-invariant; sorting also
    # ensures identical floating-point accumulation for equal optima.
    def anchor_key(item):
        anchor, position, motion = item
        class_id = anchor.get("class_id")
        return (
            type(class_id).__name__,
            repr(class_id),
            position[0],
            position[1],
            motion[0],
            motion[1],
        )

    valid_references.sort(key=anchor_key)
    valid_candidates.sort(key=anchor_key)

    pair_scores = []
    for reference, reference_position, reference_motion in valid_references:
        row = []
        for candidate, candidate_position, candidate_motion in valid_candidates:
            position_delta = math.hypot(
                candidate_position[0] - reference_position[0],
                candidate_position[1] - reference_position[1],
            )
            position_score = math.exp(-position_delta / 0.10)
            motion_score = vector_motion_similarity(
                reference_motion, candidate_motion
            )
            if motion_score is None:
                row.append(None)
                continue
            class_score = (
                1.0
                if candidate.get("class_id") == reference.get("class_id")
                else 0.0
            )
            score = 0.55 * motion_score + 0.35 * position_score + 0.10 * class_score
            row.append(score if math.isfinite(score) else None)
        pair_scores.append(tuple(row))

    matched_count, total_score = _maximum_cardinality_weight_assignment(pair_scores)
    if matched_count <= 0:
        return None
    coverage = matched_count / max(1, len(reference_anchors))
    combined = 0.75 * (total_score / matched_count) + 0.25 * coverage
    return max(0.0, min(1.0, combined))


def _maximum_cardinality_weight_assignment(
    scores: Sequence[Sequence[float | None]],
) -> tuple[int, float]:
    """Return cardinality-first maximum-weight matching in polynomial time.

    Real edges receive a bonus larger than the maximum possible total score
    difference.  Dummy rows and columns permit unmatched anchors, while
    forbidden ``None`` edges receive a penalty.  A square Hungarian assignment
    then gives maximum cardinality first and maximum compatibility second in
    O((R + C)^3), avoiding exponential work in the real-time inference loop.
    """

    reference_count = len(scores)
    candidate_count = len(scores[0]) if reference_count else 0
    if reference_count == 0 or candidate_count == 0:
        return 0, 0.0
    if any(len(row) != candidate_count for row in scores):
        return 0, 0.0

    max_pairs = min(reference_count, candidate_count)
    cardinality_bonus = float(max_pairs + 1)
    size = reference_count + candidate_count
    forbidden_utility = -cardinality_bonus * float(size + 1)
    utilities = [[0.0] * size for _ in range(size)]
    for row_index, row in enumerate(scores):
        for column_index, score in enumerate(row):
            if score is None or not math.isfinite(score):
                utilities[row_index][column_index] = forbidden_utility
            else:
                utilities[row_index][column_index] = cardinality_bonus + score

    assignment = _hungarian_maximize(utilities)
    matched_count = 0
    total_score = 0.0
    for row_index in range(reference_count):
        column_index = assignment[row_index]
        if column_index < 0 or column_index >= candidate_count:
            continue
        score = scores[row_index][column_index]
        if score is None or not math.isfinite(score):
            continue
        matched_count += 1
        total_score += score
    return matched_count, total_score


def _hungarian_maximize(utilities: Sequence[Sequence[float]]) -> list[int]:
    """Deterministic square Hungarian assignment for finite utilities."""

    size = len(utilities)
    if size == 0 or any(len(row) != size for row in utilities):
        return []

    # Classic shortest augmenting path Hungarian algorithm.  Negating utility
    # converts maximum-weight assignment to minimum-cost assignment.
    row_potential = [0.0] * (size + 1)
    column_potential = [0.0] * (size + 1)
    column_match = [0] * (size + 1)
    predecessor = [0] * (size + 1)

    for row in range(1, size + 1):
        column_match[0] = row
        minimum = [math.inf] * (size + 1)
        used = [False] * (size + 1)
        current_column = 0
        while True:
            used[current_column] = True
            current_row = column_match[current_column]
            delta = math.inf
            next_column = 0
            for column in range(1, size + 1):
                if used[column]:
                    continue
                reduced_cost = (
                    -utilities[current_row - 1][column - 1]
                    - row_potential[current_row]
                    - column_potential[column]
                )
                if reduced_cost < minimum[column]:
                    minimum[column] = reduced_cost
                    predecessor[column] = current_column
                if minimum[column] < delta:
                    delta = minimum[column]
                    next_column = column
            for column in range(size + 1):
                if used[column]:
                    row_potential[column_match[column]] += delta
                    column_potential[column] -= delta
                else:
                    minimum[column] -= delta
            current_column = next_column
            if column_match[current_column] == 0:
                break
        while True:
            previous_column = predecessor[current_column]
            column_match[current_column] = column_match[previous_column]
            current_column = previous_column
            if current_column == 0:
                break

    assignment = [-1] * size
    for column in range(1, size + 1):
        matched_row = column_match[column]
        if matched_row > 0:
            assignment[matched_row - 1] = column - 1
    return assignment
