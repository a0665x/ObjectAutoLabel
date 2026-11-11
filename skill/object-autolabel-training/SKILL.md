---
name: object-autolabel-training
description: Use ObjectAutoLabel's local REST API to prepare an image-folder dataset, generate pseudo labels, build a split, train a detector, and report its model artifact. Use when a user asks an agent to run this project workflow.
---

# ObjectAutoLabel training workflow

Work from the repository root. Read `spec/PROJECT_MAP.md` and `spec/API.md`; use the running server's `/openapi.json` or `/docs` for current request schemas. This skill is a repository file: an agent can read it directly even if its host does not automatically discover `skill/`.

## Start and check

- The local runtime requires Linux, Docker Compose, NVIDIA Container Toolkit and appropriate GPU drivers; Jetson needs the matching JetPack/L4T image. See the README for setup.
- Check `GET http://127.0.0.1:8501/api/health` and `./run.sh --status`. If the service is stopped, use `./run.sh --up` for an existing image, or `./run.sh` for first setup. Do not restart or rebuild an active service: jobs are process-local and a restart interrupts them. Use the actual address from status when localhost is not applicable.
- `GET /api/models/world` and `GET /api/models/input` list installed models. If needed, `scripts/install-world-model.sh` installs the default pseudo-label model and prompt encoder, and `scripts/install-input-model.sh` installs training weights. Initial downloads require network. Report failures rather than inventing a model name.
- API paths are visible inside the container. A host folder under `data/input/example` maps to `/app/data/input/example`; for any other folder verify its actual mount before submitting. Source registration copies images into project storage. Inspect existing projects and sources before creating duplicates; respect a `duplicate_source` response.

## Execute

1. Establish the requested project, folder and target objects. If the class names or boundaries are unclear, ask the user to confirm the schema **before creating it or generating labels**. Propose zero-based class IDs, names and useful text descriptors; do not infer ground truth from filenames. Honor an already explicit schema without asking again.
2. Create or select a project with `/api/projects`, register the image folder with `POST /api/projects/{project_id}/sources` and JSON `{"kind":"image_folder","path":"/app/data/input/example"}`. Obtain `id` from the response. Check source readiness and image count with `/api/projects/{project_id}/workflow-state` or source analysis.
3. Create/select the agreed schema via `/api/projects/{project_id}/class-schemas`. Example: `{"name":"objects","classes":[{"class_id":0,"class_name":"bottle","descriptors":["bottle"]}]}`. Record the returned schema `id`. Keep class IDs and meanings consistent across data groups.
4. Start `POST /api/projects/{project_id}/pseudo-label-runs` with `{"schema_id":"<schema-id>","source_asset_id":"<source-id>","world_model":"<installed-filename>"}`. The response is a job; poll `GET /api/jobs/{id}` until `completed`, `failed`, or `cancelled`. Read the result and list `/pseudo-label-runs` to identify the completed run; never proceed on failure. Inspect representative candidate annotations and explain that pseudo labels may miss objects or contain wrong boxes. Offer or perform review as requested; do not claim human review happened if it did not.
5. For a single pseudo build, start `POST /api/projects/{project_id}/dataset-splits` with `{"name":"split-1","pseudo_label_run_id":"<pseudo-id>","train_ratio":0.8,"val_ratio":0.1,"test_ratio":0.1}`. For multiple pseudo/augmentation branches, first `POST /api/projects/{project_id}/compositions` with `{"name":"mixed","branches":[{"pseudo_label_run_id":"<pseudo-id-1>"},{"pseudo_label_run_id":"<pseudo-id-2>"}]}` and optional `open_data_import_id`; then submit the returned `composition_id` in the split request. Only use existing compatible, mapped Open Data imports. Poll the split job and retrieve the completed split ID from its result or `/dataset-splits`.
6. Submit `POST /api/projects/{project_id}/training-runs` with `{"dataset_split_id":"<split-id>","input_model":"<installed-filename>","epochs":100,"imgsz":640,"batch":16,"device":"cuda"}`; adapt parameters to the user's constraints and available hardware. Poll the job. Inspect `/training-runs` and report the actual `best_model_path` or `last_model_path`, metrics, source/split lineage and any failures. Paths are container paths; map to the host mount when applicable, without guessing filenames. A trained checkpoint is an output, not evidence of accuracy: validate and report measured results where possible.

Current training uses supported Ultralytics YOLO checkpoints, and World Model inference supports the model families exposed by the installed runtime. Do not imply arbitrary architectures or an MCP server are included. See `spec/API.md` and the interactive API docs for review, validation preview, conversions and exports. Do not delete data or silently repeat destructive/duplicate actions.
