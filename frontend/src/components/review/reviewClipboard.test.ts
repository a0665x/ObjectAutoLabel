import { describe, expect, it } from "vitest";

import type { Annotation } from "../../types";
import { copyAnnotations, pasteAnnotations } from "./reviewClipboard";

const box: Annotation = {
  id: "box-1",
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

describe("review clipboard", () => {
  it("pastes normalized geometry unchanged across image sizes", () => {
    const clipboard = copyAnnotations([box], [box.id]);
    const result = pasteAnnotations([], clipboard, () => "copy-1");

    expect(result.annotations[0]).toMatchObject({
      id: "copy-1",
      x_center: box.x_center,
      y_center: box.y_center,
      width: box.width,
      height: box.height
    });
    expect(result.annotations[0]).not.toHaveProperty("confidence", box.confidence);
  });

  it("offsets a fully coincident pasted group by the visible duplicate delta", () => {
    const clipboard = copyAnnotations([box], [box.id]);
    const result = pasteAnnotations([box], clipboard, () => "copy-1", { width: 100, height: 100 });

    expect(result.annotations[1]).toMatchObject({ id: "copy-1", x_center: 0.58, y_center: 0.58 });
    expect(result.selectedIds).toEqual(["copy-1"]);
  });
});
