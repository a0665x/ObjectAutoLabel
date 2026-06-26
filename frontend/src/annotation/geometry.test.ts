import { describe, expect, it } from "vitest";

import { clampRect, rectToYolo, yoloToRect } from "./geometry";

describe("geometry", () => {
  it("converts a yolo box to a pixel rect", () => {
    expect(yoloToRect({ x_center: 0.5, y_center: 0.5, width: 0.2, height: 0.4 }, { width: 1000, height: 500 })).toEqual({
      x: 400,
      y: 150,
      width: 200,
      height: 200
    });
  });

  it("converts a pixel rect to a yolo box", () => {
    expect(rectToYolo({ x: 400, y: 150, width: 200, height: 200 }, { width: 1000, height: 500 })).toEqual({
      x_center: 0.5,
      y_center: 0.5,
      width: 0.2,
      height: 0.4
    });
  });

  it("normalizes inverted rectangles before clamping", () => {
    expect(clampRect({ x: 80, y: 70, width: -30, height: -20 }, { width: 1000, height: 500 })).toEqual({
      x: 50,
      y: 50,
      width: 30,
      height: 20
    });
  });
});
