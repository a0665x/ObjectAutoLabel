// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as AppModule from "./App";
import { AugmentationBuildSummary, AugmentationControlPanel, AugmentationEffectModal, AugmentationPreviewCard, ConversionPackageSummary, ConversionTargetMatrix, DatasetLineageChain, ExportPackageSummary, FileManagerShortcuts, FolderPathField, HelpTooltip, InferencePreviewCard, ModelSourceSelector, ParameterHelp, ProcessingButton, ProjectArtifactContextPanel, ProjectStorageStatusCard, PseudoDependencyGraph, PseudoGenerateFeedbackPanel, SchemaClassMap, SchemaHistorySelector, SchemaTreeEditorPreview, SettingsPage, TaskCenter, TrainingInputSummary, TrainingLossChart, TrainingRunSummary, ValidationRandomButton, WorkflowGuide, WorkflowTimeline, ViewportToggle, buildAugmentationDraftStorageKey, buildTaskCenterItems, chooseLatestBuildSelection, datasetSplitImageCount, datasetSplitLineageLabel, datasetSplitOptionLabel, firstSupportedWorldModel, loadAugmentationDraft, parseTrainingMetrics, reconcileLocalPseudoJob, saveAugmentationDraft, shouldRefreshArtifactsAfterSourceProcessing, supportedWorldModels, worldModelLabel } from "./App";
import { api, buildDatasetSplitSamplesPath, type AugmentationPreviewSample, type FileBrowserShortcut } from "./api/client";
import type { ClassSchema, Job, ModelLists, Project, TrainingRun } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("worldModelLabel", () => {
  it("identifies YOLO-World v2 separately from legacy weights", () => {
    expect(worldModelLabel({
      name: "yolov8s-worldv2.pt",
      family: "yolo-world-v2",
      task: "detect",
      annotation_output: "bbox",
      supported: true,
      reason: null
    })).toContain("YOLO-World v2 · bbox");
  });
});

describe("supportedWorldModels", () => {
  const details = [
    { name: "mystery.pt", family: "unknown" as const, task: "unknown" as const, annotation_output: "bbox" as const, supported: false, reason: "Unsupported world model filename" },
    { name: "yoloe-26n-seg.pt", family: "yoloe-26" as const, task: "segment" as const, annotation_output: "bbox" as const, supported: true, reason: null }
  ];

  it("selects the first supported model instead of an unsupported file", () => {
    expect(supportedWorldModels(["mystery.pt", "yoloe-26n-seg.pt"], details)).toEqual(["yoloe-26n-seg.pt"]);
    expect(firstSupportedWorldModel(["mystery.pt", "yoloe-26n-seg.pt"], details)).toBe("yoloe-26n-seg.pt");
  });

  it("has no fallback when every local file is unsupported", () => {
    expect(firstSupportedWorldModel(["mystery.pt"], details)).toBe("");
  });

  it("keeps legacy model-list responses selectable when capability details are absent", () => {
    expect(supportedWorldModels(["yolov8s-world.pt"], [])).toEqual(["yolov8s-world.pt"]);
    expect(firstSupportedWorldModel(["yolov8s-world.pt"], [])).toBe("yolov8s-world.pt");
  });
});

describe("AugmentationPreviewCard", () => {
  it("renders the augmented preview image with bbox overlay labels", () => {
    const sample: AugmentationPreviewSample = {
      image_id: "image-1",
      preview_url: "data:image/jpeg;base64,abc123",
      file_name: "frame.jpg",
      width: 100,
      height: 50,
      annotations: [
        { class_id: 0, class_name: "person", x_center: 0.5, y_center: 0.5, width: 0.2, height: 0.4 }
      ]
    };

    const html = renderToStaticMarkup(<AugmentationPreviewCard sample={sample} />);

    expect(html).toContain("augmented preview frame.jpg");
    expect(html).toContain("data:image/jpeg;base64,abc123");
    expect(html).toContain("person");
    expect(html).toContain("1 boxes · augmented preview");
    expect(html).toContain('x="40"');
    expect(html).toContain('y="15"');
  });
});

describe("FileManagerShortcuts", () => {
  it("renders common local data shortcuts without noisy matching-file counts", () => {
    const shortcuts: FileBrowserShortcut[] = [
      { label: "0629 raw data", path: "/home/a0665x/Desktop/AI_AGX_WS/autolabel/0629", exists: true, match_count: 190, description: "Current unlabeled import folder" },
      { label: "Project input/0629", path: "/home/a0665x/Desktop/AI_AGX_WS/autolabel/ObjectAutoLabel/data/input/0629", exists: false, match_count: 0, description: "Copied working input" }
    ];

    const html = renderToStaticMarkup(<FileManagerShortcuts shortcuts={shortcuts} currentPath="" onSelect={() => undefined} />);

    expect(html).toContain("Common folders");
    expect(html).toContain("0629 raw data");
    expect(html).not.toContain("190 matches");
    expect(html).toContain("Project input/0629");
    expect(html).toContain("missing");
  });
});

describe("FolderPathField", () => {
  it("shows an explicit unassigned state instead of a path-like default", () => {
    const html = renderToStaticMarkup(<FolderPathField value="" onChange={() => undefined} onBrowse={() => undefined} />);

    expect(html).toContain("No folder selected");
    expect(html).toContain("Browse folder");
    expect(html).not.toContain("/home/...");
  });
});

describe("PseudoDependencyGraph", () => {
  it("renders no visible pseudo-label flowchart or summary columns", () => {
    const schema: ClassSchema = {
      id: "schema-1",
      project_id: "project-1",
      name: "person-car-aerial-v1",
      classes: [
        { class_id: 0, class_name: "person", descriptors: ["walking person", "person wearing a hat"] },
        { class_id: 1, class_name: "car", descriptors: ["aerial view car"] }
      ]
    };

    const html = renderToStaticMarkup(
      <PseudoDependencyGraph schema={schema} worldModel="yolov8s-world.pt" mergeBoxes={true} hasRun={true} />
    );

    expect(html).not.toContain("node-link dependency tree");
    expect(html).not.toContain("Run condition summary");
    expect(html).not.toContain("Prompt descriptors");
    expect(html).not.toContain("Inference model");
    expect(html).not.toContain("Training labels stay canonical");
    expect(html).not.toContain("data-flow=\"schema-to-classes\"");
    expect(html).not.toContain("1 ·");
    expect(html).not.toContain("2 ·");
    expect(html).not.toContain("3A ·");
    expect(html).not.toContain("3B ·");
  });
  it("does not show a not-started teaching placeholder", () => {
    const html = renderToStaticMarkup(<PseudoDependencyGraph schema={undefined} worldModel="" mergeBoxes={false} hasRun={false} />);

    expect(html).not.toContain("No run summary yet");
    expect(html).not.toContain("Inference model");
  });
});

describe("HelpTooltip", () => {
  it("renders a question mark with hover help text beside unclear titles", () => {
    const html = renderToStaticMarkup(<HelpTooltip text="Descriptors help YOLO-World recall but train as parent ids." />);

    expect(html).toContain("?");
    expect(html).toContain("Descriptors help YOLO-World recall");
    expect(html).toContain("aria-label=\"Help: Descriptors help YOLO-World recall but train as parent ids.\"");
  });
});

describe("SchemaHistorySelector", () => {
  it("warns about duplicate schema names and makes duplicate options distinguishable", () => {
    const schemas: ClassSchema[] = [
      { id: "schema-a-1111", project_id: "project-1", name: "person-car", classes: [] },
      { id: "schema-b-2222", project_id: "project-1", name: "person-car", classes: [] }
    ];

    const html = renderToStaticMarkup(<SchemaHistorySelector schemas={schemas} value="schema-a-1111" onChange={() => undefined} />);

    expect(html).toContain("Duplicate schema name warning");
    expect(html).toContain("person-car appears 2 times");
    expect(html).toContain("person-car · schema-a");
    expect(html).toContain("person-car · schema-b");
  });
});

describe("SchemaTreeEditorPreview", () => {
  it("renders class ids and descriptors as a visually nested tree", () => {
    const html = renderToStaticMarkup(
      <SchemaTreeEditorPreview
        classes={[{ class_id: 0, class_name: "person", descriptors: ["walking person", "hat person"] }]}
      />
    );

    expect(html).toContain("schema-edit-tree");
    expect(html).toContain("id 0");
    expect(html).toContain("class · person");
    expect(html).toContain("disc 01");
    expect(html).toContain("walking person");
  });
});

describe("ProcessingButton", () => {
  it("keeps the intrinsic action hook in idle and busy states", () => {
    const { rerender } = render(
      <ProcessingButton busy={false} className="primary action-process">Train</ProcessingButton>
    );
    const idleButton = screen.getByRole("button", { name: "Train" });
    expect(idleButton.classList.contains("processing-button")).toBe(true);
    expect(idleButton.classList.contains("action-process")).toBe(true);
    expect(idleButton.classList.contains("intrinsic-action")).toBe(true);

    rerender(
      <ProcessingButton busy progress={35} statusText="Epoch 1/1" className="primary action-process">Train</ProcessingButton>
    );
    const busyButton = screen.getByRole("button", { name: /Epoch 1\/1/ });
    expect(busyButton.classList.contains("processing-button")).toBe(true);
    expect(busyButton.classList.contains("action-process")).toBe(true);
    expect(busyButton.classList.contains("intrinsic-action")).toBe(true);
  });

  it("renders disabled busy feedback to prevent repeated submits", () => {
    const html = renderToStaticMarkup(<ProcessingButton busy={true}>Run</ProcessingButton>);

    expect(html).toContain("disabled");
    expect(html).toContain("Working…");
    expect(html).toContain("touch-feedback");
  });

  it("renders process progress percent and current step text while busy", () => {
    const html = renderToStaticMarkup(<ProcessingButton busy={true} progress={42} statusText="Analyzing images…">Run</ProcessingButton>);

    expect(html).toContain("Analyzing images…");
    expect(html).toContain("42%");
    expect(html).toContain("processing-meter");
    expect(html).toContain("width:42%");
  });

  it("turns a running job button into a safe stop action", async () => {
    const cancel = vi.spyOn(api, "cancelJob").mockResolvedValue({ id: "job-1", name: "training", status: "cancel_requested", progress: 42, message: "Stopping safely…" });
    render(<ProcessingButton busy jobId="job-1" progress={42}>Train</ProcessingButton>);

    const stop = screen.getByRole("button", { name: /Stop safely/ });
    expect(stop.getAttribute("type")).toBe("button");
    fireEvent.click(stop);

    await waitFor(() => expect(cancel).toHaveBeenCalledWith("job-1"));
  });
});

describe("task state coordination", () => {
  it("hides the Pseudo Generate client task once the matching backend job is visible", () => {
    const items = buildTaskCenterItems({
      jobs: [{ id: "job-1", project_id: "project-1", name: "pseudo_label", status: "running", progress: 24, message: "Processing 4/20" }],
      clientTasks: [{ id: "Pseudo Label Generate", name: "Pseudo Label Generate", status: "running", progress: 8, message: "Submitting pseudo-label run…", updatedAt: 1 }],
      activeProjectId: "project-1",
      expanded: true
    });

    expect(items.map((item) => item.title)).toEqual(["Pseudo Label"]);
  });

  it("drops a local queued pseudo job after any server pseudo job is available for the same project", () => {
    const localJob = { id: "local", project_id: "project-1", name: "pseudo_label", status: "queued" as const, progress: 0, message: "Queued" };
    const serverJob = { id: "server", project_id: "project-1", name: "pseudo_label", status: "completed" as const, progress: 100, message: "Completed" };

    expect(reconcileLocalPseudoJob(localJob, serverJob, "project-1")).toBeUndefined();
  });

  it("refreshes project artifacts immediately after source processing changes the source inventory", () => {
    expect(shouldRefreshArtifactsAfterSourceProcessing({ sourceId: "source-1", imageCount: 12 })).toBe(true);
  });

  it("lets the collapsed Task Center move without turning the drag into an expand click", () => {
    Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: MouseEvent });
    render(<TaskCenter jobs={[{ id: "job-1", project_id: "project-1", name: "dataset_split", status: "completed", progress: 100, message: "Completed" }]} clientTasks={[]} activeProjectId="project-1" onJobsChange={() => undefined} />);
    const panel = screen.getByLabelText("Task center");
    Object.defineProperty(panel, "getBoundingClientRect", { value: () => ({ left: 600, top: 500, width: 270, height: 46, right: 870, bottom: 546, x: 600, y: 500, toJSON: () => ({}) }) });
    const handle = screen.getByRole("button", { name: /Task Center/i });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 700, clientY: 520 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 620, clientY: 430 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 620, clientY: 430 });
    fireEvent.click(handle);

    expect(panel.style.left).toBe("520px");
    expect(panel.style.top).toBe("410px");
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem("object-autolabel.task-center-position")).toContain("520");
  });

  it("docks Stream Demo tasks without applying or changing the saved floating position", () => {
    const saved = JSON.stringify({ left: 520, top: 410 });
    window.localStorage.setItem("object-autolabel.task-center-position", saved);
    render(<TaskCenter docked jobs={[{ id: "job-1", project_id: "project-1", name: "dataset_split", status: "completed", progress: 100, message: "Completed" }]} clientTasks={[]} activeProjectId="project-1" onJobsChange={() => undefined} />);
    const panel = screen.getByLabelText("Task center");
    const handle = screen.getByRole("button", { name: /Task Center/i });
    expect(panel.classList.contains("is-docked")).toBe(true);
    expect(panel.style.left).toBe("");
    fireEvent.keyDown(handle, { altKey: true, key: "ArrowLeft" });
    fireEvent.click(handle);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem("object-autolabel.task-center-position")).toBe(saved);
  });
});

describe("PseudoGenerateFeedbackPanel", () => {
  it("shows immediate local feedback before the backend job is visible", () => {
    const html = renderToStaticMarkup(
      <PseudoGenerateFeedbackPanel
        submitting={true}
        submitNotice="Saving schema and submitting pseudo-label run…"
        activeJob={undefined}
        latestRun={undefined}
        schemaName="person-car-aerial-v1"
        worldModel="yolov8s-world.pt"
        mergeBoxes={true}
        mergeIou={0.75}
        onRestart={() => undefined}
      />
    );

    expect(html).toContain("Pseudo-label run status");
    expect(html).toContain("Starting now");
    expect(html).toContain("Saving schema and submitting pseudo-label run…");
    expect(html).toContain("person-car-aerial-v1");
    expect(html).toContain("yolov8s-world.pt");
    expect(html).toContain("merge on · IoU 0.75");
  });

  it("shows restart affordance while a pseudo-label job is already running", () => {
    const html = renderToStaticMarkup(
      <PseudoGenerateFeedbackPanel
        submitting={false}
        submitNotice=""
        activeJob={{ id: "job-1", project_id: "project-1", name: "pseudo_label", status: "running", progress: 37, message: "Processing 7/190: frame.png · boxes=210 · merged=20/230 (8.7%)" }}
        latestRun={undefined}
        schemaName="person-car-aerial-v1"
        worldModel="yolov8s-world.pt"
        mergeBoxes={false}
        mergeIou={0.75}
        onRestart={() => undefined}
      />
    );

    expect(html).toContain("37%");
    expect(html).toContain("Processing 7/190");
    expect(html).toContain("Restart with current settings");
    expect(html).toContain("running job first");
  });
});

describe("ViewportToggle", () => {
  it("renders a Desktop/Mobile segmented control with the active state", () => {
    const html = renderToStaticMarkup(<ViewportToggle mode="desktop" onChange={() => undefined} />);

    expect(html).toContain("Desktop");
    expect(html).toContain("Mobile");
    expect(html).toContain("aria-label=\"Viewport mode\"");
    expect(html).toContain("active");
  });
});


describe("WorkflowGuide", () => {
  it("uses project artifacts for done state, stays clickable, and keeps review as spot-check instead of fake complete", () => {
    const html = renderToStaticMarkup(
      <WorkflowGuide
        currentPage="split"
        activeProjectId="project-1"
        facts={{ sourceCount: 1, splitCount: 0, trainingRunCount: 0, conversionPackageCount: 0, exportBundleCount: 0 }}
        onNavigate={() => undefined}
        jobs={[{ id: "1", project_id: "project-1", name: "pseudo_label", status: "completed", progress: 100, message: "done" }]}
      />
    );

    expect(html).toContain("Workflow guide");
    expect(html).toContain("Next: Split");
    expect(html).toContain("Source");
    expect(html).toContain("Done");
    expect(html).toContain("Review");
    expect(html).toContain("Spot-check");
    expect(html).toContain("button");
    expect(html).toContain("Not done yet");
  });

  it("ignores legacy global jobs when an active project has its own workflow artifacts", () => {
    const html = renderToStaticMarkup(
      <WorkflowGuide
        currentPage="projects"
        activeProjectId="project-1"
        facts={{ sourceCount: 1, pseudoLabelRunCount: 1, splitCount: 0, trainingRunCount: 0, conversionPackageCount: 0, exportBundleCount: 0 }}
        onNavigate={() => undefined}
        jobs={[
          { id: "old-failed", project_id: null, name: "pseudo_label", status: "failed", progress: 1, message: "Old failed legacy job" },
          { id: "current-done", project_id: "project-1", name: "pseudo_label", status: "completed", progress: 100, message: "Completed" }
        ]}
      />
    );

    expect(html).toContain("Pseudo");
    expect(html).not.toContain("Needs attention");
  });
});


describe("AugmentationControlPanel", () => {
  it("starts from an empty recipe and exposes add-parameter actions plus active multiplier styling", () => {
    const html = renderToStaticMarkup(
      <AugmentationControlPanel
        settings={{ effects: [], copies: 5, skip: false }}
        onChange={() => undefined}
        onEditEffect={() => undefined}
      />
    );

    expect(html).toContain("No augmentation parameters yet");
    expect(html).toContain("+ Blur Filter");
    expect(html).toContain("+ Random Rotation");
    expect(html).toContain("x5");
    expect(html).toContain("is-active");
    expect(html).toContain("Skip augment");
    expect(html).toContain("+ Mirror");
    expect(html).not.toContain("Mirror directions");
  });

  it("renders skip augment as the selected source-build mode", () => {
    const html = renderToStaticMarkup(
      <AugmentationControlPanel
        settings={{ effects: [], copies: 3, skip: true }}
        onChange={() => undefined}
        onEditEffect={() => undefined}
      />
    );

    expect(html).toContain("Skip augment");
    expect(html).toContain("source build");
    expect(html).toContain("is-active");
  });

  it("renders applied effects as a stacked recipe instead of full-width sliders", () => {
    const html = renderToStaticMarkup(
      <AugmentationControlPanel
        settings={{ effects: [{ id: "blur-1", key: "blur", value: 4 }], copies: 8, skip: false }}
        onChange={() => undefined}
        onEditEffect={() => undefined}
      />
    );

    expect(html).toContain("Applied augmentation stack");
    expect(html).toContain("Blur Filter");
    expect(html).toContain("±4");
    expect(html).toContain("Edit");
    expect(html).toContain("Remove");
    expect(html).not.toContain("模糊");
    expect(html).not.toContain("降低影像");
  });

  it("renders mirror as a normal stacked effect with direction and probability", () => {
    const html = renderToStaticMarkup(
      <AugmentationControlPanel
        settings={{ effects: [{ id: "mirror-1", key: "mirror", value: 0, direction: "vertical", probability: 35 }], copies: 3, skip: false }}
        onChange={() => undefined}
        onEditEffect={() => undefined}
      />
    );

    expect(html).toContain("Mirror");
    expect(html).toContain("Top ↔ Bottom");
    expect(html).toContain("35%");
  });
});

describe("dataset build lineage helpers", () => {
  const pseudo = { id: "pseudo-1", run_name: "Pseudo_20260707_v001", schema_name: "person-car", image_count: 10, labeled_count: 8, created_at: "2026-07-07T03:00:00Z" };
  const augment = { id: "aug-1", pseudo_label_run_id: "pseudo-1", name: "Skip source build", source_image_count: 8, created_image_count: 8, output_dir: "/app/data/projects/demo/augmentations/skip", created_at: "2026-07-07T03:10:00Z" };
  const split = { id: "split-1", name: "Split_20260707_112000", pseudo_label_run_id: "pseudo-1", augmentation_run_id: "aug-1", open_data_import_id: "open-1", image_ids_json: JSON.stringify({ train: ["1", "2", "3", "4", "5", "6"], valid: ["7"], test: ["8"] }), train_ratio: 0.8, val_ratio: 0.1, test_ratio: 0.1, dataset_yaml_path: "/app/data/projects/demo/splits/default/dataset.yaml", created_at: "2026-07-07T03:20:00Z" };
  const openData = { id: "open-1", project_id: "project-1", dataset_key: "visdrone2019-det" as const, schema_id: "schema-1", mapping: {}, sample_percentage: 50, selected_image_count: 3, selected_annotation_count: 12, status: "active", created_at: "2026-07-07T03:15:00Z" };

  it("summarizes an augmentation build with source and generated counts", () => {
    const html = renderToStaticMarkup(<AugmentationBuildSummary run={augment} pseudoRuns={[pseudo]} />);

    expect(html).toContain("Source images");
    expect(html).toContain("8");
    expect(html).toContain("Generated images");
    expect(html).toContain("Skip source build");
    expect(html).toContain("/app/data/projects/demo/augmentations/skip");
  });

  it("keeps outdated augmentation and split history visible with a user-facing reason and rebuild guidance", () => {
    const reason = JSON.stringify({ code: "project_image_removed", image_ids: ["image-uuid-1"] });
    const augmentationHtml = renderToStaticMarkup(
      <AugmentationBuildSummary run={{ ...augment, outdated: true, outdated_reason: reason }} pseudoRuns={[pseudo]} />
    );
    const splitHtml = renderToStaticMarkup(
      <TrainingInputSummary split={{ ...split, outdated: true, outdated_reason: reason }} pseudoRuns={[pseudo]} augmentationRuns={[augment]} />
    );

    expect(augmentationHtml).toContain("Outdated");
    expect(augmentationHtml).toMatch(/project image was removed/i);
    expect(augmentationHtml).not.toContain("project_image_removed");
    expect(augmentationHtml).not.toContain("image-uuid-1");
    expect(augmentationHtml).toMatch(/rebuild.*Augment.*Split/i);
    expect(splitHtml).toContain("Outdated");
    expect(splitHtml).toMatch(/project image was removed/i);
    expect(splitHtml).not.toContain("project_image_removed");
    expect(splitHtml).toMatch(/rebuild.*Split/i);
  });

  it("keeps outdated splits visible but prevents Train submission", async () => {
    type TrainPageProps = {
      project: Project;
      models: ModelLists;
      jobs: Job[];
      refreshJobs: () => Promise<void>;
      t: (key: string) => string;
      artifactRevision: number;
    };
    const TrainPage = (AppModule as unknown as { TrainPage?: ComponentType<TrainPageProps> }).TrainPage;
    expect(typeof TrainPage).toBe("function");
    if (!TrainPage) return;

    const outdatedSplit = {
      ...split,
      outdated: true,
      outdated_reason: "Project image removal removal-1 invalidated this split."
    };
    vi.spyOn(api, "datasetSplits").mockResolvedValue([outdatedSplit]);
    vi.spyOn(api, "pseudoLabelRuns").mockResolvedValue([pseudo]);
    vi.spyOn(api, "augmentationRuns").mockResolvedValue([augment]);
    vi.spyOn(api, "trainingRuns").mockResolvedValue([]);
    vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(null);
    vi.spyOn(api, "openDataImports").mockResolvedValue([]);
    const train = vi.spyOn(api, "train").mockResolvedValue({ id: "job-1", name: "training", status: "queued", progress: 0, message: "queued" });
    const models: ModelLists = { world_models: [], world_model_details: [], input_models: ["yolov8n.pt"], output_models: [] };
    const testProject: Project = { id: "project-1", name: "demo", description: "", root_path: "/tmp/demo" };
    const { container } = render(<TrainPage project={testProject} models={models} jobs={[]} refreshJobs={async () => undefined} t={(key) => key} artifactRevision={0} />);

    expect(await screen.findByText(/Build a new Split version before training/i)).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Outdated — rebuild required/i })).toBeNull();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(train).not.toHaveBeenCalled());
  });

  it("offers MuSGD in the explicit optimizer order and submits it unchanged", async () => {
    type TrainPageProps = {
      project: Project;
      models: ModelLists;
      jobs: Job[];
      refreshJobs: () => Promise<void>;
      t: (key: string) => string;
      artifactRevision: number;
    };
    const TrainPage = (AppModule as unknown as { TrainPage?: ComponentType<TrainPageProps> }).TrainPage;
    expect(typeof TrainPage).toBe("function");
    if (!TrainPage) return;

    vi.spyOn(api, "datasetSplits").mockResolvedValue([split]);
    vi.spyOn(api, "pseudoLabelRuns").mockResolvedValue([pseudo]);
    vi.spyOn(api, "augmentationRuns").mockResolvedValue([augment]);
    vi.spyOn(api, "trainingRuns").mockResolvedValue([]);
    vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(openData);
    vi.spyOn(api, "openDataImports").mockResolvedValue([openData]);
    const train = vi.spyOn(api, "train").mockResolvedValue({ id: "job-1", name: "training", status: "queued", progress: 0, message: "queued" });
    const models: ModelLists = { world_models: [], world_model_details: [], input_models: ["yolov8n.pt", "yolo11n.pt"], output_models: [] };
    const testProject: Project = { id: "project-1", name: "demo", description: "", root_path: "/tmp/demo" };
    const { container, rerender } = render(<TrainPage project={testProject} models={models} jobs={[]} refreshJobs={async () => undefined} t={(key) => key} artifactRevision={0} />);

    const optimizer = await screen.findByLabelText("Optimizer") as HTMLSelectElement;
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    expect((screen.getByLabelText("Training run name") as HTMLInputElement).value).toBe(`Train_${mmdd}_v001`);
    fireEvent.change(screen.getByLabelText("Input model"), { target: { value: "yolo11n.pt" } });
    expect(Array.from(optimizer.options).map((option) => option.text)).toEqual(["SGD", "MuSGD", "Adam", "AdamW"]);
    fireEvent.change(optimizer, { target: { value: "MuSGD" } });
    await waitFor(() => expect((container.querySelector('select[name="optimizer"]') as HTMLSelectElement).value).toBe("MuSGD"));
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(train).toHaveBeenCalled());
    expect(train.mock.calls[0]?.[1]).toMatchObject({ input_model: "yolo11n.pt", optimizer: "MuSGD" });
    rerender(<TrainPage project={testProject} models={{ ...models, input_models: [...models.input_models] }} jobs={[{ id: "job-1", name: "training", status: "running", progress: 5, message: "Training started", project_id: testProject.id }]} refreshJobs={async () => undefined} t={(key) => key} artifactRevision={1} />);
    await waitFor(() => expect((screen.getByLabelText("Input model") as HTMLSelectElement).value).toBe("yolo11n.pt"));
    expect((screen.getByLabelText("Optimizer") as HTMLSelectElement).value).toBe("MuSGD");
    expect(screen.getByLabelText("Submitted training configuration").textContent).toMatch(/yolo11n\.pt.*MuSGD/s);
    expect(screen.queryByText("100 epochs")).toBeNull();
    expect(screen.queryByText("SGD / 0.01")).toBeNull();
  });

  it("includes an explicit seed when requesting random Split samples", () => {
    expect(buildDatasetSplitSamplesPath("project-1", "split-1", 4, 123)).toBe("/api/projects/project-1/dataset-splits/split-1/samples?limit_per_bucket=4&sample_seed=123");
  });

  it("confirms history deletion and refreshes after the cascade completes", async () => {
    const HistoryDeleteButton = (AppModule as unknown as {
      HistoryDeleteButton?: ComponentType<{
        projectId: string;
        artifactType: "training";
        artifactId: string;
        label: string;
        onDeleted: () => Promise<void>;
      }>;
    }).HistoryDeleteButton;
    expect(typeof HistoryDeleteButton).toBe("function");
    if (!HistoryDeleteButton) return;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteHistory = vi.spyOn(api as unknown as { deleteHistory: (...args: unknown[]) => Promise<unknown> }, "deleteHistory")
      .mockResolvedValue({ deleted: { training: 1, conversion: 1, export: 1 }, removed_paths: [] });
    const onDeleted = vi.fn().mockResolvedValue(undefined);

    render(<HistoryDeleteButton projectId="project-1" artifactType="training" artifactId="train-1" label="detector-v1" onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete training history detector-v1" }));

    await waitFor(() => expect(deleteHistory).toHaveBeenCalledWith("project-1", "training", "train-1"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/downstream Conversion and Export/i));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("keeps outdated augmentation history visible but prevents Split from using it", async () => {
    type SplitPageProps = {
      project: Project;
      jobs: Job[];
      refreshJobs: () => Promise<void>;
      t: (key: string) => string;
      artifactRevision: number;
    };
    const SplitPage = (AppModule as unknown as { SplitPage?: ComponentType<SplitPageProps> }).SplitPage;
    expect(typeof SplitPage).toBe("function");
    if (!SplitPage) return;

    const staleAugment = {
      ...augment,
      outdated: true,
      outdated_reason: JSON.stringify({ code: "project_image_removed", image_ids: ["image-1"] })
    };
    vi.spyOn(api, "pseudoLabelRuns").mockResolvedValue([pseudo]);
    vi.spyOn(api, "augmentationRuns").mockResolvedValue([staleAugment]);
    vi.spyOn(api, "datasetSplits").mockResolvedValue([]);
    vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(null);
    vi.spyOn(api, "openDataImports").mockResolvedValue([]);
    const splitRequest = vi.spyOn(api, "split").mockResolvedValue({ id: "job-split", name: "dataset_split", status: "queued", progress: 0, message: "queued" });
    const testProject: Project = { id: "project-1", name: "demo", description: "", root_path: "/tmp/demo" };
    const { container } = render(<SplitPage project={testProject} jobs={[]} refreshJobs={async () => undefined} t={(key) => key} artifactRevision={0} />);

    const sourceSelect = await screen.findByLabelText("Augment version") as HTMLSelectElement;
    const outdatedOption = screen.getByRole("option", { name: /Outdated — rebuild required/i }) as HTMLOptionElement;
    expect(outdatedOption.disabled).toBe(true);
    expect(sourceSelect.value).toBe("");

    fireEvent.change(sourceSelect, { target: { value: staleAugment.id } });
    expect((screen.getByRole("button", { name: "Build New Split Version" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/outdated.*rebuild Augment/i);
    expect(splitRequest).not.toHaveBeenCalled();
  });

  it("labels split and train inputs with pseudo and augment build lineage", () => {
    expect(datasetSplitImageCount(split)).toBe(8);
    expect(datasetSplitOptionLabel(split, [pseudo], [augment], openData)).toContain("[Pseudo · Pseudo_20260707_v001]");
    expect(datasetSplitLineageLabel(split, [pseudo], [augment], openData)).toContain("[Open Data · visdrone2019-det 50% · 3 images]");

    const html = renderToStaticMarkup(<TrainingInputSummary split={split} pseudoRuns={[pseudo]} augmentationRuns={[augment]} openDataImport={openData} />);
    expect(html).toContain("Training input");
    expect(html).toContain("lineage-pseudo");
    expect(html).toContain("lineage-augment");
    expect(html).toContain("lineage-open-data");
    expect(html).toContain("lineage-split");
    expect(html).toContain("Skip source build");
    expect(html).toContain("8 images");
    expect(renderToStaticMarkup(<DatasetLineageChain split={split} pseudoRun={pseudo} augmentationRun={augment} openDataImport={openData} />)).toContain("5 images");
  });

  it("updates downstream build selection to the newest generated augment build after artifact refresh", () => {
    const oldBuild = { id: "aug-old", created_at: "2026-07-07T03:00:00Z" };
    const newBuild = { id: "aug-new", created_at: "2026-07-07T03:10:00Z" };

    expect(chooseLatestBuildSelection("aug-old", [newBuild, oldBuild], true)).toBe("aug-new");
    expect(chooseLatestBuildSelection("aug-old", [newBuild, oldBuild], false)).toBe("aug-old");
    expect(chooseLatestBuildSelection("missing", [newBuild, oldBuild], false)).toBe("aug-new");
  });
});

describe("Training run metrics", () => {
  const run: TrainingRun = {
    id: "train-1",
    project_id: "project-1",
    dataset_split_id: "split-1",
    input_model: "/models/yolov8n.pt",
    output_dir: "/project/output_model/runs",
    run_name: "Train_augx3_v002",
    save_dir: "/project/output_model/runs/train2",
    best_model_path: "/project/output_model/runs/train2/weights/best.pt",
    last_model_path: "/project/output_model/runs/train2/weights/last.pt",
    status: "completed",
    metrics_json: JSON.stringify([
      { epoch: 1, total_epochs: 3, box_loss: 1.2, cls_loss: 0.8, dfl_loss: 0.4 },
      { epoch: 2, total_epochs: 3, box_loss: 0.9, cls_loss: 0.5, dfl_loss: 0.3 }
    ])
  };

  it("parses persisted training metrics into chart points", () => {
    const metrics = parseTrainingMetrics(run);

    expect(metrics).toHaveLength(2);
    expect(metrics[0].epoch).toBe(1);
    expect(metrics[1].box_loss).toBe(0.9);
  });

  it("keeps chart points when legacy metrics contain Python NaN values", () => {
    const metrics = parseTrainingMetrics({ ...run, metrics_json: '[{"epoch":1,"box_loss":1.2,"cls_loss":null,"dfl_loss":0.4,"val/cls_loss":NaN}]' });

    expect(metrics).toHaveLength(1);
    expect(metrics[0].box_loss).toBe(1.2);
    expect(metrics[0]["val/cls_loss"]).toBeUndefined();
  });

  it("renders three readable loss charts with axis labels, points, and regression trend lines", () => {
    const html = renderToStaticMarkup(<TrainingLossChart run={run} />);

    expect(html).toContain("Box loss");
    expect(html).toContain("Class loss");
    expect(html).toContain("DFL loss");
    expect(html).toContain("Epoch");
    expect(html).toContain("Loss");
    expect(html).toContain("loss-axis-tick");
    expect(html).toContain("loss-point");
    expect(html).toContain("loss-regression");
    expect(html).toContain("<polyline");
    expect(html).toContain("Epoch 2/3");
  });

  it("shows the exact Ultralytics save_dir and model weight paths", () => {
    const html = renderToStaticMarkup(<TrainingRunSummary run={run} />);

    expect(html).toContain("Train_augx3_v002");
    expect(html).toContain("/project/output_model/runs/train2");
    expect(html).toContain("/project/output_model/runs/train2/weights/best.pt");
    expect(html).toContain("/project/output_model/runs/train2/weights/last.pt");
  });
});


describe("AugmentationEffectModal", () => {
  it("shows a sampled-photo editor with bbox overlay opt-in and apply action", () => {
    const html = renderToStaticMarkup(
      <AugmentationEffectModal
        draft={{ id: "blur-1", key: "blur", value: 4, showBbox: false }}
        previewSamples={[]}
        loading={false}
        error=""
        onChange={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("Configure Blur Filter");
    expect(html).toContain("Preview bounding boxes");
    expect(html).toContain("Apply effect");
    expect(html).not.toContain("模糊");
    expect(html).not.toContain("降低影像");
  });

  it("configures mirror direction and trigger probability", () => {
    const html = renderToStaticMarkup(
      <AugmentationEffectModal
        draft={{ id: "mirror-1", key: "mirror", value: 0, direction: "horizontal", probability: 50 }}
        previewSamples={[]}
        loading={false}
        error=""
        onChange={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("Configure Mirror");
    expect(html).toContain("Left ↔ Right");
    expect(html).toContain("Top ↔ Bottom");
    expect(html).toContain("Trigger probability");
    expect(html).toContain("50%");
  });

  it("shows an explicit loading state while the sampled photo is being generated", () => {
    const html = renderToStaticMarkup(
      <AugmentationEffectModal
        draft={{ id: "blur-1", key: "blur", value: 4, showBbox: false }}
        previewSamples={[]}
        loading={true}
        error=""
        onChange={() => undefined}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("Sampling preview image…");
    expect(html).toContain("sample-preview-skeleton");
  });
});


describe("augmentation draft persistence", () => {
  it("stores the augmentation stack by project so switching tabs does not clear it", () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); }
    } as Storage;
    const projectId = "project-1";
    const draft = { name: "augmented-v2", settings: { copies: 8, skip: false, effects: [{ id: "blur-1", key: "blur" as const, value: 4 }] } };

    saveAugmentationDraft(projectId, draft, fakeStorage);

    expect(storage.has(buildAugmentationDraftStorageKey(projectId))).toBe(true);
    expect(loadAugmentationDraft(projectId, fakeStorage)).toEqual(draft);
  });
});


describe("ValidationRandomButton", () => {
  it("keeps an editable sample count beside the random action", () => {
    const html = renderToStaticMarkup(<ValidationRandomButton loading={false} sampleCount={3} onSampleCountChange={() => undefined} onClick={() => undefined} />);

    expect(html).toContain("Random sample");
    expect(html).toContain("Sample count");
    expect(html).toContain('value="3"');
  });
});

describe("WorkflowTimeline", () => {
  it("renders project jobs as a processing timeline", () => {
    const html = renderToStaticMarkup(
      <WorkflowTimeline jobs={[{ id: "1", name: "pseudo_label", status: "completed", progress: 100, message: "done" }]} />
    );

    expect(html).toContain("Processing timeline");
    expect(html).toContain("pseudo_label");
    expect(html).toContain("completed");
  });
});

describe("ParameterHelp", () => {
  it("renders explicit training parameter descriptions", () => {
    const html = renderToStaticMarkup(<ParameterHelp name="Epochs" value="100" help="Full passes through train images" />);

    expect(html).toContain("Epochs");
    expect(html).toContain("100");
    expect(html).toContain("Full passes through train images");
  });
});

describe("InferencePreviewCard", () => {
  it("renders validation inference results with model and schema names", () => {
    const html = renderToStaticMarkup(
      <InferencePreviewCard
        result={{
          file_name: "sample.jpg",
          image_url: "/api/files?path=sample.jpg",
          width: 100,
          height: 50,
          model_name: "best.pt",
          schema_name: "person-car",
          annotations: [{ class_id: 1, class_name: "car", x_center: 0.5, y_center: 0.5, width: 0.2, height: 0.4 }]
        }}
      />
    );

    expect(html).toContain("best.pt");
    expect(html).toContain("person-car");
    expect(html).toContain("car");
    expect(html).toContain('x="40"');
  });
});

describe("Model conversion UI helpers", () => {
  const schema: ClassSchema = {
    id: "schema-1",
    project_id: "project-1",
    name: "hardware",
    classes: [
      { class_id: 0, class_name: "bolt", descriptors: ["bolt"] },
      { class_id: 1, class_name: "nut", descriptors: ["nut"] }
    ]
  };

  it("renders class id to name mapping for model packages", () => {
    const html = renderToStaticMarkup(<SchemaClassMap schema={schema} />);

    expect(html).toContain("Class schema manifest");
    expect(html).toContain("id 0");
    expect(html).toContain("bolt");
    expect(html).toContain("id 1");
    expect(html).toContain("nut");
  });

  it("renders exactly the ONNX FP32 and LiteRT FP32 conversion choices", () => {
    render(<ConversionTargetMatrix selected={["onnx:fp32", "tflite:fp32"]} onToggle={() => undefined} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect((screen.getByRole("checkbox", { name: "ONNX FP32" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "LiteRT FP32" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("FP16")).toBeNull();
    expect(screen.queryByText("INT8")).toBeNull();
  });

  it("loads conversion capabilities and blocks unavailable aarch64 conversion", async () => {
    type ModelConvertPageProps = { project: Project; jobs: Job[]; refreshJobs: () => Promise<void> };
    const ModelConvertPage = (AppModule as unknown as { ModelConvertPage?: ComponentType<ModelConvertPageProps> }).ModelConvertPage;
    expect(typeof ModelConvertPage).toBe("function");
    if (!ModelConvertPage) return;

    vi.spyOn(api, "modelSources").mockResolvedValue([{
      id: "source-1",
      label: "Current project · best.pt",
      path: "/models/best.pt",
      relative_path: "best.pt",
      scope: "current_project",
      source_type: "training_run",
      status: "completed",
      training_run_id: "training-1",
      project_id: "project-1"
    }]);
    vi.spyOn(api, "classSchemas").mockResolvedValue([schema]);
    vi.spyOn(api, "modelConversions").mockResolvedValue([]);
    const capabilityApi = api as typeof api & {
      modelConversionCapabilities?: () => Promise<Array<{
        format: "onnx" | "tflite";
        precision: "fp32";
        architecture: string;
        exporter: "ultralytics";
        available: boolean;
        reason: string | null;
      }>>;
    };
    expect(typeof capabilityApi.modelConversionCapabilities).toBe("function");
    if (!capabilityApi.modelConversionCapabilities) return;
    const capabilitySpy = vi.spyOn(capabilityApi, "modelConversionCapabilities").mockResolvedValue([
      { format: "onnx", precision: "fp32", architecture: "aarch64", exporter: "ultralytics", available: false, reason: "Copy the .pt checkpoint to an x86_64 host and convert it there." },
      { format: "tflite", precision: "fp32", architecture: "aarch64", exporter: "ultralytics", available: false, reason: "Copy the .pt checkpoint to an x86_64 host and convert it there." }
    ]);

    render(<ModelConvertPage project={{ id: "project-1", name: "Test", description: "", root_path: "/data/test" }} jobs={[]} refreshJobs={async () => undefined} />);

    expect(await screen.findByText(/Copy the \.pt checkpoint to an x86_64 host/)).toBeTruthy();
    expect(capabilitySpy).toHaveBeenCalledOnce();
    expect((screen.getByRole("checkbox", { name: "ONNX FP32" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "LiteRT FP32" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Convert package/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("defaults ONNX to opset 11, submits another version and exposes hard failures", async () => {
    vi.spyOn(api, "modelSources").mockResolvedValue([{ id: "source", label: "YOLO26 best.pt", path: "/models/best.pt", relative_path: "best.pt", scope: "current_project", source_type: "training_run", status: "completed", training_run_id: "train", project_id: "project-1" }]);
    vi.spyOn(api, "classSchemas").mockResolvedValue([schema]);
    vi.spyOn(api, "modelConversions").mockResolvedValue([]);
    vi.spyOn(api, "modelConversionCapabilities").mockResolvedValue([
      { format: "onnx", precision: "fp32", architecture: "x86_64", exporter: "ultralytics", available: true, reason: null },
      { format: "tflite", precision: "fp32", architecture: "x86_64", exporter: "ultralytics", available: true, reason: null }
    ]);
    const create = vi.spyOn(api, "createModelConversion").mockRejectedValue(new Error("ONNX opset 17 conversion failed: unsupported operator. No fallback opset was used."));
    render(<AppModule.ModelConvertPage project={{ id: "project-1", name: "Test", description: "", root_path: "/data/test" }} jobs={[]} refreshJobs={async () => undefined} />);
    const button = screen.getByRole("button", { name: /Convert package/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("ONNX opset") as HTMLSelectElement).value).toBe("11");
    fireEvent.change(screen.getByLabelText("ONNX opset"), { target: { value: "17" } });
    fireEvent.click(button);
    await waitFor(() => expect(create).toHaveBeenCalledWith("project-1", expect.objectContaining({ opset: 17 })));
    expect((await screen.findByRole("alert")).textContent).toContain("No fallback opset was used");
    fireEvent.click(screen.getByRole("checkbox", { name: "ONNX FP32" }));
    expect((screen.getByLabelText("ONNX opset") as HTMLSelectElement).disabled).toBe(true);
  });

  it("summarizes conversion packages and export package contents", () => {
    const conversion = {
      id: "conversion-1",
      project_id: "project-1",
      training_run_id: "training-1",
      source_model_path: "/models/best.pt",
      package_name: "conversion-001",
      output_dir: "/models/conversion-001",
      schema_id: "schema-1",
      schema_name: "hardware",
      schema_snapshot: [{ id: 0, name: "bolt" }],
      manifest_path: "/models/conversion-001/metadata.json",
      status: "completed",
      artifacts: [{ id: "artifact-1", conversion_run_id: "conversion-1", format: "onnx", precision: "fp32", output_path: "/models/model.onnx", status: "completed" }]
    };

    const conversionHtml = renderToStaticMarkup(<ConversionPackageSummary conversion={conversion} selectedArtifactId="artifact-1" onSelectArtifact={() => undefined} onExport={() => undefined} exporting={false} />);
    const exportHtml = renderToStaticMarkup(<ExportPackageSummary conversion={conversion} selectedArtifactIds={["artifact-1"]} includeNativePt={true} onToggleArtifact={() => undefined} onToggleNative={() => undefined} />);

    expect(conversionHtml).toContain("conversion-001");
    expect(conversionHtml).toContain("onnx · fp32");
    expect(conversionHtml).toContain("Export ZIP");
    expect(exportHtml).toContain("Native PT");
    expect(exportHtml).toContain("classes.json");
    expect(exportHtml).toContain("metadata.json");
  });

  it("renders grouped model sources from current, other, and loose output scopes", () => {
    const html = renderToStaticMarkup(
      <ModelSourceSelector
        sources={[
          { id: "a", label: "Current project · best.pt", path: "/app/output_model/project/train/weights/best.pt", relative_path: "project/train/weights/best.pt", scope: "current_project", source_type: "training_run", status: "completed", training_run_id: "train-1", project_id: "project" },
          { id: "b", label: "Other project · other/train/weights/best.pt", path: "/app/output_model/other/train/weights/best.pt", relative_path: "other/train/weights/best.pt", scope: "other_project", source_type: "discovered_output", status: "completed", training_run_id: null, project_id: "other" },
          { id: "c", label: "Loose output_model · best_202507141626.pt", path: "/app/output_model/best_202507141626.pt", relative_path: "best_202507141626.pt", scope: "loose_output", source_type: "discovered_output", status: "completed", training_run_id: null, project_id: null }
        ]}
        value="a"
        onChange={() => undefined}
      />
    );

    expect(html).toContain("Current project models");
    expect(html).toContain("Other project models");
    expect(html).toContain("Loose output_model models");
    expect(html).toContain("best_202507141626.pt");
  });
});

describe("ProjectArtifactContextPanel", () => {
    it("renders project-level artifact counts", () => {
      const html = renderToStaticMarkup(
        <ProjectArtifactContextPanel
          context={{
            project: { id: "p1", name: "Demo", description: "", root_path: "/data/projects/demo" },
            counts: { sources: 1, class_schemas: 2, dataset_splits: 3, training_runs: 4, model_sources: 5, conversion_packages: 6, export_bundles: 7 },
            model_sources: []
          }}
        />
      );

      expect(html).toContain("Project context");
      expect(html).toContain("training runs");
      expect(html).toContain("export bundles");
    });
  });

describe("ProjectStorageStatusCard", () => {
    it("renders a stale cleanup affordance when project storage is missing", () => {
      const html = renderToStaticMarkup(
        <ProjectStorageStatusCard
          status={{ workspace_exists: false, output_index_exists: false, is_stale: true, missing: ["project workspace", "output model index"] }}
          cleaning={false}
          onCleanup={() => undefined}
        />
      );

      expect(html).toContain("Stale project record");
      expect(html).toContain("project workspace");
      expect(html).toContain("Clean stale DB record");
    });

    it("shows healthy storage without cleanup action", () => {
      const html = renderToStaticMarkup(
        <ProjectStorageStatusCard
          status={{ workspace_exists: true, output_index_exists: true, is_stale: false, missing: [] }}
          cleaning={false}
          onCleanup={() => undefined}
        />
      );

      expect(html).toContain("Project storage healthy");
      expect(html).not.toContain("Clean stale DB record");
  });
});

describe("SettingsPage", () => {
  it("renders workflow-oriented settings instead of only raw model lists", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        t={(key) => key}
        models={{
          world_models: ["yoloe-26n-seg.pt", "yolov8s-world.pt"],
          world_model_details: [
            { name: "yoloe-26n-seg.pt", family: "yoloe-26", task: "segment", annotation_output: "bbox", supported: true, reason: null },
            { name: "yolov8s-world.pt", family: "yolo-world", task: "detect", annotation_output: "bbox", supported: true, reason: null }
          ],
          input_models: ["yolov8n.pt"],
          output_models: ["test-v5/runs/train/weights/best.pt"]
        }}
        activeProject={{ id: "p1", name: "test-v5", description: "", root_path: "/app/data/projects/test-v5" }}
        context={{
          project: { id: "p1", name: "test-v5", description: "", root_path: "/app/data/projects/test-v5" },
          counts: { sources: 1, class_schemas: 1, dataset_splits: 2, training_runs: 1, model_sources: 1, conversion_packages: 0, export_bundles: 0 },
          model_sources: []
        }}
      />
    );

    expect(html).toContain("Workflow defaults");
    expect(html).toContain("Pseudo default model");
    expect(html).toContain("Augment default");
    expect(html).toContain("Runtime deployment");
    expect(html).toContain("Desktop x86_64");
    expect(html).toContain("Jetson ARM64");
    expect(html).toContain("registered tailnet devices only");
    expect(html).toContain("./run.sh --tailscale-up");
    expect(html).not.toContain("Tailscale Funnel");
    expect(html).toContain("/app/data/projects/test-v5");
    expect(html).toContain("YOLOE-26 · Seg → bbox");
    expect(html).toContain("YOLO-World · bbox");
  });
});
