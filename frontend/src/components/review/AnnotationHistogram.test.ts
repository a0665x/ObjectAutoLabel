import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../types";
import { AnnotationHistogram, annotationIdsInAreaBin } from "./AnnotationHistogram";

const box = (id: string, class_id: number, width: number, height: number): Annotation => ({ id, class_id, class_name: class_id ? "car" : "person", x_center: .5, y_center: .5, width, height, source_type: "manual", edited: false });
describe("annotation area selection", () => {
  it("selects only current-image boxes in the clicked class and area bin", () => {
    expect(annotationIdsInAreaBin([box("a", 0, .05, .1), box("b", 0, .2, .2), box("c", 1, .2, .2)], 0, { lower: 1, upper: 5 })).toEqual(["b"]);
  });
  it("uses adaptive boundaries and includes the final 100 percent edge", () => {
    const boxes = [box("a", 0, .01, .1), box("b", 0, .03, .1), box("full", 0, 1, 1)];
    expect(annotationIdsInAreaBin(boxes, 0, { lower: 0, upper: .2 })).toEqual(["a"]);
    expect(annotationIdsInAreaBin(boxes, 0, { lower: .2, upper: .4 })).toEqual(["b"]);
    expect(annotationIdsInAreaBin(boxes, 0, { lower: 90, upper: 100 })).toEqual(["full"]);
  });
  it("renders adaptive sub-percent bins from the dataset response", () => {
    const html = renderToStaticMarkup(createElement(AnnotationHistogram, {
      annotations: [box("a", 0, .01, .1)],
      distribution: [{ class_id: 0, class_name: "person", bins: [
        { lower: 0, upper: .2, count: 12 },
        { lower: .2, upper: .4, count: 8 }
      ] }],
      loading: false,
      activeBin: null,
      onSelectBin: vi.fn()
    }));
    expect(html).toContain("0–0.2%");
    expect(html).toContain("0.2–0.4%");
    expect(html).toContain("20 boxes");
  });
});
