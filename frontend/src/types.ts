export type Language = "en" | "zh" | "ja" | "ko";

export type AuthUser = {
  provider: string;
  subject: string;
  name: string;
  email?: string | null;
  picture?: string | null;
};

export type AuthStatus = {
  enabled: boolean;
  authenticated: boolean;
  providers: string[];
  user?: AuthUser | null;
  error?: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  root_path: string;
  created_at?: string;
  updated_at?: string;
};

export type ProjectStorageStatus = {
  workspace_exists: boolean;
  output_index_exists: boolean;
  is_stale: boolean;
  missing: string[];
};

export type Job = {
  id: string;
  project_id?: string | null;
  related_type?: string | null;
  name: string;
  status: "queued" | "running" | "cancel_requested" | "cancelled" | "completed" | "failed";
  progress: number;
  message: string;
  error?: string | null;
  result?: Record<string, unknown> | null;
};

export type ModelLists = {
  world_models: string[];
  world_model_details: WorldModelInfo[];
  input_models: string[];
  output_models: string[];
};

export type WorldModelInfo = {
  name: string;
  family: "yolo-world" | "yolo-world-v2" | "yoloe-26" | "unknown";
  task: "detect" | "segment" | "unknown";
  annotation_output: "bbox";
  supported: boolean;
  reason: string | null;
};

export type ClassItem = {
  class_id: number;
  class_name: string;
  descriptors: string[];
};

export type ClassSchema = {
  id: string;
  project_id: string;
  name: string;
  classes: ClassItem[];
};

export type SourceAsset = {
  id: string;
  project_id: string;
  kind: "video" | "image_folder";
  path: string;
};

export type ProjectImage = {
  mean_confidence?: number | null;
  min_confidence?: number | null;
  max_confidence?: number | null;
  low_confidence_count?: number;
  annotation_count?: number;
  pseudo_label_run_id?: string | null;
  augmentation_run_id?: string | null;
  id: string;
  project_id: string;
  source_asset_id?: string | null;
  source_origin?: "project" | "open_data";
  source_split?: "train" | "val" | null;
  open_data_import_id?: string | null;
  path: string;
  width?: number | null;
  height?: number | null;
  review_status: string;
};

export type ReviewImagePosition = {
  filtered_index: number;
  filtered_total: number;
  project_index: number;
  project_total: number;
};

export type ImageRemovalResult = {
  operation_id: string;
  image_id: string;
  next_image_id: string | null;
};

export type ImageRestoreResult = {
  image: ProjectImage;
  annotations: Annotation[];
};

export type Annotation = {
  id: string;
  class_id: number;
  class_name: string;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
  confidence?: number | null;
  source_descriptor?: string | null;
  source_type: string;
  edited: boolean;
};

export type ModelConversionArtifact = {
  id: string;
  conversion_run_id: string;
  format: string;
  precision: string;
  layout?: "NCHW" | "NHWC";
  output_path?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
};

export type ModelConversionFormat = "onnx" | "tflite";

export type ModelConversionTarget = {
  format: ModelConversionFormat;
  precision: "fp32";
  layout?: "NCHW" | "NHWC";
};

export type ModelConversionCapability = ModelConversionTarget & {
  architecture: string;
  exporter: "ultralytics";
  available: boolean;
  reason: string | null;
};

export type ModelConversionCreatePayload = {
  training_run_id: string | null;
  source_model_path: string;
  schema_id: string;
  targets: ModelConversionTarget[];
  imgsz: number;
  opset?: number;
};

export type ModelSource = {
  id: string;
  label: string;
  path: string;
  relative_path: string;
  scope: "current_project" | "other_project" | "loose_output";
  source_type: "training_run" | "discovered_output";
  status: string;
  training_run_id?: string | null;
  project_id?: string | null;
};

export type ProjectArtifactContext = {
  project: Project;
  counts: {
    sources: number;
    source_images?: number;
    class_schemas: number;
    pseudo_label_runs?: number;
    augmentation_runs?: number;
    dataset_splits: number;
    training_runs: number;
    model_sources: number;
    conversion_packages: number;
    export_bundles: number;
  };
  model_sources: ModelSource[];
  pseudo_label_runs?: PseudoLabelRun[];
  augmentation_runs?: AugmentationRun[];
  dataset_splits?: DatasetSplitRun[];
};

export type OpenDataCatalogItem = {
  key: string;
  name: string;
  provider: "built_in" | "ultralytics_platform";
  source_url: string;
  owner: string;
  task: string;
  compatible: boolean;
  compatibility_reason: string;
  image_count: number;
  train_count: number;
  val_count: number;
  test_count: number;
  labels: string[];
  downloaded: boolean;
  status: string;
  cache_path: string;
  license: string;
  format: string;
  download_requires_api_key: boolean;
};

export type OpenDataMapping = Record<string, number | null>;
export type OpenDataPreview = {
  dataset_key: string;
  schema_id: string;
  schema_name: string;
  sample_percentage: number;
  source_image_count: number;
  eligible_image_count: number;
  excluded_empty_count: number;
  selected_image_count: number;
  selected_annotation_count: number;
  selected_by_split: Record<string, number>;
  split_policy?: string;
  target_class_counts: Record<string, number>;
  samples: Array<{ file_name: string; split: string; image_url: string; annotations: Array<Pick<Annotation, "class_id" | "class_name" | "x_center" | "y_center" | "width" | "height">> }>;
};

export type OpenDataImport = {
  id: string;
  project_id: string;
  dataset_key: string;
  version_name?: string | null;
  schema_id: string;
  mapping: OpenDataMapping;
  sample_percentage: number;
  selected_image_count: number;
  selected_annotation_count: number;
  status: string;
  created_at: string;
};

export type ImageSourceSummary = {
  images: Record<string, number>;
  classes: Record<string, Record<string, number>>;
};

export type PseudoLabelRun = {
  id: string;
  project_id?: string;
  schema_id?: string | null;
  schema_name?: string | null;
  run_name?: string | null;
  image_count?: number | null;
  labeled_count?: number | null;
  raw_detection_count?: number | null;
  merged_detection_count?: number | null;
  merge_rate?: number | null;
  confidence?: number | null;
  iou?: number | null;
  created_at?: string | null;
  last_image_path?: string | null;
};

export type AugmentationRun = {
  id: string;
  project_id?: string;
  pseudo_label_run_id?: string | null;
  name?: string | null;
  output_dir?: string | null;
  source_image_count?: number | null;
  created_image_count?: number | null;
  created_at?: string | null;
  outdated?: boolean;
  outdated_reason?: string | null;
};

export type DatasetSplitRun = {
  id: string;
  project_id?: string;
  name?: string | null;
  pseudo_label_run_id?: string | null;
  augmentation_run_id?: string | null;
  open_data_import_id?: string | null;
  is_current?: boolean;
  dataset_yaml_path?: string | null;
  image_ids_json?: string | null;
  train_ratio?: number | null;
  val_ratio?: number | null;
  test_ratio?: number | null;
  created_at?: string | null;
  outdated?: boolean;
  outdated_reason?: string | null;
};

export type TrainingMetric = {
  epoch: number;
  total_epochs?: number;
  box_loss?: number;
  cls_loss?: number;
  dfl_loss?: number;
  [key: string]: number | undefined;
};

export type TrainingRun = {
  id: string;
  project_id?: string;
  dataset_split_id?: string;
  input_model?: string;
  output_dir?: string;
  run_name?: string | null;
  save_dir?: string | null;
  best_model_path?: string | null;
  last_model_path?: string | null;
  metrics_json?: string | null;
  settings_json?: string | null;
  settings?: {
    epochs?: number;
    imgsz?: number;
    batch?: number;
    device?: string;
    patience?: number;
    optimizer?: string;
    lr0?: number;
    lrf?: number;
    rect?: boolean;
    amp?: boolean;
  };
  status?: string;
  job_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ModelConversionRun = {
  id: string;
  display_label?: string;
  project_id: string;
  training_run_id: string;
  source_model_path: string;
  package_name: string;
  output_dir: string;
  schema_id?: string | null;
  schema_name: string;
  schema_snapshot: Array<{ id: number; name: string }>;
  manifest_path?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  artifacts: ModelConversionArtifact[];
};

export type ModelExportBundle = {
  id: string;
  project_id: string;
  conversion_run_id: string;
  bundle_name: string;
  output_dir: string;
  included_artifacts: string[];
  status: string;
  created_at?: string;
  updated_at?: string;
};
