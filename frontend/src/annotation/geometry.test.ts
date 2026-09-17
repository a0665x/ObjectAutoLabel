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

  it("keeps six-decimal boxes inside the right and bottom edges", () => {
    const box = rectToYolo(clampRect({ x: 1, y: 1, width: 2, height: 2 }, { width: 3, height: 3 }), { width: 3, height: 3 });
    expect(box.x_center + box.width / 2).toBeLessThanOrEqual(1);
    expect(box.y_center + box.height / 2).toBeLessThanOrEqual(1);
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
