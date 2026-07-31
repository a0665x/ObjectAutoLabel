import { describe, expect, it } from "vitest";

import { buildArtifactContextPath, buildAugmentationRunSamplesPath, buildDatasetSplitSamplesPath, buildExportBundlesPath, buildModelConversionExportDownloadPath, buildModelConversionNetronPath, buildModelConversionsPath, buildModelSourcesPath, buildImageQuery } from "./client";

describe("buildImageQuery", () => {
  it("includes the review queue filters used by the workbench", () => {
    expect(
      buildImageQuery({
        review_status: "pending_review",
        has_low_confidence: true,
        source_asset_id: "source-1",
        limit: 25,
        offset: 50
      })
    ).toBe("?review_status=pending_review&has_low_confidence=true&source_asset_id=source-1&limit=25&offset=50");
  });

  it("omits empty filters", () => {
    expect(buildImageQuery({})).toBe("");
  });
});

describe("buildDatasetSplitSamplesPath", () => {
  it("targets the split samples endpoint with a per-bucket preview limit", () => {
    expect(buildDatasetSplitSamplesPath("project-1", "split-2", 4)).toBe(
      "/api/projects/project-1/dataset-splits/split-2/samples?limit_per_bucket=4"
    );
  });
});

describe("buildAugmentationRunSamplesPath", () => {
  it("targets a random augmentation build sample endpoint", () => {
    expect(buildAugmentationRunSamplesPath("project-1", "augment-2", 3)).toBe(
      "/api/projects/project-1/augmentation-runs/augment-2/samples?limit=3"
    );
  });
});

describe("model conversion paths", () => {
  it("targets package conversion and export bundle endpoints", () => {
    expect(buildModelConversionsPath("project-1")).toBe("/api/projects/project-1/model-conversions");
    expect(buildModelSourcesPath("project-1")).toBe("/api/projects/project-1/model-sources");
    expect(buildArtifactContextPath("project-1")).toBe("/api/projects/project-1/artifact-context");
    expect(buildExportBundlesPath("project-1")).toBe("/api/projects/project-1/export-bundles");
    expect(buildModelConversionNetronPath("project-1", "conversion-1", "artifact-1")).toBe(
      "/api/projects/project-1/model-conversions/conversion-1/netron?artifact_id=artifact-1"
    );
    expect(buildModelConversionExportDownloadPath("project-1", "conversion-1")).toBe(
      "/api/projects/project-1/model-conversions/conversion-1/export-download"
    );
  });
});
