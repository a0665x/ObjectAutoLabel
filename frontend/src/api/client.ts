import type { Annotation, AugmentationRun, AuthStatus, ClassSchema, DatasetSplitRun, ImageRemovalResult, ImageRestoreResult, Job, ModelConversionCapability, ModelConversionCreatePayload, ModelConversionRun, ModelExportBundle, ModelLists, ModelSource, OpenDataCatalogItem, OpenDataImport, OpenDataMapping, OpenDataPreview, Project, ProjectArtifactContext, ProjectImage, ProjectStorageStatus, PseudoLabelRun, ReviewImagePosition, SourceAsset, TrainingRun, WorldModelInfo } from "../types";

export type ReviewStatus = "unreviewed" | "pending_review" | "needs_fix" | "reviewed" | "skipped";

export type ReviewStats = {
  unreviewed: number;
  pending_review: number;
  needs_fix: number;
  reviewed: number;
  skipped: number;
  edited: number;
  low_confidence: number;
};

export type ImageFilters = {
  review_status?: ReviewStatus;
  has_low_confidence?: boolean;
  source_asset_id?: string;
  source_origin?: "project" | "open_data";
  source_groups?: Array<"pseudo" | "augment" | "open_data">;
  limit?: number;
  offset?: number;
};

export type BboxHistogramBin = { lower: number; upper: number; count: number };
export type BboxHistogramClass = { class_id: number; class_name: string; bins: BboxHistogramBin[] };

export type SplitSampleAnnotation = Pick<Annotation, "class_id" | "class_name" | "x_center" | "y_center" | "width" | "height">;

export type AugmentationPreviewSample = {
  image_id: string;
  preview_url: string;
  file_name: string;
  width?: number | null;
  height?: number | null;
  annotations: SplitSampleAnnotation[];
};

export type SplitSample = {
  bucket: "train" | "valid" | "test";
  image_id: string;
  image_path: string;
  image_url: string;
  file_name: string;
  width?: number | null;
  height?: number | null;
  annotations: SplitSampleAnnotation[];
};

export type SplitSamples = Record<"train" | "valid" | "test", SplitSample[]>;

export type FileBrowserEntry = { name: string; path: string; kind: "directory" | "file"; selectable: boolean; match_count: number };
export type FileBrowserShortcut = { label: string; path: string; description: string; exists: boolean; match_count: number };
export type FileBrowserResult = { path: string; parent?: string | null; mode: string; current_match_count: number; shortcuts: FileBrowserShortcut[]; entries: FileBrowserEntry[] };
export type SourceAnalysis = { image_count: number; known_dimensions: number; min_width?: number | null; max_width?: number | null; min_height?: number | null; max_height?: number | null; extensions: Record<string, number>; top_sizes: Array<[string, number]> };
export type ValidationPreviewResult = {
  file_name: string;
  image_path?: string;
  image_url: string;
  width?: number | null;
  height?: number | null;
  model_name: string;
  schema_name: string;
  annotations: Array<SplitSampleAnnotation & { confidence?: number | null }>;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === "string") message = parsed.detail;
      } catch {
        // Preserve non-JSON backend errors verbatim.
      }
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function buildImageQuery(filters: ImageFilters): string {
  const params = new URLSearchParams();

  if (filters.review_status) params.set("review_status", filters.review_status);
  if (typeof filters.has_low_confidence === "boolean") {
    params.set("has_low_confidence", String(filters.has_low_confidence));
  }
  if (filters.source_asset_id) params.set("source_asset_id", filters.source_asset_id);
  if (filters.source_origin) params.set("source_origin", filters.source_origin);
  if (filters.source_groups?.length) params.set("source_groups", filters.source_groups.join(","));
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildDatasetSplitSamplesPath(projectId: string, splitId: string, limitPerBucket = 6, sampleSeed?: number): string {
  const params = new URLSearchParams({ limit_per_bucket: String(limitPerBucket) });
  if (sampleSeed !== undefined) params.set("sample_seed", String(sampleSeed));
  return `/api/projects/${projectId}/dataset-splits/${splitId}/samples?${params.toString()}`;
}

export function buildAugmentationRunSamplesPath(projectId: string, runId: string, limit = 3): string {
  const params = new URLSearchParams({ limit: String(limit) });
  return `/api/projects/${projectId}/augmentation-runs/${runId}/samples?${params.toString()}`;
}

export function buildModelConversionsPath(projectId: string): string {
  return `/api/projects/${projectId}/model-conversions`;
}

export function buildModelSourcesPath(projectId: string): string {
  return `/api/projects/${projectId}/model-sources`;
}

export function buildArtifactContextPath(projectId: string): string {
  return `/api/projects/${projectId}/artifact-context`;
}

export function buildModelConversionNetronPath(projectId: string, conversionId: string, artifactId: string): string {
  const params = new URLSearchParams({ artifact_id: artifactId });
  return `/api/projects/${projectId}/model-conversions/${conversionId}/netron?${params.toString()}`;
}

export function buildModelConversionExportDownloadPath(projectId: string, conversionId: string): string {
  return `/api/projects/${projectId}/model-conversions/${conversionId}/export-download`;
}

export function buildExportBundlesPath(projectId: string): string {
  return `/api/projects/${projectId}/export-bundles`;
}

function assertSupportedConversionTargets(payload: ModelConversionCreatePayload): void {
  const supported = payload.targets.every(
    (target) => (target.format === "onnx" || target.format === "tflite") && target.precision === "fp32" && (target.format === "onnx" ? (target.layout ?? "NCHW") === "NCHW" : (target.layout ?? "NCHW") === "NCHW" || target.layout === "NHWC")
  );
  if (!supported) {
    throw new Error("Only ONNX FP32 and LiteRT FP32 conversion targets are supported");
  }
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] ?? "model-export-bundle.zip"
  };
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  health: () => request<{ ok: boolean; project_root: string }>("/api/health"),
  projects: () => request<Project[]>("/api/projects"),
  createProject: (payload: { name: string; description: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  deleteProject: (projectId: string) => request<{ ok: boolean }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  projectStorageStatus: (projectId: string) => request<ProjectStorageStatus>(`/api/projects/${projectId}/storage-status`),
  cleanupStaleProject: (projectId: string) => request<{ ok: boolean }>(`/api/projects/${projectId}/cleanup-stale`, { method: "POST" }),
  jobs: (projectId?: string) => request<Job[]>(`/api/jobs${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`),
  cancelJob: (jobId: string) => request<Job>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  fileBrowser: (path: string, mode: string) => request<FileBrowserResult>(`/api/file-browser?path=${encodeURIComponent(path)}&mode=${encodeURIComponent(mode)}`),
  models: async (): Promise<ModelLists> => {
    const [world, input, output] = await Promise.all([
      request<{ world_models: string[]; world_model_details?: WorldModelInfo[] }>("/api/models/world"),
      request<{ input_models: string[] }>("/api/models/input"),
      request<{ output_models: string[] }>("/api/models/output")
    ]);
    return {
      world_models: world.world_models,
      world_model_details: world.world_model_details ?? [],
      input_models: input.input_models,
      output_models: output.output_models
    };
  },
  classSchemas: (projectId: string) => request<ClassSchema[]>(`/api/projects/${projectId}/class-schemas`),
  createClassSchema: (projectId: string, payload: { name: string; classes: unknown[] }) =>
    request<ClassSchema>(`/api/projects/${projectId}/class-schemas`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  sources: (projectId: string) => request<SourceAsset[]>(`/api/projects/${projectId}/sources`),
  createSource: (projectId: string, payload: { kind: string; path: string }) =>
    request<SourceAsset>(`/api/projects/${projectId}/sources`, { method: "POST", body: JSON.stringify(payload) }),
  sourceAnalysis: (projectId: string, payload: { source_asset_id?: string | null }) =>
    request<SourceAnalysis>(`/api/projects/${projectId}/source-analysis`, { method: "POST", body: JSON.stringify(payload) }),
  extractFrames: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/frame-runs`, { method: "POST", body: JSON.stringify(payload) }),
  reviewStats: (projectId: string) => request<ReviewStats>(`/api/projects/${projectId}/review-stats`),
  images: (projectId: string, filters: ImageFilters = {}) =>
    request<ProjectImage[]>(`/api/projects/${projectId}/images${buildImageQuery({ limit: 500, ...filters })}`),
  imagePosition: (projectId: string, imageId: string, filters: ImageFilters = {}) => {
    const query = buildImageQuery({
      review_status: filters.review_status,
      has_low_confidence: filters.has_low_confidence,
      source_asset_id: filters.source_asset_id,
      source_origin: filters.source_origin,
      source_groups: filters.source_groups
    });
    const separator = query ? "&" : "?";
    return request<ReviewImagePosition>(
      `/api/projects/${projectId}/image-position${query}${separator}image_id=${encodeURIComponent(imageId)}`
    );
  },
  reviewSourceCounts: (projectId: string) => request<Record<"pseudo" | "augment" | "open_data", number>>(`/api/projects/${projectId}/review-source-counts`),
  bboxHistogram: (projectId: string, filters: ImageFilters = {}) =>
    request<BboxHistogramClass[]>(`/api/projects/${projectId}/bbox-histogram${buildImageQuery(filters)}`),
  annotations: (imageId: string) =>
    request<{ image: ProjectImage; annotations: Annotation[] }>(`/api/images/${imageId}/annotations`),
  saveAnnotations: (imageId: string, payload: { annotations: Annotation[]; review_status: string }) =>
    request<{ annotations: Annotation[]; label_path: string }>(`/api/images/${imageId}/annotations`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  removeProjectImage: (projectId: string, imageId: string) =>
    request<ImageRemovalResult>(`/api/projects/${projectId}/images/${imageId}`, { method: "DELETE" }),
  restoreProjectImage: (projectId: string, operationId: string) =>
    request<ImageRestoreResult>(`/api/projects/${projectId}/image-removals/${operationId}/restore`, { method: "POST" }),
  pseudoLabel: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/pseudo-label-runs`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  pseudoLabelRuns: (projectId: string) => request<PseudoLabelRun[]>(`/api/projects/${projectId}/pseudo-label-runs`),
  openDataCatalog: () => request<OpenDataCatalogItem[]>("/api/open-data/catalog"),
  inspectOpenData: (datasetUrl: string) => request<OpenDataCatalogItem>("/api/open-data/inspect", { method: "POST", body: JSON.stringify({ dataset_url: datasetUrl }) }),
  activeOpenDataImport: (projectId: string) => request<OpenDataImport | null>(`/api/projects/${projectId}/open-data/import`),
  openDataImports: (projectId: string) => request<OpenDataImport[]>(`/api/projects/${projectId}/open-data/imports`),
  imageSourceSummary: (projectId: string) => request<import("../types").ImageSourceSummary>(`/api/projects/${projectId}/image-source-summary`),
  downloadOpenData: (projectId: string, datasetKey = "visdrone2019-det", apiKey?: string) => request<Job>(`/api/projects/${projectId}/open-data/download`, { method: "POST", body: JSON.stringify({ dataset_key: datasetKey, license_accepted: true, api_key: apiKey || undefined }) }),
  previewOpenData: (projectId: string, payload: { dataset_key: string; schema_id: string; mapping: OpenDataMapping; sample_percentage: number; seed: number; preview_seed?: number }) => request<OpenDataPreview>(`/api/projects/${projectId}/open-data/preview`, { method: "POST", body: JSON.stringify(payload) }),
  importOpenData: (projectId: string, payload: { dataset_key: string; schema_id: string; mapping: OpenDataMapping; sample_percentage: number; seed: number; version_name?: string }) => request<Job>(`/api/projects/${projectId}/open-data/import`, { method: "POST", body: JSON.stringify(payload) }),
  removeOpenDataImport: (projectId: string) => request<{ removed: boolean; dataset_key: string }>(`/api/projects/${projectId}/open-data/import`, { method: "DELETE" }),
  augmentPreview: (projectId: string, payload: Record<string, unknown>) =>
    request<AugmentationPreviewSample[]>(`/api/projects/${projectId}/augmentation-preview`, { method: "POST", body: JSON.stringify(payload) }),
  augment: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/augmentation-runs`, { method: "POST", body: JSON.stringify(payload) }),
  augmentationRuns: (projectId: string) => request<AugmentationRun[]>(`/api/projects/${projectId}/augmentation-runs`),
  augmentationRunSamples: (projectId: string, runId: string, limit = 3) =>
    request<AugmentationPreviewSample[]>(buildAugmentationRunSamplesPath(projectId, runId, limit)),
  split: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/dataset-splits`, { method: "POST", body: JSON.stringify(payload) }),
  datasetSplits: (projectId: string) => request<DatasetSplitRun[]>(`/api/projects/${projectId}/dataset-splits`),
  datasetSplitSamples: (projectId: string, splitId: string, limitPerBucket = 6, sampleSeed?: number) =>
    request<SplitSamples>(buildDatasetSplitSamplesPath(projectId, splitId, limitPerBucket, sampleSeed)),
  trainingRuns: (projectId: string) => request<TrainingRun[]>(`/api/projects/${projectId}/training-runs`),
  deleteHistory: (projectId: string, artifactType: "open_data" | "pseudo" | "augmentation" | "split" | "training" | "conversion" | "export", artifactId: string) =>
    request<{ deleted: Record<string, number>; removed_paths: string[] }>(
      `/api/projects/${projectId}/history/${artifactType}/${encodeURIComponent(artifactId)}`,
      { method: "DELETE" }
    ),
  modelSources: (projectId: string) => request<ModelSource[]>(buildModelSourcesPath(projectId)),
  artifactContext: (projectId: string) => request<ProjectArtifactContext>(buildArtifactContextPath(projectId)),
  modelConversions: (projectId: string) => request<ModelConversionRun[]>(buildModelConversionsPath(projectId)),
  modelConversionCapabilities: () => request<ModelConversionCapability[]>("/api/model-conversion-capabilities"),
  createModelConversion: (projectId: string, payload: ModelConversionCreatePayload) => {
    assertSupportedConversionTargets(payload);
    return request<Job>(buildModelConversionsPath(projectId), { method: "POST", body: JSON.stringify(payload) });
  },
  modelConversionNetron: (projectId: string, conversionId: string, artifactId: string) =>
    request<{ url: string }>(buildModelConversionNetronPath(projectId, conversionId, artifactId)),
  downloadModelConversionExport: (projectId: string, conversionId: string) =>
    requestBlob(buildModelConversionExportDownloadPath(projectId, conversionId), { method: "POST" }),
  exportBundles: (projectId: string) => request<ModelExportBundle[]>(buildExportBundlesPath(projectId)),
  createExportBundle: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(buildExportBundlesPath(projectId), { method: "POST", body: JSON.stringify(payload) }),
  validationPreview: (projectId: string, payload: Record<string, unknown>) =>
    request<ValidationPreviewResult[]>(`/api/projects/${projectId}/validation-preview`, { method: "POST", body: JSON.stringify(payload) }),
  train: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/training-runs`, { method: "POST", body: JSON.stringify(payload) }),
  exportModel: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/model-exports`, { method: "POST", body: JSON.stringify(payload) })
};
