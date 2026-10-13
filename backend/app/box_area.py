"""Pre-filter bbox area statistics and conservative separated-mode suggestion."""
from __future__ import annotations

import math
from bisect import bisect_right


def suggested_max_area(areas: list[float]) -> float:
    ordered = sorted(area for area in areas if math.isfinite(area) and 0 <= area <= 1)
    best_gap, threshold = 0.0, 1 / 3
    # Require evidence on both sides; a large mode need not be a minority.
    for index in range(2, len(ordered) - 3):
        left, right = ordered[index:index + 2]
        gap = right - left
        small_median = ordered[index // 2]
        large_median = ordered[(index + 1 + len(ordered)) // 2]
        if gap >= .05 and gap > best_gap and large_median >= .1 and large_median >= max(small_median, .000001) * 4:
            best_gap, threshold = gap, (left + right) / 2
    return threshold


def area_distribution(areas: list[float]) -> dict:
    valid = [area for area in areas if math.isfinite(area) and 0 <= area <= 1]
    # Log1p axis gives small detection boxes room without hiding the large tail.
    boundaries = [(10001 ** (index / 50) - 1) / 10000 for index in range(51)]
    boundaries[0], boundaries[-1] = 0.0, 1.0
    counts = [0] * 50
    for area in valid:
        counts[min(49, max(0, bisect_right(boundaries, area) - 1))] += 1
    return {'bins': [{'lower': boundaries[i], 'upper': boundaries[i + 1], 'count': count} for i, count in enumerate(counts)],
            'box_count': len(valid), 'suggested_max': suggested_max_area(valid), 'pre_filter': True}
