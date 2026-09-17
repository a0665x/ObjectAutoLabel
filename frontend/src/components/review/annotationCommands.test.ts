import { describe, expect, it } from "vitest";

import type { Annotation, ClassItem } from "../../types";
import {
  applySharedDuplicateOffset,
  changeAnnotationClasses,
  deleteAnnotations,
  duplicateAnnotations,
  keyboardNudgeDelta,
  moveAnnotations
} from "./annotationCommands";

const box: Annotation = {
  id: "a",
  class_id: 1,
  class_name: "car",
  x_center: 0.5,
  y_center: 0.5,
  width: 0.2,
  height: 0.2,
  confidence: 0.91,
  source_descriptor: "red car",
  source_type: "pseudo",
  edited: false
};

describe("annotation commands", () => {
  it("moves all selected boxes by one shared clamped delta", () => {
    const result = moveAnnotations([box], ["a"], { x: 10, y: -10 }, { width: 100, height: 100 });

    expect(result[0]).toMatchObject({ x_center: 0.6, y_center: 0.4, edited: true });
  });

  it("clamps one shared delta for a multi-selection", () => {
    const edgeBox = { ...box, id: "edge", x_center: 0.9 };
    const result = moveAnnotations([box, edgeBox], ["a", "edge"], { x: 20, y: 0 }, { width: 100, height: 100 });

    expect(result.map((item) => item.x_center)).toEqual([0.5, 0.9]);
  });

  it("duplicates selected boxes with fresh ids and an eight-pixel offset", () => {
    const result = duplicateAnnotations([box], ["a"], { width: 100, height: 100 }, () => "copy");

    expect(result.annotations).toHaveLength(2);
    expect(result.annotations[1]).toMatchObject({
      id: "copy",
      x_center: 0.58,
      y_center: 0.58,
      confidence: null,
      source_descriptor: null,
      source_type: "manual",
      edited: true
    });
    expect(result.selectedIds).toEqual(["copy"]);
  });

  it("keeps the visible duplicate offset shared when a group reaches the image edge", () => {
    const edgeBox = { ...box, id: "edge", x_center: 0.9 };

    const result = applySharedDuplicateOffset([box, edgeBox], { width: 100, height: 100 });

    expect(result.map((item) => item.x_center)).toEqual([0.5, 0.9]);
  });

  it("changes classes and deletes only selected annotations", () => {
    const person: ClassItem = { class_id: 2, class_name: "person", descriptors: [] };
    const other = { ...box, id: "b" };

    const changed = changeAnnotationClasses([box, other], ["a"], person);
    expect(changed[0]).toMatchObject({ class_id: 2, class_name: "person", edited: true });
    expect(changed[1]).toEqual(other);
    expect(deleteAnnotations(changed, ["a"])).toEqual([other]);
  });

  it("maps arrow keys to one-pixel and Shift ten-pixel nudges", () => {
    expect(keyboardNudgeDelta("ArrowRight", false)).toEqual({ x: 1, y: 0 });
    expect(keyboardNudgeDelta("ArrowUp", true)).toEqual({ x: 0, y: -10 });
    expect(keyboardNudgeDelta("Enter", false)).toBeNull();
  });
});
