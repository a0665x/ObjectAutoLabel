import { describe, expect, it } from "vitest";

import { clampZoom, fitZoom, zoomAroundPoint, zoomToRects } from "./viewport";

describe("review viewport", () => {
  it("clamps zoom to 25%-800%", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(8);
  });

  it("fits an image inside the viewport", () => {
    expect(fitZoom({ width: 2000, height: 1000 }, { width: 1000, height: 800 })).toBe(0.5);
  });

  it("keeps the pointed image coordinate stationary", () => {
    expect(
      zoomAroundPoint({
        zoom: 1,
        nextZoom: 2,
        scrollLeft: 100,
        scrollTop: 50,
        pointerX: 200,
        pointerY: 150
      })
    ).toEqual({ scrollLeft: 400, scrollTop: 250 });
  });

  it("fits the union of selected rectangles with padding", () => {
    expect(
      zoomToRects([{ x: 100, y: 100, width: 200, height: 100 }], { width: 1000, height: 600 }, 40)
    ).toEqual({
      zoom: 3.3333333333333335,
      centerX: 200,
      centerY: 150
    });
  });
});
