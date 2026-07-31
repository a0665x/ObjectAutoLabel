export type Language = "en" | "zh" | "ja" | "ko";

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
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  error?: string | null;
  result?: Record<string, unknown> | null;
};

export type ModelLists = {
  world_models: string[];
  input_models: string[];
  output_models: string[];
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
  id: string;
  project_id: string;
  source_asset_id?: string | null;
  path: string;
  width?: number | null;
  height?: number | null;
  review_status: string;
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
  output_path?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
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
};

export type DatasetSplitRun = {
  id: string;
  project_id?: string;
  name?: string | null;
  pseudo_label_run_id?: string | null;
  augmentation_run_id?: string | null;
  dataset_yaml_path?: string | null;
  train_ratio?: number | null;
  val_ratio?: number | null;
  test_ratio?: number | null;
  created_at?: string | null;
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
  status?: string;
  job_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ModelConversionRun = {
  id: string;
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
