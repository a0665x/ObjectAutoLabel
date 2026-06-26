import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Brain,
  Database,
  FolderInput,
  Languages,
  Play,
  Scissors,
  Settings,
  Sparkles,
  SquarePen,
  Upload
} from "lucide-react";
import { api } from "./api/client";
import { translate } from "./i18n";
import { ReviewPage } from "./pages/ReviewPage";
import { shouldProceedWithReviewExit } from "./pages/reviewState";
import type { ClassSchema, Job, Language, ModelLists, Project, SourceAsset } from "./types";

type Page = "projects" | "sources" | "schema" | "pseudo" | "review" | "split" | "train" | "export" | "settings";

const pages: Array<{ id: Page; icon: React.ComponentType<{ size?: number }>; key: string }> = [
  { id: "projects", icon: Database, key: "projects" },
  { id: "sources", icon: FolderInput, key: "sources" },
  { id: "schema", icon: Boxes, key: "schema" },
  { id: "pseudo", icon: Sparkles, key: "pseudo" },
  { id: "review", icon: SquarePen, key: "review" },
  { id: "split", icon: Scissors, key: "split" },
  { id: "train", icon: Brain, key: "train" },
  { id: "export", icon: Upload, key: "export" },
  { id: "settings", icon: Settings, key: "settings" }
];

export function App() {
  const [language, setLanguage] = useState<Language>("en");
  const [page, setPage] = useState<Page>("projects");
  const [root, setRoot] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [reviewDirty, setReviewDirty] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [models, setModels] = useState<ModelLists>({ world_models: [], input_models: [], output_models: [] });
  const t = (key: string) => translate(language, key);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0],
    [activeProjectId, projects]
  );

  async function refresh() {
    const [health, nextProjects, nextJobs, nextModels] = await Promise.all([
      api.health(),
      api.projects(),
      api.jobs(),
      api.models()
    ]);
    setRoot(health.project_root);
    setProjects(nextProjects);
    setJobs(nextJobs);
    setModels(nextModels);
    if (!activeProjectId && nextProjects[0]) setActiveProjectId(nextProjects[0].id);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const timer = window.setInterval(() => {
      api.jobs().then(setJobs).catch(console.error);
    }, 1400);
    return () => window.clearInterval(timer);
  }, []);

  const confirmReviewExit = () => shouldProceedWithReviewExit(page === "review", reviewDirty, window.confirm);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OA</div>
          <div>
            <strong>ObjectAutoLabel</strong>
            <span>{t("localFirst")}</span>
          </div>
        </div>
        <nav className="nav">
          {pages.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={page === item.id ? "active" : ""}
                onClick={() => {
                  if (item.id === page) return;
                  if (!confirmReviewExit()) return;
                  setPage(item.id);
                }}
              >
                <Icon size={18} />
                <span>{t(item.key)}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p>{root || "FastAPI"}</p>
            <h1>{activeProject?.name ?? "ObjectAutoLabel"}</h1>
          </div>
          <div className="top-actions">
            <select
              value={activeProjectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                if (nextProjectId === activeProjectId) return;
                if (!confirmReviewExit()) return;
                setActiveProjectId(nextProjectId);
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <label className="language-select">
              <Languages size={17} />
              <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="en">EN</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </label>
          </div>
        </header>
        <StatusStrip jobs={jobs} t={t} />
        {page === "projects" && <ProjectsPage t={t} refresh={refresh} projects={projects} />}
        {page === "sources" && activeProject && <SourcesPage t={t} project={activeProject} refresh={refresh} />}
        {page === "schema" && activeProject && <SchemaPage t={t} project={activeProject} />}
        {page === "pseudo" && activeProject && <PseudoPage t={t} project={activeProject} models={models} refreshJobs={refresh} />}
        {page === "review" && activeProject && <ReviewPage t={t} project={activeProject} onDirtyChange={setReviewDirty} />}
        {page === "split" && activeProject && <SplitPage t={t} project={activeProject} refreshJobs={refresh} />}
        {page === "train" && activeProject && <TrainPage project={activeProject} models={models} refreshJobs={refresh} t={t} />}
        {page === "export" && activeProject && <ExportPage project={activeProject} refreshJobs={refresh} t={t} />}
        {page === "settings" && <SettingsPage t={t} models={models} />}
      </main>
    </div>
  );
}

function StatusStrip({ jobs, t }: { jobs: Job[]; t: (key: string) => string }) {
  return (
    <section className="status-strip">
      <div>
        <strong>{t("activeJobs")}</strong>
        <span>{jobs.length ? `${jobs[0].name}: ${jobs[0].status}` : "Idle"}</span>
      </div>
      <div className="job-pills">
        {jobs.slice(0, 4).map((job) => (
          <span key={job.id}>
            {job.name} <progress value={job.progress} max={100} />
          </span>
        ))}
      </div>
    </section>
  );
}

function ProjectsPage({ projects, refresh, t }: { projects: Project[]; refresh: () => Promise<void>; t: (key: string) => string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <section className="panel-grid">
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          await api.createProject({ name, description });
          setName("");
          setDescription("");
          await refresh();
        }}
      >
        <h2>{t("createProject")}</h2>
        <input value={name} placeholder={t("newProjectName")} onChange={(event) => setName(event.target.value)} required />
        <textarea value={description} placeholder={t("description")} onChange={(event) => setDescription(event.target.value)} />
        <button className="primary">Create</button>
      </form>
      <div className="list-panel">
        {projects.map((project) => (
          <article key={project.id} className="row-card">
            <strong>{project.name}</strong>
            <span>{project.root_path}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourcesPage({ project, refresh, t }: { project: Project; refresh: () => Promise<void>; t: (key: string) => string }) {
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [kind, setKind] = useState<"video" | "image_folder">("image_folder");
  const [path, setPath] = useState("");
  const [sourceId, setSourceId] = useState("");
  useEffect(() => {
    api.sources(project.id).then(setSources).catch(console.error);
  }, [project.id]);
  return (
    <section className="panel-grid">
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          await api.createSource(project.id, { kind, path });
          setPath("");
          setSources(await api.sources(project.id));
          await refresh();
        }}
      >
        <h2>{t("addSource")}</h2>
        <select value={kind} onChange={(event) => setKind(event.target.value as "video" | "image_folder")}>
          <option value="image_folder">{t("imageFolder")}</option>
          <option value="video">{t("videoPath")}</option>
        </select>
        <input value={path} placeholder="/home/.../images-or-video.mp4" onChange={(event) => setPath(event.target.value)} required />
        <button className="primary">Add</button>
      </form>
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          await api.extractFrames(project.id, {
            source_asset_id: sourceId,
            frames_per_second: Number(new FormData(event.currentTarget).get("fps")),
            resize_enabled: false
          });
          await refresh();
        }}
      >
        <h2>{t("extractFrames")}</h2>
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Select video source</option>
          {sources.filter((source) => source.kind === "video").map((source) => (
            <option key={source.id} value={source.id}>
              {source.path}
            </option>
          ))}
        </select>
        <input name="fps" type="number" min="0.1" step="0.1" defaultValue="2" />
        <button className="primary">Start</button>
      </form>
      <div className="list-panel wide">
        {sources.map((source) => (
          <article key={source.id} className="row-card">
            <strong>{source.kind}</strong>
            <span>{source.path}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function SchemaPage({ project, t }: { project: Project; t: (key: string) => string }) {
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [json, setJson] = useState('[{"class_id":0,"class_name":"object","descriptors":["object"]}]');
  useEffect(() => {
    api.classSchemas(project.id).then(setSchemas).catch(console.error);
  }, [project.id]);
  return (
    <section className="panel-grid">
      <form
        className="panel wide"
        onSubmit={async (event) => {
          event.preventDefault();
          await api.createClassSchema(project.id, { name: "default", classes: JSON.parse(json) });
          setSchemas(await api.classSchemas(project.id));
        }}
      >
        <h2>{t("saveSchema")}</h2>
        <textarea className="code-input" value={json} onChange={(event) => setJson(event.target.value)} />
        <button className="primary">Save</button>
      </form>
      <div className="list-panel">
        {schemas.map((schema) => (
          <article key={schema.id} className="row-card">
            <strong>{schema.name}</strong>
            <span>{schema.classes.map((item) => `${item.class_id}:${item.class_name}`).join(", ")}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function PseudoPage({ project, models, refreshJobs, t }: { project: Project; models: ModelLists; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [worldModel, setWorldModel] = useState("");
  useEffect(() => {
    api.classSchemas(project.id).then((items) => {
      setSchemas(items);
      if (items[0]) setSchemaId(items[0].id);
    });
  }, [project.id]);
  useEffect(() => {
    setWorldModel(models.world_models[0] ?? "yolov8s-world.pt");
  }, [models.world_models]);
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await api.pseudoLabel(project.id, {
          schema_id: schemaId,
          world_model: worldModel,
          confidence: Number(form.get("confidence")),
          iou: Number(form.get("iou"))
        });
        await refreshJobs();
      }}
    >
      <h2>{t("startPseudo")}</h2>
      <select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
        {schemas.map((schema) => (
          <option key={schema.id} value={schema.id}>{schema.name}</option>
        ))}
      </select>
      <select value={worldModel} onChange={(event) => setWorldModel(event.target.value)}>
        {(models.world_models.length ? models.world_models : ["yolov8s-world.pt"]).map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select>
      <div className="field-row">
        <input name="confidence" type="number" min="0" max="1" step="0.01" defaultValue="0.1" />
        <input name="iou" type="number" min="0" max="1" step="0.01" defaultValue="0.7" />
      </div>
      <button className="primary"><Play size={17} />{t("startPseudo")}</button>
    </form>
  );
}

function SplitPage({ project, refreshJobs, t }: { project: Project; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await api.split(project.id, {
          name: form.get("name"),
          train_ratio: Number(form.get("train")),
          val_ratio: Number(form.get("val")),
          test_ratio: Number(form.get("test"))
        });
        await refreshJobs();
      }}
    >
      <h2>{t("buildSplit")}</h2>
      <input name="name" defaultValue="default" />
      <div className="field-row">
        <input name="train" type="number" step="0.05" defaultValue="0.8" />
        <input name="val" type="number" step="0.05" defaultValue="0.1" />
        <input name="test" type="number" step="0.05" defaultValue="0.1" />
      </div>
      <button className="primary">{t("buildSplit")}</button>
    </form>
  );
}

function TrainPage({ project, models, refreshJobs, t }: { project: Project; models: ModelLists; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const [splits, setSplits] = useState<Array<Record<string, unknown>>>([]);
  const [splitId, setSplitId] = useState("");
  const [inputModel, setInputModel] = useState("");
  useEffect(() => {
    api.datasetSplits(project.id).then((items) => {
      setSplits(items);
      if (items[0]?.id) setSplitId(String(items[0].id));
    });
  }, [project.id]);
  useEffect(() => {
    setInputModel(models.input_models[0] ?? "yolov8n.pt");
  }, [models.input_models]);
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await api.train(project.id, {
          dataset_split_id: splitId,
          input_model: inputModel,
          epochs: Number(form.get("epochs")),
          imgsz: Number(form.get("imgsz")),
          batch: Number(form.get("batch")),
          device: form.get("device"),
          patience: Number(form.get("patience")),
          optimizer: form.get("optimizer"),
          lr0: Number(form.get("lr0")),
          lrf: Number(form.get("lrf"))
        });
        await refreshJobs();
      }}
    >
      <h2>{t("train")}</h2>
      <select value={splitId} onChange={(event) => setSplitId(event.target.value)}>
        {splits.map((split) => (
          <option key={String(split.id)} value={String(split.id)}>
            {String(split.name)} · {String(split.dataset_yaml_path)}
          </option>
        ))}
      </select>
      <select value={inputModel} onChange={(event) => setInputModel(event.target.value)}>
        {(models.input_models.length ? models.input_models : ["yolov8n.pt"]).map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select>
      <div className="field-row">
        <input name="epochs" type="number" min="1" defaultValue="100" />
        <input name="imgsz" type="number" min="1" defaultValue="640" />
        <input name="batch" type="number" min="1" defaultValue="16" />
      </div>
      <div className="field-row">
        <select name="device" defaultValue="cuda"><option>cuda</option><option>cpu</option></select>
        <input name="patience" type="number" min="1" defaultValue="10" />
        <select name="optimizer" defaultValue="SGD"><option>SGD</option><option>Adam</option><option>AdamW</option></select>
      </div>
      <div className="field-row">
        <input name="lr0" type="number" min="0" step="0.001" defaultValue="0.01" />
        <input name="lrf" type="number" min="0" step="0.001" defaultValue="0.01" />
      </div>
      <button className="primary"><Play size={17} />{t("train")}</button>
    </form>
  );
}

function ExportPage({ project, refreshJobs, t }: { project: Project; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [trainingRunId, setTrainingRunId] = useState("");
  useEffect(() => {
    api.trainingRuns(project.id).then((items) => {
      setRuns(items);
      if (items[0]?.id) setTrainingRunId(String(items[0].id));
    });
  }, [project.id]);
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await api.exportModel(project.id, {
          training_run_id: trainingRunId,
          export_format: form.get("format"),
          imgsz: Number(form.get("imgsz")),
          int8: form.get("int8") === "on"
        });
        await refreshJobs();
      }}
    >
      <h2>{t("export")}</h2>
      <select value={trainingRunId} onChange={(event) => setTrainingRunId(event.target.value)}>
        {runs.map((run) => (
          <option key={String(run.id)} value={String(run.id)}>
            {String(run.status)} · {String(run.best_model_path ?? run.last_model_path ?? run.id)}
          </option>
        ))}
      </select>
      <select name="format" defaultValue="tflite">
        <option value="tflite">TFLite</option>
        <option value="onnx">ONNX</option>
        <option value="torchscript">TorchScript</option>
      </select>
      <div className="field-row">
        <input name="imgsz" type="number" min="1" defaultValue="640" />
        <label className="check-row"><input name="int8" type="checkbox" defaultChecked />INT8</label>
      </div>
      <button className="primary">{t("export")}</button>
    </form>
  );
}

function SettingsPage({ models, t }: { models: ModelLists; t: (key: string) => string }) {
  return (
    <section className="panel-grid">
      <ModelList title={t("worldModels")} items={models.world_models} />
      <ModelList title={t("inputModels")} items={models.input_models} />
      <ModelList title={t("outputModels")} items={models.output_models} />
    </section>
  );
}

function ModelList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {items.length ? items.map((item) => <span className="file-pill" key={item}>{item}</span>) : <span className="muted">No files</span>}
    </div>
  );
}

function Placeholder({ title, models }: { title: string; models?: string[] }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted">{models?.join(", ") || "Backend endpoints will be connected in the next task."}</p>
    </div>
  );
}
