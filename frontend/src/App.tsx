import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Brain,
  Database,
  Dice5,
  Download,
  Eye,
  FolderInput,
  FolderOpen,
  HelpCircle,
  Languages,
  LoaderCircle,
  PackageCheck,
  Play,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Trash2,
  Upload
} from "lucide-react";
import { api, type AugmentationPreviewSample, type FileBrowserResult, type FileBrowserShortcut, type SourceAnalysis, type SplitSample, type SplitSamples, type ValidationPreviewResult } from "./api/client";
import { translate } from "./i18n";
import { ReviewPage } from "./pages/ReviewPage";
import { shouldProceedWithReviewExit } from "./pages/reviewState";
import type { AugmentationRun, ClassSchema, DatasetSplitRun, Job, Language, ModelConversionRun, ModelLists, ModelSource, Project, ProjectArtifactContext, ProjectStorageStatus, PseudoLabelRun, SourceAsset, TrainingMetric, TrainingRun } from "./types";

type Page = "projects" | "sources" | "schema" | "pseudo" | "review" | "augment" | "split" | "train" | "validate" | "convert" | "export" | "settings";
type ViewportMode = "desktop" | "mobile";

export type ClientTask = { id: string; name: string; status: "running" | "completed"; progress?: number; message?: string; updatedAt: number };
type TaskCenterItem = { id: string; title: string; status: string; progress?: number; message?: string | null; running: boolean };

const pages: Array<{ id: Page; icon: React.ComponentType<{ size?: number }>; key: string }> = [
  { id: "projects", icon: Database, key: "projects" },
  { id: "sources", icon: FolderInput, key: "sources" },
  { id: "pseudo", icon: Sparkles, key: "pseudo" },
  { id: "review", icon: SquarePen, key: "review" },
  { id: "augment", icon: SlidersHorizontal, key: "Augment" },
  { id: "split", icon: Scissors, key: "split" },
  { id: "train", icon: Brain, key: "train" },
  { id: "validate", icon: Eye, key: "Validate" },
  { id: "convert", icon: Boxes, key: "convert" },
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
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientTasks, setClientTasks] = useState<ClientTask[]>([]);
  const [models, setModels] = useState<ModelLists>({ world_models: [], input_models: [], output_models: [] });
  const [workflowContext, setWorkflowContext] = useState<ProjectArtifactContext | null>(null);
  const [artifactRevision, setArtifactRevision] = useState(0);
  const observedJobStates = useRef(new Map<string, string>());
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
    if (!activeProjectId && nextProjects[0]) {
      setActiveProjectId(nextProjects[0].id);
    } else if (activeProjectId && !nextProjects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(nextProjects[0]?.id ?? "");
    }
  }

  async function refreshProjectArtifacts(projectId = activeProject?.id) {
    if (!projectId) {
      setWorkflowContext(null);
      return;
    }
    const context = await api.artifactContext(projectId);
    setWorkflowContext(context);
    setArtifactRevision((revision) => revision + 1);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const timer = window.setInterval(() => {
      api.jobs().then(setJobs).catch(console.error);
    }, 1400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeProject?.id) {
      setWorkflowContext(null);
      return;
    }
    let ignore = false;
    const load = () => {
      api.artifactContext(activeProject.id)
        .then((context) => { if (!ignore) setWorkflowContext(context); })
        .catch(() => { if (!ignore) setWorkflowContext(null); });
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => { ignore = true; window.clearInterval(timer); };
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject?.id) return;
    let ignore = false;
    api.artifactContext(activeProject.id)
      .then((context) => { if (!ignore) setWorkflowContext(context); })
      .catch(() => { if (!ignore) setWorkflowContext(null); });
    return () => { ignore = true; };
  }, [activeProject?.id, jobs.map((job) => `${job.id}:${job.status}:${job.progress}`).join("|")]);

  useEffect(() => {
    if (!activeProject?.id) return;
    let changedArtifactJob = false;
    for (const job of jobs) {
      if (!jobBelongsToActiveProject(job, activeProject.id)) continue;
      const previous = observedJobStates.current.get(job.id);
      observedJobStates.current.set(job.id, job.status);
      if (previous && previous !== job.status && ["completed", "failed"].includes(job.status)) {
        changedArtifactJob = ["pseudo_label", "augmentation", "dataset_split", "training", "model_conversion", "model_export_bundle", "model_export", "source_analysis", "frame_extraction"].includes(job.name) || changedArtifactJob;
      }
    }
    if (changedArtifactJob) {
      setArtifactRevision((revision) => revision + 1);
      refreshProjectArtifacts(activeProject.id).catch(console.error);
    }
  }, [activeProject?.id, jobs]);

  useEffect(() => {
    const onTaskUpdate = (event: Event) => {
      const detail = (event as CustomEvent<Omit<ClientTask, "updatedAt">>).detail;
      if (!detail?.id || !detail.name) return;
      setClientTasks((current) => {
        const nextTask: ClientTask = { ...detail, updatedAt: Date.now() };
        const without = current.filter((task) => task.id !== detail.id);
        return [nextTask, ...without].slice(0, 8);
      });
    };
    window.addEventListener("object-autolabel-task", onTaskUpdate as EventListener);
    const cleanup = window.setInterval(() => {
      const now = Date.now();
      setClientTasks((current) => current.filter((task) => task.status === "running" || now - task.updatedAt < 7000));
    }, 1800);
    return () => {
      window.removeEventListener("object-autolabel-task", onTaskUpdate as EventListener);
      window.clearInterval(cleanup);
    };
  }, []);

  const confirmReviewExit = () => shouldProceedWithReviewExit(page === "review", reviewDirty, window.confirm);
  const navigateToPage = (nextPage: Page) => {
    if (nextPage === page) return;
    if (!confirmReviewExit()) return;
    setPage(nextPage);
  };

  return (
    <div className={`app-shell viewport-${viewportMode}`}>
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
                  navigateToPage(item.id);
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
            <ViewportToggle mode={viewportMode} onChange={setViewportMode} />
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
        <WorkflowGuide
          jobs={jobs}
          activeProjectId={activeProject?.id}
          currentPage={page}
          facts={workflowContext ? {
            sourceCount: workflowContext.counts.sources,
            sourceImageCount: workflowContext.counts.source_images,
            pseudoLabelRunCount: workflowContext.counts.pseudo_label_runs,
            augmentationRunCount: workflowContext.counts.augmentation_runs,
            splitCount: workflowContext.counts.dataset_splits,
            trainingRunCount: workflowContext.counts.training_runs,
            conversionPackageCount: workflowContext.counts.conversion_packages,
            exportBundleCount: workflowContext.counts.export_bundles
          } : undefined}
          onNavigate={navigateToPage}
        />
        {page === "projects" && <ProjectsPage t={t} refresh={refresh} projects={projects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} jobs={jobs} />}
        {page === "sources" && activeProject && <SourcesPage t={t} project={activeProject} refresh={refresh} refreshArtifacts={() => refreshProjectArtifacts(activeProject.id)} />}
        {page === "schema" && activeProject && <SchemaPage t={t} project={activeProject} />}
        {page === "pseudo" && activeProject && <PseudoPage t={t} project={activeProject} models={models} jobs={jobs} refreshJobs={refresh} />}
        {page === "review" && activeProject && <ReviewPage t={t} project={activeProject} onDirtyChange={setReviewDirty} />}
        {page === "augment" && activeProject && <AugmentationPage project={activeProject} jobs={jobs} refreshJobs={refresh} artifactRevision={artifactRevision} />}
        {page === "split" && activeProject && <SplitPage t={t} project={activeProject} jobs={jobs} refreshJobs={refresh} artifactRevision={artifactRevision} />}
        {page === "train" && activeProject && <TrainPage project={activeProject} models={models} jobs={jobs} refreshJobs={refresh} t={t} artifactRevision={artifactRevision} />}
        {page === "validate" && activeProject && <ValidationPage project={activeProject} models={models} artifactRevision={artifactRevision} />}
        {page === "convert" && activeProject && <ModelConvertPage project={activeProject} jobs={jobs} refreshJobs={refresh} />}
        {page === "export" && activeProject && <ExportPage project={activeProject} jobs={jobs} refreshJobs={refresh} t={t} />}
        {page === "settings" && <SettingsPage t={t} models={models} activeProject={activeProject} context={workflowContext} />}
      </main>
      <TaskCenter jobs={jobs} clientTasks={clientTasks} activeProjectId={activeProject?.id} />
    </div>
  );
}

export function ViewportToggle({ mode, onChange }: { mode: ViewportMode; onChange: (mode: ViewportMode) => void }) {
  return (
    <div className="viewport-toggle" role="group" aria-label="Viewport mode" title="Toggle Desktop/Mobile preview width">
      {(["desktop", "mobile"] as ViewportMode[]).map((option) => (
        <button
          key={option}
          type="button"
          className={mode === option ? "active" : ""}
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
        >
          {option === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}

export function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="help-tooltip" tabIndex={0} role="img" aria-label={`Help: ${text}`} title={text}>
      <HelpCircle size={14} aria-hidden="true" />
      <span className="help-tooltip-mark">?</span>
      <span className="help-tooltip-card">{text}</span>
    </span>
  );
}

export function isActiveJob(job?: Job) {
  return Boolean(job && !["completed", "failed", "cancelled"].includes(String(job.status)));
}

function findWorkflowJob(jobs: Job[], name: string) {
  return jobs.find((job) => job.name === name && isActiveJob(job)) ?? jobs.find((job) => job.name === name);
}

function jobProjectId(job: Job) {
  const resultProjectId = job.result && typeof job.result === "object" && "project_id" in job.result ? String(job.result.project_id ?? "") : "";
  return job.project_id || resultProjectId || "";
}

function jobBelongsToActiveProject(job: Job, activeProjectId?: string) {
  if (!activeProjectId) return true;
  return jobProjectId(job) === activeProjectId;
}

export function ProcessingButton({ busy, children, className = "primary", progress, statusText, taskName, disabled = false }: { busy: boolean; children: React.ReactNode; className?: string; progress?: number; statusText?: string; taskName?: string; disabled?: boolean }) {
  const cleanProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined;
  const wasBusy = useRef(false);
  useEffect(() => {
    if (!taskName) {
      wasBusy.current = busy;
      return;
    }
    if (busy) {
      window.dispatchEvent(new CustomEvent("object-autolabel-task", {
        detail: { id: taskName, name: taskName, status: "running", progress: cleanProgress, message: statusText || "Working…" }
      }));
    } else if (wasBusy.current) {
      window.dispatchEvent(new CustomEvent("object-autolabel-task", {
        detail: { id: taskName, name: taskName, status: "completed", progress: 100, message: statusText || "Done" }
      }));
    }
    wasBusy.current = busy;
  }, [busy, cleanProgress, statusText, taskName]);
  return (
    <button className={`${className} touch-feedback processing-button ${busy ? "is-processing" : ""}`} disabled={busy || disabled} aria-busy={busy}>
      {busy ? <LoaderCircle className="spin" size={17} /> : null}
      <span className="processing-button-label">{busy ? (statusText || "Working…") : children}</span>
      {busy && cleanProgress !== undefined ? <span className="processing-percent">{cleanProgress}%</span> : null}
      {busy && cleanProgress !== undefined ? <span className="processing-meter" aria-hidden="true"><span style={{ width: `${cleanProgress}%` }} /></span> : null}
    </button>
  );
}

function clientTaskBackendName(task: ClientTask) {
  const label = `${task.id} ${task.name}`.toLowerCase();
  if (label.includes("pseudo label")) return "pseudo_label";
  if (label.includes("extract frame")) return "frame_extraction";
  if (label.includes("dataset split")) return "dataset_split";
  if (label.includes("augmentation")) return "augmentation";
  if (label.includes("training")) return "training";
  if (label.includes("conversion")) return "model_conversion";
  if (label.includes("export")) return "model_export_bundle";
  return null;
}

function buildTaskCenterState({ jobs, clientTasks, activeProjectId, expanded }: { jobs: Job[]; clientTasks: ClientTask[]; activeProjectId?: string; expanded: boolean }): { items: TaskCenterItem[]; activeCount: number } {
  const relevantJobs = jobs.filter((job) => jobBelongsToActiveProject(job, activeProjectId));
  const serverJobNames = new Set(relevantJobs.map((job) => job.name));
  const dedupedClientTasks = clientTasks.filter((task) => {
    const backendName = clientTaskBackendName(task);
    return !backendName || !serverJobNames.has(backendName);
  });
  const activeJobs = relevantJobs.filter(isActiveJob);
  const visibleJobs = (activeJobs.length ? activeJobs : relevantJobs).slice(0, expanded ? 5 : 2);
  const runningClientTasks = dedupedClientTasks.filter((task) => task.status === "running");
  const visibleClientTasks = (runningClientTasks.length ? runningClientTasks : dedupedClientTasks).slice(0, expanded ? 3 : 1);
  const clientItems = visibleClientTasks.map((task) => ({
    id: `client-${task.id}`,
    title: task.name,
    status: task.status,
    progress: task.progress,
    message: task.message,
    running: task.status === "running"
  }));
  const jobItems = visibleJobs.map((job) => ({
    id: job.id,
    title: humanJobName(job.name),
    status: job.status,
    progress: job.progress,
    message: job.message || job.error,
    running: isActiveJob(job)
  }));
  return {
    items: [...clientItems, ...jobItems],
    activeCount: activeJobs.length + runningClientTasks.length
  };
}

export function buildTaskCenterItems(args: { jobs: Job[]; clientTasks: ClientTask[]; activeProjectId?: string; expanded: boolean }): TaskCenterItem[] {
  return buildTaskCenterState(args).items;
}

function TaskCenter({ jobs, clientTasks, activeProjectId }: { jobs: Job[]; clientTasks: ClientTask[]; activeProjectId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { items, activeCount } = buildTaskCenterState({ jobs, clientTasks, activeProjectId, expanded });
  const hasTasks = items.length > 0;
  useEffect(() => {
    if (activeCount > 0) setExpanded(true);
  }, [activeCount]);
  if (!hasTasks) return null;
  return (
    <aside className={`task-center ${expanded ? "is-expanded" : "is-collapsed"}`} aria-label="Task center">
      <button type="button" className="task-center-header" onClick={() => setExpanded((value) => !value)} title="Click to expand or collapse task details">
        <span className={`task-pulse ${activeCount ? "is-live" : ""}`} />
        <strong>Task Center</strong>
        <small>{activeCount ? `${activeCount} running` : "latest runs"}</small>
      </button>
      {expanded && <div className="task-center-list">
        {items.map((item) => <TaskToast key={item.id} title={item.title} status={item.status} progress={item.progress} message={item.message} />)}
      </div>}
    </aside>
  );
}

function humanJobName(name: string) {
  return name.split("_").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function TaskToast({ title, status, progress, message }: { title: string; status: string; progress?: number; message?: string | null }) {
  const cleanProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined;
  const isRunning = !["completed", "failed", "cancelled"].includes(status);
  return (
    <article className={`task-toast task-${status}`}>
      <div className="task-toast-top">
        <span className="task-icon">{isRunning ? <LoaderCircle className="spin" size={15} /> : status === "failed" ? "!" : "✓"}</span>
        <div>
          <strong>{title}</strong>
          <small>{status}{cleanProgress !== undefined ? ` · ${cleanProgress}%` : ""}</small>
        </div>
      </div>
      {message ? <p>{message}</p> : null}
      {cleanProgress !== undefined ? <div className="task-meter" aria-label={`${title} progress ${cleanProgress}%`}><span style={{ width: `${cleanProgress}%` }} /></div> : null}
    </article>
  );
}

type WorkflowStep = { page: Page; name: string; jobNames: string[]; hint: string; optional?: boolean };
type WorkflowFacts = { sourceCount?: number; sourceImageCount?: number; pseudoLabelRunCount?: number; augmentationRunCount?: number; splitCount?: number; trainingRunCount?: number; conversionPackageCount?: number; exportBundleCount?: number };

const workflowSteps: WorkflowStep[] = [
  { page: "projects", name: "Project", jobNames: [], hint: "Create or assign a workspace." },
  { page: "sources", name: "Source", jobNames: ["source_analysis", "frame_extraction"], hint: "Add image folder/video and run Process & analysis." },
  { page: "pseudo", name: "Pseudo", jobNames: ["pseudo_label"], hint: "Assign schema, tune prompts, then generate pseudo labels." },
  { page: "review", name: "Review", jobNames: [], hint: "Optional spot-check. All labeled images remain trainable even if review is incomplete.", optional: true },
  { page: "augment", name: "Augment", jobNames: ["augmentation"], hint: "Optional: preview transforms before split.", optional: true },
  { page: "split", name: "Split", jobNames: ["dataset_split"], hint: "Build train/validation/test dataset.yaml." },
  { page: "train", name: "Train", jobNames: ["training"], hint: "Select split/model and start training." },
  { page: "validate", name: "Validate", jobNames: ["validation"], hint: "Randomly sample images and inspect model predictions.", optional: true },
  { page: "convert", name: "Convert", jobNames: ["model_conversion"], hint: "Create ONNX/TFLite packages with schema metadata.", optional: true },
  { page: "export", name: "Export", jobNames: ["model_export_bundle", "model_export"], hint: "Export a selected conversion package.", optional: true }
];

function workflowFactDone(step: WorkflowStep, facts?: WorkflowFacts) {
  if (!facts) return false;
  if (step.page === "sources") return (facts.sourceCount ?? 0) > 0 || (facts.sourceImageCount ?? 0) > 0;
  if (step.page === "pseudo") return (facts.pseudoLabelRunCount ?? 0) > 0;
  if (step.page === "augment") return (facts.augmentationRunCount ?? 0) > 0;
  if (step.page === "split") return (facts.splitCount ?? 0) > 0;
  if (step.page === "train") return (facts.trainingRunCount ?? 0) > 0;
  if (step.page === "convert") return (facts.conversionPackageCount ?? 0) > 0;
  if (step.page === "export") return (facts.exportBundleCount ?? 0) > 0;
  return false;
}

export function WorkflowGuide({ jobs, activeProjectId, currentPage, facts, onNavigate }: { jobs: Job[]; activeProjectId?: string; currentPage: Page; facts?: WorkflowFacts; onNavigate?: (page: Page) => void }) {
  const projectJobs = jobs.filter((job) => jobBelongsToActiveProject(job, activeProjectId));
  const stepStates = workflowSteps.map((step) => {
    const stepJobs = projectJobs.filter((job) => step.jobNames.includes(job.name));
    const running = stepJobs.find(isActiveJob);
    const completed = stepJobs.find((job) => job.status === "completed");
    const failed = stepJobs.find((job) => job.status === "failed");
    const factDone = workflowFactDone(step, facts);
    const status = step.page === "projects" && activeProjectId ? "done" : running ? "running" : failed ? "failed" : completed || factDone ? "done" : step.page === currentPage ? "current" : step.optional ? "optional" : "missing";
    const job = running ?? completed ?? failed;
    return { ...step, status, job };
  });
  const nextStep = stepStates.find((step) => step.status === "current") ?? stepStates.find((step) => step.status === "failed") ?? stepStates.find((step) => step.status === "missing");
  const runningStep = stepStates.find((step) => step.status === "running");
  return (
    <section className="workflow-guide" aria-label="Workflow guide">
      <div className="workflow-guide-summary">
        <strong>{runningStep ? `${runningStep.name} is running` : nextStep ? `Next: ${nextStep.name}` : "Core workflow ready"}</strong>
        <span>{runningStep?.job?.message || nextStep?.hint || "Optional review/augmentation/validation steps can still be opened."}</span>
      </div>
      <div className="workflow-steps">
        {stepStates.map((step, index) => {
          const statusText = step.status === "done" ? "Done" : step.status === "running" ? `${step.job?.progress ?? 0}% running` : step.status === "failed" ? "Needs attention" : step.status === "current" ? "You are here" : step.status === "optional" ? "Spot-check" : "Not done yet";
          const content = <><span className="workflow-step-index">{index + 1}</span><div><strong>{step.name}</strong><small>{statusText}</small></div></>;
          return onNavigate ? (
            <button key={step.name} type="button" className={`workflow-step step-${step.status}`} title={`${step.hint} Click to open this tab. Running backend jobs continue if you navigate away; unsaved Review edits will ask for confirmation.`} onClick={() => onNavigate(step.page)}>
              {content}
            </button>
          ) : (
            <article key={step.name} className={`workflow-step step-${step.status}`} title={step.hint}>{content}</article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectsPage({ projects, refresh, t, activeProjectId, setActiveProjectId, jobs }: { projects: Project[]; refresh: () => Promise<void>; t: (key: string) => string; activeProjectId: string; setActiveProjectId: (id: string) => void; jobs: Job[] }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState<ProjectArtifactContext | null>(null);
  const [storageStatuses, setStorageStatuses] = useState<Record<string, ProjectStorageStatus>>({});
  const [cleaningProjectId, setCleaningProjectId] = useState("");
  const active = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const projectJobs = jobs.filter((job) => !active?.id || job.project_id === active.id);
  useEffect(() => {
    if (!active?.id) {
      setContext(null);
      return;
    }
    api.artifactContext(active.id).then(setContext).catch(console.error);
  }, [active?.id, jobs.length]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function loadStorageStatuses() {
      if (!projects.length) {
        if (!cancelled) setStorageStatuses({});
        return;
      }
      const pairs = await Promise.all(
        projects.map(async (project) => {
          try {
            return [project.id, await api.projectStorageStatus(project.id)] as const;
          } catch (error) {
            console.error(error);
            return [project.id, undefined] as const;
          }
        })
      );
      if (!cancelled) {
        setStorageStatuses(Object.fromEntries(pairs.filter(([, status]) => status)) as Record<string, ProjectStorageStatus>);
      }
    }
    loadStorageStatuses().catch(console.error);
    timer = window.setInterval(() => {
      loadStorageStatuses().catch(console.error);
    }, 5000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [projects]);
  async function cleanupStaleProject(project: Project) {
    if (!window.confirm(`Clean stale DB record for ${project.name}? This removes DB rows and job history only. Raw data/input is kept.`)) return;
    setCleaningProjectId(project.id);
    try {
      await api.cleanupStaleProject(project.id);
      if (activeProjectId === project.id) setActiveProjectId("");
      await refresh();
    } finally {
      setCleaningProjectId("");
    }
  }
  return (
    <section className="panel-grid">
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const project = await api.createProject({ name, description });
          setName("");
          setDescription("");
          setActiveProjectId(project.id);
          await refresh();
        }}
      >
        <h2>{t("createProject")}</h2>
        <p className="muted">Create a named workspace, then assign/switch to it from the project cards below.</p>
        <input value={name} placeholder={t("newProjectName")} onChange={(event) => setName(event.target.value)} required />
        <textarea value={description} placeholder={t("description")} onChange={(event) => setDescription(event.target.value)} />
        <button className="primary action-create">Create project</button>
      </form>
      <div className="list-panel">
        <h2>Assign / switch project</h2>
        {projects.map((project) => (
          <article key={project.id} className={`row-card ${active?.id === project.id ? "is-selected" : ""} ${storageStatuses[project.id]?.is_stale ? "is-stale" : ""}`}>
            <strong>{project.name}</strong>
            <span>{project.description || "No description"}</span>
            <span>{project.root_path}</span>
            <ProjectStorageStatusCard status={storageStatuses[project.id]} cleaning={cleaningProjectId === project.id} onCleanup={() => cleanupStaleProject(project)} />
            <div className="inline-actions">
              <button className="secondary action-assign" type="button" onClick={() => setActiveProjectId(project.id)}>Assign active</button>
              <button className="secondary danger action-delete" type="button" onClick={async () => { if (window.confirm(`Delete project package ${project.name}? This removes its project workspace, labels, YAML, models, exports, and DB rows. Raw data/input is kept.`)) { await api.deleteProject(project.id); await refresh(); } }}><Trash2 size={16} />Delete project package</button>
            </div>
          </article>
        ))}
      </div>
      {active && <div className="panel wide"><h2>Project history</h2><p className="muted">Active project: {active.name} · created {active.created_at ?? "unknown"}</p>{context && <ProjectArtifactContextPanel context={context} />}<WorkflowTimeline jobs={projectJobs} /></div>}
    </section>
  );
}

export function ProjectStorageStatusCard({ status, cleaning, onCleanup }: { status?: ProjectStorageStatus; cleaning: boolean; onCleanup: () => void }) {
  if (!status) {
    return <div className="storage-status storage-status-loading">Checking project storage…</div>;
  }
  if (!status.is_stale) {
    return <div className="storage-status storage-status-healthy">Project storage healthy · workspace and model index exist.</div>;
  }
  return (
    <div className="storage-status storage-status-stale" role="alert">
      <strong>Stale project record</strong>
      <span>DB still has this project, but storage is missing: {status.missing.join(", ") || "unknown"}.</span>
      <button type="button" className="secondary warning" disabled={cleaning} onClick={onCleanup}>
        {cleaning ? <><LoaderCircle size={14} className="spin" />Cleaning…</> : "Clean stale DB record"}
      </button>
      <small>Only DB rows/job history and broken output_model index are cleaned. data/input is kept.</small>
    </div>
  );
}

export function ProjectArtifactContextPanel({ context }: { context: ProjectArtifactContext }) {
  const countItems = [
    ["sources", context.counts.sources],
    ["class schemas", context.counts.class_schemas],
    ["dataset splits", context.counts.dataset_splits],
    ["training runs", context.counts.training_runs],
    ["model sources", context.counts.model_sources],
    ["conversion packages", context.counts.conversion_packages],
    ["export bundles", context.counts.export_bundles]
  ];
  return (
    <section className="artifact-context-panel">
      <h3>Project context</h3>
      <div className="artifact-count-grid">
        {countItems.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}
      </div>
      <div className="context-model-list">
        <strong>Completed model sources</strong>
        {context.model_sources.length ? context.model_sources.slice(0, 8).map((source) => (
          <p key={source.id}><span>{source.label}</span><small>{source.relative_path}</small></p>
        )) : <p className="muted">No completed model sources yet.</p>}
      </div>
    </section>
  );
}

export function WorkflowTimeline({ jobs }: { jobs: Job[] }) {
  return (
    <div className="timeline"><h3>Processing timeline</h3>{jobs.length ? jobs.map((job) => <article key={job.id} className={`timeline-item status-${job.status}`}><strong>{job.name}</strong><span>{job.status} · {job.progress}% · {job.message}</span><progress value={job.progress} max={100} /></article>) : <p className="muted">No processing history for this project yet.</p>}</div>
  );
}

export function shouldRefreshArtifactsAfterSourceProcessing(result: { sourceId?: string | null; imageCount?: number | null }) {
  return Boolean(result.sourceId) || Number(result.imageCount ?? 0) > 0;
}

function SourcesPage({ project, refresh, refreshArtifacts, t }: { project: Project; refresh: () => Promise<void>; refreshArtifacts: () => Promise<void>; t: (key: string) => string }) {
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [kind, setKind] = useState<"video" | "image_folder">("image_folder");
  const [path, setPath] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [analysis, setAnalysis] = useState<SourceAnalysis | null>(null);
  const [processingSource, setProcessingSource] = useState(false);
  const [sourceProgress, setSourceProgress] = useState(0);
  const [sourceStep, setSourceStep] = useState("");
  const [extractingFrames, setExtractingFrames] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractStep, setExtractStep] = useState("");
  useEffect(() => {
    api.sources(project.id).then(setSources).catch(console.error);
  }, [project.id]);
  const videoSources = sources.filter((source) => source.kind === "video");
  return (
    <section className="panel-grid">
      {showBrowser && <FileManagerDialog mode={kind} initialPath={path} onClose={() => setShowBrowser(false)} onSelect={(nextPath) => { setPath(nextPath); setShowBrowser(false); }} />}
      <form
        className="panel wide"
        onSubmit={async (event) => {
          event.preventDefault();
          setProcessingSource(true);
          setSourceProgress(8);
          setSourceStep("Registering source path…");
          setAnalysis(null);
          try {
            const source = await api.createSource(project.id, { kind, path });
            setSourceProgress(38);
            setSourceStep("Refreshing source list…");
            setPath("");
            setSources(await api.sources(project.id));
            setSourceProgress(68);
            setSourceStep("Analyzing image count, extensions and dimensions…");
            setAnalysis(await api.sourceAnalysis(project.id, { source_asset_id: source.id }));
            setSourceProgress(92);
            setSourceStep("Updating project timeline…");
            await refresh();
            if (shouldRefreshArtifactsAfterSourceProcessing({ sourceId: source.id })) {
              await refreshArtifacts();
            }
            setSourceProgress(100);
            setSourceStep("Analysis complete.");
          } finally {
            window.setTimeout(() => { setProcessingSource(false); setSourceProgress(0); setSourceStep(""); }, 250);
          }
        }}
      >
        <h2>{t("addSource")}</h2>
        <div className="segmented-control source-toggle" role="group" aria-label="Source type">
          <button type="button" className={kind === "image_folder" ? "is-active" : ""} onClick={() => setKind("image_folder")}>Image folder</button>
          <button type="button" className={kind === "video" ? "is-active" : ""} onClick={() => setKind("video")}>Video</button>
        </div>
        <p className="muted">Image folder registers jpg/png/jpeg/bmp/webp files. Video accepts mp4/webm/mov/mkv and then exposes frame extraction settings.</p>
        <div className="field-row"><input value={path} placeholder={kind === "image_folder" ? "/home/.../folder-with-jpg-png" : "/home/.../video.mp4"} onChange={(event) => setPath(event.target.value)} required /><button className="secondary action-browse" type="button" onClick={() => setShowBrowser(true)}><FolderOpen size={16} />Browse</button></div>
        <ProcessingButton busy={processingSource} progress={sourceProgress} statusText={sourceStep || "Processing source…"} taskName="Source analysis" className="primary action-process"><Play size={17} />Process & analysis</ProcessingButton>
        {processingSource && <p className="inline-feedback">{sourceProgress}% · {sourceStep || "Reading files and calculating counts/sizes…"}</p>}
      </form>
      {kind === "video" && <form className="panel" onSubmit={async (event) => { event.preventDefault(); setExtractingFrames(true); setExtractProgress(10); setExtractStep("Submitting frame extraction job…"); try { const form = new FormData(event.currentTarget); await api.extractFrames(project.id, { source_asset_id: sourceId, frames_per_second: Number(form.get("fps")), resize_enabled: form.get("resize") === "on", resize_width: Number(form.get("width") || 0) || null, resize_height: Number(form.get("height") || 0) || null }); setExtractProgress(75); setExtractStep("Refreshing project jobs…"); await refresh(); setExtractProgress(100); setExtractStep("Frame extraction accepted."); } finally { window.setTimeout(() => { setExtractingFrames(false); setExtractProgress(0); setExtractStep(""); }, 250); } }}>
        <h2>{t("extractFrames")}</h2>
        <label><span>Video source</span><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Select video source</option>{videoSources.map((source) => <option key={source.id} value={source.id}>{source.path}</option>)}</select></label>
        <label title="Frames per second to sample from the video. 1 means one image per second; 5 is denser and creates more training images."><span>Extract FPS</span><input name="fps" type="number" min="0.1" step="0.1" defaultValue="2" /></label>
        <label className="check-row" title="Resize extracted frames to a fixed width/height if the raw video is too large or inconsistent."><input name="resize" type="checkbox" />Resize extracted frames</label>
        <div className="field-row"><label title="Output image width after resize."><span>Resize width</span><input name="width" type="number" min="1" placeholder="1280" /></label><label title="Output image height after resize."><span>Resize height</span><input name="height" type="number" min="1" placeholder="720" /></label></div>
        <ProcessingButton busy={extractingFrames} progress={extractProgress} statusText={extractStep || "Extracting frames…"} taskName="Extract frames" className="primary action-process">Extract frames</ProcessingButton>
      </form>}
      <div className="list-panel">
        <h2>Dataset analysis</h2>
        {analysis ? <SourceAnalysisPanel analysis={analysis} /> : <p className="muted">Press Process & analysis to register the source and show image count, dimensions, extensions, and size distribution.</p>}
      </div>
      <div className="list-panel wide">
        <h2>Source history</h2>
        {sources.map((source) => <article key={source.id} className="row-card"><strong>{source.kind}</strong><span>{source.path}</span><button type="button" className="secondary action-analyze" onClick={async () => setAnalysis(await api.sourceAnalysis(project.id, { source_asset_id: source.id }))}>Analyze this source</button></article>)}
      </div>
    </section>
  );
}

function SourceAnalysisPanel({ analysis }: { analysis: SourceAnalysis }) {
  return <div className="analysis-grid"><div className="stat-tile"><strong>{analysis.image_count}</strong><span>registered images</span></div><div className="stat-tile"><strong>{analysis.known_dimensions}</strong><span>known dimensions</span></div><div className="stat-tile"><strong>{analysis.min_width}–{analysis.max_width}</strong><span>width range</span></div><div className="stat-tile"><strong>{analysis.min_height}–{analysis.max_height}</strong><span>height range</span></div><div className="wide muted">Extensions: {Object.entries(analysis.extensions).map(([key, value]) => `${key}:${value}`).join(", ") || "none"}</div><div className="wide muted">Common sizes: {analysis.top_sizes.map(([key, value]) => `${key} (${value})`).join(", ") || "none"}</div></div>;
}

export function FileManagerShortcuts({ shortcuts, currentPath, onSelect }: { shortcuts: FileBrowserShortcut[]; currentPath: string; onSelect: (path: string) => void }) {
  if (!shortcuts.length) return null;
  return (
    <section className="file-shortcuts" aria-label="Common folders">
      <h3>Common folders</h3>
      <div className="shortcut-grid">
        {shortcuts.map((shortcut) => {
          const active = shortcut.path === currentPath;
          return (
            <button
              key={`${shortcut.label}-${shortcut.path}`}
              type="button"
              className={`shortcut-card ${active ? "is-active" : ""}`}
              disabled={!shortcut.exists}
              title={shortcut.description}
              onClick={() => onSelect(shortcut.path)}
            >
              <strong>{shortcut.label}</strong>
              <span>{shortcut.exists ? shortcut.path : "missing"}</span>
              <small>{shortcut.exists ? `${shortcut.match_count} matches` : "missing"}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FileManagerDialog({ mode, initialPath, onSelect, onClose }: { mode: "video" | "image_folder"; initialPath: string; onSelect: (path: string) => void; onClose: () => void }) {
  const [browser, setBrowser] = useState<FileBrowserResult | null>(null);
  const [path, setPath] = useState(initialPath);
  useEffect(() => { api.fileBrowser(path, mode).then((result) => { setBrowser(result); if (!path) setPath(result.path); }).catch(console.error); }, [path, mode]);
  return <div className="modal-backdrop"><div className="file-manager"><div className="sidebar-header"><div><h2>File manager</h2><p className="muted">Choose {mode === "image_folder" ? "a folder containing jpg/png images" : "an mp4/webm/mov video file"} from this device.</p></div><button className="secondary action-neutral" type="button" onClick={onClose}>Close</button></div><FileManagerShortcuts shortcuts={browser?.shortcuts ?? []} currentPath={browser?.path ?? path} onSelect={setPath} /><div className="field-row"><input value={path} onChange={(event) => setPath(event.target.value)} /><button type="button" className="secondary action-browse" onClick={() => api.fileBrowser(path, mode).then((result) => { setBrowser(result); setPath(result.path); })}>Go</button></div>{browser?.parent && <button type="button" className="secondary action-browse" onClick={() => setPath(browser.parent || path)}>.. parent</button>}{mode === "image_folder" && browser && browser.current_match_count > 0 && <button type="button" className="primary action-assign" onClick={() => onSelect(browser.path)}>Use this folder ({browser.current_match_count} images)</button>}<div className="file-list">{browser?.entries.map((entry) => <button key={entry.path} type="button" className={entry.selectable ? "file-row selectable" : "file-row"} onClick={() => entry.kind === "directory" && !entry.selectable ? setPath(entry.path) : entry.selectable ? onSelect(entry.path) : undefined}><strong>{entry.kind === "directory" ? "📁" : mode === "image_folder" ? "🖼️" : "🎞️"} {entry.name}</strong><span>{entry.match_count} matching {mode === "image_folder" ? "images" : "videos"}</span></button>)}</div></div></div>;
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
        <button className="primary action-save">Save</button>
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

function SchemaHierarchy({ schema }: { schema?: ClassSchema }) {
  if (!schema) return <p className="muted">Select or save a schema to preview YOLO-World prompt groups.</p>;
  return (
    <div className="schema-hierarchy">
      {schema.classes.map((item) => (
        <article key={item.class_id} className="schema-class-card">
          <strong>{item.class_name} (id:{item.class_id})</strong>
          <ul>
            {(item.descriptors.length ? item.descriptors : [item.class_name]).map((descriptor) => (
              <li key={descriptor}>{descriptor}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function PseudoDependencyGraph({ schema: _schema, worldModel: _worldModel, mergeBoxes: _mergeBoxes, hasRun: _hasRun = true }: { schema?: ClassSchema; worldModel: string; mergeBoxes: boolean; hasRun?: boolean }) {
  return null;
}

export function SchemaTreeEditorPreview({ classes }: { classes: ClassSchema["classes"] }) {
  return (
    <div className="schema-edit-tree" aria-label="editable schema tree">
      {classes.map((item) => (
        <article key={`${item.class_id}-${item.class_name}`} className="schema-edit-node">
          <div className="schema-edit-class-line">
            <span className="class-id-chip">id {item.class_id}</span>
            <strong>class · {item.class_name}</strong>
          </div>
          <div className="schema-edit-branch">
            {(item.descriptors.length ? item.descriptors : [item.class_name]).map((descriptor, index) => (
              <div className="schema-edit-disc-line" key={`${descriptor}-${index}`}>
                <span className="disc-chip">disc {String(index + 1).padStart(2, "0")}</span>
                <span>{descriptor}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function parsePreviewPath(message: string): string | null {
  const match = message.match(/preview=([^·]+)$/);
  return match ? match[1].trim() : null;
}

export function PseudoGenerateFeedbackPanel({ submitting, submitNotice, activeJob, latestRun, schemaName, worldModel, mergeBoxes, mergeIou, onRestart: _onRestart }: { submitting: boolean; submitNotice: string; activeJob?: Job; latestRun?: PseudoLabelRun; schemaName: string; worldModel: string; mergeBoxes: boolean; mergeIou: number; onRestart?: () => void }) {
  const isRunning = isActiveJob(activeJob);
  const progress = submitting && !activeJob ? 8 : activeJob ? Math.max(0, Math.min(100, Math.round(activeJob.progress || 0))) : undefined;
  const statusLabel = submitting && !activeJob ? "Starting now" : activeJob ? `${activeJob.name}: ${activeJob.status}` : latestRun ? "Latest completed run" : "Ready to generate";
  const message = submitting && !activeJob ? (submitNotice || "Saving schema and submitting pseudo-label run…") : activeJob?.message || submitNotice || (latestRun ? `images=${String(latestRun.labeled_count ?? 0)}/${String(latestRun.image_count ?? 0)} · merge=${((Number(latestRun.merge_rate) || 0) * 100).toFixed(1)}%` : "Choose schema/settings, then Generate Pseudo Labels.");
  return (
    <section className={`pseudo-generate-feedback ${isRunning || submitting ? "is-live" : ""} ${activeJob?.status === "failed" ? "is-error" : ""}`} aria-live="polite">
      <div className="pseudo-feedback-header">
        <div>
          <strong>Pseudo-label run status</strong>
          <span>{statusLabel}</span>
        </div>
        {typeof progress === "number" ? <span className="status-chip live">{progress}%</span> : null}
      </div>
      {typeof progress === "number" ? <progress value={progress} max={100} /> : null}
      <p>{message}</p>
      {activeJob?.error ? <p className="error-text">{activeJob.error}</p> : null}
      <div className="pseudo-settings-summary">
        <span>schema: <strong>{schemaName || "draft schema"}</strong></span>
        <span>model: <strong>{worldModel || "not selected"}</strong></span>
        <span>{mergeBoxes ? `merge on · IoU ${mergeIou.toFixed(2)}` : "merge off"}</span>
      </div>
      {isRunning ? (
        <div className="inline-confirm pseudo-restart-confirm">
          <span>Finish the running job first. Repeated clicks are blocked so the queue cannot accidentally duplicate this long task.</span>
          <button type="button" className="secondary action-process" disabled>Restart with current settings</button>
        </div>
      ) : null}
    </section>
  );
}

function schemaDuplicateMessages(schemas: ClassSchema[]) {
  const counts = new Map<string, number>();
  schemas.forEach((schema) => counts.set(schema.name, (counts.get(schema.name) ?? 0) + 1));
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([name, count]) => `${name} appears ${count} times`);
}

function schemaOptionLabel(schema: ClassSchema, duplicateNames: Set<string>) {
  return duplicateNames.has(schema.name) ? `${schema.name} · ${schema.id.slice(0, 8)}` : schema.name;
}

export function pseudoRunLabel(run: PseudoLabelRun) {
  const name = run.run_name || run.schema_name || `Pseudo_${run.id.slice(0, 8)}`;
  const created = run.created_at ? String(run.created_at).replace("T", " ").slice(0, 19) : "unknown time";
  const imageSummary = `${Number(run.labeled_count ?? 0)}/${Number(run.image_count ?? 0)} images`;
  return `[Review_${created.slice(0, 10).replaceAll("-", "")}_${run.id.slice(0, 6)}] ${name} · ${imageSummary}`;
}

export function augmentationRunLabel(run: AugmentationRun, pseudoRuns: PseudoLabelRun[] = []) {
  const pseudo = pseudoRuns.find((candidate) => candidate.id === run.pseudo_label_run_id);
  const source = pseudo ? pseudoRunLabel(pseudo).split("] ")[0] + "]" : "[Review_any]";
  const created = run.created_at ? String(run.created_at).replace("T", " ").slice(0, 19) : "unknown time";
  return `${source} → [Augment_${created.slice(0, 10).replaceAll("-", "")}_${run.id.slice(0, 6)}] ${run.name || run.id} · ${Number(run.created_image_count ?? 0)} images`;
}

export function datasetSplitLineageLabel(split: DatasetSplitRun | Record<string, unknown>, pseudoRuns: PseudoLabelRun[] = [], augmentationRuns: AugmentationRun[] = []) {
  const pseudoId = String(split.pseudo_label_run_id ?? "");
  const augmentId = String(split.augmentation_run_id ?? "");
  const pseudo = pseudoRuns.find((run) => run.id === pseudoId);
  const augment = augmentationRuns.find((run) => run.id === augmentId);
  const splitName = String(split.name ?? split.id ?? "split");
  const splitPrefix = `[Split_${String(split.created_at ?? "").slice(0, 10).replaceAll("-", "") || "build"}_${String(split.id ?? "").slice(0, 6)}] ${splitName}`;
  const pseudoLabel = pseudo ? pseudoRunLabel(pseudo).split("] ")[1] || pseudoRunLabel(pseudo) : "All labeled images";
  const augmentLabel = augment ? `${augment.name || augment.id} · ${Number(augment.created_image_count ?? 0)}/${Number(augment.source_image_count ?? 0)} images` : "No augment/source build selected";
  return `${splitPrefix} · pseudo: ${pseudoLabel} · dataset source: ${augmentLabel}`;
}

export function chooseLatestBuildSelection<T extends { id: string; created_at?: string | null }>(currentId: string, builds: T[], preferLatest: boolean) {
  if (!builds.length) return "";
  const sorted = [...builds].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  if (preferLatest) return sorted[0].id;
  return builds.some((build) => build.id === currentId) ? currentId : sorted[0].id;
}

export function AugmentationBuildSummary({ run, pseudoRuns = [] }: { run?: AugmentationRun | null; pseudoRuns?: PseudoLabelRun[] }) {
  if (!run) return <p className="muted">No augment/source build selected yet.</p>;
  const pseudo = pseudoRuns.find((candidate) => candidate.id === run.pseudo_label_run_id);
  return (
    <section className="artifact-context-panel augmentation-build-summary">
      <h3>Augment build</h3>
      <div className="artifact-count-grid">
        <article><strong>{Number(run.source_image_count ?? 0)}</strong><span>Source images</span></article>
        <article><strong>{Number(run.created_image_count ?? 0)}</strong><span>Generated images</span></article>
      </div>
      <p><strong>{run.name || run.id}</strong></p>
      <p className="muted">{pseudo ? pseudoRunLabel(pseudo) : "All labeled images"}</p>
      <p className="muted">{run.output_dir}</p>
    </section>
  );
}

export function TrainingInputSummary({ split, pseudoRuns = [], augmentationRuns = [] }: { split?: DatasetSplitRun | Record<string, unknown> | null; pseudoRuns?: PseudoLabelRun[]; augmentationRuns?: AugmentationRun[] }) {
  if (!split) return <p className="muted">Select a split build before training.</p>;
  const augment = augmentationRuns.find((run) => run.id === String(split.augmentation_run_id ?? ""));
  return (
    <section className="training-input-summary">
      <strong>Training input</strong>
      <p>Split build: {String(split.name ?? split.id ?? "split")}</p>
      <p>Dataset source: {augment ? `${augment.name || augment.id} · ${Number(augment.created_image_count ?? 0)} images` : "No augment/source build selected"}</p>
      <p className="muted">{datasetSplitLineageLabel(split, pseudoRuns, augmentationRuns)}</p>
    </section>
  );
}

export function reconcileLocalPseudoJob(localJob: Job | undefined, serverJob: Job | undefined, projectId: string): Job | undefined {
  if (!localJob) return undefined;
  if (!serverJob) return localJob;
  if (serverJob.name !== "pseudo_label") return localJob;
  if (serverJob.project_id && serverJob.project_id !== projectId) return localJob;
  return undefined;
}

export function SchemaHistorySelector({ schemas, value, onChange }: { schemas: ClassSchema[]; value: string; onChange: (schemaId: string) => void }) {
  const duplicates = schemaDuplicateMessages(schemas);
  const duplicateNames = new Set(duplicates.map((message) => message.split(" appears ")[0]));
  return (
    <div className="schema-history-selector">
      <label>
        <span className="label-with-help">History / assign existing schema <HelpTooltip text="Pick a committed schema from history. Selecting an option immediately switches the editable class/prompt tree to that schema." /></span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">New editable schema</option>
          {schemas.map((schema) => <option key={schema.id} value={schema.id}>{schemaOptionLabel(schema, duplicateNames)}</option>)}
        </select>
      </label>
      {duplicates.length ? <p className="schema-warning">Duplicate schema name warning: {duplicates.join("; ")}. Use the id suffix in the dropdown to tell them apart.</p> : null}
    </div>
  );
}

function defaultPromptClasses(): ClassSchema["classes"] {
  return [
    {
      class_id: 0,
      class_name: "person",
      descriptors: ["person", "pedestrian", "walking person", "standing person", "person standing on grass", "person on asphalt road", "person wearing a hat", "aerial view of a person"]
    },
    {
      class_id: 1,
      class_name: "car",
      descriptors: ["car", "vehicle", "moving vehicle", "parked car", "aerial view of a car", "top-down view of a car", "partially occluded vehicle"]
    }
  ];
}

function PseudoPage({ project, models, jobs, refreshJobs, t }: { project: Project; models: ModelLists; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [runs, setRuns] = useState<PseudoLabelRun[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [schemaName, setSchemaName] = useState("person-car-aerial-v1");
  const [pseudoRunName, setPseudoRunName] = useState(() => `Pseudo_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}_v001`);
  const [classes, setClasses] = useState<ClassSchema["classes"]>(defaultPromptClasses());
  const [worldModel, setWorldModel] = useState("");
  const [mergeBoxes, setMergeBoxes] = useState(false);
  const [confidence, setConfidence] = useState(0.1);
  const [iou, setIou] = useState(0.7);
  const [mergeIou, setMergeIou] = useState(0.75);
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState("");
  const [localPseudoJob, setLocalPseudoJob] = useState<Job | undefined>();
  const [schemaDirty, setSchemaDirty] = useState(true);
  const [savingSchema, setSavingSchema] = useState(false);
  const [schemaNotice, setSchemaNotice] = useState("");
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const serverPseudoJob = findWorkflowJob(jobs, "pseudo_label");
  const pseudoJob = isActiveJob(serverPseudoJob) ? serverPseudoJob : isActiveJob(localPseudoJob) ? localPseudoJob : serverPseudoJob ?? localPseudoJob;
  const previewPath = pseudoJob ? parsePreviewPath(pseudoJob.message) : selectedSchema ? String(runs[0]?.last_image_path ?? "") : "";
  const graphSchema: ClassSchema = {
    id: schemaId || "draft-schema",
    project_id: project.id,
    name: selectedSchema ? selectedSchema.name : schemaName || "New editable schema",
    classes
  };

  async function loadHistory() {
    const [nextSchemas, nextRuns] = await Promise.all([api.classSchemas(project.id), api.pseudoLabelRuns(project.id)]);
    setSchemas(nextSchemas);
    setRuns(nextRuns as PseudoLabelRun[]);
    if (nextSchemas[0]) {
      setSchemaId(nextSchemas[0].id);
      setSchemaName(nextSchemas[0].name);
      setClasses(nextSchemas[0].classes.map((item) => ({ ...item, descriptors: [...item.descriptors] })));
      setSchemaDirty(false);
    }
  }

  useEffect(() => {
    setPseudoRunName(`Pseudo_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}_v001`);
    loadHistory().catch(console.error);
  }, [project.id]);
  useEffect(() => {
    setWorldModel(models.world_models[0] ?? "yolov8s-world.pt");
  }, [models.world_models]);
  useEffect(() => {
    setLocalPseudoJob((current) => reconcileLocalPseudoJob(current, serverPseudoJob, project.id));
  }, [project.id, serverPseudoJob?.id, serverPseudoJob?.status]);

  function applySchema(schema: ClassSchema) {
    setSchemaId(schema.id);
    setSchemaName(schema.name);
    setClasses(schema.classes.map((item) => ({ ...item, descriptors: [...item.descriptors] })));
    setSchemaDirty(false);
    setSchemaNotice(`Switched to schema history item: ${schema.name}`);
  }

  function startNewSchema() {
    setSchemaId("");
    setSchemaName("person-car-aerial-v1");
    setClasses(defaultPromptClasses());
    setSchemaDirty(true);
    setSchemaNotice("Editing a new schema draft. Commit it before Generate to add it to history.");
  }

  function markSchemaDirty() {
    setSchemaDirty(true);
    setSchemaNotice("Schema draft has unsaved changes. Commit schema to history before Generate.");
  }

  async function saveSchema(): Promise<string> {
    const cleanClasses = classes.map((item, index) => ({
      class_id: Number.isFinite(item.class_id) ? item.class_id : index,
      class_name: item.class_name.trim() || `class_${index}`,
      descriptors: item.descriptors.map((descriptor) => descriptor.trim()).filter(Boolean)
    }));
    const saved = await api.createClassSchema(project.id, { name: schemaName || "pseudo-label-schema", classes: cleanClasses });
    await loadHistory();
    setSchemaId(saved.id);
    setSchemaName(saved.name);
    setClasses(saved.classes.map((item) => ({ ...item, descriptors: [...item.descriptors] })));
    setSchemaDirty(false);
    setSchemaNotice(`Committed schema to history: ${saved.name}`);
    return saved.id;
  }

  async function submitPseudoLabelRun(mode: "generate" | "restart" = "generate") {
    if (submitting) return;
    if (isActiveJob(pseudoJob)) {
      setSubmitNotice("Pseudo-label generation is already running. Wait until it completes before creating another version.");
      return;
    }
    if (!schemaId || schemaDirty) {
      setSchemaNotice("Please commit the current schema to history before Generate, then choose it from History if needed.");
      setSubmitNotice("Generate blocked: schema is not committed yet.");
      return;
    }
    setSubmitNotice(mode === "restart" ? "Restarting pseudo-label run with current settings…" : "Submitting pseudo-label run with the committed schema…");
    setSubmitting(true);
    try {
      const activeSchemaId = schemaId;
      const job = await api.pseudoLabel(project.id, {
        run_name: pseudoRunName,
        schema_id: activeSchemaId,
        world_model: worldModel,
        confidence,
        iou,
        merge_boxes: mergeBoxes,
        merge_iou: mergeIou
      });
      setLocalPseudoJob(job);
      setSubmitNotice(mode === "restart" ? "Restart accepted. Progress will switch to the new run on the next poll." : "Request accepted. Progress and preview will update below.");
      await refreshJobs();
    } catch (error) {
      setSubmitNotice(`Pseudo-label request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="panel wide"
      onSubmit={async (event) => {
        event.preventDefault();
        await submitPseudoLabelRun("generate");
      }}
    >
      <h2 className="section-title-with-help">{t("startPseudo")} <HelpTooltip text="Use this page to choose a committed person/car schema, edit prompt descriptors, then run YOLO-World. Descriptors are prompt helpers only; training labels stay canonical ids." /></h2>
      <p className="muted">Class schema is the training label YAML shape. Descriptors are editable YOLO-World prompts only; they collapse back to the parent class id for training.</p>
      <label title="Pseudo-label build name used by Augment/Split selectors."><span>Pseudo build name</span><input value={pseudoRunName} onChange={(event) => setPseudoRunName(event.target.value)} /></label>
      <PseudoDependencyGraph schema={graphSchema} worldModel={worldModel} mergeBoxes={mergeBoxes} hasRun={Boolean(pseudoJob || runs.length)} />
      <section className="schema-commit-panel">
        <div className="field-row">
          <label>
            <span className="label-with-help">Schema name <HelpTooltip text="This is the saved schema history name. If the same name appears more than once, the dropdown adds an id suffix and shows a warning." /></span>
            <input value={schemaName} onChange={(event) => { setSchemaName(event.target.value); markSchemaDirty(); }} />
          </label>
          <SchemaHistorySelector schemas={schemas} value={schemaId} onChange={(nextId) => { const schema = schemas.find((item) => item.id === nextId); if (schema) applySchema(schema); else startNewSchema(); }} />
        </div>
        <div className="inline-actions schema-actions">
          <button type="button" className="primary action-save" disabled={savingSchema || !schemaDirty} onClick={async () => { setSavingSchema(true); try { await saveSchema(); } finally { setSavingSchema(false); } }}>{savingSchema ? "Committing schema…" : schemaDirty ? "Commit schema to history" : "Schema committed"}</button>
          <button type="button" className="secondary action-add" onClick={startNewSchema}>New schema draft</button>
          <span className={`schema-state-chip ${schemaDirty ? "is-dirty" : "is-clean"}`}>{schemaDirty ? "draft not committed" : schemaId ? "history schema selected" : "new draft"}</span>
        </div>
        {schemaNotice ? <p className="inline-feedback">{schemaNotice}</p> : null}
      </section>
      <div className="editable-schema-tree">
        {classes.map((item, classIndex) => (
          <article key={`${item.class_id}-${classIndex}`} className="schema-edit-node">
            <div className="schema-edit-class-line editable">
              <span className="class-id-chip">id</span>
              <input className="schema-id-input" aria-label={`class ${classIndex + 1} id`} type="number" value={item.class_id} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, class_id: Number(event.target.value) } : candidate)); }} />
              <span className="class-name-chip">class</span>
              <input className="schema-class-input" aria-label={`class ${classIndex + 1} name`} value={item.class_name} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, class_name: event.target.value } : candidate)); }} />
              <button type="button" className="secondary danger compact-action action-delete" onClick={() => { markSchemaDirty(); setClasses((current) => current.filter((_, index) => index !== classIndex)); }}>- class</button>
            </div>
            <div className="schema-edit-branch editable">
              {item.descriptors.map((descriptor, descriptorIndex) => (
                <div className="schema-edit-disc-line editable" key={`${descriptor}-${descriptorIndex}`}>
                  <span className="disc-chip">disc {String(descriptorIndex + 1).padStart(2, "0")}</span>
                  <input aria-label={`${item.class_name} descriptor ${descriptorIndex + 1}`} value={descriptor} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: candidate.descriptors.map((value, subIndex) => subIndex === descriptorIndex ? event.target.value : value) } : candidate)); }} />
                  <button type="button" className="secondary compact-action action-remove" onClick={() => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: candidate.descriptors.filter((_, subIndex) => subIndex !== descriptorIndex) } : candidate)); }}>- disc</button>
                </div>
              ))}
              <button type="button" className="secondary add-disc-action action-add" onClick={() => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: [...candidate.descriptors, candidate.class_name] } : candidate)); }}>+ disc under {item.class_name || `class ${classIndex + 1}`}</button>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="secondary add-class-action action-add" onClick={() => { markSchemaDirty(); setClasses((current) => [...current, { class_id: current.length, class_name: "new_class", descriptors: ["new object"] }]); }}>+ class</button>
      <details className="history-panel">
        <summary>Previous pseudo-label runs <HelpTooltip text="These are prior Generate runs. They record which schema/settings produced labels, but selecting schemas is controlled by the History dropdown above." /></summary>
        {runs.map((run) => <div className="row-card" key={run.id}><strong>{pseudoRunLabel(run)}</strong><span>{run.created_at} · conf={String(run.confidence)} iou={String(run.iou)} · images={String(run.labeled_count)}/{String(run.image_count)} · merge={((Number(run.merge_rate) || 0) * 100).toFixed(1)}%</span></div>)}
      </details>
      <label>
        <span className="label-with-help">YOLO-World model <HelpTooltip text="The open-vocabulary model used for pseudo labeling. Prompt descriptors are sent to this model, then detections are mapped back to class ids." /></span>
        <select value={worldModel} onChange={(event) => setWorldModel(event.target.value)}>
          {(models.world_models.length ? models.world_models : ["yolov8s-world.pt"]).map((model) => <option key={model}>{model}</option>)}
        </select>
      </label>
      <div className="field-row">
        <label title="Confidence threshold: 0.1 is loose and keeps more candidate boxes; 0.7 is strict and keeps only high-confidence boxes."><span className="label-with-help">Confidence threshold <HelpTooltip text="Minimum detection confidence. Lower values find more boxes but more false positives; higher values are stricter." /></span><input name="confidence" type="number" min="0" max="1" step="0.01" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label>
        <label title="NMS IoU threshold: overlap threshold used by YOLO-World to suppress duplicate boxes before optional same-class merge."><span className="label-with-help">NMS IoU threshold <HelpTooltip text="YOLO-World overlap threshold before your optional same-class prompt merge. Higher values keep more overlapping candidates." /></span><input name="iou" type="number" min="0" max="1" step="0.01" value={iou} onChange={(event) => setIou(Number(event.target.value))} /></label>
      </div>
      <label className="check-row" title="Merge overlapping boxes that came from different prompts but map to the same training class id."><input type="checkbox" checked={mergeBoxes} onChange={(event) => setMergeBoxes(event.target.checked)} />Merge boxes from same class prompts <HelpTooltip text="If multiple descriptors for the same parent class hit the same object, overlapping boxes can be merged and descriptor provenance is kept." /></label>
      {mergeBoxes && <label title="Boxes of the same class with IoU above this value collapse into the highest-confidence box; the merged prompt names are kept as provenance."><span className="label-with-help">Merge IoU threshold <HelpTooltip text="How much same-class boxes must overlap before merging. Higher means only very similar boxes merge." /></span><input name="merge_iou" type="number" min="0" max="1" step="0.01" value={mergeIou} onChange={(event) => setMergeIou(Number(event.target.value))} /></label>}
      <PseudoGenerateFeedbackPanel
        submitting={submitting}
        submitNotice={submitNotice}
        activeJob={pseudoJob}
        latestRun={runs[0]}
        schemaName={schemaName}
        worldModel={worldModel}
        mergeBoxes={mergeBoxes}
        mergeIou={mergeIou}
      />
      {previewPath && <div className="pseudo-preview"><strong>Latest processed preview</strong><img src={`/api/files?path=${encodeURIComponent(previewPath)}`} alt="latest pseudo-label preview" /></div>}
      <ProcessingButton busy={submitting || isActiveJob(pseudoJob)} disabled={!schemaId || schemaDirty} progress={pseudoJob ? pseudoJob.progress : submitting ? 8 : undefined} statusText={pseudoJob ? pseudoJob.message || `${pseudoJob.name}: ${pseudoJob.status}` : submitNotice || "Submitting pseudo-label run…"} taskName="Pseudo Label Generate" className="primary action-process"><Play size={17} />Generate Pseudo Labels</ProcessingButton>
    </form>
  );
}

type AugmentationEffectKey = "hue" | "exposure" | "blur" | "noise" | "gain" | "boxMotionBlur" | "rotation";
type AugmentationEffect = { id: string; key: AugmentationEffectKey; value: number; showBbox?: boolean };
type AugmentationSettings = { effects: AugmentationEffect[]; copies: number; skip: boolean };
type AugmentationDraft = { name: string; settings: AugmentationSettings };
type AugmentationField = { key: AugmentationEffectKey; title: string; description: string; min: number; max: number; unit?: string };

const DEFAULT_AUGMENTATION_DRAFT: AugmentationDraft = { name: "augmented-v1", settings: { effects: [], copies: 3, skip: false } };

export function buildAugmentationDraftStorageKey(projectId: string) {
  return `object-autolabel:augmentation-draft:${projectId}`;
}

function isAugmentationEffectKey(value: unknown): value is AugmentationEffectKey {
  return ["hue", "exposure", "blur", "noise", "gain", "boxMotionBlur", "rotation"].includes(String(value));
}

export function loadAugmentationDraft(projectId: string, storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null): AugmentationDraft {
  if (!storage) return DEFAULT_AUGMENTATION_DRAFT;
  try {
    const raw = storage.getItem(buildAugmentationDraftStorageKey(projectId));
    if (!raw) return DEFAULT_AUGMENTATION_DRAFT;
    const parsed = JSON.parse(raw) as Partial<AugmentationDraft>;
    const effects = Array.isArray(parsed.settings?.effects)
      ? parsed.settings.effects.filter((effect): effect is AugmentationEffect => Boolean(effect && typeof effect.id === "string" && isAugmentationEffectKey(effect.key)))
      : [];
    const copies = [3, 5, 8, 10].includes(Number(parsed.settings?.copies)) ? Number(parsed.settings?.copies) : DEFAULT_AUGMENTATION_DRAFT.settings.copies;
    const skip = Boolean(parsed.settings?.skip);
    return { name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : DEFAULT_AUGMENTATION_DRAFT.name, settings: { effects, copies, skip } };
  } catch {
    return DEFAULT_AUGMENTATION_DRAFT;
  }
}

export function saveAugmentationDraft(projectId: string, draft: AugmentationDraft, storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) return;
  storage.setItem(buildAugmentationDraftStorageKey(projectId), JSON.stringify(draft));
}

const AUGMENTATION_FIELDS: AugmentationField[] = [
  { key: "hue", title: "Hue Adjustment", description: "", min: 0, max: 45, unit: "°" },
  { key: "exposure", title: "Exposure Simulation", description: "", min: 0, max: 80 },
  { key: "blur", title: "Blur Filter", description: "", min: 0, max: 10 },
  { key: "noise", title: "Random Noise", description: "", min: 0, max: 100 },
  { key: "gain", title: "Camera Gain Variance", description: "", min: 0, max: 60 },
  { key: "boxMotionBlur", title: "Bounding Box: Motion Blur", description: "", min: 0, max: 15 },
  { key: "rotation", title: "Random Rotation", description: "", min: 0, max: 30, unit: "°" }
];

function augmentationField(key: AugmentationEffectKey) {
  return AUGMENTATION_FIELDS.find((field) => field.key === key) ?? AUGMENTATION_FIELDS[0];
}

function newAugmentationEffect(key: AugmentationEffectKey): AugmentationEffect {
  const field = augmentationField(key);
  return { id: `${key}-${Date.now()}-${Math.random().toString(16).slice(2)}`, key, value: Math.max(1, Math.round(field.max / 3)), showBbox: false };
}

function aggregateAugmentationSettings(settings: AugmentationSettings) {
  const payload = { hue: 0, exposure: 0, noise: 0, blur: 0, gain: 0, box_motion_blur: 0, rotation: 0 };
  settings.effects.forEach((effect) => {
    if (effect.key === "boxMotionBlur") payload.box_motion_blur = Math.max(payload.box_motion_blur, effect.value);
    else payload[effect.key] = Math.max(payload[effect.key], effect.value);
  });
  return payload;
}

export function AugmentationControlPanel({ settings, onChange, onEditEffect }: { settings: AugmentationSettings; onChange: (settings: AugmentationSettings) => void; onEditEffect: (effect: AugmentationEffect) => void }) {
  const update = (patch: Partial<AugmentationSettings>) => onChange({ ...settings, ...patch });
  const removeEffect = (id: string) => update({ effects: settings.effects.filter((effect) => effect.id !== id) });
  return (
    <section className="augmentation-control-panel">
      <div className="augmentation-multiplier">
        <strong>Augmentation dataset size</strong>
        <p className="muted">Choose how many augmented variants to generate for each labeled image.</p>
        <div className="ratio-presets augmentation-size-presets">
          {[3, 5, 8, 10].map((value) => (
            <button key={value} type="button" className={!settings.skip && settings.copies === value ? "secondary action-browse is-active" : "secondary action-browse"} aria-pressed={!settings.skip && settings.copies === value} onClick={() => update({ copies: value, skip: false })}>x{value}</button>
          ))}
          <button type="button" className={settings.skip ? "secondary action-browse is-active" : "secondary action-browse"} aria-pressed={settings.skip} onClick={() => update({ skip: true })}>Skip augment</button>
        </div>
        {settings.skip ? <p className="inline-feedback">Skip augment creates a source build: original labeled images are copied into a selectable dataset version without pixel transforms.</p> : null}
      </div>
      <div className="augmentation-add-panel">
        <strong>+ Add augmentation parameter</strong>
        <p className="muted">Start from an empty recipe. Add only the effects you want, configure each in a sampled-photo dialog, then stack them before creating images.</p>
        <div className="augmentation-add-grid">
          {AUGMENTATION_FIELDS.map((field) => (
            <button key={field.key} type="button" className="secondary action-add" onClick={() => onEditEffect(newAugmentationEffect(field.key))}>+ {field.title}</button>
          ))}
        </div>
      </div>
      <div className="augmentation-stack">
        <div className="sidebar-header"><div><h3>Applied augmentation stack</h3><p className="muted">Effects run together when creating augmented images. Use Edit to reopen the sampled-photo settings.</p></div></div>
        {settings.effects.length ? settings.effects.map((effect, index) => {
          const field = augmentationField(effect.key);
          return (
            <article key={effect.id} className="augmentation-stack-item">
              <span className="stack-order">{index + 1}</span>
              <div><strong>{field.title}</strong></div>
              <span className="effect-value">±{effect.value}{field.unit ?? ""}</span>
              <div className="inline-actions">
                <button type="button" className="secondary action-browse" onClick={() => onEditEffect(effect)}>Edit</button>
                <button type="button" className="secondary action-delete" onClick={() => removeEffect(effect.id)}>Remove</button>
              </div>
            </article>
          );
        }) : <p className="empty-recipe">No augmentation parameters yet. Use + Blur Filter, + Random Rotation, or another parameter above to build a stack.</p>}
      </div>
    </section>
  );
}

export function AugmentationEffectModal({ draft, previewSamples, loading, error, onChange, onApply, onClose }: { draft: AugmentationEffect; previewSamples: AugmentationPreviewSample[]; loading: boolean; error: string; onChange: (effect: AugmentationEffect) => void; onApply: () => void; onClose: () => void }) {
  const field = augmentationField(draft.key);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Configure ${field.title}`}>
      <section className="modal-card augmentation-effect-modal">
        <div className="sidebar-header">
          <div><h2>Configure {field.title}</h2><p className="muted">Adjust the ± sampling range on one random labeled photo. Bbox preview is optional because overlay rendering can add latency.</p></div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        <label><span>± value range {field.unit ? `(${field.unit})` : ""}</span><input type="range" min={field.min} max={field.max} value={draft.value} onChange={(event) => onChange({ ...draft, value: Number(event.target.value) })} /><strong>−{draft.value}{field.unit ?? ""} / +{draft.value}{field.unit ?? ""}</strong></label>
        <label className="check-row"><input type="checkbox" checked={Boolean(draft.showBbox)} onChange={(event) => onChange({ ...draft, showBbox: event.target.checked })} />Preview bounding boxes</label>
        {loading && <p className="inline-feedback">Sampling preview image…</p>}
        {error && <p className="review-error">{error}</p>}
        <div className="split-sample-grid modal-preview-grid">{previewSamples.length ? previewSamples.map((sample) => <AugmentationPreviewCard key={`modal-${sample.image_id}`} sample={sample} showBoxes={Boolean(draft.showBbox)} />) : loading ? <div className="sample-preview-skeleton">Loading sampled image preview…</div> : <p className="muted">No labeled image preview available yet.</p>}</div>
        <div className="inline-actions modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary action-save" onClick={onApply}>Apply effect</button></div>
      </section>
    </div>
  );
}

function AugmentationPage({ project, jobs, refreshJobs, artifactRevision }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; artifactRevision: number }) {
  const augmentationJob = findWorkflowJob(jobs, "augmentation");
  const initialDraft = useMemo(() => loadAugmentationDraft(project.id), [project.id]);
  const [name, setName] = useState(initialDraft.name);
  const [settings, setSettings] = useState<AugmentationSettings>(initialDraft.settings);
  const [pseudoRuns, setPseudoRuns] = useState<PseudoLabelRun[]>([]);
  const [augmentationRuns, setAugmentationRuns] = useState<AugmentationRun[]>([]);
  const [selectedPseudoRunId, setSelectedPseudoRunId] = useState("");
  const [selectedBuildId, setSelectedBuildId] = useState("");
  const [editingEffect, setEditingEffect] = useState<AugmentationEffect | null>(null);
  const [modalPreviewSamples, setModalPreviewSamples] = useState<AugmentationPreviewSample[]>([]);
  const [createdSamples, setCreatedSamples] = useState<AugmentationPreviewSample[]>([]);
  const [showCreatedBoxes, setShowCreatedBoxes] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingBuilds, setLoadingBuilds] = useState(false);

  async function loadAugmentationRuns(nextSelectedId?: string) {
    setLoadingBuilds(true);
    try {
      const [nextPseudoRuns, nextAugmentationRuns] = await Promise.all([api.pseudoLabelRuns(project.id), api.augmentationRuns(project.id)]);
      setPseudoRuns(nextPseudoRuns);
      setAugmentationRuns(nextAugmentationRuns);
      if (!selectedPseudoRunId && nextPseudoRuns[0]?.id) setSelectedPseudoRunId(nextPseudoRuns[0].id);
      const nextId = nextSelectedId || chooseLatestBuildSelection(selectedBuildId, nextAugmentationRuns, false);
      setSelectedBuildId(nextId);
      return { runs: nextAugmentationRuns, selectedId: nextId };
    } finally {
      setLoadingBuilds(false);
    }
  }

  useEffect(() => {
    const nextDraft = loadAugmentationDraft(project.id);
    setName(nextDraft.name);
    setSettings(nextDraft.settings);
    setEditingEffect(null);
    setModalPreviewSamples([]);
    setCreatedSamples([]);
    setSelectedBuildId("");
    setSelectedPseudoRunId("");
    loadAugmentationRuns().catch(console.error);
  }, [project.id]);

  useEffect(() => {
    if (!artifactRevision) return;
    loadAugmentationRuns().catch((error) => {
      setLoadingBuilds(false);
      console.error(error);
    });
  }, [artifactRevision]);

  useEffect(() => {
    saveAugmentationDraft(project.id, { name, settings });
  }, [project.id, name, settings]);

  useEffect(() => {
    if (!editingEffect) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    setModalPreviewSamples([]);
    const runPreview = async () => {
      try {
        const payload = aggregateAugmentationSettings({ effects: [editingEffect], copies: settings.copies, skip: false });
        const samples = await api.augmentPreview(project.id, { ...payload, polarity: 1, limit: 1 });
        if (!cancelled) setModalPreviewSamples(samples);
      } catch (error) {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void runPreview();
    return () => {
      cancelled = true;
    };
  }, [project.id, editingEffect, settings.copies]);

  function applyEditingEffect() {
    if (!editingEffect) return;
    setSettings((current) => {
      const exists = current.effects.some((effect) => effect.id === editingEffect.id);
      return { ...current, effects: exists ? current.effects.map((effect) => effect.id === editingEffect.id ? editingEffect : effect) : [...current.effects, editingEffect] };
    });
    setEditingEffect(null);
  }

  async function loadCreatedPreview() {
    const buildId = selectedBuildId || augmentationRuns[0]?.id;
    if (!buildId) return;
    const samples = await api.augmentationRunSamples(project.id, buildId, 3);
    setCreatedSamples(samples.sort(() => Math.random() - 0.5).slice(0, 3));
  }

  const aggregatePayload = aggregateAugmentationSettings(settings);
  const hasEffects = settings.effects.length > 0;
  const selectedBuild = augmentationRuns.find((run) => run.id === selectedBuildId);
  return (
    <form
      className="panel wide"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          await api.augment(project.id, {
            name,
            pseudo_label_run_id: selectedPseudoRunId || null,
            ...aggregatePayload,
            horizontal_flip: false,
            copies: settings.copies,
            skip_augment: settings.skip
          });
          await refreshJobs();
          const next = await loadAugmentationRuns();
          if (next.selectedId) {
            const samples = await api.augmentationRunSamples(project.id, next.selectedId, 3);
            setCreatedSamples(samples.sort(() => Math.random() - 0.5).slice(0, 3));
          }
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>Image augmentation</h2>
      <p className="muted">Optional step before Split. Build an augmentation stack with + parameters, configure each in a sampled-photo dialog, then create generated images.</p>
      <label><span>Pseudo-label build input</span><select value={selectedPseudoRunId} onChange={(event) => setSelectedPseudoRunId(event.target.value)}><option value="">All currently labeled images</option>{pseudoRuns.map((run) => <option key={run.id} value={run.id}>{pseudoRunLabel(run)}</option>)}</select></label>
      <label><span>Augmentation run name</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <AugmentationControlPanel settings={settings} onChange={setSettings} onEditEffect={(effect) => { setPreviewError(""); setModalPreviewSamples([]); setEditingEffect(effect); }} />
      {!hasEffects && !settings.skip && <p className="inline-feedback">Add at least one augmentation parameter or choose Skip augment to create a source build.</p>}
      <AugmentationBuildSummary run={selectedBuild} pseudoRuns={pseudoRuns} />
      {loadingBuilds ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> Refreshing build versions…</p> : null}
      {augmentationRuns.length ? <div className="field-row"><label><span>Inspect build</span><select value={selectedBuildId} disabled={loadingBuilds} onChange={(event) => { setSelectedBuildId(event.target.value); setCreatedSamples([]); }}><option value="">Select augment/source build</option>{augmentationRuns.map((run) => <option key={run.id} value={run.id}>{augmentationRunLabel(run, pseudoRuns)}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={showCreatedBoxes} onChange={(event) => setShowCreatedBoxes(event.target.checked)} />Show bounding boxes</label><button type="button" className="secondary action-browse" disabled={loadingBuilds} onClick={() => loadCreatedPreview().catch(console.error)}><Dice5 size={16} />Random sample</button></div> : null}
      {createdSamples.length ? <section className="augmentation-preview created-augmentation-preview"><h3>Random generated output check</h3><p className="muted">After Create augmented images, inspect random generated images to make sure transformed labels still align.</p><div className="split-sample-grid">{createdSamples.map((sample) => <AugmentationPreviewCard key={`created-${sample.image_id}`} sample={sample} showBoxes={showCreatedBoxes} />)}</div></section> : null}
      {augmentationJob && <div className="job-progress-inline" title={augmentationJob.message}><span>{augmentationJob.name}: {augmentationJob.status}</span><progress value={augmentationJob.progress} max={100} /><small>{augmentationJob.progress}% · {augmentationJob.message}</small></div>}
      <ProcessingButton busy={submitting || isActiveJob(augmentationJob)} disabled={!hasEffects && !settings.skip} progress={augmentationJob ? augmentationJob.progress : submitting ? 12 : undefined} statusText={augmentationJob ? augmentationJob.message || `${augmentationJob.name}: ${augmentationJob.status}` : "Submitting augmentation run…"} className="primary action-process"><Play size={17} />Create augmented images</ProcessingButton>
      {editingEffect && <AugmentationEffectModal draft={editingEffect} previewSamples={modalPreviewSamples} loading={previewLoading} error={previewError} onChange={setEditingEffect} onApply={applyEditingEffect} onClose={() => setEditingEffect(null)} />}
    </form>
  );
}

export function AugmentationPreviewCard({ sample, showBoxes = true }: { sample: AugmentationPreviewSample; showBoxes?: boolean }) {
  const width = Number(sample.width) || 640;
  const height = Number(sample.height) || 480;
  return (
    <article className="split-sample-card augmentation-sample-card">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`augmented preview ${sample.file_name}`}>
        <image href={sample.preview_url} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
        {showBoxes && sample.annotations.map((annotation, index) => {
          const x = (annotation.x_center - annotation.width / 2) * width;
          const y = (annotation.y_center - annotation.height / 2) * height;
          const rectWidth = annotation.width * width;
          const rectHeight = annotation.height * height;
          return (
            <g key={`${annotation.class_id}-${index}`}>
              <rect x={x} y={y} width={rectWidth} height={rectHeight} />
              <text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name || `class ${annotation.class_id}`}</text>
            </g>
          );
        })}
      </svg>
      <div><strong>{sample.file_name}</strong><span>{showBoxes ? `${sample.annotations.length} boxes · augmented preview` : "bbox overlay hidden · augmented preview"}</span></div>
    </article>
  );
}

function SplitPage({ project, jobs, refreshJobs, t, artifactRevision }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string; artifactRevision: number }) {
  const [runs, setRuns] = useState<PseudoLabelRun[]>([]);
  const [augmentationRuns, setAugmentationRuns] = useState<AugmentationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedAugmentationRunId, setSelectedAugmentationRunId] = useState("");
  const [splits, setSplits] = useState<Array<Record<string, unknown>>>([]);
  const [selectedSplitId, setSelectedSplitId] = useState("");
  const [samples, setSamples] = useState<SplitSamples>({ train: [], valid: [], test: [] });
  const [sampleLimit, setSampleLimit] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [trainRatio, setTrainRatio] = useState("0.80");
  const [valRatio, setValRatio] = useState("0.10");
  const splitJob = findWorkflowJob(jobs, "dataset_split");
  const trainRatioNumber = Number(trainRatio);
  const valRatioNumber = Number(valRatio);
  const computedTestRatio = Math.max(0, 1 - (Number.isFinite(trainRatioNumber) ? trainRatioNumber : 0) - (Number.isFinite(valRatioNumber) ? valRatioNumber : 0));
  const ratioTotal = (Number.isFinite(trainRatioNumber) ? trainRatioNumber : 0) + (Number.isFinite(valRatioNumber) ? valRatioNumber : 0) + computedTestRatio;
  const ratiosValid = trainRatioNumber > 0 && valRatioNumber >= 0 && computedTestRatio >= 0 && Math.abs(ratioTotal - 1) < 0.0001;

  async function loadSplits(nextSelectedId?: string) {
    const nextSplits = await api.datasetSplits(project.id);
    setSplits(nextSplits);
    const nextId = nextSelectedId || String(nextSplits[0]?.id ?? "");
    setSelectedSplitId(nextId);
    if (nextId) {
      setSamples(await api.datasetSplitSamples(project.id, nextId, sampleLimit));
    } else {
      setSamples({ train: [], valid: [], test: [] });
    }
  }

  async function loadBuildInputs(preferLatestAugment: boolean) {
    setLoadingBuilds(true);
    try {
      const [nextRuns, nextAugmentationRuns, nextSplits] = await Promise.all([api.pseudoLabelRuns(project.id), api.augmentationRuns(project.id), api.datasetSplits(project.id)]);
      setRuns(nextRuns as PseudoLabelRun[]);
      setAugmentationRuns(nextAugmentationRuns as AugmentationRun[]);
      setSplits(nextSplits);
      setSelectedRunId((current) => chooseLatestBuildSelection(current, nextRuns, false));
      setSelectedAugmentationRunId((current) => chooseLatestBuildSelection(current, nextAugmentationRuns, preferLatestAugment));
      const nextSplitId = String(nextSplits[0]?.id ?? "");
      setSelectedSplitId(nextSplitId);
      if (nextSplitId) {
        setLoadingSamples(true);
        setSamples(await api.datasetSplitSamples(project.id, nextSplitId, sampleLimit));
      }
    } finally {
      setLoadingSamples(false);
      setLoadingBuilds(false);
    }
  }

  useEffect(() => {
    loadBuildInputs(false).catch(console.error);
  }, [project.id]);

  useEffect(() => {
    if (!artifactRevision) return;
    loadBuildInputs(true).catch(console.error);
  }, [artifactRevision]);

  useEffect(() => {
    if (!selectedSplitId) return;
    setLoadingSamples(true);
    api.datasetSplitSamples(project.id, selectedSplitId, sampleLimit).then(setSamples).catch(console.error).finally(() => setLoadingSamples(false));
  }, [project.id, selectedSplitId, sampleLimit]);

  const selectedRun = runs.find((run) => run.id === selectedRunId);
  const selectedAugmentationRun = augmentationRuns.find((run) => run.id === selectedAugmentationRunId);
  const selectedSplit = splits.find((split) => String(split.id) === selectedSplitId);
  return (
    <section className="panel-grid">
      <form
        className="panel wide"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          try {
            const form = new FormData(event.currentTarget);
            if (!ratiosValid) throw new Error("Train + validation must be <= 1.0 so test can fill the remainder.");
            await api.split(project.id, {
              name: form.get("name"),
              train_ratio: trainRatioNumber,
              val_ratio: valRatioNumber,
              test_ratio: Number(computedTestRatio.toFixed(4)),
              pseudo_label_run_id: selectedRunId || selectedAugmentationRun?.pseudo_label_run_id || null,
              augmentation_run_id: selectedAugmentationRunId || null
            });
            await refreshJobs();
            await loadSplits();
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2>{t("buildSplit")}</h2>
        <p className="muted">Split chooses images from a selected pseudo-label run. Train is the learning set, validation checks performance during training, and test is held out for final spot checks.</p>
        {loadingBuilds ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> Syncing latest upstream builds…</p> : null}
        <label><span>Pseudo-label run / source condition</span><select value={selectedRunId} disabled={loadingBuilds} onChange={(event) => setSelectedRunId(event.target.value)}><option value="">All currently labeled images</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.schema_name ?? run.id} · {run.created_at} · {run.labeled_count}/{run.image_count} images</option>)}</select></label>
        {selectedRun && <p className="muted">Using conf={String(selectedRun.confidence)}, iou={String(selectedRun.iou)}, merge rate={((Number(selectedRun.merge_rate) || 0) * 100).toFixed(1)}%.</p>}
        <label><span>Augment/source build</span><select value={selectedAugmentationRunId} disabled={loadingBuilds} onChange={(event) => setSelectedAugmentationRunId(event.target.value)}><option value="">No augment build: all matching labeled images</option>{augmentationRuns.map((run) => <option key={run.id} value={run.id}>{augmentationRunLabel(run, runs)}</option>)}</select></label>
        <AugmentationBuildSummary run={selectedAugmentationRun} pseudoRuns={runs} />
        <input name="name" defaultValue="default" />
        <div className="ratio-builder" aria-label="Train validation test split ratios">
          <div className="ratio-presets" aria-label="Split ratio presets">
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.80"); setValRatio("0.10"); }}>80 / 10 / 10</button>
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.70"); setValRatio("0.20"); }}>70 / 20 / 10</button>
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.90"); setValRatio("0.05"); }}>90 / 5 / 5</button>
          </div>
          <div className="field-row">
            <label title="Training portion: images used to update model weights. Test is auto-computed so total stays 1.00."><span>Train ratio</span><input name="train" type="text" inputMode="decimal" value={trainRatio} onChange={(event) => setTrainRatio(event.target.value)} /></label>
            <label title="Validation portion: images used during training to monitor overfitting and select best.pt."><span>Validation ratio</span><input name="val" type="text" inputMode="decimal" value={valRatio} onChange={(event) => setValRatio(event.target.value)} /></label>
            <label title="Test is computed automatically so train + validation + test always equals 1.0."><span>Test ratio (auto)</span><input name="test" type="text" readOnly value={computedTestRatio.toFixed(2)} /></label>
          </div>
          <div className="ratio-visual" title="The three segments always represent 100% of selected images.">
            <span className="ratio-train" style={{ width: `${Math.max(0, Math.min(100, trainRatioNumber * 100))}%` }}>Train {(trainRatioNumber * 100 || 0).toFixed(0)}%</span>
            <span className="ratio-val" style={{ width: `${Math.max(0, Math.min(100, valRatioNumber * 100))}%` }}>Val {(valRatioNumber * 100 || 0).toFixed(0)}%</span>
            <span className="ratio-test" style={{ width: `${Math.max(0, Math.min(100, computedTestRatio * 100))}%` }}>Test {(computedTestRatio * 100).toFixed(0)}%</span>
          </div>
          <p className={ratiosValid ? "inline-feedback" : "review-error"}>{ratiosValid ? `Total = 1.00. Test automatically fills the remaining ${computedTestRatio.toFixed(2)}.` : "Invalid split: Train + Validation cannot exceed 1.00."}</p>
        </div>
        <ProcessingButton busy={submitting || isActiveJob(splitJob)} disabled={!ratiosValid} progress={splitJob ? splitJob.progress : submitting ? 15 : undefined} statusText={splitJob ? splitJob.message || `${splitJob.name}: ${splitJob.status}` : "Submitting split build…"} className="primary action-process">{t("buildSplit")}</ProcessingButton>
      </form>
      <div className="list-panel wide">
        <h2>Split history / sample</h2>
        <div className="field-row">
          <label><span>Preview split</span><select value={selectedSplitId} onChange={(event) => setSelectedSplitId(event.target.value)}><option value="">No split selected</option>{splits.map((split) => <option key={String(split.id)} value={String(split.id)}>{String(split.name)} · {String(split.created_at ?? "")}</option>)}</select></label>
          <label title="How many images to sample from each train/valid/test bucket."><span>Samples per bucket</span><input type="number" min="1" max="12" value={sampleLimit} onChange={(event) => setSampleLimit(Number(event.target.value))} /></label>
        </div>
        {selectedSplit && <p className="muted">Previewing {datasetSplitLineageLabel(selectedSplit, runs, augmentationRuns)} · train/val/test={String(selectedSplit.train_ratio)}/{String(selectedSplit.val_ratio)}/{String(selectedSplit.test_ratio)} · {String(selectedSplit.dataset_yaml_path)}</p>}
        {loadingSamples ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> Rendering split sample boxes…</p> : null}
        <SplitSamplePreview samples={samples} />
        {splits.map((split) => <article key={String(split.id)} className="row-card"><strong>{String(split.name)}</strong><span>{datasetSplitLineageLabel(split, runs, augmentationRuns)} · {String(split.dataset_yaml_path)} · train/val/test={String(split.train_ratio)}/{String(split.val_ratio)}/{String(split.test_ratio)}</span></article>)}
      </div>
    </section>
  );
}

function SplitSamplePreview({ samples }: { samples: SplitSamples }) {
  const buckets: Array<keyof SplitSamples> = ["train", "valid", "test"];
  return (
    <div className="split-preview">
      {buckets.map((bucket) => (
        <section key={bucket} className="split-preview-bucket">
          <h3>{bucket === "valid" ? "Validation" : bucket.charAt(0).toUpperCase() + bucket.slice(1)} samples</h3>
          <div className="split-sample-grid">
            {samples[bucket].length ? samples[bucket].map((sample) => <SplitSampleCard key={`${bucket}-${sample.image_id}`} sample={sample} />) : <p className="muted">No samples in this bucket.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function SplitSampleCard({ sample }: { sample: SplitSample }) {
  const width = Number(sample.width) || 640;
  const height = Number(sample.height) || 480;
  return (
    <article className="split-sample-card">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${sample.bucket} sample ${sample.file_name}`}>
        <image href={`/api/files?path=${encodeURIComponent(sample.image_path)}`} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
        {sample.annotations.map((annotation, index) => {
          const x = (annotation.x_center - annotation.width / 2) * width;
          const y = (annotation.y_center - annotation.height / 2) * height;
          const rectWidth = annotation.width * width;
          const rectHeight = annotation.height * height;
          return (
            <g key={`${annotation.class_id}-${index}`}>
              <rect x={x} y={y} width={rectWidth} height={rectHeight} />
              <text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name || `class ${annotation.class_id}`}</text>
            </g>
          );
        })}
      </svg>
      <div><strong>{sample.file_name}</strong><span>{sample.annotations.length} boxes</span></div>
    </article>
  );
}

export function parseTrainingMetrics(run?: TrainingRun | null): TrainingMetric[] {
  if (!run?.metrics_json) return [];
  try {
    const parsed = JSON.parse(run.metrics_json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        ...Object.fromEntries(Object.entries(item).filter(([, value]) => typeof value === "number")),
        epoch: Number(item.epoch)
      }))
      .filter((item): item is TrainingMetric => Number.isFinite(item.epoch));
  } catch {
    return [];
  }
}

function trainingRunDisplayName(run: TrainingRun) {
  return run.run_name || `Train_${run.id.slice(0, 8)}`;
}

export function TrainingLossChart({ run }: { run?: TrainingRun | null }) {
  const metrics = parseTrainingMetrics(run);
  const series = [
    { key: "box_loss", title: "Box loss", color: "#2563eb" },
    { key: "cls_loss", title: "Class loss", color: "#16a34a" },
    { key: "dfl_loss", title: "DFL loss", color: "#dc2626" }
  ];
  const latest = metrics.at(-1);
  return (
    <section className="training-loss-chart">
      <div className="sidebar-header"><div><h3>Training loss</h3><p className="muted">{latest ? `Epoch ${latest.epoch}/${latest.total_epochs ?? "?"}` : "Waiting for the first epoch metric."}</p></div></div>
      {metrics.length ? <div className="loss-chart-grid">{series.map((item) => <SingleLossChart key={item.key} metrics={metrics} metricKey={item.key} title={item.title} color={item.color} />)}</div> : <p className="muted">No loss points have been written yet.</p>}
    </section>
  );
}

function linearRegression(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 0.000001) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function SingleLossChart({ metrics, metricKey, title, color }: { metrics: TrainingMetric[]; metricKey: string; title: string; color: string }) {
  const points = metrics
    .map((metric) => ({ epoch: Number(metric.epoch), value: Number(metric[metricKey]) }))
    .filter((point) => Number.isFinite(point.epoch) && Number.isFinite(point.value));
  if (!points.length) {
    return <article className="single-loss-chart"><h4>{title}</h4><p className="muted">No points yet.</p></article>;
  }
  const width = 280;
  const height = 170;
  const padLeft = 42;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 34;
  const values = points.map((point) => point.value);
  const epochs = points.map((point) => point.epoch);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const yMin = Number.isFinite(minValue) ? Math.max(0, minValue - Math.max(0.02, (maxValue - minValue) * 0.15)) : 0;
  const yMax = Number.isFinite(maxValue) ? maxValue + Math.max(0.02, (maxValue - minValue) * 0.15) : 1;
  const xMin = Math.min(...epochs);
  const xMax = Math.max(...epochs);
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const xFor = (epoch: number) => padLeft + ((epoch - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
  const yFor = (value: number) => padTop + (1 - ((value - yMin) / Math.max(0.0001, yMax - yMin))) * plotHeight;
  const polyline = points.map((point) => `${xFor(point.epoch).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
  const trend = linearRegression(points.map((point) => ({ x: point.epoch, y: point.value })));
  const trendStart = trend ? { x: xMin, y: trend.slope * xMin + trend.intercept } : null;
  const trendEnd = trend ? { x: xMax, y: trend.slope * xMax + trend.intercept } : null;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = Array.from(new Set([xMin, Math.round((xMin + xMax) / 2), xMax])).filter(Number.isFinite);
  return (
    <article className="single-loss-chart">
      <h4>{title}</h4>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} by epoch`}>
        <line className="loss-axis" x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} />
        <line className="loss-axis" x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} />
        {yTicks.map((tick) => <g className="loss-axis-tick" key={`y-${tick.toFixed(4)}`}><line x1={padLeft - 4} y1={yFor(tick)} x2={width - padRight} y2={yFor(tick)} /><text x={4} y={yFor(tick) + 4}>{tick.toFixed(2)}</text></g>)}
        {xTicks.map((tick) => <g className="loss-axis-tick" key={`x-${tick}`}><line x1={xFor(tick)} y1={height - padBottom} x2={xFor(tick)} y2={height - padBottom + 4} /><text x={xFor(tick) - 8} y={height - 10}>{tick}</text></g>)}
        <text className="loss-axis-label" x={width / 2 - 16} y={height - 2}>Epoch</text>
        <text className="loss-axis-label" x={2} y={12}>Loss</text>
        {polyline ? <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" /> : null}
        {trendStart && trendEnd ? <line className="loss-regression" x1={xFor(trendStart.x)} y1={yFor(trendStart.y)} x2={xFor(trendEnd.x)} y2={yFor(trendEnd.y)} /> : null}
        {points.map((point) => <circle className="loss-point" key={`${metricKey}-${point.epoch}`} cx={xFor(point.epoch)} cy={yFor(point.value)} r="3.2" fill={color}><title>{`Epoch ${point.epoch}: ${point.value.toFixed(4)}`}</title></circle>)}
      </svg>
    </article>
  );
}

export function TrainingRunSummary({ run }: { run?: TrainingRun | null }) {
  if (!run) return <section className="build-summary"><h3>Training run</h3><p className="muted">No training run selected yet.</p></section>;
  return (
    <section className="build-summary">
      <h3>{trainingRunDisplayName(run)}</h3>
      <dl>
        <div><dt>Status</dt><dd>{run.status || "unknown"}</dd></div>
        <div><dt>Ultralytics save_dir</dt><dd>{run.save_dir || "not finished"}</dd></div>
        <div><dt>Best model</dt><dd>{run.best_model_path || "not available"}</dd></div>
        <div><dt>Last model</dt><dd>{run.last_model_path || "not available"}</dd></div>
      </dl>
    </section>
  );
}

function TrainPage({ project, models, jobs, refreshJobs, t, artifactRevision }: { project: Project; models: ModelLists; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string; artifactRevision: number }) {
  const [splits, setSplits] = useState<Array<Record<string, unknown>>>([]);
  const [pseudoRuns, setPseudoRuns] = useState<PseudoLabelRun[]>([]);
  const [augmentationRuns, setAugmentationRuns] = useState<AugmentationRun[]>([]);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [splitId, setSplitId] = useState("");
  const [inputModel, setInputModel] = useState("");
  const [runName, setRunName] = useState(() => `Train_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}_v001`);
  const [submitting, setSubmitting] = useState(false);
  const [loadingInputs, setLoadingInputs] = useState(false);
  async function loadTrainingContext() {
    setLoadingInputs(true);
    try {
      const [items, nextPseudoRuns, nextAugmentationRuns, nextTrainingRuns] = await Promise.all([api.datasetSplits(project.id), api.pseudoLabelRuns(project.id), api.augmentationRuns(project.id), api.trainingRuns(project.id)]);
      setSplits(items);
      setPseudoRuns(nextPseudoRuns);
      setAugmentationRuns(nextAugmentationRuns);
      setTrainingRuns(nextTrainingRuns);
      if (items[0]?.id) setSplitId((current) => current || String(items[0].id));
    } finally {
      setLoadingInputs(false);
    }
  }
  useEffect(() => {
    setRunName(`Train_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}_v001`);
    setSplitId("");
    loadTrainingContext().catch(console.error);
  }, [project.id]);
  useEffect(() => {
    setInputModel(models.input_models[0] ?? "yolov8n.pt");
  }, [models.input_models]);
  const trainingJob = findWorkflowJob(jobs, "training");
  useEffect(() => {
    if (trainingJob) {
      api.trainingRuns(project.id).then(setTrainingRuns).catch(console.error);
    }
  }, [project.id, trainingJob?.id, trainingJob?.progress, trainingJob?.status]);
  useEffect(() => {
    if (!artifactRevision) return;
    loadTrainingContext().catch((error) => {
      setLoadingInputs(false);
      console.error(error);
    });
  }, [artifactRevision]);
  const selectedSplit = splits.find((split) => String(split.id) === splitId);
  const selectedOrLatestRun = trainingRuns.find((run) => run.job_id === trainingJob?.id) ?? trainingRuns[0] ?? null;
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          const form = new FormData(event.currentTarget);
          await api.train(project.id, {
            run_name: runName,
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
          await loadTrainingContext();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>{t("train")}</h2>
      <p className="muted">Train uses the selected split dataset.yaml. Every numeric/control below has a direct meaning; hover labels for detail.</p>
      <label title="Training build name shown later in Validate and Model Convert selectors."><span>Training run name</span><input value={runName} onChange={(event) => setRunName(event.target.value)} /></label>
      {loadingInputs ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> Syncing latest split/model inputs…</p> : null}
      <label title="Dataset split YAML created from Split. This decides train/validation/test images and class names."><span>Dataset split</span><select value={splitId} disabled={loadingInputs} onChange={(event) => setSplitId(event.target.value)}>
        {splits.map((split) => (
          <option key={String(split.id)} value={String(split.id)}>
            {datasetSplitLineageLabel(split, pseudoRuns, augmentationRuns)}
          </option>
        ))}
      </select></label>
      <TrainingInputSummary split={selectedSplit} pseudoRuns={pseudoRuns} augmentationRuns={augmentationRuns} />
      <label title="Starting YOLO weights. Use a pretrained input model for fine-tuning or an output model for continued training."><span>Input model</span><select value={inputModel} onChange={(event) => setInputModel(event.target.value)}>
        {(models.input_models.length ? models.input_models : ["yolov8n.pt"]).map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select></label>
      <div className="field-row">
        <label title="Epochs: complete passes through all training images. More can improve learning but increases overfitting/time."><span>Epochs</span><input name="epochs" type="number" min="1" defaultValue="100" /></label>
        <label title="imgsz: square input resize used by YOLO, e.g. 640 means 640×640. Larger keeps details but uses more VRAM."><span>Image size</span><input name="imgsz" type="number" min="1" defaultValue="640" /></label>
        <label title="Batch: images per optimizer step. Larger is faster but needs more GPU memory."><span>Batch</span><input name="batch" type="number" min="1" defaultValue="16" /></label>
      </div>
      <div className="field-row">
        <label title="Device: cuda uses NVIDIA GPU; cpu is slower but useful for debugging."><span>Device</span><select name="device" defaultValue="cuda"><option>cuda</option><option>cpu</option></select></label>
        <label title="Patience: early stop after this many validation epochs without improvement."><span>Patience</span><input name="patience" type="number" min="1" defaultValue="10" /></label>
        <label title="Optimizer: SGD is stable/default; Adam/AdamW may converge faster but can need LR tuning."><span>Optimizer</span><select name="optimizer" defaultValue="SGD"><option>SGD</option><option>Adam</option><option>AdamW</option></select></label>
      </div>
      <div className="field-row">
        <label title="lr0: initial learning rate. 0.01 is common for SGD; too high diverges, too low learns slowly."><span>Initial LR</span><input name="lr0" type="number" min="0" step="0.001" defaultValue="0.01" /></label>
        <label title="lrf: final LR factor for the scheduler. 0.01 means decay to 1% of initial LR by the end."><span>Final LR factor</span><input name="lrf" type="number" min="0" step="0.001" defaultValue="0.01" /></label>
      </div>
      <div className="param-help-grid">
        <ParameterHelp name="100 epochs" value="time/overfit" help="How many full passes over the training set." />
        <ParameterHelp name="640 imgsz" value="detail/VRAM" help="Resize size for YOLO input; larger can detect smaller objects." />
        <ParameterHelp name="16 batch" value="VRAM" help="Images per step; reduce if CUDA out-of-memory occurs." />
        <ParameterHelp name="cuda" value="GPU" help="Use AGX GPU acceleration for training." />
        <ParameterHelp name="SGD / 0.01" value="optimizer/LR" help="How weights are updated and initial update size." />
      </div>
      {trainingJob && <div className="job-progress-inline" title={trainingJob.message}><span>{trainingJob.name}: {trainingJob.status}</span><progress value={trainingJob.progress} max={100} /><small>{trainingJob.progress}% · {trainingJob.message}</small></div>}
      <TrainingLossChart run={selectedOrLatestRun} />
      <TrainingRunSummary run={selectedOrLatestRun} />
      {trainingRuns.length ? <section className="build-summary"><h3>Training history</h3><div className="version-list">{trainingRuns.map((run) => <article key={run.id}><strong>{trainingRunDisplayName(run)}</strong><span>{run.status || "unknown"} · {run.save_dir || run.output_dir || "waiting for save_dir"}</span></article>)}</div></section> : null}
      <ProcessingButton busy={submitting || isActiveJob(trainingJob)} progress={trainingJob ? trainingJob.progress : submitting ? 10 : undefined} statusText={trainingJob ? trainingJob.message || `${trainingJob.name}: ${trainingJob.status}` : "Submitting training run…"} className="primary action-process"><Play size={17} />{t("train")}</ProcessingButton>
    </form>
  );
}

export function ParameterHelp({ name, value, help }: { name: string; value: string; help: string }) {
  return <article className="param-help" title={help}><strong>{name}</strong><span>{value}</span><p>{help}</p></article>;
}

export function ValidationRandomButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button type="button" className="primary action-validate" onClick={onClick} disabled={loading} title="Random sample: choose one image from the selected folder and rerun inference">
      {loading ? <LoaderCircle size={18} className="spin" /> : <Dice5 size={18} />}
      {loading ? "Running inference…" : "Random sample"}
    </button>
  );
}

function ValidationPage({ project, models, artifactRevision }: { project: Project; models: ModelLists; artifactRevision: number }) {
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [modelSources, setModelSources] = useState<ModelSource[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [modelName, setModelName] = useState("");
  const [folderPath, setFolderPath] = useState("/home/a0665x/Desktop/AI_AGX_WS/autolabel/0629");
  const [showBrowser, setShowBrowser] = useState(false);
  const [result, setResult] = useState<ValidationPreviewResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  useEffect(() => { api.classSchemas(project.id).then((items) => { setSchemas(items); if (items[0]) setSchemaId(items[0].id); }).catch(console.error); }, [project.id]);
  async function loadModelSources(preferLatest: boolean) {
    setLoadingModels(true);
    try {
      const items = await api.modelSources(project.id);
      setModelSources(items);
      setModelName((current) => preferLatest ? items[0]?.path ?? current : current || items[0]?.path || "");
    } finally {
      setLoadingModels(false);
    }
  }
  useEffect(() => { loadModelSources(false).catch(console.error); }, [project.id]);
  useEffect(() => { if (artifactRevision) loadModelSources(true).catch(console.error); }, [artifactRevision]);
  useEffect(() => { if (!modelName) setModelName(modelSources[0]?.path ?? models.output_models[0] ?? models.input_models[0] ?? "yolov8n.pt"); }, [modelName, modelSources, models.output_models, models.input_models]);
  async function runRandomInference() {
    setError("");
    setLoading(true);
    try {
      setResult(await api.validationPreview(project.id, { model_name: modelName, schema_id: schemaId || null, folder_path: folderPath, confidence: 0.25, iou: 0.7 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const fallbackModels = [...models.output_models, ...models.input_models];
  return <section className="panel-grid"><div className="panel wide">{showBrowser && <FileManagerDialog mode="image_folder" initialPath={folderPath} onClose={() => setShowBrowser(false)} onSelect={(path) => { setFolderPath(path); setShowBrowser(false); }} />}<div className="sidebar-header"><div><h2>Validate / random inference</h2><p className="muted">Choose a model and class schema, then sample one image from a folder. Random sample picks another image and runs inference again.</p></div><ValidationRandomButton loading={loading} onClick={runRandomInference} /></div>{loadingModels ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> Syncing latest project models…</p> : null}<div className="field-row"><label title="Model artifact used for inference. Current project training outputs are listed before global models."><span>Model source</span><select value={modelName} disabled={loadingModels} onChange={(event) => setModelName(event.target.value)}>{modelSources.map((source) => <option key={source.id} value={source.path}>{source.label}</option>)}{fallbackModels.length ? <optgroup label="Global models">{fallbackModels.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup> : null}</select></label><label title="Class schema used to show id/name context next to model outputs."><span>Class schema</span><select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}><option value="">Model native classes</option>{schemas.map((schema) => <option key={schema.id} value={schema.id}>{schema.name}</option>)}</select></label></div><div className="field-row"><input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} /><button type="button" className="secondary action-browse" onClick={() => setShowBrowser(true)}><FolderOpen size={16} />Browse folder</button></div>{selectedSchema && <SchemaHierarchy schema={selectedSchema} />}{error && <p className="review-error">{error}</p>}{result && <InferencePreviewCard result={result} />}</div></section>;
}

export function InferencePreviewCard({ result }: { result: ValidationPreviewResult }) {
  const width = Number(result.width) || 640;
  const height = Number(result.height) || 480;
  return <article className="split-sample-card validation-card"><div><strong>{result.file_name}</strong><span>model: {result.model_name} · schema: {result.schema_name} · {result.annotations.length} detections</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`validation inference ${result.file_name}`}><image href={result.image_url} width={width} height={height} preserveAspectRatio="xMidYMid meet" />{result.annotations.map((annotation, index) => { const x = (annotation.x_center - annotation.width / 2) * width; const y = (annotation.y_center - annotation.height / 2) * height; const rectWidth = annotation.width * width; const rectHeight = annotation.height * height; return <g key={`${annotation.class_id}-${index}`}><rect x={x} y={y} width={rectWidth} height={rectHeight} /><text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name} {typeof annotation.confidence === "number" ? annotation.confidence.toFixed(2) : ""}</text></g>; })}</svg></article>;
}

const CONVERSION_TARGETS = [
  { key: "onnx:fp32", format: "onnx", precision: "fp32", label: "FP32" },
  { key: "onnx:fp16", format: "onnx", precision: "fp16", label: "FP16" },
  { key: "tflite:fp32", format: "tflite", precision: "fp32", label: "FP32" },
  { key: "tflite:fp16", format: "tflite", precision: "fp16", label: "FP16" },
  { key: "tflite:int8", format: "tflite", precision: "int8", label: "INT8" }
];

function targetKey(format: string, precision: string) {
  return `${format}:${precision}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "not finished";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function SchemaClassMap({ schema }: { schema?: ClassSchema | null }) {
  if (!schema) return <div className="schema-class-map empty"><strong>Class schema manifest</strong><span>No schema selected</span></div>;
  return (
    <div className="schema-class-map">
      <strong>Class schema manifest</strong>
      <span>{schema.name}</span>
      <div className="class-id-grid">
        {schema.classes.map((item) => (
          <div key={item.class_id} className="class-id-row"><code>id {item.class_id}</code><span>{item.class_name}</span></div>
        ))}
      </div>
    </div>
  );
}

export function ConversionTargetMatrix({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="conversion-target-matrix">
      {["onnx", "tflite"].map((format) => (
        <section key={format}>
          <strong>{format === "onnx" ? "ONNX" : "TFLite"}</strong>
          <div>
            {CONVERSION_TARGETS.filter((target) => target.format === format).map((target) => (
              <label key={target.key} className="check-row">
                <input type="checkbox" checked={selected.includes(target.key)} onChange={() => onToggle(target.key)} />
                {target.label}
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ConversionPackageSummary({
  conversion,
  selectedArtifactId,
  onSelectArtifact,
  onExport,
  exporting
}: {
  conversion: ModelConversionRun;
  selectedArtifactId: string;
  onSelectArtifact: (artifactId: string) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const completedArtifacts = conversion.artifacts.filter((artifact) => artifact.status === "completed");
  return (
    <article className="conversion-package">
      <div className="conversion-package-main">
        <div>
          <strong>{conversion.package_name}</strong>
          <span>{conversion.status} · schema: {conversion.schema_name}</span>
          <small>created: {formatDateTime(conversion.created_at)}</small>
          <small>completed: {conversion.status === "completed" ? formatDateTime(conversion.updated_at) : "not completed"}</small>
          <small>{conversion.source_model_path}</small>
        </div>
        <button type="button" className="secondary action-export" disabled={conversion.status !== "completed" || completedArtifacts.length === 0 || exporting} onClick={onExport} title="Download native PT, converted models, classes.json, metadata.json, and bundle manifest">
          <Download size={16} />{exporting ? "Exporting..." : "Export ZIP"}
        </button>
      </div>
      <div className="artifact-chip-row">
        {conversion.artifacts.map((artifact) => (
          <button key={artifact.id} type="button" className={selectedArtifactId === artifact.id ? "active artifact-chip" : "artifact-chip"} onClick={() => onSelectArtifact(artifact.id)}>
            {artifact.format} · {artifact.precision} · {artifact.status}
          </button>
        ))}
      </div>
    </article>
  );
}

export function ExportPackageSummary({ conversion, selectedArtifactIds, includeNativePt, onToggleArtifact, onToggleNative }: { conversion: ModelConversionRun; selectedArtifactIds: string[]; includeNativePt: boolean; onToggleArtifact: (artifactId: string) => void; onToggleNative: () => void }) {
  return (
    <div className="export-package-summary">
      <h3>{conversion.package_name}</h3>
      <label className="check-row"><input type="checkbox" checked={includeNativePt} onChange={onToggleNative} />Native PT</label>
      <div className="manifest-files"><span>classes.json</span><span>metadata.json</span></div>
      {conversion.artifacts.map((artifact) => (
        <label key={artifact.id} className="check-row">
          <input type="checkbox" checked={selectedArtifactIds.includes(artifact.id)} onChange={() => onToggleArtifact(artifact.id)} />
          {artifact.format} · {artifact.precision}
        </label>
      ))}
    </div>
  );
}

export function ModelSourceSelector({ sources, value, onChange }: { sources: ModelSource[]; value: string; onChange: (sourceId: string) => void }) {
  const groups: Array<[ModelSource["scope"], string]> = [
    ["current_project", "Current project models"],
    ["other_project", "Other project models"],
    ["loose_output", "Loose output_model models"]
  ];
  return (
    <label><span>Model source</span><select value={value} onChange={(event) => onChange(event.target.value)}>
      {groups.map(([scope, label]) => {
        const items = sources.filter((source) => source.scope === scope);
        if (!items.length) return null;
        return <optgroup key={scope} label={label}>{items.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</optgroup>;
      })}
    </select></label>
  );
}

function ModelConvertPage({ project, jobs, refreshJobs }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void> }) {
  const [modelSources, setModelSources] = useState<ModelSource[]>([]);
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [conversions, setConversions] = useState<ModelConversionRun[]>([]);
  const [modelSourceId, setModelSourceId] = useState("");
  const [schemaId, setSchemaId] = useState("");
  const [selectedTargets, setSelectedTargets] = useState(["onnx:fp32", "tflite:int8"]);
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [netronUrl, setNetronUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exportingConversionId, setExportingConversionId] = useState("");
  const [exportError, setExportError] = useState("");
  const conversionJob = findWorkflowJob(jobs, "model_conversion");
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const selectedModelSource = modelSources.find((source) => source.id === modelSourceId);

  async function loadConvertData() {
    const [sourceModels, classSchemas, conversionRuns] = await Promise.all([
      api.modelSources(project.id),
      api.classSchemas(project.id),
      api.modelConversions(project.id)
    ]);
    setModelSources(sourceModels);
    setSchemas(classSchemas);
    setConversions(conversionRuns);
    if (!modelSourceId && sourceModels[0]?.id) setModelSourceId(sourceModels[0].id);
    if (!schemaId && classSchemas[0]?.id) setSchemaId(classSchemas[0].id);
    const firstArtifact = conversionRuns[0]?.artifacts[0];
    if (!selectedArtifactId && firstArtifact) setSelectedArtifactId(firstArtifact.id);
  }

  useEffect(() => { loadConvertData().catch(console.error); }, [project.id]);

  function toggleTarget(key: string) {
    setSelectedTargets((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  async function openNetron(conversion: ModelConversionRun, artifactId: string) {
    setSelectedArtifactId(artifactId);
    const result = await api.modelConversionNetron(project.id, conversion.id, artifactId);
    setNetronUrl(result.url);
  }

  async function exportConversion(conversion: ModelConversionRun) {
    setExportError("");
    setExportingConversionId(conversion.id);
    try {
      const result = await api.downloadModelConversionExport(project.id, conversion.id);
      saveBlob(result.blob, result.filename);
      await loadConvertData();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingConversionId("");
    }
  }

  return (
    <section className="panel-grid">
      <form className="panel" onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          await api.createModelConversion(project.id, {
            training_run_id: selectedModelSource?.training_run_id ?? null,
            source_model_path: selectedModelSource?.path,
            schema_id: schemaId,
            targets: selectedTargets.map((key) => {
              const [format, precision] = key.split(":");
              return { format, precision };
            }),
            imgsz: Number(new FormData(event.currentTarget).get("imgsz"))
          });
          await refreshJobs();
          await loadConvertData();
        } finally {
          setSubmitting(false);
        }
      }}>
        <h2>Model Convert</h2>
        <p className="muted">Create one conversion package from any completed PT/PTH model source, selected formats, and an explicit class schema manifest.</p>
        <ModelSourceSelector sources={modelSources} value={modelSourceId} onChange={setModelSourceId} />
        {selectedModelSource && <p className="inline-feedback">{selectedModelSource.scope} · {selectedModelSource.source_type} · {selectedModelSource.relative_path}</p>}
        <label><span>Class schema</span><select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
          {schemas.map((schema) => <option key={schema.id} value={schema.id}>{schema.name}</option>)}
        </select></label>
        <SchemaClassMap schema={selectedSchema} />
        <label><span>Image size</span><input name="imgsz" type="number" min="1" defaultValue="640" /></label>
        <ConversionTargetMatrix selected={selectedTargets} onToggle={toggleTarget} />
        {conversionJob && <div className="job-progress-inline" title={conversionJob.message}><span>{conversionJob.name}: {conversionJob.status}</span><progress value={conversionJob.progress} max={100} /><small>{conversionJob.progress}% · {conversionJob.message}</small></div>}
        <ProcessingButton busy={submitting || isActiveJob(conversionJob)} disabled={!selectedModelSource || !schemaId || selectedTargets.length === 0} progress={conversionJob ? conversionJob.progress : submitting ? 10 : undefined} statusText={conversionJob ? conversionJob.message : "Submitting conversion package…"} className="primary action-process"><PackageCheck size={17} />Convert package</ProcessingButton>
      </form>
      <section className="panel wide">
        <h2>Conversion packages</h2>
        {conversions.length === 0 && <p className="muted">No conversion package yet.</p>}
        {exportError && <p className="review-error">{exportError}</p>}
        {conversions.map((conversion) => (
          <ConversionPackageSummary
            key={conversion.id}
            conversion={conversion}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={(artifactId) => openNetron(conversion, artifactId).catch(console.error)}
            onExport={() => exportConversion(conversion).catch(console.error)}
            exporting={exportingConversionId === conversion.id}
          />
        ))}
        <div className="netron-panel">
          {netronUrl ? <iframe title="Netron model graph" src={netronUrl} /> : <p className="muted">Select an artifact to open Netron preview. Mouse wheel zoom and drag are handled by Netron.</p>}
        </div>
      </section>
    </section>
  );
}

function ExportPage({ project, jobs, refreshJobs, t }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const [conversions, setConversions] = useState<ModelConversionRun[]>([]);
  const [conversionId, setConversionId] = useState("");
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [includeNativePt, setIncludeNativePt] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const exportJob = findWorkflowJob(jobs, "model_export_bundle") || findWorkflowJob(jobs, "model_export");
  const selectedConversion = conversions.find((conversion) => conversion.id === conversionId);
  useEffect(() => {
    api.modelConversions(project.id).then((items) => {
      setConversions(items);
      if (items[0]?.id) {
        setConversionId(items[0].id);
        setSelectedArtifactIds(items[0].artifacts.map((artifact) => artifact.id));
      }
    });
  }, [project.id]);
  function toggleArtifact(artifactId: string) {
    setSelectedArtifactIds((current) => current.includes(artifactId) ? current.filter((item) => item !== artifactId) : [...current, artifactId]);
  }
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          await api.createExportBundle(project.id, {
            conversion_run_id: conversionId,
            include_artifact_ids: selectedArtifactIds,
            include_native_pt: includeNativePt
          });
          await refreshJobs();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>{t("export")}</h2>
      <p className="muted">Export is tied to a Model Convert package so the native PT, converted artifacts, classes.json, and metadata.json stay together.</p>
      <select value={conversionId} onChange={(event) => {
        const nextId = event.target.value;
        setConversionId(nextId);
        const next = conversions.find((conversion) => conversion.id === nextId);
        setSelectedArtifactIds(next ? next.artifacts.map((artifact) => artifact.id) : []);
      }}>
        {conversions.map((conversion) => (
          <option key={conversion.id} value={conversion.id}>
            {conversion.package_name} · {conversion.status} · {conversion.artifacts.length} artifacts
          </option>
        ))}
      </select>
      {selectedConversion ? <ExportPackageSummary conversion={selectedConversion} selectedArtifactIds={selectedArtifactIds} includeNativePt={includeNativePt} onToggleArtifact={toggleArtifact} onToggleNative={() => setIncludeNativePt((current) => !current)} /> : <p className="muted">Create a Model Convert package first.</p>}
      {exportJob && <div className="job-progress-inline" title={exportJob.message}><span>{exportJob.name}: {exportJob.status}</span><progress value={exportJob.progress} max={100} /><small>{exportJob.progress}% · {exportJob.message}</small></div>}
      <ProcessingButton busy={submitting || isActiveJob(exportJob)} disabled={!conversionId} progress={exportJob ? exportJob.progress : submitting ? 10 : undefined} statusText={exportJob ? exportJob.message || `${exportJob.name}: ${exportJob.status}` : "Submitting export bundle…"} className="primary action-export">{t("export")}</ProcessingButton>
    </form>
  );
}

export function SettingsPage({ models, t, activeProject, context }: { models: ModelLists; t: (key: string) => string; activeProject?: Project; context?: ProjectArtifactContext | null }) {
  const [pseudoModel, setPseudoModel] = useState(models.world_models[0] ?? "yolov8s-world.pt");
  const [trainModel, setTrainModel] = useState(models.input_models[0] ?? "yolov8n.pt");
  const [augmentDefault, setAugmentDefault] = useState("Skip augment");
  const [splitDefault, setSplitDefault] = useState("80 / 10 / 10");
  const [trainDevice, setTrainDevice] = useState("cuda");
  useEffect(() => {
    setPseudoModel((current) => current || models.world_models[0] || "yolov8s-world.pt");
    setTrainModel((current) => current || models.input_models[0] || "yolov8n.pt");
  }, [models.world_models, models.input_models]);
  return (
    <section className="panel-grid settings-grid">
      <section className="panel wide settings-panel">
        <div className="sidebar-header"><div><h2>Workflow defaults</h2><p className="muted">Defaults used when entering each workflow tab. They keep the project flow explicit without hiding build selectors.</p></div></div>
        <div className="settings-control-grid">
          <label><span>Pseudo default model</span><select value={pseudoModel} onChange={(event) => setPseudoModel(event.target.value)}>{(models.world_models.length ? models.world_models : ["yolov8s-world.pt"]).map((model) => <option key={model}>{model}</option>)}</select></label>
          <label><span>Train input model</span><select value={trainModel} onChange={(event) => setTrainModel(event.target.value)}>{(models.input_models.length ? models.input_models : ["yolov8n.pt"]).map((model) => <option key={model}>{model}</option>)}</select></label>
          <label><span>Augment default</span><select value={augmentDefault} onChange={(event) => setAugmentDefault(event.target.value)}><option>Skip augment</option><option>x3</option><option>x5</option><option>x8</option><option>x10</option></select></label>
          <label><span>Split ratio preset</span><select value={splitDefault} onChange={(event) => setSplitDefault(event.target.value)}><option>80 / 10 / 10</option><option>70 / 20 / 10</option><option>90 / 5 / 5</option></select></label>
          <label><span>Train device</span><select value={trainDevice} onChange={(event) => setTrainDevice(event.target.value)}><option>cuda</option><option>cpu</option></select></label>
        </div>
        <p className="inline-feedback">These are UI defaults for faster setup. Every workflow tab still shows the exact input build before running.</p>
      </section>

      <section className="panel settings-panel">
        <h2>Project storage</h2>
        <dl className="settings-detail-list">
          <div><dt>Active project</dt><dd>{activeProject?.name ?? "No project selected"}</dd></div>
          <div><dt>Project folder</dt><dd>{activeProject?.root_path ?? "Create or select a project first."}</dd></div>
          <div><dt>Sources / pseudo / augment / split</dt><dd>{context ? `${context.counts.sources} sources · ${context.counts.pseudo_label_runs ?? 0} pseudo builds · ${context.counts.augmentation_runs ?? 0} augment/source builds · ${context.counts.dataset_splits} splits` : "Loading project context…"}</dd></div>
          <div><dt>Training / packages</dt><dd>{context ? `${context.counts.training_runs} training runs · ${context.counts.model_sources} model sources · ${context.counts.conversion_packages} conversion packages · ${context.counts.export_bundles} export bundles` : "Loading project context…"}</dd></div>
        </dl>
      </section>

      <section className="panel settings-panel">
        <h2>Runtime deployment</h2>
        <div className="runtime-mode-grid">
          <article><strong>Desktop x86_64</strong><span>Uses docker-compose.yml and the CUDA PyTorch desktop image. Use `./run.sh --mode desktop` on x86 workstations.</span></article>
          <article><strong>Jetson ARM64</strong><span>Uses docker-compose.jetson.yml and NVIDIA igpu/L4T PyTorch images. Use `./run.sh --mode jetson` on Orin/JetPack systems.</span></article>
        </div>
        <p className="muted">Run `./run.sh --detect` or `./run.sh --plan desktop` to inspect mode, architecture, compose file, and bind host without changing containers.</p>
      </section>

      <ModelList title={t("worldModels")} subtitle="YOLO-World weights used by Pseudo." items={models.world_models} />
      <ModelList title={t("inputModels")} subtitle="Pretrained YOLO weights used by Train." items={models.input_models} />
      <ModelList title={t("outputModels")} subtitle="Global/project model index used by Validate and Convert." items={models.output_models} />
    </section>
  );
}

function ModelList({ title, items, subtitle }: { title: string; items: string[]; subtitle?: string }) {
  return (
    <div className="panel settings-panel">
      <h2>{title}</h2>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
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
