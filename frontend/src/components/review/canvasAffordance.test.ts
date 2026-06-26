import { describe, expect, it } from "vitest";

import { getCanvasAffordance, screenPixelsToImageUnits } from "./canvasAffordance";

describe("canvasAffordance", () => {
  it("keeps affordances stable on very large images rendered small", () => {
    const affordance = getCanvasAffordance({ imageWidth: 4000, renderedWidth: 200 });
    const scale = 200 / 4000;

    expect(affordance.handleRadius * scale).toBeCloseTo(7, 5);
    expect(affordance.strokeWidth * scale).toBeCloseTo(2, 5);
    expect(affordance.fontSize * scale).toBeCloseTo(12, 5);
  });

  it("keeps affordances stable on smaller images rendered large", () => {
    const affordance = getCanvasAffordance({ imageWidth: 800, renderedWidth: 1200 });
    const scale = 1200 / 800;

    expect(affordance.handleRadius * scale).toBeCloseTo(7, 5);
    expect(affordance.strokeWidth * scale).toBeCloseTo(2, 5);
    expect(affordance.fontSize * scale).toBeCloseTo(12, 5);
  });

  it("falls back to raw pixels when render scale is unavailable", () => {
    expect(screenPixelsToImageUnits(12, { imageWidth: 0, renderedWidth: 0 })).toBe(12);
  });
});
