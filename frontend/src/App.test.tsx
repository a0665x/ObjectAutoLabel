import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AugmentationBuildSummary, AugmentationControlPanel, AugmentationEffectModal, AugmentationPreviewCard, ConversionPackageSummary, ConversionTargetMatrix, ExportPackageSummary, FileManagerShortcuts, HelpTooltip, InferencePreviewCard, ModelSourceSelector, ParameterHelp, ProcessingButton, ProjectArtifactContextPanel, ProjectStorageStatusCard, PseudoDependencyGraph, PseudoGenerateFeedbackPanel, SchemaClassMap, SchemaHistorySelector, SchemaTreeEditorPreview, SettingsPage, TrainingInputSummary, TrainingLossChart, TrainingRunSummary, ValidationRandomButton, WorkflowGuide, WorkflowTimeline, ViewportToggle, buildAugmentationDraftStorageKey, buildTaskCenterItems, chooseLatestBuildSelection, datasetSplitLineageLabel, loadAugmentationDraft, parseTrainingMetrics, reconcileLocalPseudoJob, saveAugmentationDraft, shouldRefreshArtifactsAfterSourceProcessing } from "./App";
import type { AugmentationPreviewSample, FileBrowserShortcut } from "./api/client";
import type { ClassSchema, TrainingRun } from "./types";

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
  it("renders common local data shortcuts with counts and disabled missing paths", () => {
    const shortcuts: FileBrowserShortcut[] = [
      { label: "0629 raw data", path: "/home/a0665x/Desktop/AI_AGX_WS/autolabel/0629", exists: true, match_count: 190, description: "Current unlabeled import folder" },
      { label: "Project input/0629", path: "/home/a0665x/Desktop/AI_AGX_WS/autolabel/ObjectAutoLabel/data/input/0629", exists: false, match_count: 0, description: "Copied working input" }
    ];

    const html = renderToStaticMarkup(<FileManagerShortcuts shortcuts={shortcuts} currentPath="" onSelect={() => undefined} />);

    expect(html).toContain("Common folders");
    expect(html).toContain("0629 raw data");
    expect(html).toContain("190 matches");
    expect(html).toContain("Project input/0629");
    expect(html).toContain("missing");
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
});

describe("dataset build lineage helpers", () => {
  const pseudo = { id: "pseudo-1", run_name: "Pseudo_20260707_v001", schema_name: "person-car", image_count: 10, labeled_count: 8, created_at: "2026-07-07T03:00:00Z" };
  const augment = { id: "aug-1", pseudo_label_run_id: "pseudo-1", name: "Skip source build", source_image_count: 8, created_image_count: 8, output_dir: "/app/data/projects/demo/augmentations/skip", created_at: "2026-07-07T03:10:00Z" };
  const split = { id: "split-1", name: "default", pseudo_label_run_id: "pseudo-1", augmentation_run_id: "aug-1", train_ratio: 0.8, val_ratio: 0.1, test_ratio: 0.1, dataset_yaml_path: "/app/data/projects/demo/splits/default/dataset.yaml", created_at: "2026-07-07T03:20:00Z" };

  it("summarizes an augmentation build with source and generated counts", () => {
    const html = renderToStaticMarkup(<AugmentationBuildSummary run={augment} pseudoRuns={[pseudo]} />);

    expect(html).toContain("Source images");
    expect(html).toContain("8");
    expect(html).toContain("Generated images");
    expect(html).toContain("Skip source build");
    expect(html).toContain("/app/data/projects/demo/augmentations/skip");
  });

  it("labels split and train inputs with pseudo and augment build lineage", () => {
    expect(datasetSplitLineageLabel(split, [pseudo], [augment])).toContain("Pseudo_20260707_v001");
    expect(datasetSplitLineageLabel(split, [pseudo], [augment])).toContain("Skip source build");

    const html = renderToStaticMarkup(<TrainingInputSummary split={split} pseudoRuns={[pseudo]} augmentationRuns={[augment]} />);
    expect(html).toContain("Training input");
    expect(html).toContain("Split build");
    expect(html).toContain("Dataset source");
    expect(html).toContain("Skip source build");
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
  it("uses an English random sampling label instead of Chinese dice copy", () => {
    const html = renderToStaticMarkup(<ValidationRandomButton loading={false} onClick={() => undefined} />);

    expect(html).toContain("Random sample");
    expect(html).not.toContain("骰子");
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

  it("renders ONNX and TFLite precision choices as a conversion matrix", () => {
    const html = renderToStaticMarkup(<ConversionTargetMatrix selected={["onnx:fp32", "tflite:int8"]} onToggle={() => undefined} />);

    expect(html).toContain("ONNX");
    expect(html).toContain("FP32");
    expect(html).toContain("TFLite");
    expect(html).toContain("INT8");
    expect(html).toContain("checked");
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
        models={{ world_models: ["yolov8s-world.pt"], input_models: ["yolov8n.pt"], output_models: ["test-v5/runs/train/weights/best.pt"] }}
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
    expect(html).toContain("/app/data/projects/test-v5");
  });
});
