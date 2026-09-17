import { describe, expect, it } from "vitest";
import { clientPointToImage, resolveEffectiveTool } from "./canvasInteraction";

describe("canvas interaction geometry", () => {
  it("returns null when the overlay has no measurable bounds", () => {
    expect(clientPointToImage({ clientX: 20, clientY: 30 }, { left: 0, top: 0, width: 0, height: 0 }, { width: 1000, height: 500 })).toBeNull();
  });

  it("maps the client point into image coordinates", () => {
    expect(clientPointToImage({ clientX: 250, clientY: 125 }, { left: 0, top: 0, width: 500, height: 250 }, { width: 1000, height: 500 })).toEqual({ x: 500, y: 250 });
  });

  it("applies pan before modifier tool gates", () => {
    expect(resolveEffectiveTool({ persistent: "select", lastEdit: "select", button: 1, space: false, modifier: true, shift: false, hit: "background" })).toBe("pan");
  });

  it("uses Ctrl/Cmd to force draw from select even over a box", () => {
    expect(resolveEffectiveTool({ persistent: "select", lastEdit: "select", button: 0, space: false, modifier: true, shift: false, hit: "box" })).toBe("draw");
  });

  it("uses Ctrl/Cmd to temporarily select from draw", () => {
    expect(resolveEffectiveTool({ persistent: "draw", lastEdit: "draw", button: 0, space: false, modifier: true, shift: false, hit: "box" })).toBe("select");
  });

  it("returns from pan to the last edit tool while Ctrl/Cmd is held", () => {
    expect(resolveEffectiveTool({ persistent: "pan", lastEdit: "draw", button: 0, space: false, modifier: true, shift: false, hit: "background" })).toBe("draw");
  });
});
