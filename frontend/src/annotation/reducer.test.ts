import { describe, expect, it } from "vitest";

import type { Annotation } from "../types";
import { annotationReducer } from "./reducer";

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

describe("annotationReducer", () => {
  it("adds a manual annotation", () => {
    const annotation = makeAnnotation();

    expect(annotationReducer([], { type: "add", annotation })).toEqual([annotation]);
  });

  it("deletes an annotation by id", () => {
    const state = [makeAnnotation(), makeAnnotation({ id: "annotation-2" })];

    expect(annotationReducer(state, { type: "delete", id: "annotation-1" })).toEqual([state[1]]);
  });

  it("changes the class metadata", () => {
    const state = [makeAnnotation()];

    expect(
      annotationReducer(state, { type: "changeClass", id: "annotation-1", class_id: 7, class_name: "truck" })
    ).toEqual([
      {
        ...state[0],
        class_id: 7,
        class_name: "truck",
        edited: true
      }
    ]);
  });

  it("moves a box and marks it as edited", () => {
    const state = [makeAnnotation()];

    expect(
      annotationReducer(state, {
        type: "move",
        id: "annotation-1",
        rect: { x: 100, y: 50, width: 200, height: 100 },
        image: { width: 1000, height: 500 }
      })
    ).toEqual([
      {
        ...state[0],
        x_center: 0.2,
        y_center: 0.2,
        width: 0.2,
        height: 0.2,
        edited: true
      }
    ]);
  });

  it("resizes a box and clamps it to image bounds", () => {
    const state = [makeAnnotation()];

    expect(
      annotationReducer(state, {
        type: "resize",
        id: "annotation-1",
        rect: { x: -10, y: 20, width: 300, height: 600 },
        image: { width: 1000, height: 500 }
      })
    ).toEqual([
      {
        ...state[0],
        x_center: 0.145,
        y_center: 0.52,
        width: 0.29,
        height: 0.96,
        edited: true
      }
    ]);
  });
});
