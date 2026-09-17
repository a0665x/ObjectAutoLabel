import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Annotation, ClassItem, ProjectImage } from "../../types";
import { AnnotationInspector } from "./AnnotationInspector";
import { AnnotationToolbar } from "./AnnotationToolbar";
import { ImageQueue, confidenceLevels } from "./ImageQueue";

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
        canGoPrev={false}
        canGoNext={true}
        dirty={true}
        saving={false}
        zoom={1}
        position={{ filtered_index: 2, filtered_total: 5, project_index: 7, project_total: 11 }}
        onModeChange={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onSave={vi.fn()}
        onSaveAndNext={vi.fn()}
        onMergeSameClass={vi.fn()}
        onFit={vi.fn()}
        onActualSize={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
      />
    );

    expect(html).toContain("Save &amp; next");
    expect(html).toContain('class="toolbar-primary-row"');
    expect(html).toContain('class="toolbar-cluster toolbar-view-group"');
    expect(html).toContain('class="toolbar-cluster toolbar-commit-group"');
    expect(html).toContain('class="toolbar-secondary-row"');
    expect(html).toContain('class="segmented-control toolbar-tool-group"');
    expect(html.indexOf("Image zoom controls")).toBeLessThan(html.indexOf("Save &amp; next"));
    expect(html.indexOf("Annotation tools")).toBeLessThan(html.indexOf("Zoomed drag"));
    expect(html).toContain("Ctrl+S");
    expect(html).toContain("Ctrl+D");
    expect(html).toContain("confidence score assigned by YOLO-World");
    expect(html).toContain("Fit");
    expect(html).toContain("100%");
    expect(html).toContain("Space+drag");
    expect(html).toContain("Middle-drag");
    expect(html).toContain("Ctrl+wheel");
    expect(html).toContain("Right-click");
    expect(html).toContain("Arrow keys");
    expect(html).toContain("Filtered queue 2 / 5");
    expect(html).toContain("Project total 7 / 11");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows annotation provenance and edited state in the inspector", () => {
    const html = renderToStaticMarkup(
      <AnnotationInspector
        image={image}
        annotations={annotations}
        selectedId="annotation-1"
        classes={classes}
        dirty={false}
        loading={false}
        saving={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onClassChange={vi.fn()}
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

  it("shows explicit prefetch feedback while nearby boxes are cached", () => {
    const html = renderToStaticMarkup(
      <ImageQueue
        images={[image]}
        activeImageId={image.id}
        filters={{}}
        stats={{ unreviewed: 0, pending_review: 1, needs_fix: 0, reviewed: 0, skipped: 0, edited: 0, low_confidence: 0 }}
        sources={[]}
        loading={false}
        prefetching={true}
        onSelectImage={vi.fn()}
        onFilterChange={vi.fn()}
      />
    );

    expect(html).toContain("preloading next boxes");
    expect(html).toContain("Preloading next image boxes");
  });

  it("hides source choices until Open Data is part of the project", () => {
    const base = {
      images: [image], activeImageId: image.id, filters: {},
      stats: { unreviewed: 0, pending_review: 1, needs_fix: 0, reviewed: 0, skipped: 0, edited: 0, low_confidence: 0 },
      sources: [], loading: false, onSelectImage: vi.fn(), onFilterChange: vi.fn()
    };
    const withoutImport = renderToStaticMarkup(<ImageQueue {...base} openDataImport={null} />);
    const withImport = renderToStaticMarkup(<ImageQueue {...base} openDataImport={{ id: "open-1", project_id: "project-1", dataset_key: "visdrone2019-det", schema_id: "schema-1", mapping: {}, sample_percentage: 50, selected_image_count: 2, selected_annotation_count: 3, status: "active", created_at: "2026-09-04" }} />);
    expect(withoutImport).toContain("Dataset composition");
    expect(withoutImport).toMatch(/Open Sources<\/span><strong>0<\/strong><\/button>/);
    expect(withImport).toContain("Dataset composition");
    expect(withImport).toContain("Open Sources");
  });});

describe("review confidence map", () => {
  it("uses mean confidence colors without exposing filenames", () => {
    const html = renderToStaticMarkup(<ImageQueue
      images={[{ ...image, mean_confidence: 0.18, annotation_count: 3 }]}
      activeImageId={image.id} filters={{}}
      stats={{ unreviewed: 0, pending_review: 1, needs_fix: 0, reviewed: 0, skipped: 0, edited: 0, low_confidence: 1 }}
      sources={[]} loading={false} onSelectImage={vi.fn()} onFilterChange={vi.fn()}
    />);
    expect(html).toContain("confidence-3");
    expect(html).toContain("Mean 18.0%");
    expect(html).not.toContain("frame-001.jpg");
  });
});


describe("relative confidence levels", () => {
  it("separates a high-confidence cohort using distribution-aware risk", () => {
    const rows = [
      { ...image, id: "a", mean_confidence: .91, min_confidence: .88, max_confidence: .94, low_confidence_count: 0, annotation_count: 4 },
      { ...image, id: "b", mean_confidence: .93, min_confidence: .61, max_confidence: .99, low_confidence_count: 0, annotation_count: 8 },
      { ...image, id: "c", mean_confidence: .95, min_confidence: .94, max_confidence: .96, low_confidence_count: 0, annotation_count: 2 }
    ];
    expect(new Set(confidenceLevels(rows).values()).size).toBe(3);
  });
});
