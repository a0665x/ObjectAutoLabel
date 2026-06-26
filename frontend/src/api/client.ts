import type { Annotation, ClassSchema, Job, ModelLists, Project, ProjectImage, SourceAsset } from "../types";

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
  limit?: number;
  offset?: number;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

function buildImageQuery(filters: ImageFilters): string {
  const params = new URLSearchParams();

  if (filters.review_status) params.set("review_status", filters.review_status);
  if (typeof filters.has_low_confidence === "boolean") {
    params.set("has_low_confidence", String(filters.has_low_confidence));
  }
  if (filters.source_asset_id) params.set("source_asset_id", filters.source_asset_id);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  const query = params.toString();
  return query ? `?${query}` : "";
}

export const api = {
  health: () => request<{ ok: boolean; project_root: string }>("/api/health"),
  projects: () => request<Project[]>("/api/projects"),
  createProject: (payload: { name: string; description: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  jobs: () => request<Job[]>("/api/jobs"),
  models: async (): Promise<ModelLists> => {
    const [world, input, output] = await Promise.all([
      request<{ world_models: string[] }>("/api/models/world"),
      request<{ input_models: string[] }>("/api/models/input"),
      request<{ output_models: string[] }>("/api/models/output")
    ]);
    return { world_models: world.world_models, input_models: input.input_models, output_models: output.output_models };
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
  extractFrames: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/frame-runs`, { method: "POST", body: JSON.stringify(payload) }),
  reviewStats: (projectId: string) => request<ReviewStats>(`/api/projects/${projectId}/review-stats`),
  images: (projectId: string, filters: ImageFilters = {}) =>
    request<ProjectImage[]>(`/api/projects/${projectId}/images${buildImageQuery({ limit: 500, ...filters })}`),
  annotations: (imageId: string) =>
    request<{ image: ProjectImage; annotations: Annotation[] }>(`/api/images/${imageId}/annotations`),
  saveAnnotations: (imageId: string, payload: { annotations: Annotation[]; review_status: string }) =>
    request<{ annotations: Annotation[]; label_path: string }>(`/api/images/${imageId}/annotations`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  pseudoLabel: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/pseudo-label-runs`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  split: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/dataset-splits`, { method: "POST", body: JSON.stringify(payload) }),
  datasetSplits: (projectId: string) => request<Array<Record<string, unknown>>>(`/api/projects/${projectId}/dataset-splits`),
  trainingRuns: (projectId: string) => request<Array<Record<string, unknown>>>(`/api/projects/${projectId}/training-runs`),
  train: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/training-runs`, { method: "POST", body: JSON.stringify(payload) }),
  exportModel: (projectId: string, payload: Record<string, unknown>) =>
    request<Job>(`/api/projects/${projectId}/model-exports`, { method: "POST", body: JSON.stringify(payload) })
};
