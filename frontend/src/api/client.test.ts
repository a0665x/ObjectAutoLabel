import { afterEach, describe, expect, it, vi } from "vitest";

import { api, buildArtifactContextPath, buildAugmentationRunSamplesPath, buildDatasetSplitSamplesPath, buildExportBundlesPath, buildModelConversionExportDownloadPath, buildModelConversionNetronPath, buildModelConversionsPath, buildModelSourcesPath, buildImageQuery } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("models", () => {
  it("preserves structured world model capabilities", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      const body = path.endsWith("/world")
        ? {
            world_models: ["yoloe-26n-seg.pt"],
            world_model_details: [{
              name: "yoloe-26n-seg.pt",
              family: "yoloe-26",
              task: "segment",
              annotation_output: "bbox",
              supported: true,
              reason: null
            }]
          }
        : path.endsWith("/input") ? { input_models: [] } : { output_models: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });

    const models = await api.models();
    expect(models.world_model_details[0]).toMatchObject({ family: "yoloe-26", annotation_output: "bbox" });
  });
});

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

describe("project image removal", () => {
  it("uses the recoverable remove and restore endpoints", async () => {
    const removalApi = api as typeof api & {
      removeProjectImage?: (projectId: string, imageId: string) => Promise<unknown>;
      restoreProjectImage?: (projectId: string, operationId: string) => Promise<unknown>;
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ operation_id: "removal-1", image_id: "image-1", next_image_id: "image-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ image: { id: "image-1" }, annotations: [] }), { status: 200 }));

    expect(typeof removalApi.removeProjectImage).toBe("function");
    expect(typeof removalApi.restoreProjectImage).toBe("function");
    if (!removalApi.removeProjectImage || !removalApi.restoreProjectImage) return;

    await removalApi.removeProjectImage("project-1", "image-1");
    await removalApi.restoreProjectImage("project-1", "removal-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/projects/project-1/images/image-1", expect.objectContaining({ method: "DELETE" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/projects/project-1/image-removals/removal-1/restore", expect.objectContaining({ method: "POST" }));
  });
});

describe("API error messages", () => {
  it("surfaces FastAPI detail text without raw JSON wrappers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Dataset split is outdated; rebuild Augment/Split before training." }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(api.train("project-1", { dataset_split_id: "split-1" })).rejects.toMatchObject({
      message: "Dataset split is outdated; rebuild Augment/Split before training."
    });
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

  it("loads model conversion capabilities from the global endpoint", async () => {
    const conversionApi = api as typeof api & {
      modelConversionCapabilities?: () => Promise<unknown>;
    };
    expect(typeof conversionApi.modelConversionCapabilities).toBe("function");
    if (!conversionApi.modelConversionCapabilities) return;
    const response = [{ format: "onnx", precision: "fp32", architecture: "x86_64", exporter: "ultralytics", available: true, reason: null }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } })
    );

    await expect(conversionApi.modelConversionCapabilities()).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/model-conversion-capabilities", expect.any(Object));
  });

  it("rejects conversion requests outside ONNX FP32 and TFLite FP32", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    expect(() => api.createModelConversion("project-1", {
      training_run_id: "training-1",
      source_model_path: "/models/best.pt",
      schema_id: "schema-1",
      targets: [{ format: "tflite", precision: "int8" }],
      imgsz: 640
    } as never)).toThrow("Only ONNX FP32 and LiteRT FP32 conversion targets are supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("serializes selected Review source groups", () => {
    expect(buildImageQuery({ source_groups: ["pseudo", "augment"] })).toContain("source_groups=pseudo%2Caugment");
  });

});
