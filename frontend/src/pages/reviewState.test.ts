import { describe, expect, it, vi } from "vitest";

import type { Annotation } from "../types";
import {
  createReviewBaseline,
  hasDirtyReviewState,
  shouldProceedWithReviewNavigation,
  UNSAVED_REVIEW_CHANGES_MESSAGE
} from "./reviewState";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "annotation-1",
    class_id: 1,
    class_name: "car",
    x_center: 0.5,
    y_center: 0.5,
    width: 0.2,
    height: 0.2,
    confidence: 0.9,
    source_descriptor: "car",
    source_type: "manual",
    edited: false,
    ...overrides
  };
}

describe("reviewState", () => {
  it("treats matching annotations and review status as clean", () => {
    const annotations = [makeAnnotation()];
    const baseline = createReviewBaseline(annotations, "pending_review");

    expect(hasDirtyReviewState(baseline, annotations, "pending_review")).toBe(false);
  });

  it("marks status-only changes as dirty", () => {
    const annotations = [makeAnnotation()];
    const baseline = createReviewBaseline(annotations, "pending_review");

    expect(hasDirtyReviewState(baseline, annotations, "reviewed")).toBe(true);
  });

  it("skips confirmation when there are no unsaved changes", () => {
    const confirm = vi.fn(() => false);

    expect(shouldProceedWithReviewNavigation(false, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("blocks navigation when confirmation is rejected", () => {
    const confirm = vi.fn(() => false);

    expect(shouldProceedWithReviewNavigation(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNSAVED_REVIEW_CHANGES_MESSAGE);
  });
});
