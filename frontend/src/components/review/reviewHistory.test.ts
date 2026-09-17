import { describe, expect, it } from "vitest";

import type { Annotation } from "../../types";
import { pushHistory, redoHistory, undoHistory } from "./reviewHistory";

const box: Annotation = {
  id: "box-1",
  class_id: 1,
  class_name: "car",
  x_center: 0.5,
  y_center: 0.5,
  width: 0.2,
  height: 0.2,
  confidence: null,
  source_descriptor: null,
  source_type: "manual",
  edited: true
};

describe("review history", () => {
  it("undo and redo restore complete annotation snapshots", () => {
    const before = [box];
    const added = { ...box, id: "box-2" };
    const after = [...before, added];
    const pushed = pushHistory(
      { past: [], future: [] },
      { kind: "annotations", imageId: "image-1", before, after }
    );

    expect(undoHistory(pushed).entry?.before).toEqual(before);
    expect(redoHistory(undoHistory(pushed).state).entry?.after).toEqual(after);
  });

  it("captures immutable snapshots and clears redo entries when pushing", () => {
    const existing = { kind: "annotations" as const, imageId: "image-1", before: [], after: [box] };
    const state = { past: [], future: [existing] };
    const pushed = pushHistory(state, { kind: "annotations", imageId: "image-1", before: [box], after: [] });

    box.class_name = "changed after push";

    expect(pushed.future).toEqual([]);
    const entry = pushed.past[0];
    expect(entry.kind).toBe("annotations");
    if (entry.kind === "annotations") expect(entry.before[0].class_name).toBe("car");
  });
});
