export type Language = "en" | "zh" | "ja" | "ko";

export type Project = {
  id: string;
  name: string;
  description: string;
  root_path: string;
};

export type Job = {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  error?: string | null;
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
  id?: string | null;
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
