import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Annotation, ClassItem, ProjectImage } from "../../types";
import { AnnotationInspector } from "./AnnotationInspector";
import { AnnotationToolbar } from "./AnnotationToolbar";

const image: ProjectImage = {
  id: "image-1",
  project_id: "project-1",
  path: "/tmp/project/sources/frame-001.jpg",
  review_status: "pending_review"
};

const classes: ClassItem[] = [
  { class_id: 0, class_name: "car", descriptors: ["car"] },
  { class_id: 1, class_name: "person", descriptors: ["person"] }
];

const annotations: Annotation[] = [
  {
    id: "annotation-1",
    class_id: 0,
    class_name: "car",
    x_center: 0.5,
    y_center: 0.5,
    width: 0.2,
    height: 0.2,
    confidence: 0.42,
    source_descriptor: "red sedan",
    source_type: "pseudo",
    edited: true
  }
];

describe("review panels", () => {
  it("shows save-and-next controls in the toolbar", () => {
    const html = renderToStaticMarkup(
      <AnnotationToolbar
        mode="select"
        reviewStatus="pending_review"
        canGoPrev={false}
        canGoNext={true}
        dirty={true}
        saving={false}
        onModeChange={vi.fn()}
        onReviewStatusChange={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onSave={vi.fn()}
        onSaveAndNext={vi.fn()}
      />
    );

    expect(html).toContain("Save &amp; next");
    expect(html).toContain("Shift+S");
  });

  it("shows annotation provenance and edited state in the inspector", () => {
    const html = renderToStaticMarkup(
      <AnnotationInspector
        image={image}
        annotations={annotations}
        selectedId="annotation-1"
        classes={classes}
        reviewStatus="pending_review"
        dirty={false}
        loading={false}
        saving={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onClassChange={vi.fn()}
        onReviewStatusChange={vi.fn()}
        onSave={vi.fn()}
        onSaveAndNext={vi.fn()}
      />
    );

    expect(html).toContain("Confidence");
    expect(html).toContain("42.0%");
    expect(html).toContain("Source descriptor");
    expect(html).toContain("red sedan");
    expect(html).toContain("Source type");
    expect(html).toContain("pseudo");
    expect(html).toContain("Edited");
    expect(html).toContain("Yes");
  });
});
