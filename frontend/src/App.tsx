import {useUiText, uiText, UiLanguageProvider} from './uiText';
import { WorkflowProvider, AssignmentFooter, WorkflowInputs, useWorkflow } from "./workflow/WorkflowState";
import { CompositionBoard } from "./workflow/CompositionBoard";
import { VersionInspector } from './workflow/VersionInspector';
import {BoxAreaRange} from './components/BoxAreaRange';
import {SplitCoverage} from './components/SplitCoverage';
import type {BoxAreaDistribution} from './api/client';
import { recipeIssue, splitRecipe } from './workflow/composition';
import {workflowText} from './workflow/text';
import {WorkflowError} from './workflow/WorkflowError';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Brain,
  Database,
  Dice5,
  Download,
  Eye,
  FileImage,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  Github,
  GripHorizontal,
  HelpCircle,
  ChevronRight,
  LoaderCircle,
  LogOut,
  PackageCheck,
  Play,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  StopCircle,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { api, ApiError, type AugmentationPreviewSample, type FileBrowserResult, type FileBrowserShortcut, type SourceAnalysis, type SplitSample, type SplitSamples, type ValidationPreviewResult } from "./api/client";
import { versionedBuildName } from "./artifactNaming";
import { translate } from "./i18n";
import { ReviewPage } from "./pages/ReviewPage";
import { OpenDataPage } from "./pages/OpenDataPage";
import { StreamDemoPage } from "./pages/StreamDemoPage";
import { shouldProceedWithReviewExit } from "./pages/reviewState";
import type { AugmentationRun, AuthStatus, ClassSchema, DatasetSplitRun, Job, Language, ModelConversionCapability, ModelConversionRun, ModelConversionTarget, ModelExportBundle, ModelLists, ModelSource, OpenDataImport, Project, ProjectArtifactContext, ProjectStorageStatus, PseudoLabelRun, SourceAsset, TrainingMetric, TrainingRun, WorldModelInfo } from "./types";

type Page = "projects" | "sources" | "schema" | "pseudo" | "review" | "augment" | "open-data" | "split" | "train" | "validate" | "convert" | "export" | "stream-demo" | "settings";
type ViewportMode = "desktop" | "mobile";

export type ClientTask = { id: string; name: string; status: "running" | "completed"; progress?: number; message?: string; updatedAt: number };
type TaskCenterItem = { id: string; title: string; status: string; progress?: number; message?: string | null; running: boolean; cancellable: boolean };

export function worldModelLabel(info: WorldModelInfo): string {
  if (info.family === "yoloe-26") return `${info.name} — YOLOE-26 · Seg → bbox`;
  if (info.family === "yolo-world-v2") return `${info.name} — YOLO-World v2 · bbox`;
  if (info.family === "yolo-world") return `${info.name} — YOLO-World · bbox`;
  return `${info.name} — Unsupported${info.reason ? `: ${info.reason}` : ""}`;
}

export function supportedWorldModels(names: string[], details: WorldModelInfo[]): string[] {
  if (!details.length) return names;
  return names.filter((name) => details.find((info) => info.name === name)?.supported === true);
}

export function firstSupportedWorldModel(names: string[], details: WorldModelInfo[]): string {
  return supportedWorldModels(names, details)[0] ?? "";
}

const pages: Array<{ id: Page; icon: React.ComponentType<{ size?: number }>; key: string }> = [
  { id: "projects", icon: Database, key: "projects" },
  { id: "sources", icon: FolderInput, key: "sources" },
  { id: "pseudo", icon: Sparkles, key: "pseudo" },
  { id: "review", icon: SquarePen, key: "review" },
  { id: "augment", icon: SlidersHorizontal, key: "Augment" },
  { id: "open-data", icon: Download, key: "openData" },
  { id: "split", icon: Scissors, key: "split" },
  { id: "train", icon: Brain, key: "train" },
  { id: "validate", icon: Eye, key: "Validate" },
  { id: "convert", icon: Boxes, key: "convert" },
  { id: "stream-demo", icon: Film, key: "Stream Demo" },
  { id: "settings", icon: Settings, key: "settings" }
];

const LOGIN_PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  facebook: "Continue with Facebook",
  line: "Continue with LINE"
};

export function LoginScreen({ status }: { status: AuthStatus }) {
  const ui = useUiText();
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-user-mark"><UserRound size={28} aria-hidden="true" /></div>
        <div>
          <p className="auth-eyebrow">ObjectAutoLabel</p>
          <h1 id="auth-title">{ui("Sign in to continue")}</h1>
          <p className="muted">{ui("Choose an identity provider to access this local labeling workspace.")}</p>
        </div>
        {status.providers.length ? (
          <div className="auth-provider-list">
            {status.providers.map((provider) => (
              <a key={provider} className={`auth-provider auth-provider-${provider}`} href={`/api/auth/login/${provider}`}>
                <UserRound size={18} aria-hidden="true" />
                <span>{LOGIN_PROVIDER_LABELS[provider] ?? ui("Continue with {v0}", {v0: provider})}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="auth-setup-message" role="alert">
            <strong>{ui("No login provider is configured.")}</strong>
            <span>{status.error ?? ui("Add at least one provider client ID/secret and restart the service.")}</span>
          </div>
        )}
        <a className="source-code-link auth-source-link" href="https://github.com/a0665x/ObjectAutoLabel" target="_blank" rel="noreferrer"><Github size={16} aria-hidden="true" /><span>{ui("AGPL-3.0 · Source code")}</span></a>
      </section>
    </main>
  );
}

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const ui = uiText(language);
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-Hant' : language; }, [language]);
  const [page, setPage] = useState<Page>("projects");
  const [root, setRoot] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [reviewDirty, setReviewDirty] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [clientTasks, setClientTasks] = useState<ClientTask[]>([]);
  const [models, setModels] = useState<ModelLists>({ world_models: [], world_model_details: [], input_models: [], output_models: [] });
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
    api.authStatus()
      .then(setAuthStatus)
      .catch((error) => setAuthStatus({ enabled: true, authenticated: false, providers: [], error: error instanceof Error ? error.message : String(error) }));
  }, []);

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    refresh().catch(console.error);
    const timer = window.setInterval(() => {
      api.jobs().then(setJobs).catch(console.error);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [authStatus?.authenticated]);

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
      if (previous && previous !== job.status && ["completed", "failed", "cancelled"].includes(job.status)) {
        changedArtifactJob = ["pseudo_label", "augmentation", "open_data_download", "open_data_import", "dataset_split", "training", "model_conversion", "model_export_bundle", "model_export", "source_analysis", "frame_extraction"].includes(job.name) || changedArtifactJob;
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

  const confirmReviewExit = () => shouldProceedWithReviewExit(page === "review", reviewDirty, message => window.confirm(ui(message)));
  const navigateToPage = (nextPage: Page) => {
    if (nextPage === page) return;
    if (!confirmReviewExit()) return;
    setPage(nextPage);
  };

  if (!authStatus) {
    return <div className="auth-loading"><LoaderCircle className="spin" size={22} /><span>{ui("Checking sign-in…")}</span></div>;
  }
  if (!authStatus.authenticated) {
    return <LoginScreen status={authStatus} />;
  }

  return (
    <UiLanguageProvider language={language}><div className={`app-shell viewport-${viewportMode}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-user-avatar" aria-label={authStatus.user ? ui("Signed in as {v0}", {v0: authStatus.user.name}) : ui("Local user")}>
            {authStatus.user?.picture ? <img src={authStatus.user.picture} alt="" referrerPolicy="no-referrer" /> : <UserRound size={22} aria-hidden="true" />}
          </div>
          <div>
            <strong>ObjectAutoLabel</strong>
            <span>{authStatus.user?.name ?? t("localFirst")}</span>
          </div>
          {authStatus.enabled ? <button type="button" className="brand-signout" title={ui("Sign out")} aria-label={ui("Sign out")} onClick={async () => { await api.logout(); window.location.reload(); }}><LogOut size={17} /></button> : null}
        </div>
        <nav className="nav">
          {pages.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                data-stage={({pseudo:'pseudo',augment:'augmentation','open-data':'open_data'} as Record<string,string>)[item.id]}
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
        <a className="source-code-link" href="https://github.com/a0665x/ObjectAutoLabel" target="_blank" rel="noreferrer"><Github size={16} aria-hidden="true" /><span>{ui("AGPL-3.0 · Source code")}</span></a>
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
              <span>{ui("Language")}</span>
              <select aria-label={ui("Language")} value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
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
        <WorkflowProvider key={activeProject?.id ?? "none"} projectId={activeProject?.id ?? ""} revision={`${artifactRevision}:${jobs.map(job => `${job.id}:${job.status}`).join("|")}`} onNavigate={next=>navigateToPage(next as Page)} language={language}>
        <VersionInspector page={page}/>
        {page==='review'&&activeProject&&<WorkflowInputs stages={['pseudo','augmentation']}/>}
        {page === "projects" && <ProjectsPage t={t} refresh={refresh} projects={projects} activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} jobs={jobs} />}
        {page === "sources" && activeProject && <SourcesPage t={t} project={activeProject} refresh={refresh} refreshArtifacts={() => refreshProjectArtifacts(activeProject.id)} />}
        {page === "schema" && activeProject && <SchemaPage t={t} project={activeProject} />}
        {page === "pseudo" && activeProject && <PseudoPage t={t} project={activeProject} models={models} jobs={jobs} refreshJobs={refresh} />}
        {page === "review" && activeProject && <ReviewPage t={t} project={activeProject} onDirtyChange={setReviewDirty} />}
        {page === "augment" && activeProject && <AugmentationPage project={activeProject} jobs={jobs} refreshJobs={refresh} artifactRevision={artifactRevision} />}
        {page === "open-data" && activeProject && <OpenDataPage project={activeProject} jobs={jobs} refreshJobs={refresh} artifactRevision={artifactRevision} />}
        {page === "split" && activeProject && <SplitPage t={t} project={activeProject} jobs={jobs} refreshJobs={refresh} artifactRevision={artifactRevision} />}
        {page === "train" && activeProject && <TrainPage project={activeProject} models={models} jobs={jobs} refreshJobs={refresh} t={t} artifactRevision={artifactRevision} onGoToSplit={() => navigateToPage("split")} />}
        {page === "validate" && activeProject && <ValidationPage project={activeProject} models={models} artifactRevision={artifactRevision} />}
        {page === "convert" && activeProject && <ModelConvertPage project={activeProject} jobs={jobs} refreshJobs={refresh} />}

        {page === "stream-demo" && activeProject && <StreamDemoPage key={activeProject.id} project={activeProject} language={language} />}
        {page === "settings" && <SettingsPage t={t} models={models} activeProject={activeProject} context={workflowContext} />}
        {activeProject && page !== 'split' && <AssignmentFooter page={page} onDeleted={async () => { await refresh(); await refreshProjectArtifacts(); }} />}
        </WorkflowProvider>
        <TaskCenter jobs={jobs} clientTasks={clientTasks} activeProjectId={activeProject?.id} onJobsChange={setJobs} docked={page === 'stream-demo'||page === 'split'} />
      </main>
    </div></UiLanguageProvider>
  );
}

export function ViewportToggle({ mode, onChange }: { mode: ViewportMode; onChange: (mode: ViewportMode) => void }) {
  const ui = useUiText();
  return (
    <div className="viewport-toggle" role="group" aria-label={ui("Viewport mode")} title={ui("Toggle Desktop/Mobile preview width")}>
      {(["desktop", "mobile"] as ViewportMode[]).map((option) => (
        <button
          key={option}
          type="button"
          className={mode === option ? "active" : ""}
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
        >
          {option === "desktop" ? ui("Desktop") : ui("Mobile")}
        </button>
      ))}
    </div>
  );
}

export function HelpTooltip({ text }: { text: string }) {
  const ui = useUiText();
  return (
    <span className="help-tooltip" tabIndex={0} role="img" aria-label={ui("Help: {v0}", {v0: text})} title={text}>
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

export function ProcessingButton({ busy, children, className = "primary", progress, statusText, taskName, disabled = false, jobId }: { busy: boolean; children: React.ReactNode; className?: string; progress?: number; statusText?: string; taskName?: string; disabled?: boolean; jobId?: string }) {
  const w=workflowText(useWorkflow()?.language);
  const cleanProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined;
  const wasBusy = useRef(false);
  const [cancelling, setCancelling] = useState(false);
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
    <button
      type={busy && jobId ? "button" : "submit"}
      className={`${className} touch-feedback processing-button intrinsic-action ${busy ? "is-processing" : ""} ${busy && jobId ? "is-cancellable" : ""}`}
      disabled={busy && jobId ? cancelling : busy || disabled}
      aria-busy={busy}
      onClick={busy && jobId ? async (event) => {
        event.preventDefault();
        setCancelling(true);
        try {
          await api.cancelJob(jobId);
        } finally {
          setCancelling(false);
        }
      } : undefined}
    >
      {busy && jobId ? <StopCircle size={17} /> : busy ? <LoaderCircle className="spin" size={17} /> : null}
      <span className="processing-button-label">{busy && jobId ? w(cancelling ? "Requesting stop…" : "Stop safely") : busy ? (statusText || w("Working…")) : children}</span>
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
    running: task.status === "running",
    cancellable: false
  }));
  const jobItems = visibleJobs.map((job) => ({
    id: job.id,
    title: humanJobName(job.name),
    status: job.status,
    progress: job.progress,
    message: job.message || job.error,
    running: isActiveJob(job),
    cancellable: ["queued", "running"].includes(job.status)
  }));
  return {
    items: [...clientItems, ...jobItems],
    activeCount: activeJobs.length + runningClientTasks.length
  };
}

export function buildTaskCenterItems(args: { jobs: Job[]; clientTasks: ClientTask[]; activeProjectId?: string; expanded: boolean }): TaskCenterItem[] {
  return buildTaskCenterState(args).items;
}

type TaskCenterPosition = { left: number; top: number };
const TASK_CENTER_POSITION_KEY = "object-autolabel.task-center-position";

function clampTaskCenterPosition(left: number, top: number, width: number, height: number): TaskCenterPosition {
  const gutter = 8;
  return {
    left: Math.max(gutter, Math.min(left, Math.max(gutter, window.innerWidth - width - gutter))),
    top: Math.max(gutter, Math.min(top, Math.max(gutter, window.innerHeight - height - gutter)))
  };
}

function loadTaskCenterPosition(): TaskCenterPosition | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(TASK_CENTER_POSITION_KEY) || "null") as TaskCenterPosition | null;
    return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null;
  } catch {
    return null;
  }
}

export function TaskCenter({ jobs, clientTasks, activeProjectId, onJobsChange, docked = false }: { jobs: Job[]; clientTasks: ClientTask[]; activeProjectId?: string; onJobsChange: (jobs: Job[]) => void; docked?: boolean }) {
  const ui = useUiText();
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<TaskCenterPosition | null>(() => loadTaskCenterPosition());
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const { items, activeCount } = buildTaskCenterState({ jobs, clientTasks, activeProjectId, expanded });
  const hasTasks = items.length > 0;
  useEffect(() => {
    if (activeCount > 0) setExpanded(true);
  }, [activeCount]);
  useEffect(() => {
    const keepInsideViewport = () => {
      const panel = panelRef.current;
      if (!panel || !position) return;
      const rect = panel.getBoundingClientRect();
      const next = clampTaskCenterPosition(position.left, position.top, rect.width, rect.height);
      if (next.left !== position.left || next.top !== position.top) setPosition(next);
    };
    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [position, expanded]);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      suppressClickRef.current = true;
      const next = clampTaskCenterPosition(drag.left + dx, drag.top + dy, drag.width, drag.height);
      setPosition(next);
      window.localStorage.setItem(TASK_CENTER_POSITION_KEY, JSON.stringify(next));
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      if (drag.moved) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    const cancel = () => { dragRef.current = null; suppressClickRef.current = false; setDragging(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging]);
  function persistPosition(next: TaskCenterPosition) {
    setPosition(next);
    window.localStorage.setItem(TASK_CENTER_POSITION_KEY, JSON.stringify(next));
  }
  function nudgePosition(dx: number, dy: number) {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    persistPosition(clampTaskCenterPosition(rect.left + dx, rect.top + dy, rect.width, rect.height));
  }
  if (!hasTasks) return null;
  return (
    <aside
      ref={panelRef}
      className={`task-center ${expanded ? "is-expanded" : "is-collapsed"}${dragging ? " is-dragging" : ""}${position ? " has-custom-position" : ""}${docked ? " is-docked" : ""}`}
      aria-label={ui("Task center")}
      style={!docked && position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}
    >
      <button
        type="button"
        className="task-center-header"
        aria-expanded={expanded}
        onPointerDown={(event) => {
          if (docked || event.button !== 0) return;
          const rect = panelRef.current?.getBoundingClientRect();
          if (!rect) return;
          suppressClickRef.current = false;
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, moved: false };
          setDragging(true);
        }}
        onKeyDown={(event) => {
          if (docked || !event.altKey) return;
          const movement: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
          const delta = movement[event.key];
          if (!delta) return;
          event.preventDefault();
          nudgePosition(delta[0], delta[1]);
        }}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setExpanded((value) => !value);
        }}
        title={docked ? ui("Expand/collapse tasks") : ui("Drag to move · Click to expand/collapse · Alt+Arrow to move with keyboard")}
      >
        <GripHorizontal className="task-drag-grip" size={16} aria-hidden="true" />
        <span className={`task-pulse ${activeCount ? "is-live" : ""}`} />
        <strong>{ui("Task Center")}</strong>
        <small>{activeCount ? ui("{v0} running", {v0: activeCount}) : ui("latest runs")}</small>
      </button>
      {expanded && <div className="task-center-list">
        {items.map((item) => <TaskToast key={item.id} title={item.title} status={item.status} progress={item.progress} message={item.message} cancellable={item.cancellable} onCancel={item.cancellable ? async () => {
          const updated = await api.cancelJob(item.id);
          onJobsChange(jobs.map((job) => job.id === updated.id ? updated : job));
        } : undefined} />)}
      </div>}
    </aside>
  );
}

function humanJobName(name: string) {
  return name.split("_").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function TaskToast({ title, status, progress, message, cancellable = false, onCancel }: { title: string; status: string; progress?: number; message?: string | null; cancellable?: boolean; onCancel?: () => Promise<void> }) {
  const ui = useUiText();
  const cleanProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined;
  const isRunning = !["completed", "failed", "cancelled"].includes(status);
  return (
    <article className={`task-toast task-${status}`}>
      <div className="task-toast-top">
        <span className="task-icon">{isRunning ? <LoaderCircle className="spin" size={15} /> : status === "failed" ? "!" : "✓"}</span>
        <div>
          <strong>{ui(title)}</strong>
          <small>{ui(status)}{cleanProgress !== undefined ? ` · ${cleanProgress}%` : ""}</small>
        </div>
      </div>
      {message ? <p>{ui(message)}</p> : null}
      {cancellable && onCancel ? <button type="button" className="task-cancel-button" onClick={() => void onCancel()}><StopCircle size={15} />{ui("Stop safely")}</button> : null}
      {cleanProgress !== undefined ? <div className="task-meter" aria-label={ui("{v0} progress {v1}%", {v0: title, v1: cleanProgress})}><span style={{ width: `${cleanProgress}%` }} /></div> : null}
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
  { page: "open-data", name: "Open Data", jobNames: ["open_data_download", "open_data_import"], hint: "Optional: map and sample a supported labeled dataset before Split.", optional: true },
  { page: "split", name: "Split", jobNames: ["dataset_split"], hint: "Build train/validation/test dataset.yaml." },
  { page: "train", name: "Train", jobNames: ["training"], hint: "Select split/model and start training." },
  { page: "validate", name: "Validate", jobNames: ["validation"], hint: "Randomly sample images and inspect model predictions.", optional: true },
  { page: "convert", name: "Convert / Export", jobNames: ["model_conversion", "model_export_bundle", "model_export"], hint: "Convert models and download packages with training evidence.", optional: true }
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
  const ui = useUiText();
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
    <section className="workflow-guide" aria-label={ui("Workflow guide")}>
      <div className="workflow-guide-summary">
        <strong>{runningStep ? ui("{v0} is running", {v0: ui(runningStep.name)}) : nextStep ? ui("Next: {v0}", {v0: ui(nextStep.name)}) : ui("Core workflow ready")}</strong>
        <span>{runningStep?.job?.message || (nextStep ? ui(nextStep.hint) : "") || ui("Optional review/augmentation/validation steps can still be opened.")}</span>
      </div>
      <div className="workflow-steps">
        {stepStates.map((step, index) => {
          const statusText = step.status === "done" ? "Done" : step.status === "running" ? ui("{progress}% running", {progress: step.job?.progress ?? 0}) : step.status === "failed" ? "Needs attention" : step.status === "current" ? "You are here" : step.status === "optional" ? "Spot-check" : "Not done yet";
          const content = <><span className="workflow-step-index">{index + 1}</span><div><strong>{ui(step.name)}</strong><small>{ui(statusText)}</small></div></>;
          return onNavigate ? (
            <button key={step.name} type="button" className={`workflow-step step-${step.status}`} title={ui("{v0} Click to open this tab. Running backend jobs continue if you navigate away; unsaved Review edits will ask for confirmation.", {v0: ui(step.hint)})} onClick={() => onNavigate(step.page)}>
              {content}
            </button>
          ) : (
            <article key={step.name} className={`workflow-step step-${step.status}`} title={ui(step.hint)}>{content}</article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectsPage({ projects, refresh, t, activeProjectId, setActiveProjectId, jobs }: { projects: Project[]; refresh: () => Promise<void>; t: (key: string) => string; activeProjectId: string; setActiveProjectId: (id: string) => void; jobs: Job[] }) {
  const ui = useUiText();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [context, setContext] = useState<ProjectArtifactContext | null>(null);
  const [storageStatuses, setStorageStatuses] = useState<Record<string, ProjectStorageStatus>>({});
  const [cleaningProjectId, setCleaningProjectId] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [projectError, setProjectError] = useState("");
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
    if (!window.confirm(ui("Clean stale DB record for {name}? This removes DB rows and job history only. Raw data/input is kept.", {name:project.name}))) return;
    setCleaningProjectId(project.id);
    try {
      await api.cleanupStaleProject(project.id);
      if (activeProjectId === project.id) setActiveProjectId("");
      await refresh();
    } finally {
      setCleaningProjectId("");
    }
  }
  async function deletePackage(project: Project) {
    if (!window.confirm(ui("Delete project package {name}? This removes its project workspace, labels, YAML, models, exports, and DB rows. Raw data/input is kept.", {name:project.name}))) return;
    setDeletingProjectId(project.id); setProjectError("");
    try { await api.deleteProject(project.id); await refresh(); }
    catch (cause) { setProjectError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDeletingProjectId(""); }
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
        <p className="muted">{ui("Create a named workspace, then assign/switch to it from the project cards below.")}</p>
        <input value={name} placeholder={t("newProjectName")} onChange={(event) => setName(event.target.value)} required />
        <textarea value={description} placeholder={t("description")} onChange={(event) => setDescription(event.target.value)} />
        <button className="primary action-create">{ui("Create project")}</button>
      </form>
      <div className="list-panel">
        <h2>{ui("Assign / switch project")}</h2>
        {projectError && <p className="review-error" role="alert">{projectError}</p>}
        {projects.map((project) => (
          <article key={project.id} className={`row-card project-card ${active?.id === project.id ? "is-assigned" : ""} ${storageStatuses[project.id]?.is_stale ? "is-stale" : ""}`}>
            <strong>{project.name}</strong>
            <span>{project.description || ui("No description")}</span>
            <span>{project.root_path}</span>
            <ProjectStorageStatusCard status={storageStatuses[project.id]} cleaning={cleaningProjectId === project.id} onCleanup={() => cleanupStaleProject(project)} />
            <div className="inline-actions">
              <button className="secondary action-assign" type="button" aria-pressed={active?.id === project.id} onClick={() => setActiveProjectId(project.id)}>{active?.id === project.id ? ui("Assigned") : ui("Assign active")}</button>
              <button className="secondary danger action-delete" type="button" disabled={Boolean(deletingProjectId) || jobs.some(job => job.project_id === project.id && ["queued", "running", "cancel_requested"].includes(job.status))} onClick={() => void deletePackage(project)}><Trash2 size={16} />{deletingProjectId === project.id ? ui("Deleting…") : ui("Delete project package")}</button>
            </div>
          </article>
        ))}
      </div>
      {active && <div className="panel wide"><h2>{ui("Project history")}</h2><p className="muted">{ui("Active project:")} {active.name} {ui("· created")} {active.created_at ?? ui("unknown")}</p>{context && <ProjectArtifactContextPanel context={context} />}<WorkflowTimeline jobs={projectJobs} /></div>}
    </section>
  );
}

export function ProjectStorageStatusCard({ status, cleaning, onCleanup }: { status?: ProjectStorageStatus; cleaning: boolean; onCleanup: () => void }) {
  const ui = useUiText();
  if (!status) {
    return <div className="storage-status storage-status-loading">{ui("Checking project storage…")}</div>;
  }
  if (!status.is_stale) {
    return <div className="storage-status storage-status-healthy">{ui("Project storage healthy · workspace and model index exist.")}</div>;
  }
  return (
    <div className="storage-status storage-status-stale" role="alert">
      <strong>{ui("Stale project record")}</strong>
      <span>{ui("DB still has this project, but storage is missing:")} {status.missing.join(", ") || ui("unknown")}.</span>
      <button type="button" className="secondary warning" disabled={cleaning} onClick={onCleanup}>
        {cleaning ? <><LoaderCircle size={14} className="spin" />{ui("Cleaning…")}</> : ui("Clean stale DB record")}
      </button>
      <small>{ui("Only DB rows/job history and broken output_model index are cleaned. data/input is kept.")}</small>
    </div>
  );
}

export function ProjectArtifactContextPanel({ context }: { context: ProjectArtifactContext }) {
  const ui = useUiText();
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
      <h3>{ui("Project context")}</h3>
      <div className="artifact-count-grid">
        {countItems.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{ui(String(label))}</span></article>)}
      </div>
      <div className="context-model-list">
        <strong>{ui("Completed model sources")}</strong>
        {context.model_sources.length ? context.model_sources.slice(0, 8).map((source) => (
          <p key={source.id}><span>{source.label}</span><small>{source.relative_path}</small></p>
        )) : <p className="muted">{ui("No completed model sources yet.")}</p>}
      </div>
    </section>
  );
}

export function WorkflowTimeline({ jobs }: { jobs: Job[] }) {
  const ui = useUiText();
  return (
    <div className="timeline"><h3>{ui("Processing timeline")}</h3>{jobs.length ? jobs.map((job) => <article key={job.id} className={`timeline-item status-${job.status}`}><strong>{ui(job.name)}</strong><span>{ui(job.status)} · {job.progress}% · {job.message}</span><progress value={job.progress} max={100} /></article>) : <p className="muted">{ui("No processing history for this project yet.")}</p>}</div>
  );
}

export function shouldRefreshArtifactsAfterSourceProcessing(result: { sourceId?: string | null; imageCount?: number | null }) {
  return Boolean(result.sourceId) || Number(result.imageCount ?? 0) > 0;
}

export function SourcesPage({ project, refresh, refreshArtifacts, t }: { project: Project; refresh: () => Promise<void>; refreshArtifacts: () => Promise<void>; t: (key: string) => string }) {
  const ui = useUiText();
  const runtime=useWorkflow();
  const assignedSourceId=runtime?.state?.assignments.source;
  const sourceVersions=runtime?.state?.catalog.source??[];
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [kind, setKind] = useState<"video" | "image_folder">("image_folder");
  const [path, setPath] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [analysis, setAnalysis] = useState<SourceAnalysis | null>(null);
  const [processingSource, setProcessingSource] = useState(false);
  const [sourceError,setSourceError]=useState('');
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
          setSourceError('');
          setSourceProgress(8);
          setSourceStep("Registering source path…");
          setAnalysis(null);
          try {
            let source:SourceAsset;
            try{source=await api.createSource(project.id,{kind,path});}
            catch(error){
              if(!(error instanceof ApiError)||error.status!==409||!error.detail||typeof error.detail!=='object'||!('code' in error.detail)||error.detail.code!=='duplicate_source')throw error;
              if(!window.confirm(ui('This Source is already registered: {path}. Create another version anyway? Cancel to use the existing Source history instead.',{path})))return;
              source=await api.createSource(project.id,{kind,path,allow_duplicate:true});
            }
            setSourceProgress(38);
            setSourceStep("Refreshing source list…");
            setPath("");
            setSources(await api.sources(project.id));
            await runtime?.reload();
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
          } catch(error){setSourceError(error instanceof Error?error.message:String(error));} finally {
            window.setTimeout(() => { setProcessingSource(false); setSourceProgress(0); setSourceStep(""); }, 250);
          }
        }}
      >
        <h2>{t("addSource")}</h2>
        <div className="segmented-control source-toggle" role="group" aria-label={ui("Source type")}>
          <button type="button" className={kind === "image_folder" ? "is-active" : ""} onClick={() => setKind("image_folder")}>{ui("Image folder")}</button>
          <button type="button" className={kind === "video" ? "is-active" : ""} onClick={() => setKind("video")}>{ui("Video")}</button>
        </div>
        <p className="muted">{ui("Image folder registers jpg/png/jpeg/bmp/webp files. Video accepts mp4/webm/mov/mkv and then exposes frame extraction settings.")}</p>
        <FolderPathField value={path} mode={kind} onChange={setPath} onBrowse={() => setShowBrowser(true)} required />
        <ProcessingButton busy={processingSource} progress={sourceProgress} statusText={sourceStep || ui("Processing source…")} taskName={ui("Source analysis")} className="primary action-process"><Play size={17} />{ui("Process & analysis")}</ProcessingButton>
        {processingSource && <p className="inline-feedback">{sourceProgress}% · {sourceStep || ui("Reading files and calculating counts/sizes…")}</p>}
        <WorkflowError message={sourceError}/>
      </form>
      {kind === "video" && <form className="panel" onSubmit={async (event) => { event.preventDefault(); setExtractingFrames(true); setExtractProgress(10); setExtractStep("Submitting frame extraction job…"); try { const form = new FormData(event.currentTarget); await api.extractFrames(project.id, { source_asset_id: sourceId, frames_per_second: Number(form.get("fps")), resize_enabled: form.get("resize") === "on", resize_width: Number(form.get("width") || 0) || null, resize_height: Number(form.get("height") || 0) || null }); setExtractProgress(75); setExtractStep("Refreshing project jobs…"); await refresh(); setExtractProgress(100); setExtractStep("Frame extraction accepted."); } finally { window.setTimeout(() => { setExtractingFrames(false); setExtractProgress(0); setExtractStep(""); }, 250); } }}>
        <h2>{t("extractFrames")}</h2>
        <label><span>{ui("Video source")}</span><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">{ui("Select video source")}</option>{videoSources.map((source) => <option key={source.id} value={source.id}>{source.path}</option>)}</select></label>
        <label title={ui("Frames per second to sample from the video. 1 means one image per second; 5 is denser and creates more training images.")}><span>{ui("Extract FPS")}</span><input name="fps" type="number" min="0.1" step="0.1" defaultValue="2" /></label>
        <label className="check-row" title={ui("Resize extracted frames to a fixed width/height if the raw video is too large or inconsistent.")}><input name="resize" type="checkbox" />{ui("Resize extracted frames")}</label>
        <div className="field-row"><label title={ui("Output image width after resize.")}><span>{ui("Resize width")}</span><input name="width" type="number" min="1" placeholder="1280" /></label><label title={ui("Output image height after resize.")}><span>{ui("Resize height")}</span><input name="height" type="number" min="1" placeholder="720" /></label></div>
        <ProcessingButton busy={extractingFrames} progress={extractProgress} statusText={extractStep || ui("Extracting frames…")} taskName={ui("Extract frames")} className="primary action-process">{ui("Extract frames")}</ProcessingButton>
      </form>}
      <div className="list-panel">
        <h2>{ui("Dataset analysis")}</h2>
        {analysis ? <SourceAnalysisPanel analysis={analysis} /> : <p className="muted">{ui("Press Process & analysis to register the source and show image count, dimensions, extensions, and size distribution.")}</p>}
      </div>
      <div className="list-panel wide workflow-history">
        <div className="sidebar-header"><h2>{ui("Source history")}</h2>{runtime&&<span className="assigned-badge">{ui('Assigned: {name}',{name:sourceVersions.find(version=>version.id===assignedSourceId)?.name??ui('None')})}</span>}</div>
        {runtime&&<p className="muted">{ui('Assign one Source for Pseudo labeling. New sources remain unassigned until you choose them.')}</p>}
        {runtime?.error&&<WorkflowError message={runtime.error}/>}
        {sources.map((source) => {const version=sourceVersions.find(version=>version.id===source.id);return <article key={source.id} className={`row-card source-history-row ${source.id===assignedSourceId?'is-assigned':''}`}>
          <strong>{version?.name??source.path.split('/').filter(Boolean).at(-1)} · {ui(source.kind)}</strong><span>{source.path}</span>
          {version&&<span>{ui('{count} images',{count:version.count.toLocaleString()})} · {source.id.slice(0,8)} · {version.created_at.slice(0,16).replace('T',' ')}</span>}
          <WorkflowError message={version?.reason}/>
          <div className="inline-actions">{runtime&&<button type="button" className="secondary action-assign" disabled={runtime.busy||!version||Boolean(version.reason)} onClick={()=>void runtime.change(()=>api.assignWorkflow(project.id,'source',source.id))}>{ui(source.id===assignedSourceId?'Assigned':'Assign Source')}</button>}
          <button type="button" className="secondary action-analyze" onClick={async () => setAnalysis(await api.sourceAnalysis(project.id, { source_asset_id: source.id }))}>{ui("Analyze this source")}</button>
          <button type="button" className="secondary danger action-delete" aria-label={ui('Delete Source history {name}',{name:version?.name??source.path})} disabled={runtime?.busy||processingSource||extractingFrames} onClick={()=>{
            if(!window.confirm(ui('Delete Source “{name}”, its copied images, and dependent Pseudo, Augment, Split, Training and Export history? The original input and shared Open Data cache are kept.',{name:version?.name??source.path})))return;
            const remove=async()=>{await api.deleteHistory(project.id,'source',source.id);setSources(await api.sources(project.id));setAnalysis(null);if(sourceId===source.id)setSourceId('');await refresh();await refreshArtifacts();return api.workflowState(project.id);};
            if(runtime)void runtime.change(remove);else void remove().catch(error=>setSourceError(String(error)));
          }}>{ui('Delete history')}</button></div>
        </article>;})}
        {runtime&&assignedSourceId&&<button type="button" className="secondary" disabled={runtime.busy} onClick={()=>void runtime.change(()=>api.assignWorkflow(project.id,'source',null))}>{ui('Clear assignment')}</button>}
      </div>
    </section>
  );
}

function SourceAnalysisPanel({ analysis }: { analysis: SourceAnalysis }) {
  const ui = useUiText();
  return <div className="analysis-grid"><div className="stat-tile"><strong>{analysis.image_count}</strong><span>{ui("registered images")}</span></div><div className="stat-tile"><strong>{analysis.known_dimensions}</strong><span>{ui("known dimensions")}</span></div><div className="stat-tile"><strong>{analysis.min_width}–{analysis.max_width}</strong><span>{ui("width range")}</span></div><div className="stat-tile"><strong>{analysis.min_height}–{analysis.max_height}</strong><span>{ui("height range")}</span></div><div className="wide muted">{ui("Extensions:")} {Object.entries(analysis.extensions).map(([key, value]) => `${key}:${value}`).join(", ") || ui("none")}</div><div className="wide muted">{ui("Common sizes:")} {analysis.top_sizes.map(([key, value]) => `${key} (${value})`).join(", ") || ui("none")}</div></div>;
}

export function FileManagerShortcuts({ shortcuts, currentPath, onSelect }: { shortcuts: FileBrowserShortcut[]; currentPath: string; onSelect: (path: string) => void }) {
  const ui = useUiText();
  if (!shortcuts.length) return null;
  return (
    <section className="file-shortcuts" aria-label={ui("Common folders")}>
      <h3>{ui("Places")}</h3>
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
              <Folder size={17} aria-hidden="true" />
              <span className="shortcut-copy"><strong>{shortcut.label}</strong><small>{shortcut.exists ? shortcut.path : ui("missing")}</small></span>
              {shortcut.exists && shortcut.match_count > 0 ? <span className="file-count-badge">{shortcut.match_count}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function filePathBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return [];
  const absolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = absolute ? [{ label: "Root", path: "/" }] : [];
  parts.forEach((part, index) => {
    const prefix = parts.slice(0, index + 1).join("/");
    crumbs.push({ label: part, path: absolute ? `/${prefix}` : prefix });
  });
  return crumbs;
}

export function FolderPathField({ value, mode = "image_folder", onChange, onBrowse, required = false }: { value: string; mode?: "video" | "image_folder"; onChange: (path: string) => void; onBrowse: () => void; required?: boolean }) {
  const ui = useUiText();
  const empty = !value.trim();
  return (
    <div className="folder-path-field">
      <label>
        <span>{mode === "image_folder" ? ui("Selected folder") : ui("Selected video")}</span>
        <input
          value={value}
          placeholder={mode === "image_folder" ? ui("No folder selected") : ui("No video selected")}
          aria-describedby="folder-path-hint"
          onChange={(event) => onChange(event.target.value)}
          required={required}
        />
      </label>
      <button className="secondary action-browse" type="button" onClick={onBrowse}><FolderOpen size={16} />{ui("Browse folder")}</button>
      <small id="folder-path-hint" className={empty ? "path-assignment-status is-empty" : "path-assignment-status"}>
        {empty ? ui("Not assigned yet — browse or enter a path.") : ui("Assigned path")}
      </small>
    </div>
  );
}

export function FileManagerDialog({ mode, initialPath, onSelect, onClose }: { mode: "video" | "image_folder"; initialPath: string; onSelect: (path: string) => void; onClose: () => void }) {
  const ui = useUiText();
  const [browser, setBrowser] = useState<FileBrowserResult | null>(null);
  const [browserError, setBrowserError] = useState("");
  const [draftPath, setDraftPath] = useState(initialPath);
  const [loading, setLoading] = useState(true);
  const [navigation, setNavigation] = useState<{ items: string[]; index: number }>({ items: [], index: -1 });
  const browseRequestRef = useRef(0);

  async function openPath(nextPath: string, recordHistory = true) {
    const requestId = ++browseRequestRef.current;
    setLoading(true);
    setBrowserError("");
    try {
      const result = await api.fileBrowser(nextPath, mode);
      if (requestId !== browseRequestRef.current) return;
      setBrowser(result);
      setDraftPath(result.path);
      if (recordHistory) {
        setNavigation((current) => {
          if (current.items[current.index] === result.path) return current;
          const items = [...current.items.slice(0, current.index + 1), result.path];
          return { items, index: items.length - 1 };
        });
      }
    } catch (reason) {
      if (requestId !== browseRequestRef.current) return;
      setBrowserError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId === browseRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void openPath(initialPath);
    // The initial location is intentionally loaded once per mode/open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const currentPath = browser?.path ?? draftPath;
  const breadcrumbs = filePathBreadcrumbs(currentPath);
  const directories = (browser?.entries ?? []).filter((entry) => entry.kind === "directory");
  const matchingFiles = (browser?.entries ?? []).filter((entry) => entry.kind === "file");
  const moveHistory = (offset: number) => {
    const nextIndex = navigation.index + offset;
    const target = navigation.items[nextIndex];
    if (!target) return;
    setNavigation((current) => ({ ...current, index: nextIndex }));
    void openPath(target, false);
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div className="file-manager" role="dialog" aria-modal="true" aria-labelledby="file-manager-title">
    <header className="file-manager-header"><div><span className="eyebrow">{ui("Local workspace")}</span><h2 id="file-manager-title">{ui("Choose a")} {mode === "image_folder" ? ui("folder of images") : ui("video file")}</h2><p className="muted">{ui("Browse container-visible folders, verify their contents, then confirm your selection.")}</p></div><button className="file-manager-close" type="button" aria-label={ui("Close file manager")} onClick={onClose}><X size={20} /></button></header>
    <div className="file-manager-toolbar">
      <div className="file-nav-actions" aria-label={ui("Folder history")}><button type="button" aria-label={ui("Go back")} disabled={navigation.index <= 0 || loading} onClick={() => moveHistory(-1)}><ArrowLeft size={17} /></button><button type="button" aria-label={ui("Go forward")} disabled={navigation.index < 0 || navigation.index >= navigation.items.length - 1 || loading} onClick={() => moveHistory(1)}><ArrowRight size={17} /></button>{browser?.parent ? <button type="button" className="up-folder-button" disabled={loading} onClick={() => void openPath(browser.parent ?? "")}><FolderOpen size={17} />{ui("Up")}</button> : null}</div>
      <nav className="path-breadcrumbs" aria-label={ui("Current folder")}>{breadcrumbs.map((crumb, index) => <span key={crumb.path}><button type="button" title={crumb.path} disabled={loading || crumb.path === currentPath} onClick={() => void openPath(crumb.path)}>{crumb.path === "/" ? ui("Root") : crumb.label}</button>{index < breadcrumbs.length - 1 ? <ChevronRight size={14} aria-hidden="true" /> : null}</span>)}</nav>
    </div>
    <div className="file-manager-body">
      <aside className="file-manager-sidebar"><FileManagerShortcuts shortcuts={browser?.shortcuts ?? []} currentPath={currentPath} onSelect={(nextPath) => void openPath(nextPath)} /></aside>
      <section className="file-manager-content">
        <div className="folder-navigation"><label><span>{ui("Path")}</span><input value={draftPath} spellCheck={false} onChange={(event) => setDraftPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void openPath(draftPath); } }} /></label><button type="button" className="secondary action-navigate folder-go" disabled={loading} onClick={() => void openPath(draftPath)}>{loading ? ui("Opening…") : ui("Open path")}</button></div>
        {browserError ? <p className="review-error" role="alert">{ui(browserError)}</p> : null}
        <div className="folder-selection-row"><div><strong>{mode === "image_folder" ? ui("Current folder") : ui("Select a video below")}</strong><span>{mode === "image_folder" ? ui("{v0} supported image{v1}", {v0: browser?.current_match_count ?? 0, v1: browser?.current_match_count === 1 ? "" : "s"}) : ui("{v0} supported video{v1}", {v0: matchingFiles.length, v1: matchingFiles.length === 1 ? "" : "s"})}</span></div>{mode === "image_folder" ? <button type="button" className="primary action-assign" disabled={loading || !browser || browser.current_match_count < 1} onClick={() => browser && onSelect(browser.path)}>{ui("Select this folder")}</button> : null}</div>
        <section className="file-list" aria-label={ui("Folder contents")}>
          {loading && !browser ? <p className="file-manager-empty"><LoaderCircle className="spin" size={18} />{ui("Loading folder…")}</p> : null}
          {!loading && directories.length === 0 && matchingFiles.length === 0 ? <p className="file-manager-empty">{ui("This folder has no visible subfolders or supported files.")}</p> : null}
          {directories.map((entry) => <button key={entry.path} type="button" className={`file-row ${entry.selectable ? "selectable" : ""}`} onClick={() => void openPath(entry.path)}><span className="file-icon"><Folder size={19} aria-hidden="true" /></span><span className="file-row-copy"><strong>{entry.name}</strong><small>{ui("Folder")}</small></span><span className={`file-count-badge ${entry.match_count > 0 ? "has-files" : ""}`}>{entry.match_count > 0 ? `${entry.match_count} ${mode === "image_folder" ? "images" : "videos"}` : ui("Open")}</span><ChevronRight size={17} aria-hidden="true" /></button>)}
          {matchingFiles.map((entry) => mode === "video" ? <button key={entry.path} type="button" className="file-row selectable" onClick={() => onSelect(entry.path)}><span className="file-icon video"><Film size={19} aria-hidden="true" /></span><span className="file-row-copy"><strong>{entry.name}</strong><small>{ui("Video file")}</small></span><span className="file-select-label">{ui("Select")}</span></button> : <div key={entry.path} className="file-row image-file"><span className="file-icon image"><FileImage size={19} aria-hidden="true" /></span><span className="file-row-copy"><strong>{entry.name}</strong><small>{ui("Supported image")}</small></span></div>)}
        </section>
      </section>
    </div>
  </div></div>;
}

function SchemaPage({ project, t }: { project: Project; t: (key: string) => string }) {
  const ui = useUiText();
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
        <button className="primary action-save">{ui("Save")}</button>
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
  const ui = useUiText();
  if (!schema) return <p className="muted">{ui("Select or save a schema to preview YOLO-World prompt groups.")}</p>;
  return (
    <div className="schema-hierarchy">
      {schema.classes.map((item) => (
        <article key={item.class_id} className="schema-class-card">
          <strong>{item.class_name} {ui("(id:")}{item.class_id})</strong>
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
  const ui = useUiText();
  return (
    <div className="schema-edit-tree" aria-label={ui("editable schema tree")}>
      {classes.map((item) => (
        <article key={`${item.class_id}-${item.class_name}`} className="schema-edit-node">
          <div className="schema-edit-class-line">
            <span className="class-id-chip">{ui("id")} {item.class_id}</span>
            <strong>{ui("class ·")} {item.class_name}</strong>
          </div>
          <div className="schema-edit-branch">
            {(item.descriptors.length ? item.descriptors : [item.class_name]).map((descriptor, index) => (
              <div className="schema-edit-disc-line" key={`${descriptor}-${index}`}>
                <span className="disc-chip">{ui("disc")} {String(index + 1).padStart(2, "0")}</span>
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
  const ui = useUiText();
  const isRunning = isActiveJob(activeJob);
  const progress = submitting && !activeJob ? 8 : activeJob ? Math.max(0, Math.min(100, Math.round(activeJob.progress || 0))) : undefined;
  const statusLabel = submitting && !activeJob ? "Starting now" : activeJob ? `${activeJob.name}: ${activeJob.status}` : latestRun ? "Latest completed run" : "Ready to generate";
  const message = submitting && !activeJob ? (submitNotice || "Saving schema and submitting pseudo-label run…") : activeJob?.message || submitNotice || (latestRun ? `images=${String(latestRun.labeled_count ?? 0)}/${String(latestRun.image_count ?? 0)} · merge=${((Number(latestRun.merge_rate) || 0) * 100).toFixed(1)}%` : "Choose schema/settings, then Generate Pseudo Labels.");
  return (
    <section className={`pseudo-generate-feedback ${isRunning || submitting ? "is-live" : ""} ${activeJob?.status === "failed" ? "is-error" : ""}`} aria-live="polite">
      <div className="pseudo-feedback-header">
        <div>
          <strong>{ui("Pseudo-label run status")}</strong>
          <span>{ui(statusLabel)}</span>
        </div>
        {typeof progress === "number" ? <span className="status-chip live">{progress}%</span> : null}
      </div>
      {typeof progress === "number" ? <progress value={progress} max={100} /> : null}
      <p>{ui(message)}</p>
      {!isRunning && !submitting && latestRun?.filter_large_boxes ? <p>{ui('Filtered {count} boxes; kept area {lower}%–{upper}% of image.', {count: String(latestRun.filtered_box_count ?? 0), lower: ((latestRun.min_box_area_ratio ?? 0) * 100).toFixed(2), upper: ((latestRun.max_box_area_ratio ?? 1 / 3) * 100).toFixed(2)})}</p> : null}
      {activeJob?.error ? <p className="error-text">{activeJob.error}</p> : null}
      <div className="pseudo-settings-summary">
        <span>{ui("schema:")} <strong>{schemaName || ui("draft schema")}</strong></span>
        <span>{ui("model:")} <strong>{worldModel || ui("not selected")}</strong></span>
        <span>{mergeBoxes ? ui("merge on · IoU {v0}", {v0: mergeIou.toFixed(2)}) : ui("merge off")}</span>
      </div>
      {isRunning ? (
        <div className="inline-confirm pseudo-restart-confirm">
          <span>{ui("Finish the running job first. Repeated clicks are blocked so the queue cannot accidentally duplicate this long task.")}</span>
          <button type="button" className="secondary action-process" disabled>{ui("Restart with current settings")}</button>
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
  return `[Pseudo · ${name}]`;
}

export function augmentationRunLabel(run: AugmentationRun, pseudoRuns: PseudoLabelRun[] = []) {
  const pseudo = pseudoRuns.find((candidate) => candidate.id === run.pseudo_label_run_id);
  const source = pseudo ? pseudoRunLabel(pseudo) : "[Pseudo · All project labels]";
  return `${source} → [Augment · ${augmentationBuildName(run)}]${run.outdated ? " · Outdated — rebuild required" : ""}`;
}

type HistoryArtifactType = "pseudo" | "augmentation" | "split" | "training" | "conversion" | "export";

const HISTORY_DOWNSTREAM: Record<HistoryArtifactType, string> = {
  pseudo: "downstream Augment, Split, Training, Conversion and Export history",
  augmentation: "downstream Split, Training, Conversion and Export history",
  split: "downstream Training, Conversion and Export history",
  training: "downstream Conversion and Export history",
  conversion: "downstream Export history",
  export: "this Export history only"
};

export function HistoryDeleteButton({ projectId, artifactType, artifactId, label, onDeleted, disabled = false }: {
  projectId: string;
  artifactType: HistoryArtifactType;
  artifactId: string;
  label: string;
  onDeleted: () => Promise<void>;
  disabled?: boolean;
}) {
  const ui = useUiText();
  const [deleting, setDeleting] = useState(false);
  const w=workflowText(useWorkflow()?.language);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm(artifactType==='split'?w('Delete Split “{name}” and dependent training/export history? Raw sources are preserved.',{name:label}):ui("Delete {type} history “{name}” and {downstream}? Project input and the shared Open Data cache will be preserved.", {type:ui(artifactType),name:label,downstream:ui(HISTORY_DOWNSTREAM[artifactType])}))) return;
    setDeleting(true);
    setError("");
    try {
      await api.deleteHistory(projectId, artifactType, artifactId);
      await onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(false);
    }
  }
  return <div className="history-delete-action"><button type="button" className="secondary danger compact-action action-delete" disabled={disabled || deleting} aria-label={artifactType==='split'?w('Delete split history {name}',{name:label}):ui("Delete {v0} history {v1}", {v0: ui(artifactType), v1: label})} onClick={remove}><Trash2 size={16} />{w(deleting ? "Deleting…" : "Delete")}</button><WorkflowError message={error}/></div>;
}

function splitBuckets(split: DatasetSplitRun | Record<string, unknown>): Record<string, string[]> {
  const raw = split.image_ids_json;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed as Record<string, string[]> : {};
  } catch {
    return {};
  }
}

export function datasetSplitImageCount(split: DatasetSplitRun | Record<string, unknown>): number {
  return Object.values(splitBuckets(split)).reduce((total, ids) => total + (Array.isArray(ids) ? ids.length : 0), 0);
}

function pseudoBuildName(run?: PseudoLabelRun) {
  return run?.run_name || run?.schema_name || (run ? `Pseudo ${run.id.slice(0, 6)}` : "All project labels");
}

function augmentationBuildName(run?: AugmentationRun) {
  return run?.name || (run ? `Augment ${run.id.slice(0, 6)}` : "No Augment");
}

function splitBuildName(date = new Date()) {
  return versionedBuildName("Split", [], date);
}

function splitDisplayName(split: DatasetSplitRun | Record<string, unknown>) {
  const storedName = String(split.name ?? "");
  if ((storedName === "default" || /^current-\d+$/.test(storedName)) && split.created_at) {
    const created = new Date(String(split.created_at));
    if (!Number.isNaN(created.getTime())) return splitBuildName(created);
  }
  return storedName || `Split_${String(split.id ?? "build").slice(0, 6)}`;
}

function findOpenDataImport(openData: OpenDataImport | OpenDataImport[] | null | undefined, id: unknown) {
  return (Array.isArray(openData) ? openData : openData ? [openData] : []).find((item) => item.id === id) ?? null;
}

function openDataVersionName(item?: OpenDataImport | null) {
  return item?.version_name || (item ? `${item.dataset_key} ${item.sample_percentage}%` : "No Open Data");
}

type SplitBranch = {pseudo_label_run_id:string|null;augmentation_run_id:string|null;pseudo_name?:string;pseudo_count?:number;augmentation_name?:string;augmentation_count?:number};
function savedSplitBranches(split:DatasetSplitRun|Record<string,unknown>):SplitBranch[] {
  try {const recipe=JSON.parse(String(split.composition_json??'{}'));return Array.isArray(recipe.branches)?recipe.branches:[];}catch{return [];}
}
export function datasetSplitOptionLabel(split: DatasetSplitRun | Record<string, unknown>, pseudoRuns: PseudoLabelRun[] = [], augmentationRuns: AugmentationRun[] = [], openDataImport?: OpenDataImport | OpenDataImport[] | null) {
  const pseudoId = String(split.pseudo_label_run_id ?? "");
  const augmentId = String(split.augmentation_run_id ?? "");
  const pseudo = pseudoRuns.find((run) => run.id === pseudoId);
  const augment = augmentationRuns.find((run) => run.id === augmentId);
  const total = datasetSplitImageCount(split);
  const openData = findOpenDataImport(openDataImport, split.open_data_import_id);
  const pseudoLabel = `[Pseudo · ${pseudoBuildName(pseudo)}]`;
  const augmentLabel = `[Augment · ${augmentationBuildName(augment)}]`;
  const openDataLabel = split.open_data_import_id ? ` + [Open Data · ${openData ? openDataVersionName(openData) : "linked import"}${openData ? ` · ${openData.selected_image_count.toLocaleString()} images` : ""}]` : "";
  const branches=savedSplitBranches(split);
  const sources=branches.length>1?branches.map(branch=>`([Pseudo · ${branch.pseudo_name??pseudoBuildName(pseudoRuns.find(run=>run.id===branch.pseudo_label_run_id))}] → [Augment · ${branch.augmentation_name??augmentationBuildName(augmentationRuns.find(run=>run.id===branch.augmentation_run_id))}])`).join(' + '):`${pseudoLabel} → ${augmentLabel}`;
  return `${sources}${openDataLabel} → [Split · ${splitDisplayName(split)}${total ? ` · ${total.toLocaleString()} images` : ""}]${split.outdated ? " · Outdated — rebuild required" : ""}`;
}

export function datasetSplitLineageLabel(split: DatasetSplitRun | Record<string, unknown>, pseudoRuns: PseudoLabelRun[] = [], augmentationRuns: AugmentationRun[] = [], openDataImport?: OpenDataImport | OpenDataImport[] | null) {
  return datasetSplitOptionLabel(split, pseudoRuns, augmentationRuns, openDataImport);
}

export function DatasetLineageChain({ split, pseudoRun, augmentationRun, openDataImport }: { split?: DatasetSplitRun | Record<string, unknown> | null; pseudoRun?: PseudoLabelRun; augmentationRun?: AugmentationRun; openDataImport?: OpenDataImport | OpenDataImport[] | null }) {
  const w=workflowText(useWorkflow()?.language);
  const total = split ? datasetSplitImageCount(split) : 0;
  const matchingOpenData = split ? findOpenDataImport(openDataImport, split.open_data_import_id) : (Array.isArray(openDataImport) ? openDataImport[0] : openDataImport ?? null);
  const openDataCount = matchingOpenData?.selected_image_count ?? 0;
  const projectCount = split && total ? Math.max(0, total - openDataCount) : Number(augmentationRun?.created_image_count ?? pseudoRun?.labeled_count ?? 0);
  const splitName = split ? splitDisplayName(split) : w("New Split");
  const pseudoName=pseudoRun?pseudoBuildName(pseudoRun):split&&'composition_id' in split&&split.composition_id&&!split.pseudo_label_run_id?w('Not included'):w('All project labels');
  const augmentName=augmentationRun?augmentationBuildName(augmentationRun):w('No Augment');
  const images=(count:number)=>w('{count} images',{count:count.toLocaleString()});
  const accessible = `[${w('Pseudo')} · ${pseudoName}] → [${w('Augment')} · ${augmentName}]${matchingOpenData || split?.open_data_import_id ? ` + [${w('Open Data')} · ${matchingOpenData?.dataset_key || w("linked import")}]` : ""} → [${w('Split')} · ${splitName}${total ? ` · ${images(total)}` : ""}]`;
  const branches=split?savedSplitBranches(split):[];
  if(branches.length>1)return <div className="dataset-lineage" aria-label={branches.map(branch=>`${branch.pseudo_name} → ${branch.augmentation_name??w('No Augment')}`).join(' + ')+` → ${splitName}`}>
    <div className="lineage-parallel">{branches.map((branch,index)=><div className="dataset-lineage" key={index}>
      <span className="lineage-node lineage-pseudo">[{w('Pseudo')} · {branch.pseudo_name??w('Version unavailable')} · {w('{count} labeled',{count:(branch.pseudo_count??0).toLocaleString()})}]</span>
      <span className="lineage-connector" aria-hidden="true">→</span><span className="lineage-node lineage-augment">[{w('Augment')} · {branch.augmentation_name??w('No Augment')}{branch.augmentation_run_id?` · ${images(branch.augmentation_count??0)}`:''}]</span>
    </div>)}</div>
    {matchingOpenData&&<><span className="lineage-connector">+</span><span className="lineage-node lineage-open-data">[{w('Open Data')} · {openDataVersionName(matchingOpenData)} · {images(openDataCount)}]</span></>}
    <span className="lineage-connector">→</span><span className="lineage-node lineage-split">[{w('Split')} · {splitName} · {images(total)}]</span>
  </div>;
  return (
    <div className="dataset-lineage" aria-label={accessible}>
      <span className="lineage-node lineage-pseudo">[{w('Pseudo')} · {pseudoName}{pseudoRun?.labeled_count != null ? ` · ${w('{count} labeled',{count:Number(pseudoRun.labeled_count).toLocaleString()})}` : ""}]</span>
      <span className="lineage-connector" aria-hidden="true">→</span>
      <span className="lineage-node lineage-augment">[{w('Augment')} · {augmentName}{projectCount ? ` · ${images(projectCount)}` : ""}]</span>
      {matchingOpenData || split?.open_data_import_id ? <><span className="lineage-connector" aria-hidden="true">+</span><span className="lineage-node lineage-open-data">[{w('Open Data')} · {matchingOpenData ? openDataVersionName(matchingOpenData) : w("linked import")}{matchingOpenData ? ` · ${images(openDataCount)}` : ""}]</span></> : null}
      <span className="lineage-connector" aria-hidden="true">→</span>
      <span className="lineage-node lineage-split">[{w('Split')} · {splitName}{total ? ` · ${images(total)}` : ` · ${w('total after build')}`}]</span>
    </div>
  );
}

export function chooseLatestBuildSelection<T extends { id: string; created_at?: string | null }>(currentId: string, builds: T[], preferLatest: boolean) {
  if (!builds.length) return "";
  const sorted = [...builds].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  if (preferLatest) return sorted[0].id;
  return builds.some((build) => build.id === currentId) ? currentId : sorted[0].id;
}

export function AugmentationBuildSummary({ run, pseudoRuns = [] }: { run?: AugmentationRun | null; pseudoRuns?: PseudoLabelRun[] }) {
  const ui = useUiText();
  if (!run) return <p className="muted">{ui("No augment/source build selected yet.")}</p>;
  const pseudo = pseudoRuns.find((candidate) => candidate.id === run.pseudo_label_run_id);
  return (
    <section className="artifact-context-panel augmentation-build-summary">
      <h3>{ui("Augment build")}</h3>
      <div className="artifact-count-grid">
        <article><strong>{Number(run.source_image_count ?? 0)}</strong><span>{ui("Source images")}</span></article>
        <article><strong>{Number(run.created_image_count ?? 0)}</strong><span>{ui("Generated images")}</span></article>
      </div>
      <p><strong>{run.name || run.id}</strong></p>
      <p className="muted">{pseudo ? pseudoRunLabel(pseudo) : ui("All labeled images")}</p>
      <p className="muted">{run.output_dir}</p>
      <OutdatedArtifactNotice outdated={run.outdated} reason={run.outdated_reason} rebuild="Rebuild Augment and Split before training." />
    </section>
  );
}

export function OutdatedArtifactNotice({ outdated, reason, rebuild }: { outdated?: boolean; reason?: string | null; rebuild: string }) {
  const w=workflowText(useWorkflow()?.language);
  if (!outdated) return null;
  return (
    <div className="outdated-artifact-notice" role="status">
      <span className="outdated-badge">{w('Outdated — rebuild required')}</span>
      <WorkflowError message={outdatedReasonMessage(reason)} announce={false}/>
      <p>{w(rebuild)}</p>
    </div>
  );
}

export function outdatedReasonMessage(reason?: string | null): string {
  if (!reason) return "A project image was removed after this build was created.";
  try {
    const parsed = JSON.parse(reason) as { code?: unknown; image_ids?: unknown };
    if (parsed.code === "project_image_removed" && Array.isArray(parsed.image_ids)) {
      const count = parsed.image_ids.length;
      return count === 1
        ? "A project image was removed after this build was created."
        : `${count || "Multiple"} project images were removed after this build was created.`;
    }
  } catch {
    // Older records may already contain a user-facing prose reason.
  }
  return reason;
}

export function TrainingInputSummary({ split, pseudoRuns = [], augmentationRuns = [], openDataImport }: { split?: DatasetSplitRun | Record<string, unknown> | null; pseudoRuns?: PseudoLabelRun[]; augmentationRuns?: AugmentationRun[]; openDataImport?: OpenDataImport | OpenDataImport[] | null }) {
  const ui = useUiText();
  if (!split) return <p className="muted">{ui("Select a split build before training.")}</p>;
  const pseudo = pseudoRuns.find((run) => run.id === String(split.pseudo_label_run_id ?? ""));
  const augment = augmentationRuns.find((run) => run.id === String(split.augmentation_run_id ?? ""));
  return (
    <section className="training-input-summary">
      <strong>{ui("Training input")}</strong>
      <DatasetLineageChain split={split} pseudoRun={pseudo} augmentationRun={augment} openDataImport={openDataImport} />
      <OutdatedArtifactNotice outdated={Boolean(split.outdated)} reason={typeof split.outdated_reason === "string" ? split.outdated_reason : null} rebuild="Rebuild Split before training." />
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
  const ui = useUiText();
  const duplicates = schemaDuplicateMessages(schemas);
  const duplicateNames = new Set(duplicates.map((message) => message.split(" appears ")[0]));
  return (
    <div className="schema-history-selector">
      <label>
        <span className="label-with-help">{ui("History / assign existing schema")} <HelpTooltip text={ui("Pick a committed schema from history. Selecting an option immediately switches the editable class/prompt tree to that schema.")} /></span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{ui("New editable schema")}</option>
          {schemas.map((schema) => <option key={schema.id} value={schema.id}>{schemaOptionLabel(schema, duplicateNames)}</option>)}
        </select>
      </label>
      {duplicates.length ? <p className="schema-warning">{ui("Duplicate schema name warning:")} {duplicates.join("; ")}. Use the id suffix in the dropdown to tell them apart.</p> : null}
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

export function PseudoPage({ project, models, jobs, refreshJobs, t }: { project: Project; models: ModelLists; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string }) {
  const ui = useUiText();
  const runtime=useWorkflow();
  const sourceVersions=runtime?.state?.catalog.source??[];
  const sourceId=runtime?.state?.assignments.source??'';
  const selectedSource=sourceVersions.find(version=>version.id===sourceId);
  const sourceReady=Boolean(selectedSource&&!selectedSource.reason&&!runtime?.busy);
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [runs, setRuns] = useState<PseudoLabelRun[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [schemaName, setSchemaName] = useState("person-car-aerial-v1");
  const [pseudoRunName, setPseudoRunName] = useState(() => versionedBuildName("Pseudo"));
  const pseudoNameEdited=useRef(false);
  const [classes, setClasses] = useState<ClassSchema["classes"]>(defaultPromptClasses());
  const [worldModel, setWorldModel] = useState("");
  const [mergeBoxes, setMergeBoxes] = useState(false);
  const [confidence, setConfidence] = useState(0.1);
  const [iou, setIou] = useState(0.7);
  const [mergeIou, setMergeIou] = useState(0.75);
  const [filterLargeBoxes,setFilterLargeBoxes]=useState(false);
  const [maxBoxAreaRatio,setMaxBoxAreaRatio]=useState(1/3);
  const [minBoxAreaRatio,setMinBoxAreaRatio]=useState(0);
  const [areaFilterMode,setAreaFilterMode]=useState<'auto'|'manual'>('auto');
  const [areaDistribution,setAreaDistribution]=useState<BoxAreaDistribution|null>(null);
  const [areaDistributionLoading,setAreaDistributionLoading]=useState(false);
  const [areaDistributionError,setAreaDistributionError]=useState('');
  const areaThresholdValid=Number.isFinite(maxBoxAreaRatio)&&maxBoxAreaRatio>0&&maxBoxAreaRatio<=1&&minBoxAreaRatio>=0&&minBoxAreaRatio<maxBoxAreaRatio;
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{key:string;values?:Record<string,string|number>}>({key:''});
  const submitNotice=ui(submitMessage.key,submitMessage.values);
  const setSubmitNotice=(key:string,values?:Record<string,string|number>)=>setSubmitMessage({key,values});
  const [localPseudoJob, setLocalPseudoJob] = useState<Job | undefined>();
  const [schemaDirty, setSchemaDirty] = useState(true);
  const [savingSchema, setSavingSchema] = useState(false);
  const [schemaMessage, setSchemaMessage] = useState<{key:string;values?:Record<string,string|number>}>({key:''});
  const schemaNotice=ui(schemaMessage.key,schemaMessage.values);
  const setSchemaNotice=(key:string,values?:Record<string,string|number>)=>setSchemaMessage({key,values});
  const availableWorldModels = supportedWorldModels(models.world_models, models.world_model_details);
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const serverPseudoJob = findWorkflowJob(jobs, "pseudo_label");
  const pseudoJob = isActiveJob(serverPseudoJob) ? serverPseudoJob : isActiveJob(localPseudoJob) ? localPseudoJob : serverPseudoJob ?? localPseudoJob;
  const focusedRun=runs.find(run=>run.id===(runtime?.focus?.stage==='pseudo'?runtime.focus.id:runtime?.state?.assignments.pseudo));
  const previewPath = focusedRun ? String(focusedRun.last_image_path??'') : pseudoJob ? parsePreviewPath(pseudoJob.message) : selectedSchema ? String(runs[0]?.last_image_path ?? "") : "";
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
    return nextRuns as PseudoLabelRun[];
  }

  useEffect(() => {
    pseudoNameEdited.current=false;
    setPseudoRunName(versionedBuildName("Pseudo"));
    loadHistory().then((nextRuns) => {
      if(!pseudoNameEdited.current)setPseudoRunName(versionedBuildName("Pseudo", nextRuns.map((run) => run.run_name || "")));
    }).catch(console.error);
  }, [project.id]);
  useEffect(() => {
    setWorldModel((current) => availableWorldModels.includes(current) ? current : availableWorldModels[0] ?? "");
  }, [models.world_models, models.world_model_details]);
  const pseudoHistoryKey=runtime?.state?.catalog.pseudo.map(run=>run.id).join('|');
  const latestSourceRunId=runs.find(run=>run.source_asset_id===sourceId)?.id;
  useEffect(()=>{
    let ignore=false;
    setAreaDistribution(null);setAreaDistributionError('');
    if(!sourceId){setAreaDistributionLoading(false);return;}
    setAreaDistributionLoading(true);
    api.pseudoAreaDistribution(project.id,sourceId).then(next=>{if(!ignore)setAreaDistribution(next);}).catch(error=>{if(!ignore)setAreaDistributionError(String(error));}).finally(()=>{if(!ignore)setAreaDistributionLoading(false);});
    return ()=>{ignore=true;};
  },[project.id,sourceId,latestSourceRunId]);
  useEffect(()=>{setAreaFilterMode('auto');setMinBoxAreaRatio(0);setMaxBoxAreaRatio(1/3);},[project.id,sourceId]);
  const displayedAreaRange:[number,number]=areaFilterMode==='auto'?[0,areaDistribution?.suggested_max??1/3]:[minBoxAreaRatio,maxBoxAreaRatio];
  useEffect(()=>{
    if(!runtime?.state)return;
    let ignore=false;
    api.pseudoLabelRuns(project.id).then(next=>{if(!ignore)setRuns(next);}).catch(console.error);
    return ()=>{ignore=true;};
  },[project.id,pseudoHistoryKey]);
  useEffect(() => {
    setLocalPseudoJob((current) => reconcileLocalPseudoJob(current, serverPseudoJob, project.id));
  }, [project.id, serverPseudoJob?.id, serverPseudoJob?.status]);

  function applySchema(schema: ClassSchema) {
    setSchemaId(schema.id);
    setSchemaName(schema.name);
    setClasses(schema.classes.map((item) => ({ ...item, descriptors: [...item.descriptors] })));
    setSchemaDirty(false);
    setSchemaNotice('Switched to schema history item: {name}',{name:schema.name});
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
    setSchemaNotice('Committed schema to history: {name}',{name:saved.name});
    return saved.id;
  }

  async function submitPseudoLabelRun(mode: "generate" | "restart" = "generate") {
    if (submitting) return;
    if (isActiveJob(pseudoJob)) {
      setSubmitNotice("Pseudo-label generation is already running. Wait until it completes before creating another version.");
      return;
    }
    if(!sourceReady){setSubmitNotice('Assign a Source before generating Pseudo labels');return;}
    if(filterLargeBoxes&&!areaThresholdValid){setSubmitNotice('Maximum box area must be greater than 0% and at most 100%.');return;}
    if (!schemaId || schemaDirty) {
      setSchemaNotice("Please commit the current schema to history before Generate, then choose it from History if needed.");
      setSubmitNotice("Generate blocked: schema is not committed yet.");
      return;
    }
    if (!worldModel) {
      setSubmitNotice("Generate blocked: no supported local world model is installed.");
      return;
    }
    setSubmitNotice(mode === "restart" ? "Restarting pseudo-label run with current settings…" : "Submitting pseudo-label run with the committed schema…");
    setSubmitting(true);
    try {
      const activeSchemaId = schemaId;
      const job = await api.pseudoLabel(project.id, {
        run_name: pseudoRunName,
        source_asset_id: sourceId,
        schema_id: activeSchemaId,
        world_model: worldModel,
        confidence,
        iou,
        merge_boxes: mergeBoxes,
        merge_iou: mergeIou,
        filter_large_boxes:filterLargeBoxes,max_box_area_ratio:areaThresholdValid?maxBoxAreaRatio:1/3,
        min_box_area_ratio:areaThresholdValid?minBoxAreaRatio:0,area_filter_mode:areaFilterMode
      });
      setLocalPseudoJob(job);
      setSubmitNotice(mode === "restart" ? "Restart accepted. Progress will switch to the new run on the next poll." : "Request accepted. Progress and preview will update below.");
      await refreshJobs();
    } catch (error) {
      setSubmitNotice('Pseudo-label request failed: {detail}',{detail:error instanceof Error ? error.message : String(error)});
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
      <h2 className="section-title-with-help">{t("startPseudo")} <HelpTooltip text={ui("Use this page to choose a committed person/car schema, edit prompt descriptors, then run YOLO-World. Descriptors are prompt helpers only; training labels stay canonical ids.")} /></h2>
      <p className="muted">{ui("Class schema is the training label YAML shape. Descriptors are editable YOLO-World prompts only; they collapse back to the parent class id for training.")}</p>
      <section className="schema-commit-panel workflow-inputs" aria-label={ui('Pseudo input source')}>
        <label><span>{ui('Source version')}</span><select value={sourceId} disabled={!runtime?.state||runtime.busy||submitting||isActiveJob(pseudoJob)} onChange={event=>{if(runtime)void runtime.change(()=>api.assignWorkflow(project.id,'source',event.target.value||null));}}>
          <option value="">{ui('Select an assigned Source')}</option>
          {sourceVersions.map(version=><option key={version.id} value={version.id} disabled={Boolean(version.reason)}>{version.name} · {ui('{count} images',{count:version.count.toLocaleString()})} · {version.id.slice(0,8)}</option>)}
        </select></label>
        {selectedSource?<><p className="muted">{ui('Only this Source will be labeled; other Sources are kept.')}</p><p className="muted">{String(selectedSource.settings.path??'')}</p></>:<p className="muted">{ui('Assign a Source in Source history or select it here before Generate.')}</p>}
        <WorkflowError message={runtime?.error||selectedSource?.reason}/>
      </section>
      <label title={ui("Pseudo-label build name used by Augment/Split selectors.")}><span>{ui("Pseudo build name")}</span><input value={pseudoRunName} onChange={(event) => {pseudoNameEdited.current=true;setPseudoRunName(event.target.value);}} /></label>
      <PseudoDependencyGraph schema={graphSchema} worldModel={worldModel} mergeBoxes={mergeBoxes} hasRun={Boolean(pseudoJob || runs.length)} />
      <section className="schema-commit-panel">
        <div className="field-row">
          <label>
            <span className="label-with-help">{ui("Schema name")} <HelpTooltip text={ui("This is the saved schema history name. If the same name appears more than once, the dropdown adds an id suffix and shows a warning.")} /></span>
            <input value={schemaName} onChange={(event) => { setSchemaName(event.target.value); markSchemaDirty(); }} />
          </label>
          <SchemaHistorySelector schemas={schemas} value={schemaId} onChange={(nextId) => { const schema = schemas.find((item) => item.id === nextId); if (schema) applySchema(schema); else startNewSchema(); }} />
        </div>
        <div className="inline-actions schema-actions">
          <button type="button" className="primary action-save" disabled={savingSchema || !schemaDirty} onClick={async () => { setSavingSchema(true); try { await saveSchema(); } finally { setSavingSchema(false); } }}>{savingSchema ? ui("Committing schema…") : schemaDirty ? ui("Commit schema to history") : ui("Schema committed")}</button>
          <button type="button" className="secondary action-add" onClick={startNewSchema}>{ui("New schema draft")}</button>
          <span className={`schema-state-chip ${schemaDirty ? "is-dirty" : "is-clean"}`}>{schemaDirty ? ui("draft not committed") : schemaId ? ui("history schema selected") : ui("new draft")}</span>
        </div>
        {schemaNotice ? <p className="inline-feedback">{ui(schemaNotice)}</p> : null}
      </section>
      <div className="editable-schema-tree">
        {classes.map((item, classIndex) => (
          <article key={`${item.class_id}-${classIndex}`} className="schema-edit-node">
            <div className="schema-edit-class-line editable">
              <span className="class-id-chip">{ui("id")}</span>
              <input className="schema-id-input" aria-label={ui("class {v0} id", {v0: classIndex + 1})} type="number" value={item.class_id} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, class_id: Number(event.target.value) } : candidate)); }} />
              <span className="class-name-chip">{ui("class")}</span>
              <input className="schema-class-input" aria-label={ui("class {v0} name", {v0: classIndex + 1})} value={item.class_name} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, class_name: event.target.value } : candidate)); }} />
              <button type="button" className="secondary danger compact-action action-delete" onClick={() => { markSchemaDirty(); setClasses((current) => current.filter((_, index) => index !== classIndex)); }}>{ui("- class")}</button>
            </div>
            <div className="schema-edit-branch editable">
              {item.descriptors.map((descriptor, descriptorIndex) => (
                <div className="schema-edit-disc-line editable" key={`${descriptor}-${descriptorIndex}`}>
                  <span className="disc-chip">{ui("disc")} {String(descriptorIndex + 1).padStart(2, "0")}</span>
                  <input aria-label={ui("{v0} descriptor {v1}", {v0: item.class_name, v1: descriptorIndex + 1})} value={descriptor} onChange={(event) => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: candidate.descriptors.map((value, subIndex) => subIndex === descriptorIndex ? event.target.value : value) } : candidate)); }} />
                  <button type="button" className="secondary compact-action action-remove" onClick={() => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: candidate.descriptors.filter((_, subIndex) => subIndex !== descriptorIndex) } : candidate)); }}>{ui("- disc")}</button>
                </div>
              ))}
              <button type="button" className="secondary add-disc-action action-add" onClick={() => { markSchemaDirty(); setClasses((current) => current.map((candidate, index) => index === classIndex ? { ...candidate, descriptors: [...candidate.descriptors, candidate.class_name] } : candidate)); }}>{ui("+ disc under")} {item.class_name || ui("class {v0}", {v0: classIndex + 1})}</button>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="secondary add-class-action action-add" onClick={() => { markSchemaDirty(); setClasses((current) => [...current, { class_id: current.length, class_name: "new_class", descriptors: ["new object"] }]); }}>{ui("+ class")}</button>
      <label>
        <span className="label-with-help">{ui("World model")} <HelpTooltip text={ui("The open-vocabulary model used for pseudo labeling. YOLOE segmentation checkpoints are converted to bounding-box annotations; masks are not stored.")} /></span>
        <select value={worldModel} disabled={!availableWorldModels.length} onChange={(event) => setWorldModel(event.target.value)}>
          {availableWorldModels.length ? availableWorldModels.map((model) => {
            const info = models.world_model_details.find((item) => item.name === model);
            return <option key={model} value={model}>{info ? worldModelLabel(info) : model}</option>;
          }) : <option value="">{ui("No supported local world models")}</option>}
        </select>
      </label>
      <div className="field-row">
        <label title={ui("Confidence threshold: 0.1 is loose and keeps more candidate boxes; 0.7 is strict and keeps only high-confidence boxes.")}><span className="label-with-help">{ui("Confidence threshold")} <HelpTooltip text={ui("Minimum detection confidence. Lower values find more boxes but more false positives; higher values are stricter.")} /></span><input name="confidence" type="number" min="0" max="1" step="0.01" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} /></label>
        <label title={ui("NMS IoU threshold: overlap threshold used by YOLO-World to suppress duplicate boxes before optional same-class merge.")}><span className="label-with-help">{ui("NMS IoU threshold")} <HelpTooltip text={ui("YOLO-World overlap threshold before your optional same-class prompt merge. Higher values keep more overlapping candidates.")} /></span><input name="iou" type="number" min="0" max="1" step="0.01" value={iou} onChange={(event) => setIou(Number(event.target.value))} /></label>
      </div>
      <label className="check-row" title={ui("Merge overlapping boxes that came from different prompts but map to the same training class id.")}><input type="checkbox" checked={mergeBoxes} onChange={(event) => setMergeBoxes(event.target.checked)} />{ui("Merge boxes from same class prompts")} <HelpTooltip text={ui("If multiple descriptors for the same parent class hit the same object, overlapping boxes can be merged and descriptor provenance is kept.")} /></label>
      {mergeBoxes && <label title={ui("Boxes of the same class with IoU above this value collapse into the highest-confidence box; the merged prompt names are kept as provenance.")}><span className="label-with-help">{ui("Merge IoU threshold")} <HelpTooltip text={ui("How much same-class boxes must overlap before merging. Higher means only very similar boxes merge.")} /></span><input name="merge_iou" type="number" min="0" max="1" step="0.01" value={mergeIou} onChange={(event) => setMergeIou(Number(event.target.value))} /></label>}
      <label className="check-row"><input type="checkbox" aria-label={ui('Automatically filter large boxes')} checked={filterLargeBoxes} onChange={event=>setFilterLargeBoxes(event.target.checked)}/>{ui('Automatically filter large boxes')} <HelpTooltip text={ui('Manual range applies to the next run. Boxes on the boundaries are kept; images are never removed.')} /></label>
      {filterLargeBoxes&&<BoxAreaRange distribution={areaDistribution} range={displayedAreaRange} automatic={areaFilterMode==='auto'} loading={areaDistributionLoading} error={areaDistributionError} onSuggest={()=>setAreaFilterMode('auto')} onChange={([lower,upper])=>{setAreaFilterMode('manual');setMinBoxAreaRatio(lower);setMaxBoxAreaRatio(upper);}}/>}
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
      {previewPath && <div className="pseudo-preview"><strong>{focusedRun?ui("Selected version preview"):ui("Latest processed preview")}</strong><img src={`/api/files?path=${encodeURIComponent(previewPath)}`} alt={ui("pseudo-label preview")} /></div>}
      <ProcessingButton busy={submitting || isActiveJob(pseudoJob)} jobId={isActiveJob(pseudoJob) ? pseudoJob?.id : undefined} disabled={!sourceReady || !schemaId || schemaDirty || !worldModel || (filterLargeBoxes&&!areaThresholdValid)} progress={pseudoJob ? pseudoJob.progress : submitting ? 8 : undefined} statusText={pseudoJob ? pseudoJob.message || `${pseudoJob.name}: ${pseudoJob.status}` : submitNotice || ui("Submitting pseudo-label run…")} taskName={ui("Pseudo Label Generate")} className="primary action-process"><Play size={17} />{ui("Generate Pseudo Labels")}</ProcessingButton>
    </form>
  );
}

type AugmentationEffectKey = "hue" | "exposure" | "blur" | "noise" | "gain" | "boxMotionBlur" | "rotation" | "mirror";
type AugmentationEffect = { id: string; key: AugmentationEffectKey; value: number; showBbox?: boolean; direction?: "horizontal" | "vertical"; probability?: number };
type AugmentationSettings = { effects: AugmentationEffect[]; copies: number; skip: boolean; horizontalFlip?: boolean; verticalFlip?: boolean };
type AugmentationDraft = { name: string; settings: AugmentationSettings };
type AugmentationField = { key: AugmentationEffectKey; title: string; description: string; min: number; max: number; unit?: string };

const DEFAULT_AUGMENTATION_DRAFT: AugmentationDraft = { name: "", settings: { effects: [], copies: 3, skip: false } };

export function buildAugmentationDraftStorageKey(projectId: string) {
  return `object-autolabel:augmentation-draft:${projectId}`;
}

function isAugmentationEffectKey(value: unknown): value is AugmentationEffectKey {
  return ["hue", "exposure", "blur", "noise", "gain", "boxMotionBlur", "rotation", "mirror"].includes(String(value));
}

export function loadAugmentationDraft(projectId: string, storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null): AugmentationDraft {
  const fallback = { ...DEFAULT_AUGMENTATION_DRAFT, name: versionedBuildName("Augment") };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(buildAugmentationDraftStorageKey(projectId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AugmentationDraft>;
    const effects = Array.isArray(parsed.settings?.effects)
      ? parsed.settings.effects.filter((effect): effect is AugmentationEffect => Boolean(effect && typeof effect.id === "string" && isAugmentationEffectKey(effect.key)))
      : [];
    const copies = [3, 5, 8, 10].includes(Number(parsed.settings?.copies)) ? Number(parsed.settings?.copies) : DEFAULT_AUGMENTATION_DRAFT.settings.copies;
    const skip = Boolean(parsed.settings?.skip);
    const hasMirror = effects.some((effect) => effect.key === "mirror");
    const legacyHorizontal = Boolean(parsed.settings?.horizontalFlip);
    const legacyVertical = Boolean(parsed.settings?.verticalFlip);
    const migratedEffects = !hasMirror && (legacyHorizontal || legacyVertical)
      ? [...effects, { id: `mirror-migrated-${projectId}`, key: "mirror" as const, value: 0, direction: legacyVertical ? "vertical" as const : "horizontal" as const, probability: 100 }]
      : effects;
    return { name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : fallback.name, settings: { effects: migratedEffects, copies, skip } };
  } catch {
    return fallback;
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
  { key: "rotation", title: "Random Rotation", description: "", min: 0, max: 30, unit: "°" },
  { key: "mirror", title: "Mirror", description: "", min: 0, max: 100, unit: "%" }
];

function augmentationField(key: AugmentationEffectKey) {
  return AUGMENTATION_FIELDS.find((field) => field.key === key) ?? AUGMENTATION_FIELDS[0];
}

function newAugmentationEffect(key: AugmentationEffectKey): AugmentationEffect {
  const field = augmentationField(key);
  return { id: `${key}-${Date.now()}-${Math.random().toString(16).slice(2)}`, key, value: key === "mirror" ? 0 : Math.max(1, Math.round(field.max / 3)), showBbox: false, ...(key === "mirror" ? { direction: "horizontal" as const, probability: 50 } : {}) };
}

function aggregateAugmentationSettings(settings: AugmentationSettings) {
  const payload = { hue: 0, exposure: 0, noise: 0, blur: 0, gain: 0, box_motion_blur: 0, rotation: 0, horizontal_flip: false, vertical_flip: false, mirror_probability: 0 };
  settings.effects.forEach((effect) => {
    if (effect.key === "mirror") {
      payload.horizontal_flip = (effect.direction ?? "horizontal") === "horizontal";
      payload.vertical_flip = effect.direction === "vertical";
      payload.mirror_probability = Math.max(0, Math.min(100, effect.probability ?? 50)) / 100;
    } else if (effect.key === "boxMotionBlur") payload.box_motion_blur = Math.max(payload.box_motion_blur, effect.value);
    else payload[effect.key] = Math.max(payload[effect.key], effect.value);
  });
  return payload;
}

export function AugmentationControlPanel({ settings, onChange, onEditEffect }: { settings: AugmentationSettings; onChange: (settings: AugmentationSettings) => void; onEditEffect: (effect: AugmentationEffect) => void }) {
  const ui = useUiText();
  const update = (patch: Partial<AugmentationSettings>) => onChange({ ...settings, ...patch });
  const removeEffect = (id: string) => update({ effects: settings.effects.filter((effect) => effect.id !== id) });
  return (
    <section className="augmentation-control-panel">
      <div className="augmentation-multiplier">
        <strong>{ui("Augmentation dataset size")}</strong>
        <p className="muted">{ui("Choose how many augmented variants to generate for each labeled image.")}</p>
        <div className="ratio-presets augmentation-size-presets">
          {[3, 5, 8, 10].map((value) => (
            <button key={value} type="button" className={!settings.skip && settings.copies === value ? "secondary action-browse is-active" : "secondary action-browse"} aria-pressed={!settings.skip && settings.copies === value} onClick={() => update({ copies: value, skip: false })}>{ui("x")}{value}</button>
          ))}
          <button type="button" className={settings.skip ? "secondary action-browse is-active" : "secondary action-browse"} aria-pressed={settings.skip} onClick={() => update({ skip: true })}>{ui("Skip augment")}</button>
        </div>
        {settings.skip ? <p className="inline-feedback">{ui("Skip augment creates a source build: original labeled images are copied into a selectable dataset version without pixel transforms.")}</p> : null}
      </div>
      <div className="augmentation-add-panel">
        <strong>{ui("+ Add augmentation parameter")}</strong>
        <p className="muted">{ui("Start from an empty recipe. Add only the effects you want, configure each in a sampled-photo dialog, then stack them before creating images.")}</p>
        <div className="augmentation-add-grid">
          {AUGMENTATION_FIELDS.map((field) => (
            <button key={field.key} type="button" className="secondary action-add" onClick={() => onEditEffect(newAugmentationEffect(field.key))}>+ {ui(field.title)}</button>
          ))}
        </div>
      </div>
      <div className="augmentation-stack">
        <div className="sidebar-header"><div><h3>{ui("Applied augmentation stack")}</h3><p className="muted">{ui("Effects run together when creating augmented images. Use Edit to reopen the sampled-photo settings.")}</p></div></div>
        {settings.effects.length ? settings.effects.map((effect, index) => {
          const field = augmentationField(effect.key);
          return (
            <article key={effect.id} className="augmentation-stack-item">
              <span className="stack-order">{index + 1}</span>
              <div><strong>{ui(field.title)}</strong></div>
              <span className="effect-value">{effect.key === "mirror" ? `${ui(effect.direction === "vertical" ? "Top ↔ Bottom" : "Left ↔ Right")} · ${effect.probability ?? 50}%` : `±${effect.value}${field.unit ?? ""}`}</span>
              <div className="inline-actions">
                <button type="button" className="secondary action-browse" onClick={() => onEditEffect(effect)}>{ui("Edit")}</button>
                <button type="button" className="secondary action-delete" onClick={() => removeEffect(effect.id)}>{ui("Remove")}</button>
              </div>
            </article>
          );
        }) : <p className="empty-recipe">{ui("No augmentation parameters yet. Use + Blur Filter, + Random Rotation, or another parameter above to build a stack.")}</p>}
      </div>
    </section>
  );
}

export function AugmentationEffectModal({ draft, previewSamples, loading, error, onChange, onApply, onClose }: { draft: AugmentationEffect; previewSamples: AugmentationPreviewSample[]; loading: boolean; error: string; onChange: (effect: AugmentationEffect) => void; onApply: () => void; onClose: () => void }) {
  const ui = useUiText();
  const field = augmentationField(draft.key);
  const isMirror = draft.key === "mirror";
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={ui("Configure {v0}", {v0: ui(field.title)})}>
      <section className="modal-card augmentation-effect-modal">
        <div className="sidebar-header">
          <div><h2>{ui("Configure")} {ui(field.title)}</h2><p className="muted">{isMirror ? ui("Choose one mirror direction and how often it should be triggered across generated images.") : ui("Adjust the ± sampling range on one random labeled photo. Bbox preview is optional because overlay rendering can add latency.")}</p></div>
          <button type="button" className="secondary" onClick={onClose}>{ui("Close")}</button>
        </div>
        {isMirror ? <fieldset className="mirror-effect-editor"><legend>{ui("Mirror direction")}</legend><label className="check-row"><input type="radio" name={`mirror-direction-${draft.id}`} checked={(draft.direction ?? "horizontal") === "horizontal"} onChange={() => onChange({ ...draft, direction: "horizontal" })} />{ui("Left ↔ Right")}</label><label className="check-row"><input type="radio" name={`mirror-direction-${draft.id}`} checked={draft.direction === "vertical"} onChange={() => onChange({ ...draft, direction: "vertical" })} />{ui("Top ↔ Bottom")}</label></fieldset> : <label><span>{ui("± value range")} {field.unit ? `(${field.unit})` : ""}</span><input type="range" min={field.min} max={field.max} value={draft.value} onChange={(event) => onChange({ ...draft, value: Number(event.target.value) })} /><strong>−{draft.value}{field.unit ?? ""} / +{draft.value}{field.unit ?? ""}</strong></label>}
        {isMirror ? <label><span>{ui("Trigger probability")}</span><input type="range" min="0" max="100" step="1" value={draft.probability ?? 50} onChange={(event) => onChange({ ...draft, probability: Number(event.target.value) })} /><strong>{draft.probability ?? 50}{ui("% of generated images")}</strong></label> : null}
        <label className="check-row"><input type="checkbox" checked={Boolean(draft.showBbox)} onChange={(event) => onChange({ ...draft, showBbox: event.target.checked })} />{ui("Preview bounding boxes")}</label>
        {loading && <p className="inline-feedback">{ui("Sampling preview image…")}</p>}
        {error && <p className="review-error">{ui(error)}</p>}
        <div className="split-sample-grid modal-preview-grid">{previewSamples.length ? previewSamples.map((sample) => <AugmentationPreviewCard key={`modal-${sample.image_id}`} sample={sample} showBoxes={Boolean(draft.showBbox)} />) : loading ? <div className="sample-preview-skeleton">{ui("Loading sampled image preview…")}</div> : <p className="muted">{ui("No labeled image preview available yet.")}</p>}</div>
        <div className="inline-actions modal-actions"><button type="button" className="secondary" onClick={onClose}>{ui("Cancel")}</button><button type="button" className="primary action-save" onClick={onApply}>{ui("Apply effect")}</button></div>
      </section>
    </div>
  );
}

function AugmentationPage({ project, jobs, refreshJobs, artifactRevision }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; artifactRevision: number }) {
  const ui = useUiText();
  const runtime = useWorkflow();
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
      setName((current) => /^Augment_\d+_v\d+$/i.test(current) ? versionedBuildName("Augment", nextAugmentationRuns.map((run) => run.name || "")) : current);
      if (runtime) setSelectedPseudoRunId(runtime.state?.assignments.pseudo ?? "");
      else if (!selectedPseudoRunId && nextPseudoRuns[0]?.id) setSelectedPseudoRunId(nextPseudoRuns[0].id);
      const inspectedId=runtime?.focus?.stage==='augmentation'?runtime.focus.id:runtime?.state?.assignments.augmentation??'';
      const nextId = nextSelectedId || (nextAugmentationRuns.some(run=>run.id===inspectedId)?inspectedId:chooseLatestBuildSelection(selectedBuildId, nextAugmentationRuns, false));
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
        if (editingEffect.key === "mirror") payload.mirror_probability = 1;
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

  useEffect(() => {
    if (runtime?.state) setSelectedPseudoRunId(runtime.state.assignments.pseudo ?? "");
  }, [runtime?.state?.assignments.pseudo, Boolean(runtime?.state)]);

  useEffect(()=>{
    if(runtime?.focus?.stage==='augmentation'&&augmentationRuns.some(run=>run.id===runtime.focus?.id)){
      setSelectedBuildId(runtime.focus.id);setCreatedSamples([]);
    }
  },[runtime?.focus?.serial,augmentationRuns]);
  useEffect(()=>{
    const id=runtime?.state?.assignments.augmentation;
    if(id&&augmentationRuns.some(run=>run.id===id)){setSelectedBuildId(id);setCreatedSamples([]);}
  },[runtime?.state?.assignments.augmentation,augmentationRuns]);

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
      <h2>{ui("Image augmentation")}</h2>
      <p className="muted">{ui("Optional step before Split. Build an augmentation stack with + parameters, configure each in a sampled-photo dialog, then create generated images.")}</p>
      <section className="workflow-inputs"><label><span>{ui("Pseudo-label build input")}</span><select value={selectedPseudoRunId} disabled={runtime?.busy||submitting||isActiveJob(augmentationJob)} onChange={(event) => { if(runtime)void runtime.change(() => api.assignWorkflow(project.id, "pseudo", event.target.value || null));else setSelectedPseudoRunId(event.target.value); }}><option value="">{ui("All currently labeled images")}</option>{pseudoRuns.map((run) => <option key={run.id} value={run.id}>{pseudoRunLabel(run)}</option>)}</select></label></section>
      <label><span>{ui("Augmentation run name")}</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <AugmentationControlPanel settings={settings} onChange={setSettings} onEditEffect={(effect) => { setPreviewError(""); setModalPreviewSamples([]); setEditingEffect(effect); }} />
      {!hasEffects && !settings.skip && <p className="inline-feedback">{ui("Add at least one augmentation parameter or choose Skip augment to create a source build.")}</p>}
      <AugmentationBuildSummary run={selectedBuild} pseudoRuns={pseudoRuns} />
      {loadingBuilds ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> {ui("Refreshing build versions…")}</p> : null}
      {augmentationRuns.length ? <div className="field-row"><label><span>{ui("Inspect build")}</span><select value={selectedBuildId} disabled={loadingBuilds} onChange={(event) => { setSelectedBuildId(event.target.value); setCreatedSamples([]); if(event.target.value)runtime?.viewVersion('augmentation',event.target.value); }}><option value="" disabled={runtime?.focus?.stage==='augmentation'}>{ui("Select augment/source build")}</option>{augmentationRuns.map((run) => <option key={run.id} value={run.id}>{augmentationRunLabel(run, pseudoRuns)}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={showCreatedBoxes} onChange={(event) => setShowCreatedBoxes(event.target.checked)} />{ui("Show bounding boxes")}</label><button type="button" className="secondary action-browse" disabled={loadingBuilds} onClick={() => loadCreatedPreview().catch(console.error)}><Dice5 size={16} />{ui("Random sample")}</button></div> : null}
      {!runtime&&augmentationRuns.length ? <details className="history-panel workflow-history" open><summary>{ui("Augment history")}</summary><div className="version-list">{augmentationRuns.map((run) => <article className="history-row" data-stage="augmentation" key={run.id}><div><strong>{augmentationRunLabel(run, pseudoRuns)}</strong><span>{Number(run.created_image_count ?? 0).toLocaleString()} {ui("generated images")}</span></div><HistoryDeleteButton projectId={project.id} artifactType="augmentation" artifactId={run.id} label={augmentationBuildName(run)} onDeleted={async () => { setCreatedSamples([]); await loadAugmentationRuns(); await refreshJobs(); }} /></article>)}</div></details> : null}
      {createdSamples.length ? <section className="augmentation-preview created-augmentation-preview"><h3>{ui("Random generated output check")}</h3><p className="muted">{ui("After Create augmented images, inspect random generated images to make sure transformed labels still align.")}</p><div className="split-sample-grid">{createdSamples.map((sample) => <AugmentationPreviewCard key={`created-${sample.image_id}`} sample={sample} showBoxes={showCreatedBoxes} />)}</div></section> : null}
      {augmentationJob && <div className="job-progress-inline" title={augmentationJob.message}><span>{augmentationJob.name}: {augmentationJob.status}</span><progress value={augmentationJob.progress} max={100} /><small>{augmentationJob.progress}% · {augmentationJob.message}</small></div>}
      <ProcessingButton busy={submitting || isActiveJob(augmentationJob)} jobId={isActiveJob(augmentationJob) ? augmentationJob?.id : undefined} disabled={!hasEffects && !settings.skip} progress={augmentationJob ? augmentationJob.progress : submitting ? 12 : undefined} statusText={augmentationJob ? augmentationJob.message || `${augmentationJob.name}: ${augmentationJob.status}` : ui("Submitting augmentation run…")} className="primary action-process"><Play size={17} />{ui("Create augmented images")}</ProcessingButton>
      {editingEffect && <AugmentationEffectModal draft={editingEffect} previewSamples={modalPreviewSamples} loading={previewLoading} error={previewError} onChange={setEditingEffect} onApply={applyEditingEffect} onClose={() => setEditingEffect(null)} />}
    </form>
  );
}

export function AugmentationPreviewCard({ sample, showBoxes = true }: { sample: AugmentationPreviewSample; showBoxes?: boolean }) {
  const ui = useUiText();
  const width = Number(sample.width) || 640;
  const height = Number(sample.height) || 480;
  return (
    <article className="split-sample-card augmentation-sample-card">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ui("augmented preview {v0}", {v0: sample.file_name})}>
        <image href={sample.preview_url} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
        {showBoxes && sample.annotations.map((annotation, index) => {
          const x = (annotation.x_center - annotation.width / 2) * width;
          const y = (annotation.y_center - annotation.height / 2) * height;
          const rectWidth = annotation.width * width;
          const rectHeight = annotation.height * height;
          return (
            <g key={`${annotation.class_id}-${index}`}>
              <rect x={x} y={y} width={rectWidth} height={rectHeight} />
              <text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name || ui("class {v0}", {v0: annotation.class_id})}</text>
            </g>
          );
        })}
      </svg>
      <div><strong>{sample.file_name}</strong><span>{showBoxes ? ui("{v0} boxes · augmented preview", {v0: sample.annotations.length}) : ui("bbox overlay hidden · augmented preview")}</span></div>
    </article>
  );
}

export function SplitPage({ project, jobs, refreshJobs, t, artifactRevision }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string; artifactRevision: number }) {
  const runtime = useWorkflow();
  const w=workflowText(runtime?.language);
  const [runs, setRuns] = useState<PseudoLabelRun[]>([]);
  const [augmentationRuns, setAugmentationRuns] = useState<AugmentationRun[]>([]);
  const [openDataImports, setOpenDataImports] = useState<OpenDataImport[]>([]);
  const [selectedOpenDataImportId, setSelectedOpenDataImportId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedAugmentationRunId, setSelectedAugmentationRunId] = useState("");
  const [splits, setSplits] = useState<Array<Record<string, unknown>>>([]);
  const [legacySplitId, setSelectedSplitId] = useState("");
  const view=runtime?.splitView??(legacySplitId?{mode:'history' as const,id:legacySplitId}:{mode:'new' as const});
  const selectedSplitId=view.mode==='history'?view.id:'';
  const inspecting=view.mode==='history';
  const inputRequest=useRef(0);
  const pendingBuild=useRef<{name:string;compositionId:string|null;previous:Set<string>}|null>(null);
  const [samples, setSamples] = useState<SplitSamples>({ train: [], valid: [], test: [] });
  const [sampleLimit, setSampleLimit] = useState(3);
  const [sampleSeed, setSampleSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [trainRatio, setTrainRatio] = useState("0.80");
  const [valRatio, setValRatio] = useState("0.10");
  const splitJob = findWorkflowJob(jobs, "dataset_split");
  const trainRatioNumber = Number(trainRatio);
  const valRatioNumber = Number(valRatio);
  const computedTestRatio = Math.max(0, 1 - (Number.isFinite(trainRatioNumber) ? trainRatioNumber : 0) - (Number.isFinite(valRatioNumber) ? valRatioNumber : 0));
  const ratioTotal = (Number.isFinite(trainRatioNumber) ? trainRatioNumber : 0) + (Number.isFinite(valRatioNumber) ? valRatioNumber : 0) + computedTestRatio;
  const ratiosValid = Number.isFinite(trainRatioNumber) && Number.isFinite(valRatioNumber) && trainRatioNumber > 0 && valRatioNumber >= 0 && computedTestRatio >= 0 && Math.abs(ratioTotal - 1) < 0.0001;
  function receiveSplits(items:Array<Record<string,unknown>>) {
    setSplits(items);
    const pending=pendingBuild.current;
    const built=pending&&items.find(item=>!pending.previous.has(String(item.id))&&item.name===pending.name&&(!pending.compositionId||item.composition_id===pending.compositionId));
    if(built){pendingBuild.current=null;if(runtime)runtime.selectSplit(String(built.id));else setSelectedSplitId(String(built.id));}
  }

  async function loadSplits(nextSelectedId?: string) {
    const nextSplits = await api.datasetSplits(project.id);
    receiveSplits(nextSplits);
    if(nextSelectedId){if(runtime)runtime.selectSplit(nextSelectedId);else setSelectedSplitId(nextSelectedId);}
  }

  async function loadBuildInputs(preferLatestAugment: boolean) {
    const ticket=++inputRequest.current;
    setLoadingBuilds(true);
    try {
      const [nextRuns, nextAugmentationRuns, nextSplits, nextOpenDataImports] = await Promise.all([api.pseudoLabelRuns(project.id), api.augmentationRuns(project.id), api.datasetSplits(project.id), api.openDataImports(project.id)]);
      if(ticket!==inputRequest.current)return;
      setRuns(nextRuns as PseudoLabelRun[]);
      setAugmentationRuns(nextAugmentationRuns as AugmentationRun[]);
      receiveSplits(nextSplits);
      setOpenDataImports(nextOpenDataImports);
      setSelectedOpenDataImportId((current) => runtime ? runtime.state?.assignments.open_data ?? "" : current && nextOpenDataImports.some((item) => item.id === current) ? current : nextOpenDataImports.find((item) => item.status === "active")?.id ?? "");
      setSelectedRunId((current) => runtime ? runtime.state?.assignments.pseudo ?? "" : chooseLatestBuildSelection(current, nextRuns, false));
      const currentAugmentationRuns = nextAugmentationRuns.filter((run) => !run.outdated);
      setSelectedAugmentationRunId((current) => runtime ? runtime.state?.assignments.augmentation ?? "" : chooseLatestBuildSelection(current, currentAugmentationRuns, preferLatestAugment));
    } finally {
      if(ticket===inputRequest.current)setLoadingBuilds(false);
    }
  }

  useEffect(() => {
    loadBuildInputs(false).catch(console.error);
    return()=>{inputRequest.current++;};
  }, [project.id]);

  useEffect(() => {
    if (!artifactRevision) return;
    loadBuildInputs(true).catch(console.error);
  }, [artifactRevision]);

  useEffect(() => {
    let cancelled=false;setSamples({train:[],valid:[],test:[]});
    if (!selectedSplitId){setLoadingSamples(false);return;}
    setLoadingSamples(true);
    api.datasetSplitSamples(project.id, selectedSplitId, sampleLimit, sampleSeed).then(next=>{if(!cancelled)setSamples(next);}).catch(error=>{if(!cancelled)setSubmitError(String(error));}).finally(() => {if(!cancelled)setLoadingSamples(false);});
    return()=>{cancelled=true;};
  }, [project.id, selectedSplitId, sampleLimit, sampleSeed]);

  useEffect(() => {
    if (!runtime?.state) return;
    setSelectedRunId(runtime.state.assignments.pseudo ?? "");
    setSelectedAugmentationRunId(runtime.state.assignments.augmentation ?? "");
    setSelectedOpenDataImportId(runtime.state.assignments.open_data ?? "");
  }, [runtime?.state?.assignments.pseudo, runtime?.state?.assignments.augmentation, runtime?.state?.assignments.open_data, Boolean(runtime?.state)]);
  const selectedRun = runs.find((run) => run.id === (runtime ? runtime.draft.pseudo_label_run_id : selectedRunId));
  const selectedAugmentationRun = augmentationRuns.find((run) => run.id === (runtime ? runtime.draft.augmentation_run_id : selectedAugmentationRunId));
  const selectedOpenDataImport = openDataImports.find((item) => item.id === (runtime ? runtime.draft.open_data_import_id : selectedOpenDataImportId)) ?? null;
  const selectedSplit = splits.find((split) => String(split.id) === selectedSplitId);
  const inputIssue=runtime?recipeIssue(runtime.state,runtime.draft):'';
  const canSubmitSplit = ratiosValid && !selectedAugmentationRun?.outdated && !inputIssue && !runtime?.busy;
  const chooseHistory=(id:string)=>{if(id){if(runtime)runtime.selectSplit(id);else setSelectedSplitId(id);}else {runtime?.newSplit();if(!runtime)setSelectedSplitId('');}};
  function startNew() {
    if(selectedSplit){runtime?.setDraft(splitRecipe(selectedSplit));setTrainRatio(String(selectedSplit.train_ratio??'.8'));setValRatio(String(selectedSplit.val_ratio??'.1'));}
    runtime?.newSplit();if(!runtime)setSelectedSplitId('');
  }
  return (
    <section className="panel-grid split-workspace">
      <section className="panel wide split-version-context workflow-history" aria-label={w('Split version context')}>
        <fieldset className="split-mode"><legend>{w('Split mode')}</legend>
          <label><input type="radio" name="split-mode" checked={!inspecting} disabled={submitting||isActiveJob(splitJob)} onChange={startNew}/>{w('New Split')}</label>
          <label><input type="radio" name="split-mode" checked={inspecting} disabled={submitting||isActiveJob(splitJob)||!splits.length} onChange={()=>chooseHistory(runtime?.state?.assignments.split??String(splits[0]?.id??''))}/>{w('History')}</label>
        </fieldset>
        <label><span>{w('Preview Split version')}</span><select value={selectedSplitId} disabled={submitting||isActiveJob(splitJob)} onChange={event=>chooseHistory(event.target.value)}><option value="">{w('New Split · no saved result yet')}</option>{splits.map(split=><option key={String(split.id)} value={String(split.id)}>{splitDisplayName(split)} · {w('{count} images',{count:datasetSplitImageCount(split).toLocaleString()})}{split.outdated?` · ${w('Outdated — rebuild required')}`:''}</option>)}</select></label>
        <p className="muted" role="status">{inspecting?w('Viewing {name} · inputs and results belong to this saved version.',{name:selectedSplit?splitDisplayName(selectedSplit):w('Version unavailable')}):w('New Split draft · build it to see its saved distribution.')}</p>
      </section>
      <CompositionBoard disabled={submitting||isActiveJob(splitJob)} recipe={inspecting?(selectedSplit?splitRecipe(selectedSplit):{pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:null}):undefined}
        splitName={inspecting?(selectedSplit?splitDisplayName(selectedSplit):w('Version unavailable')):undefined} splitCount={selectedSplit?datasetSplitImageCount(selectedSplit):undefined} onConfigureSplit={()=>{
        const form=document.getElementById('split-build-form');
        form?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
        form?.querySelector<HTMLInputElement>('input[name="train"]')?.focus({preventScroll:true});
      }}/>
      {!inspecting&&<form
        id="split-build-form"
        className="panel wide"
        onSubmit={async (event) => {
          event.preventDefault();
          if(submitting||isActiveJob(splitJob))return;
          if (selectedAugmentationRun?.outdated) {
            setSubmitError("This Augment/source build is outdated. Rebuild Augment before creating a split.");
            return;
          }
          setSubmitError("");
          setSubmitting(true);
          try {
            if (!ratiosValid) throw new Error("Train + validation must be <= 1.0 so test can fill the remainder.");
            const composition=runtime?await runtime.saveDraft():null;
            const name=versionedBuildName("Split", splits.map((split) => String(split.name ?? "")));
            await api.split(project.id, {
              // Keep prior materialized splits immutable for an already-running training job.
              ...(composition ? { composition_id: composition.id } : {}),
              name,
              train_ratio: trainRatioNumber,
              val_ratio: valRatioNumber,
              test_ratio: Number(computedTestRatio.toFixed(4)),
              pseudo_label_run_id: composition ? composition.pseudo_label_run_id : selectedRunId || selectedAugmentationRun?.pseudo_label_run_id || null,
              augmentation_run_id: composition ? composition.augmentation_run_id : selectedAugmentationRunId || null,
              open_data_import_id: composition ? composition.open_data_import_id : selectedOpenDataImportId || null
            });
            pendingBuild.current={name,compositionId:composition?.id??null,previous:new Set(splits.map(split=>String(split.id)))};
            await refreshJobs();
            await loadSplits();
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : String(error));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2>{w("Set ratios & build")}</h2>
        <p className="muted">{w("Build from the selected versions. Sources are recorded automatically.")}</p>
        {loadingBuilds ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> {w("Syncing latest upstream builds…")}</p> : null}
        {!runtime && <>
        <label><span>Pseudo version</span><select value={selectedRunId} disabled={loadingBuilds} onChange={(event) => setSelectedRunId(event.target.value)}><option value="">[Pseudo · All project labels]</option>{runs.map((run) => <option key={run.id} value={run.id}>[Pseudo · {pseudoBuildName(run)} · {Number(run.labeled_count ?? 0).toLocaleString()} labeled] · {String(run.created_at ?? "").replace("T", " ").slice(0, 19)}</option>)}</select></label>
        {selectedRun && <p className="muted">Using conf={String(selectedRun.confidence)}, iou={String(selectedRun.iou)}, merge rate={((Number(selectedRun.merge_rate) || 0) * 100).toFixed(1)}%.</p>}
        <label><span>Augment version</span><select value={selectedAugmentationRunId} disabled={loadingBuilds} onChange={(event) => { setSelectedAugmentationRunId(event.target.value); setSubmitError(""); }}><option value="">[Augment · None · use matching labeled images]</option>{augmentationRuns.map((run) => <option key={run.id} value={run.id} disabled={Boolean(run.outdated)}>[Augment · {augmentationBuildName(run)} · {Number(run.created_image_count ?? 0).toLocaleString()} images]{run.outdated ? " · Outdated — rebuild required" : ""}</option>)}</select></label>
        <AugmentationBuildSummary run={selectedAugmentationRun} pseudoRuns={runs} />
        <label><span>Open Data version</span><select value={selectedOpenDataImportId} disabled={loadingBuilds} onChange={(event) => setSelectedOpenDataImportId(event.target.value)}><option value="">[Open Data · None]</option>{openDataImports.map((item) => <option key={item.id} value={item.id}>[Open Data · {openDataVersionName(item)} · {item.selected_image_count.toLocaleString()} images]{item.status === "active" ? " · Active in Review" : " · Saved"}</option>)}</select></label>
        </>}
        {!runtime && <section className="lineage-preview" aria-label="New split source recipe">
          <div><strong>New Split recipe</strong><span>Only the explicitly selected Open Data version is included.</span></div>
          <DatasetLineageChain pseudoRun={selectedRun} augmentationRun={selectedAugmentationRun} openDataImport={selectedOpenDataImport} />
        </section>}
        {runtime && <WorkflowError message={inputIssue}/>}
        <WorkflowError message={submitError}/>
        <div className="ratio-builder" aria-label={w("Train validation test split ratios")}>
          <div className="ratio-presets" aria-label={w("Split ratio presets")}>
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.80"); setValRatio("0.10"); }}>80 / 10 / 10</button>
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.70"); setValRatio("0.20"); }}>70 / 20 / 10</button>
            <button type="button" className="secondary action-browse" onClick={() => { setTrainRatio("0.90"); setValRatio("0.05"); }}>90 / 5 / 5</button>
          </div>
          <div className="field-row">
            <label title={w("Training portion: images used to update model weights. Test is auto-computed so total stays 1.00.")}><span>{w("Train ratio")}</span><input name="train" type="text" inputMode="decimal" value={trainRatio} onChange={(event) => setTrainRatio(event.target.value)} /></label>
            <label title={w("Validation portion: images used during training to monitor overfitting and select best.pt.")}><span>{w("Validation ratio")}</span><input name="val" type="text" inputMode="decimal" value={valRatio} onChange={(event) => setValRatio(event.target.value)} /></label>
            <label title={w("Test is computed automatically so train + validation + test always equals 1.0.")}><span>{w("Test ratio (auto)")}</span><input name="test" type="text" readOnly value={computedTestRatio.toFixed(2)} /></label>
          </div>
          <details className="split-ratio-help"><summary>{w("Ratio help")}</summary><p>{w("Training portion: images used to update model weights. Test is auto-computed so total stays 1.00.")}</p><p>{w("Validation portion: images used during training to monitor overfitting and select best.pt.")}</p><p>{w("Test is computed automatically so train + validation + test always equals 1.0.")}</p></details>
          <div className="ratio-visual" aria-label={w("Train validation test split ratios")}>
            <span className="ratio-train" style={{ width: `${Math.max(0, Math.min(100, trainRatioNumber * 100))}%` }}>{w("Train")} {(trainRatioNumber * 100 || 0).toFixed(0)}%</span>
            <span className="ratio-val" style={{ width: `${Math.max(0, Math.min(100, valRatioNumber * 100))}%` }}>{w("Validation")} {(valRatioNumber * 100 || 0).toFixed(0)}%</span>
            <span className="ratio-test" style={{ width: `${Math.max(0, Math.min(100, computedTestRatio * 100))}%` }}>{w("Test")} {(computedTestRatio * 100).toFixed(0)}%</span>
          </div>
          <p className={ratiosValid ? "inline-feedback" : "review-error"}>{ratiosValid ? w("Total = 1.00. Test automatically fills the remaining {ratio}.",{ratio:computedTestRatio.toFixed(2)}) : w("Invalid split: Train + Validation cannot exceed 1.00.")}</p>
        </div>
        <ProcessingButton busy={submitting || isActiveJob(splitJob)} jobId={isActiveJob(splitJob) ? splitJob?.id : undefined} disabled={!canSubmitSplit} progress={splitJob ? splitJob.progress : submitting ? 15 : undefined} statusText={w("Building Split version…")} className="primary action-process">{w("Build New Split Version")}</ProcessingButton>
      </form>}
      {inspecting&&selectedSplit&&<div className="list-panel wide" data-split-result={selectedSplitId}>
        <div className="sidebar-header"><div><h2>{w('Saved Split · {name}',{name:splitDisplayName(selectedSplit)})}</h2><p className="muted">{w("Random visual check only; rerolling does not change the saved Split.")}</p></div><button type="button" className="secondary icon-action" aria-label={w("Reroll Split samples")} title={w("Reroll Split samples")} onClick={() => setSampleSeed((current) => current + 1)}><Dice5 size={18} />{w("Random sample")}</button></div>
        <div className="field-row">
          <label title={w("How many images to sample from each train/valid/test bucket.")}><span>{w("Samples per bucket")}</span><input type="number" min="1" max="12" value={sampleLimit} onChange={(event) => setSampleLimit(Number(event.target.value))} /></label>
        </div>
        {runtime && selectedSplit && <button type="button" className="secondary" disabled={runtime.busy||Boolean(selectedSplit.outdated)} onClick={()=>void runtime.useSplitForTraining(String(selectedSplit.id))}>{w("Use this Split in Train")} <ArrowRight size={16}/></button>}
        <WorkflowError message={runtime?.error}/>
        <p className="muted">{w("Train")}/{w("Validation")}/{w("Test")}={String(selectedSplit.train_ratio)}/{String(selectedSplit.val_ratio)}/{String(selectedSplit.test_ratio)}</p>
        <OutdatedArtifactNotice outdated={Boolean(selectedSplit.outdated)} reason={typeof selectedSplit.outdated_reason==='string'?selectedSplit.outdated_reason:null} rebuild="Build a new Split version before training."/>
        {selectedSplit && <SplitCoverage key={`${project.id}/${selectedSplitId}`} projectId={project.id} splitId={selectedSplitId} language={runtime?.language??'en'}/>}
        {loadingSamples ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> {w("Rendering split sample boxes…")}</p> : null}
        <SplitSamplePreview samples={samples} />
      </div>}
      {inspecting&&!selectedSplit&&!loadingBuilds&&<p role="alert">{w('This Split is unavailable. Choose another history version or New.')}</p>}
      <AssignmentFooter page="split" onDeleted={async()=>{await loadBuildInputs(false);await refreshJobs();}}/>
    </section>
  );
}

function SplitSamplePreview({ samples }: { samples: SplitSamples }) {
  const w=workflowText(useWorkflow()?.language);
  const buckets: Array<keyof SplitSamples> = ["train", "valid", "test"];
  return (
    <div className="split-preview">
      {buckets.map((bucket) => (
        <section key={bucket} className="split-preview-bucket">
          <h3>{w(bucket === "valid" ? "Validation samples" : bucket === "train" ? "Training samples" : "Test samples")}</h3>
          <div className="split-sample-grid">
            {samples[bucket].length ? samples[bucket].map((sample) => <SplitSampleCard key={`${bucket}-${sample.image_id}`} sample={sample} />) : <p className="muted">{w("No samples in this bucket.")}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

function SplitSampleCard({ sample }: { sample: SplitSample }) {
  const w=workflowText(useWorkflow()?.language);
  const width = Number(sample.width) || 640;
  const height = Number(sample.height) || 480;
  return (
    <article className="split-sample-card">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${w(sample.bucket === "train" ? "Training samples" : sample.bucket === "valid" ? "Validation samples" : "Test samples")} · ${sample.file_name}`}>
        <image href={`/api/files?path=${encodeURIComponent(sample.image_path)}`} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
        {sample.annotations.map((annotation, index) => {
          const x = (annotation.x_center - annotation.width / 2) * width;
          const y = (annotation.y_center - annotation.height / 2) * height;
          const rectWidth = annotation.width * width;
          const rectHeight = annotation.height * height;
          return (
            <g key={`${annotation.class_id}-${index}`}>
              <rect x={x} y={y} width={rectWidth} height={rectHeight} />
              <text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name || `${w("Class")} ${annotation.class_id}`}</text>
            </g>
          );
        })}
      </svg>
      <div><strong>{sample.file_name}</strong><span>{w("{count} boxes",{count:sample.annotations.length})}</span></div>
    </article>
  );
}

export function parseTrainingMetrics(run?: TrainingRun | null): TrainingMetric[] {
  if (!run?.metrics_json) return [];
  try {
    // Older Python json.dumps output may contain non-standard NaN/Infinity tokens.
    // Ignore those fields while preserving the finite training-loss series.
    const normalized = run.metrics_json.replace(/\bNaN\b/g, "null").replace(/\b-Infinity\b|\bInfinity\b/g, "null");
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => {
        // Old callbacks assigned the third loss to DFL. Only repair histories
        // with explicit L1 validation evidence, never a checkpoint filename.
        if (typeof item["val/l1_loss"] === "number" && !("val/dfl_loss" in item) && !("l1_loss" in item) && "dfl_loss" in item) {
          const { dfl_loss, ...rest } = item;
          return { ...rest, l1_loss: dfl_loss };
        }
        return item;
      })
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
  const ui = useUiText();
  const metrics = parseTrainingMetrics(run);
  const series = [
    { key: "box_loss", title: "Box loss", color: "#2563eb" },
    { key: "cls_loss", title: "Class loss", color: "#16a34a" },
    { key: "dfl_loss", title: "DFL loss", color: "#dc2626" },
    { key: "l1_loss", title: "L1 loss", color: "#9333ea" }
  ].filter(item => metrics.some(metric => typeof metric[item.key] === "number" && Number.isFinite(metric[item.key])));
  const latest = metrics.at(-1);
  return (
    <section className="training-loss-chart">
      <div className="sidebar-header"><div><h3>{ui("Training loss")}</h3><p className="muted">{latest ? ui("Epoch {v0}/{v1}", {v0: latest.epoch, v1: latest.total_epochs ?? "?"}) : ui("Waiting for the first epoch metric.")}</p></div></div>
      {series.some(item => item.key === "l1_loss") && <p className="muted">{ui("DFL-free regression · the model reports L1 loss.")}</p>}
      {metrics.length ? <div className="loss-chart-grid">{series.map((item) => <SingleLossChart key={item.key} metrics={metrics} metricKey={item.key} title={ui(item.title)} color={item.color} />)}</div> : <p className="muted">{ui("No loss points have been written yet.")}</p>}
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
  const ui = useUiText();
  const points = metrics
    .map((metric) => ({ epoch: Number(metric.epoch), value: Number(metric[metricKey]) }))
    .filter((point) => Number.isFinite(point.epoch) && Number.isFinite(point.value));
  if (!points.length) {
    return <article className="single-loss-chart"><h4>{title}</h4><p className="muted">{ui("No points yet.")}</p></article>;
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ui("{v0} by epoch", {v0: title})}>
        <line className="loss-axis" x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} />
        <line className="loss-axis" x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} />
        {yTicks.map((tick) => <g className="loss-axis-tick" key={`y-${tick.toFixed(4)}`}><line x1={padLeft - 4} y1={yFor(tick)} x2={width - padRight} y2={yFor(tick)} /><text x={4} y={yFor(tick) + 4}>{tick.toFixed(2)}</text></g>)}
        {xTicks.map((tick) => <g className="loss-axis-tick" key={`x-${tick}`}><line x1={xFor(tick)} y1={height - padBottom} x2={xFor(tick)} y2={height - padBottom + 4} /><text x={xFor(tick) - 8} y={height - 10}>{tick}</text></g>)}
        <text className="loss-axis-label" x={width / 2 - 16} y={height - 2}>{ui("Epoch")}</text>
        <text className="loss-axis-label" x={2} y={12}>{ui("Loss")}</text>
        {polyline ? <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" /> : null}
        {trendStart && trendEnd ? <line className="loss-regression" x1={xFor(trendStart.x)} y1={yFor(trendStart.y)} x2={xFor(trendEnd.x)} y2={yFor(trendEnd.y)} /> : null}
        {points.map((point) => <circle className="loss-point" key={`${metricKey}-${point.epoch}`} cx={xFor(point.epoch)} cy={yFor(point.value)} r="3.2" fill={color}><title>{ui("Epoch {v0}: {v1}", {v0: point.epoch, v1: point.value.toFixed(4)})}</title></circle>)}
      </svg>
    </article>
  );
}

export function TrainingRunSummary({ run }: { run?: TrainingRun | null }) {
  const ui = useUiText();
  if (!run) return <section className="build-summary"><h3>{ui("Training run")}</h3><p className="muted">{ui("No training run selected yet.")}</p></section>;
  return (
    <section className="build-summary">
      <h3>{trainingRunDisplayName(run)}</h3>
      <dl>
        <div><dt>{ui("Status")}</dt><dd>{ui(run.status || "unknown")}</dd></div>
        <div><dt>{ui("Ultralytics save_dir")}</dt><dd>{run.save_dir || ui("not finished")}</dd></div>
        <div><dt>{ui("Best model")}</dt><dd>{run.best_model_path || ui("not available")}</dd></div>
        <div><dt>{ui("Last model")}</dt><dd>{run.last_model_path || ui("not available")}</dd></div>
      </dl>
    </section>
  );
}

export function TrainPage({ project, models, jobs, refreshJobs, t, artifactRevision, onGoToSplit }: { project: Project; models: ModelLists; jobs: Job[]; refreshJobs: () => Promise<void>; t: (key: string) => string; artifactRevision: number; onGoToSplit?: () => void }) {
  const ui = useUiText();
  const runtime = useWorkflow();
  const [splits, setSplits] = useState<DatasetSplitRun[]>([]);
  const [pseudoRuns, setPseudoRuns] = useState<PseudoLabelRun[]>([]);
  const [augmentationRuns, setAugmentationRuns] = useState<AugmentationRun[]>([]);
  const [openDataImports, setOpenDataImports] = useState<OpenDataImport[]>([]);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [splitId, setSplitId] = useState("");
  const [inputModel, setInputModel] = useState("");
  const [draft, setDraft] = useState({ epochs: "100", imgsz: "640", batch: "16", device: "cuda", patience: "10", optimizer: "SGD", lr0: "0.01", lrf: "0.01" });
  const [submittedConfig, setSubmittedConfig] = useState<Record<string, string | number | boolean> | null>(null);
  const [runName, setRunName] = useState(() => versionedBuildName("Train"));
  const [submitting, setSubmitting] = useState(false);
  const [loadingInputs, setLoadingInputs] = useState(false);
  const [submitError, setSubmitError] = useState("");
  async function loadTrainingContext() {
    setLoadingInputs(true);
    try {
      const [items, nextPseudoRuns, nextAugmentationRuns, nextTrainingRuns, nextOpenDataImports] = await Promise.all([api.datasetSplits(project.id), api.pseudoLabelRuns(project.id), api.augmentationRuns(project.id), api.trainingRuns(project.id), api.openDataImports(project.id)]);
      setSplits(items);
      setPseudoRuns(nextPseudoRuns);
      setAugmentationRuns(nextAugmentationRuns);
      setTrainingRuns(nextTrainingRuns);
      setOpenDataImports(nextOpenDataImports);
      const usableSplits = items.filter((split) => !split.outdated);
      setSplitId((current) => runtime ? runtime.state?.assignments.split ?? "" : (
        current && usableSplits.some((split) => split.id === current)
          ? current
          : usableSplits.find((split) => split.is_current !== false)?.id ?? usableSplits[0]?.id ?? ""
      ));
      return nextTrainingRuns;
    } finally {
      setLoadingInputs(false);
    }
  }
  useEffect(() => {
    setRunName(versionedBuildName("Train"));
    setSplitId("");
    setSubmittedConfig(null);
    loadTrainingContext().then((nextRuns) => {
      setRunName(versionedBuildName("Train", nextRuns.map((run) => run.run_name || "")));
    }).catch(console.error);
  }, [project.id]);
  useEffect(() => {
    setInputModel((current) => current && models.input_models.includes(current) ? current : models.input_models[0] ?? "yolov8n.pt");
  }, [models.input_models.join("\u0000")]);
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
  useEffect(() => {
    if (runtime?.state) setSplitId(runtime.state.assignments.split ?? "");
  }, [runtime?.state?.assignments.split, Boolean(runtime?.state)]);
  const selectedSplit = splits.find((split) => String(split.id) === splitId);
  const canSubmitTraining = Boolean(selectedSplit && !selectedSplit.outdated);
  const selectedOrLatestRun = trainingRuns.find(run=>run.id===runtime?.state?.assignments.training)??trainingRuns.find((run) => run.job_id === trainingJob?.id) ?? trainingRuns[0] ?? null;
  const persistedConfig = selectedOrLatestRun?.settings && Object.keys(selectedOrLatestRun.settings).length ? selectedOrLatestRun.settings : null;
  const visibleConfig = (submittedConfig ?? persistedConfig) as Record<string, string | number | boolean> | null;
  return (
    <form
      className="panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!selectedSplit || selectedSplit.outdated) {
          setSubmitError("No usable Split version is selected. Build a new Split version before training.");
          return;
        }
        setSubmitError("");
        setSubmitting(true);
        try {
          const payload = {
            run_name: runName,
            dataset_split_id: splitId,
            input_model: inputModel,
            epochs: Number(draft.epochs),
            imgsz: Number(draft.imgsz),
            batch: Number(draft.batch),
            device: draft.device,
            patience: Number(draft.patience),
            optimizer: draft.optimizer,
            lr0: Number(draft.lr0),
            lrf: Number(draft.lrf)
          };
          await api.train(project.id, payload);
          setSubmittedConfig({ ...payload, split: datasetSplitOptionLabel(selectedSplit, pseudoRuns, augmentationRuns, openDataImports) });
          await refreshJobs();
          await loadTrainingContext();
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : String(error));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <h2>{t("train")}</h2>
      <p className="muted">{ui("Choose the exact Split version to train. Versions marked outdated stay visible in Split history but cannot be trained.")}</p>
      <label title={ui("Training build name shown later in Validate and Model Convert selectors.")}><span>{ui("Training run name")}</span><input value={runName} onChange={(event) => setRunName(event.target.value)} /></label>
      {loadingInputs ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> {ui("Syncing latest split/model inputs…")}</p> : null}
      <section className="workflow-inputs"><label><span>{ui("Split version")}</span><select value={splitId} disabled={loadingInputs||runtime?.busy||submitting||isActiveJob(trainingJob)} onChange={(event) => {if(runtime)void runtime.change(() => api.assignWorkflow(project.id, "split", event.target.value || null));else setSplitId(event.target.value); }}><option value="">{ui("No usable Split version")}</option>{splits.filter((split) => !split.outdated).map((split) => <option key={split.id} value={split.id}>{datasetSplitOptionLabel(split, pseudoRuns, augmentationRuns, openDataImports)}{split.is_current !== false ? ui(" · Current") : ui(" · Saved")}</option>)}</select></label></section>
      {!canSubmitTraining ? <div className="outdated-training-block"><span>{ui("Project data changed or no usable Split version exists. Build a new Split version before training.")}</span>{onGoToSplit ? <button type="button" className="secondary" onClick={onGoToSplit}>{ui("Go to Split")}</button> : null}</div> : null}
      {submitError ? <p className="review-error" role="alert">{submitError}</p> : null}
      <TrainingInputSummary split={selectedSplit} pseudoRuns={pseudoRuns} augmentationRuns={augmentationRuns} openDataImport={openDataImports} />
      <label title={ui("Starting YOLO weights. Use a pretrained input model for fine-tuning or an output model for continued training.")}><span>{ui("Input model")}</span><select value={inputModel} onChange={(event) => setInputModel(event.target.value)}>
        {(models.input_models.length ? models.input_models : ["yolov8n.pt"]).map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select></label>
      <p className="muted">{ui("Local Ultralytics Detect checkpoints in input_model are architecture-driven: YOLOv8, YOLO11, YOLO12, and YOLO26 can use the same Train flow when the installed runtime supports that checkpoint. NMS-free heads are handled inside Ultralytics. With the pinned 8.4.130 runtime, YOLO26 uses native small-object assignment and progressive dual-head loss; its charts show Box, Class and L1. MuSGD is optional and the selected optimizer is respected.")}</p>
      <div className="field-row">
        <label title={ui("Epochs: complete passes through all training images. More can improve learning but increases overfitting/time.")}><span>{ui("Epochs")}</span><input name="epochs" type="number" min="1" value={draft.epochs} onChange={(event) => setDraft((current) => ({ ...current, epochs: event.target.value }))} /></label>
        <label title={ui("imgsz: square input resize used by YOLO, e.g. 640 means 640×640. Larger keeps details but uses more VRAM.")}><span>{ui("Image size")}</span><input name="imgsz" type="number" min="1" value={draft.imgsz} onChange={(event) => setDraft((current) => ({ ...current, imgsz: event.target.value }))} /></label>
        <label title={ui("Batch: images per optimizer step. Larger is faster but needs more GPU memory.")}><span>{ui("Batch")}</span><input name="batch" type="number" min="1" value={draft.batch} onChange={(event) => setDraft((current) => ({ ...current, batch: event.target.value }))} /></label>
      </div>
      <div className="field-row">
        <label title={ui("Device: cuda uses NVIDIA GPU; cpu is slower but useful for debugging.")}><span>{ui("Device")}</span><select name="device" value={draft.device} onChange={(event) => setDraft((current) => ({ ...current, device: event.target.value }))}><option>cuda</option><option>cpu</option></select></label>
        <label title={ui("Patience: early stop after this many validation epochs without improvement.")}><span>{ui("Patience")}</span><input name="patience" type="number" min="1" value={draft.patience} onChange={(event) => setDraft((current) => ({ ...current, patience: event.target.value }))} /></label>
        <label title={ui("Optimizer: SGD is the stable default. MuSGD is a Muon + SGD hybrid intended for YOLO26 and longer/larger training runs; results still depend on the dataset and settings. Adam/AdamW may converge faster but can need LR tuning.")}><span>{ui("Optimizer")}</span><select name="optimizer" value={draft.optimizer} onChange={(event) => setDraft((current) => ({ ...current, optimizer: event.target.value }))}><option>SGD</option><option>MuSGD</option><option>Adam</option><option>AdamW</option></select></label>
      </div>
      <div className="field-row">
        <label title={ui("lr0: initial learning rate. 0.01 is common for SGD; too high diverges, too low learns slowly.")}><span>{ui("Initial LR")}</span><input name="lr0" type="number" min="0" step="0.001" value={draft.lr0} onChange={(event) => setDraft((current) => ({ ...current, lr0: event.target.value }))} /></label>
        <label title={ui("lrf: final LR factor for the scheduler. 0.01 means decay to 1% of initial LR by the end.")}><span>{ui("Final LR factor")}</span><input name="lrf" type="number" min="0" step="0.001" value={draft.lrf} onChange={(event) => setDraft((current) => ({ ...current, lrf: event.target.value }))} /></label>
      </div>
      {visibleConfig ? <section className="submitted-training-config" aria-label={ui("Submitted training configuration")}><div className="sidebar-header"><div><h3>{ui("Submitted training configuration")}</h3><p className="muted">{ui("This is the exact request retained for the current/latest run.")}</p></div><span className="open-data-ready">{ui("Locked")}</span></div><dl><div><dt>{ui("Training run")}</dt><dd>{String(visibleConfig.run_name ?? selectedOrLatestRun?.run_name ?? "—")}</dd></div><div><dt>{ui("Dataset Split")}</dt><dd>{String(visibleConfig.split ?? selectedOrLatestRun?.dataset_split_id ?? "—")}</dd></div><div><dt>{ui("Input model")}</dt><dd>{String(visibleConfig.input_model ?? selectedOrLatestRun?.input_model ?? inputModel)}</dd></div><div><dt>{ui("Optimizer")}</dt><dd>{String(visibleConfig.optimizer ?? "—")}</dd></div><div><dt>{ui("Epochs / image / batch")}</dt><dd>{String(visibleConfig.epochs ?? "—")} / {String(visibleConfig.imgsz ?? "—")} / {String(visibleConfig.batch ?? "—")}</dd></div><div><dt>{ui("Device / patience")}</dt><dd>{String(visibleConfig.device ?? "—")} / {String(visibleConfig.patience ?? "—")}</dd></div><div><dt>{ui("LR initial / final factor")}</dt><dd>{String(visibleConfig.lr0 ?? "—")} / {String(visibleConfig.lrf ?? "—")}</dd></div></dl></section> : null}
      {trainingJob && <div className="job-progress-inline" title={trainingJob.message}><span>{trainingJob.name}: {trainingJob.status}</span><progress value={trainingJob.progress} max={100} /><small>{trainingJob.progress}% · {trainingJob.message}</small></div>}
      <TrainingLossChart run={selectedOrLatestRun} />
      <TrainingRunSummary run={selectedOrLatestRun} />
      {trainingRuns.length ? <section className="build-summary"><h3>{ui("Training history")}</h3><div className="version-list">{trainingRuns.map((run) => <article className="history-row" key={run.id}><div><strong>{trainingRunDisplayName(run)}</strong><span>{ui(run.status || "unknown")} · {run.save_dir || run.output_dir || ui("waiting for save_dir")}</span></div><HistoryDeleteButton projectId={project.id} artifactType="training" artifactId={run.id} label={trainingRunDisplayName(run)} disabled={["queued", "running"].includes(run.status ?? "")} onDeleted={async () => { setSubmittedConfig(null); await loadTrainingContext(); await refreshJobs(); }} /></article>)}</div></section> : null}
      <ProcessingButton busy={submitting || isActiveJob(trainingJob)} jobId={isActiveJob(trainingJob) ? trainingJob?.id : undefined} disabled={!canSubmitTraining} progress={trainingJob ? trainingJob.progress : submitting ? 10 : undefined} statusText={trainingJob ? trainingJob.message || `${trainingJob.name}: ${trainingJob.status}` : ui("Submitting training run…")} className="primary action-process"><Play size={17} />{t("train")}</ProcessingButton>
    </form>
  );
}

export function ParameterHelp({ name, value, help }: { name: string; value: string; help: string }) {
  return <article className="param-help" title={help}><strong>{name}</strong><span>{value}</span><p>{help}</p></article>;
}

export function ValidationRandomButton({ loading, sampleCount = 1, onSampleCountChange = () => undefined, onClick, disabled = false }: { loading: boolean; sampleCount?: number; onSampleCountChange?: (count: number) => void; onClick: () => void; disabled?: boolean }) {
  const ui = useUiText();
  return (
    <div className="validation-sample-controls">
      <label><span>{ui("Sample count")}</span><input type="number" min="1" max="12" step="1" value={sampleCount} disabled={loading} onChange={(event) => onSampleCountChange(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /></label>
      <button type="button" className="primary action-validate" onClick={onClick} disabled={loading || disabled} title={ui("Random sample: choose images from the selected folder and rerun inference")}>
        {loading ? <LoaderCircle size={18} className="spin" /> : <Dice5 size={18} />}
        {loading ? ui("Running inference…") : ui("Random sample")}
      </button>
    </div>
  );
}

function ValidationPage({ project, models, artifactRevision }: { project: Project; models: ModelLists; artifactRevision: number }) {
  const ui = useUiText();
  const runtime = useWorkflow();
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [modelSources, setModelSources] = useState<ModelSource[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [modelName, setModelName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [sampleCount, setSampleCount] = useState(1);
  const [showBrowser, setShowBrowser] = useState(false);
  const [results, setResults] = useState<ValidationPreviewResult[]>([]);
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
  useEffect(() => {
    const assignedId = runtime?.state?.assignments.training;
    const source = modelSources.find(item => item.training_run_id === assignedId);
    if (assignedId && source) setModelName(source.path);
  }, [runtime?.state?.assignments.training, modelSources]);
  async function runRandomInference() {
    setError("");
    if (!folderPath.trim()) {
      setError("Choose or enter a validation image folder first.");
      return;
    }
    setLoading(true);
    try {
      setResults(await api.validationPreview(project.id, { model_name: modelName, schema_id: schemaId || null, folder_path: folderPath, sample_count: sampleCount, confidence: 0.25, iou: 0.7 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const fallbackModels = [...models.output_models, ...models.input_models];
return <section className="panel-grid"><div className="panel wide">{showBrowser && <FileManagerDialog mode="image_folder" initialPath={folderPath} onClose={() => setShowBrowser(false)} onSelect={(path) => { setFolderPath(path); setResults([]); setShowBrowser(false); }} />}<div className="sidebar-header"><div><h2>{ui("Validate / random inference")}</h2><p className="muted">{ui("Choose a model, class schema, folder, and how many random images to inspect.")}</p></div><ValidationRandomButton loading={loading} sampleCount={sampleCount} onSampleCountChange={setSampleCount} onClick={runRandomInference} disabled={!folderPath.trim()} /></div>{loadingModels ? <p className="inline-feedback"><LoaderCircle className="spin" size={15} /> {ui("Syncing latest project models…")}</p> : null}<div className="field-row workflow-inputs"><label title={ui("Model artifact used for inference. Current project training outputs are listed before global models.")}><span>{ui("Model source")}</span><select value={modelName} disabled={loadingModels||runtime?.busy} onChange={(event) => {const path=event.target.value;setModelName(path);setResults([]);const source=modelSources.find(item=>item.path===path);if(runtime)void runtime.change(()=>api.assignWorkflow(project.id,'training',source?.scope==='current_project'?source.training_run_id??null:null));}}>{modelSources.map((source) => <option key={source.id} value={source.path}>{source.label}</option>)}{fallbackModels.length ? <optgroup label={ui("Global models")}>{fallbackModels.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup> : null}</select></label><label title={ui("Class schema used to show id/name context next to model outputs.")}><span>{ui("Class schema")}</span><select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}><option value="">{ui("Model native classes")}</option>{schemas.map((schema) => <option key={schema.id} value={schema.id}>{schema.name}</option>)}</select></label></div><FolderPathField value={folderPath} onChange={(path) => { setFolderPath(path); setResults([]); }} onBrowse={() => setShowBrowser(true)} />{selectedSchema && <SchemaHierarchy schema={selectedSchema} />}{error && <p className="review-error">{ui(error)}</p>}{results.length ? <div className="validation-results-grid">{results.map((result) => <InferencePreviewCard key={result.image_path ?? result.file_name} result={result} />)}</div> : null}</div></section>;
}

export function InferencePreviewCard({ result }: { result: ValidationPreviewResult }) {
  const ui = useUiText();
  const width = Number(result.width) || 640;
  const height = Number(result.height) || 480;
  return <article className="split-sample-card validation-card"><div><strong>{result.file_name}</strong><span>{ui("model:")} {result.model_name} {ui("· schema:")} {result.schema_name} · {result.annotations.length} {ui("detections")}</span>{result.postprocess && <span>{result.postprocess}{result.postprocess === "NMS-free" ? ui(" · confidence filtering; no NMS IoU suppression") : ""}</span>}</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ui("validation inference {v0}", {v0: result.file_name})}><image href={result.image_url} width={width} height={height} preserveAspectRatio="xMidYMid meet" />{result.annotations.map((annotation, index) => { const x = (annotation.x_center - annotation.width / 2) * width; const y = (annotation.y_center - annotation.height / 2) * height; const rectWidth = annotation.width * width; const rectHeight = annotation.height * height; return <g key={`${annotation.class_id}-${index}`}><rect x={x} y={y} width={rectWidth} height={rectHeight} /><text x={Math.max(0, x)} y={Math.max(12, y - 4)}>{annotation.class_name} {typeof annotation.confidence === "number" ? annotation.confidence.toFixed(2) : ""}</text></g>; })}</svg></article>;
}

const CONVERSION_TARGETS = [
  { key: "onnx:fp32", format: "onnx", precision: "fp32", label: "ONNX FP32" },
  { key: "tflite:fp32", format: "tflite", precision: "fp32", label: "LiteRT FP32" }
] as const;

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
  const ui = useUiText();
  if (!schema) return <div className="schema-class-map empty"><strong>{ui("Class schema manifest")}</strong><span>{ui("No schema selected")}</span></div>;
  return (
    <div className="schema-class-map">
      <strong>{ui("Class schema manifest")}</strong>
      <span>{schema.name}</span>
      <div className="class-id-grid">
        {schema.classes.map((item) => (
          <div key={item.class_id} className="class-id-row"><code>{ui("id")} {item.class_id}</code><span>{item.class_name}</span></div>
        ))}
      </div>
    </div>
  );
}

export function ConversionTargetMatrix({ selected, onToggle, tfliteLayout = "NCHW", onTfliteLayoutChange = () => {}, disabled = false }: { selected: string[]; onToggle: (key: string) => void; tfliteLayout?: "NCHW" | "NHWC"; onTfliteLayoutChange?: (layout: "NCHW" | "NHWC") => void; disabled?: boolean }) {
  const ui = useUiText();
  return (
    <div className="conversion-target-matrix">
      {CONVERSION_TARGETS.map((target) => (
        <section key={target.key}>
          <label className="check-row">
            <input type="checkbox" checked={selected.includes(target.key)} disabled={disabled} onChange={() => onToggle(target.key)} />
            <strong>{target.label}</strong>
          </label>
          {target.format === "tflite" && selected.includes(target.key) ? (
            <label><span>{ui("Input layout")}</span><select value={tfliteLayout} disabled={disabled} onChange={(event) => onTfliteLayoutChange(event.target.value as "NCHW" | "NHWC")}><option value="NCHW">NCHW</option><option value="NHWC">NHWC</option></select></label>
          ) : null}
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
  const ui = useUiText();
  const completedArtifacts = conversion.artifacts.filter((artifact) => artifact.status === "completed");
  return (
    <article className="conversion-package">
      <div className="conversion-package-main">
        <div>
          <strong>{conversion.package_name}</strong>
          <span>{ui(conversion.status)} {ui("· schema:")} {conversion.schema_name}</span>
          <small>{ui("created:")} {formatDateTime(conversion.created_at)}</small>
          <small>{ui("completed:")} {conversion.status === "completed" ? formatDateTime(conversion.updated_at) : ui("not completed")}</small>
          <small>{conversion.source_model_path}</small>
        </div>
        <button type="button" className="secondary action-export" disabled={conversion.status !== "completed" || completedArtifacts.length === 0 || exporting} onClick={onExport} title={ui("Download native PT, converted models, classes.json, metadata.json, and bundle manifest")}>
          <Download size={16} />{exporting ? ui("Exporting...") : ui("Export ZIP")}
        </button>
      </div>
      <div className="artifact-chip-row">
        {conversion.artifacts.map((artifact) => (
          <button key={artifact.id} type="button" className={selectedArtifactId === artifact.id ? "active artifact-chip" : "artifact-chip"} onClick={() => onSelectArtifact(artifact.id)}>
            {artifact.format} · {artifact.precision} · {artifact.layout ?? "NCHW"} · {ui(artifact.status)}
          </button>
        ))}
      </div>
    </article>
  );
}

export function ExportPackageSummary({ conversion, selectedArtifactIds, includeNativePt, onToggleArtifact, onToggleNative }: { conversion: ModelConversionRun; selectedArtifactIds: string[]; includeNativePt: boolean; onToggleArtifact: (artifactId: string) => void; onToggleNative: () => void }) {
  const ui = useUiText();
  return (
    <div className="export-package-summary">
      <h3>{conversion.package_name}</h3>
      <label className="check-row"><input type="checkbox" checked={includeNativePt} onChange={onToggleNative} />{ui("Native PT")}</label>
      <div className="manifest-files"><span>{ui("classes.json")}</span><span>{ui("metadata.json")}</span></div>
      {conversion.artifacts.map((artifact) => (
        <label key={artifact.id} className="check-row">
          <input type="checkbox" checked={selectedArtifactIds.includes(artifact.id)} onChange={() => onToggleArtifact(artifact.id)} />
          {artifact.format} · {artifact.precision} · {artifact.layout ?? "NCHW"}
        </label>
      ))}
    </div>
  );
}

export function ModelSourceSelector({ sources, value, onChange }: { sources: ModelSource[]; value: string; onChange: (sourceId: string) => void }) {
  const ui = useUiText();
  const groups: Array<[ModelSource["scope"], string]> = [
    ["current_project", "Current project models"],
    ["other_project", "Other project models"],
    ["loose_output", "Loose output_model models"]
  ];
  return (
    <label><span>{ui("Model source")}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
      {groups.map(([scope, label]) => {
        const items = sources.filter((source) => source.scope === scope);
        if (!items.length) return null;
        return <optgroup key={scope} label={ui(label)}>{items.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</optgroup>;
      })}
    </select></label>
  );
}

export function ModelConvertPage({ project, jobs, refreshJobs }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void> }) {
  const ui = useUiText();
  const runtime = useWorkflow();
  const [modelSources, setModelSources] = useState<ModelSource[]>([]);
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [conversions, setConversions] = useState<ModelConversionRun[]>([]);
  const [capabilities, setCapabilities] = useState<ModelConversionCapability[]>([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilityError, setCapabilityError] = useState("");
  const [modelSourceId, setModelSourceId] = useState("");
  const [schemaId, setSchemaId] = useState("");
  const [selectedTargets, setSelectedTargets] = useState(["onnx:fp32", "tflite:fp32"]);
  const [tfliteLayout, setTfliteLayout] = useState<"NCHW" | "NHWC">("NCHW");
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [netronUrl, setNetronUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exportingConversionId, setExportingConversionId] = useState("");
  const [exportError, setExportError] = useState("");
  const conversionJob = findWorkflowJob(jobs, "model_conversion");
  const selectedSchema = schemas.find((schema) => schema.id === schemaId);
  const selectedModelSource = modelSources.find((source) => source.id === modelSourceId);
  const unavailableReason = capabilities.find((capability) => !capability.available)?.reason ?? capabilityError;
  const conversionUnavailable = capabilitiesLoading || Boolean(unavailableReason);

  useEffect(() => {
    const assignedId = runtime?.state?.assignments.training;
    const source = modelSources.find(item => item.training_run_id === assignedId);
    if (assignedId && source) setModelSourceId(source.id);
  }, [runtime?.state?.assignments.training, modelSources]);
  async function loadConvertData() {
    setCapabilitiesLoading(true);
    setCapabilityError("");
    const [sourceModels, classSchemas, conversionRuns, conversionCapabilities] = await Promise.all([
      api.modelSources(project.id),
      api.classSchemas(project.id),
      api.modelConversions(project.id),
      api.modelConversionCapabilities()
    ]);
    setModelSources(sourceModels);
    setSchemas(classSchemas);
    setConversions(conversionRuns);
    setCapabilities(conversionCapabilities);
    setCapabilitiesLoading(false);
    setModelSourceId((current) => sourceModels.some((item) => item.id === current) ? current : sourceModels[0]?.id ?? "");
    setSchemaId((current) => classSchemas.some((item) => item.id === current) ? current : classSchemas[0]?.id ?? "");
    const firstArtifact = conversionRuns[0]?.artifacts[0];
    setSelectedArtifactId((current) => conversionRuns.some((run) => run.artifacts.some((item) => item.id === current)) ? current : firstArtifact?.id ?? "");
  }

  useEffect(() => {
    loadConvertData().catch((error) => {
      setCapabilityError(error instanceof Error ? error.message : String(error));
      setCapabilitiesLoading(false);
    });
  }, [project.id, conversionJob?.id, conversionJob?.status]);

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
          setExportError("");
          await api.createModelConversion(project.id, {
            training_run_id: selectedModelSource?.training_run_id ?? null,
            source_model_path: selectedModelSource?.path ?? "",
            schema_id: schemaId,
            targets: selectedTargets.flatMap<ModelConversionTarget>((key) => {
              const target = CONVERSION_TARGETS.find((candidate) => candidate.key === key);
              return target ? [{ format: target.format, precision: target.precision, layout: target.format === "tflite" ? tfliteLayout : "NCHW" }] : [];
            }),
            imgsz: Number(new FormData(event.currentTarget).get("imgsz")),
            opset: Number(new FormData(event.currentTarget).get("opset") ?? 11)
          });
          await refreshJobs();
          await loadConvertData();
        } catch (err) {
          setExportError(err instanceof Error ? err.message : String(err));
        } finally {
          setSubmitting(false);
        }
      }}>
        <h2>{ui("Model Convert / Export")}</h2>
        <p className="muted">{ui("Convert a completed model, inspect artifacts, and download one ZIP with class metadata, training configuration, metrics, and result plots when available.")}</p>
        <section className="workflow-inputs"><ModelSourceSelector sources={modelSources} value={modelSourceId} onChange={id=>{setModelSourceId(id);const source=modelSources.find(item=>item.id===id);if(runtime)void runtime.change(()=>api.assignWorkflow(project.id,'training',source?.scope==='current_project'?source.training_run_id??null:null));}} /></section>
        {selectedModelSource && <p className="stream-lineage">{selectedModelSource.label}</p>}
        <label><span>{ui("Class schema")}</span><select value={schemaId} onChange={(event) => setSchemaId(event.target.value)}>
          {schemas.map((schema) => <option key={schema.id} value={schema.id}>{schema.name}</option>)}
        </select></label>
        <SchemaClassMap schema={selectedSchema} />
        <label><span>{ui("Image size")}</span><input name="imgsz" type="number" min="1" defaultValue="640" /></label>
        <ConversionTargetMatrix selected={selectedTargets} onToggle={toggleTarget} tfliteLayout={tfliteLayout} onTfliteLayoutChange={setTfliteLayout} disabled={conversionUnavailable} />
        <label><span>{ui("ONNX opset")}</span><select name="opset" defaultValue="11" disabled={!selectedTargets.some((key) => key.startsWith("onnx"))}>{Array.from({ length: 10 }, (_, i) => i + 11).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {exportError && <p className="review-error" role="alert">{ui(exportError)}</p>}
        {conversionJob?.status === "failed" && <p className="review-error" role="alert">{conversionJob.error || conversionJob.message}</p>}
        {capabilitiesLoading && <p className="inline-feedback">{ui("Checking conversion availability…")}</p>}
        {unavailableReason && <p className="review-error">{ui(unavailableReason)}</p>}
        {conversionJob && <div className="job-progress-inline" title={conversionJob.message}><span>{conversionJob.name}: {conversionJob.status}</span><progress value={conversionJob.progress} max={100} /><small>{conversionJob.progress}% · {conversionJob.message}</small></div>}
        <ProcessingButton busy={submitting || isActiveJob(conversionJob)} jobId={isActiveJob(conversionJob) ? conversionJob?.id : undefined} disabled={conversionUnavailable || !selectedModelSource || !schemaId || selectedTargets.length === 0} progress={conversionJob ? conversionJob.progress : submitting ? 10 : undefined} statusText={conversionJob ? conversionJob.message : ui("Submitting conversion package…")} className="primary action-process"><PackageCheck size={17} />{ui("Convert package")}</ProcessingButton>
      </form>
      <section className="panel wide">
        <h2>{ui("Conversion packages")}</h2>
        {conversions.length === 0 && <p className="muted">{ui("No conversion package yet.")}</p>}
        {conversions.map((conversion) => (
          <div className="conversion-history-item" key={conversion.id}>
            <ConversionPackageSummary
              conversion={conversion}
              selectedArtifactId={selectedArtifactId}
              onSelectArtifact={(artifactId) => openNetron(conversion, artifactId).catch(console.error)}
              onExport={() => exportConversion(conversion).catch(console.error)}
              exporting={exportingConversionId === conversion.id}
            />
            <HistoryDeleteButton projectId={project.id} artifactType="conversion" artifactId={conversion.id} label={conversion.package_name} disabled={["queued", "running"].includes(conversion.status)} onDeleted={async () => { setNetronUrl(""); await loadConvertData(); await refreshJobs(); }} />
          </div>
        ))}
        <div className="netron-panel">
          {netronUrl ? <iframe title={ui("Netron model graph")} src={netronUrl} /> : <p className="muted">{ui("Select an artifact to open Netron preview. Mouse wheel zoom and drag are handled by Netron.")}</p>}
        </div>
      </section>
      <ExportHistory project={project} revision={exportingConversionId} refreshJobs={refreshJobs} />
    </section>
  );
}

function ExportHistory({ project, revision, refreshJobs }: { project: Project; revision: string; refreshJobs: () => Promise<void> }) {
  const ui = useUiText();
  const [bundles, setBundles] = useState<ModelExportBundle[]>([]);
  const [error, setError] = useState("");
  const load = async () => { setBundles(await api.exportBundles(project.id)); setError(""); };
  useEffect(() => { let active = true; api.exportBundles(project.id).then((items) => { if (active) setBundles(items); }).catch((err) => { if (active) setError(String(err)); }); return () => { active = false; }; }, [project.id, revision]);
  return <section className="panel wide"><h2>{ui("Export history")}</h2><p className="muted">{ui("Use Export ZIP on a conversion package above. The ZIP includes native and converted models, classes.json, metadata.json, and training/ with args.yaml, saved run configuration, metrics and plots when available.")}</p>{error && <p className="muted">{ui("Export history is temporarily unavailable.")}</p>}{bundles.length === 0 ? <p className="muted">{ui("No export yet.")}</p> : <div className="version-list">{bundles.map((bundle) => <article className="history-row" key={bundle.id}><div><strong>{bundle.bundle_name}</strong><span>{ui(bundle.status)}</span></div><HistoryDeleteButton projectId={project.id} artifactType="export" artifactId={bundle.id} label={bundle.bundle_name} onDeleted={async () => { await load(); await refreshJobs(); }} /></article>)}</div>}</section>;
}

export function SettingsPage({ models, t, activeProject, context }: { models: ModelLists; t: (key: string) => string; activeProject?: Project; context?: ProjectArtifactContext | null }) {
  const ui = useUiText();
  const availableWorldModels = supportedWorldModels(models.world_models, models.world_model_details);
  const [pseudoModel, setPseudoModel] = useState(() => firstSupportedWorldModel(models.world_models, models.world_model_details));
  const [trainModel, setTrainModel] = useState(models.input_models[0] ?? "yolov8n.pt");
  const [augmentDefault, setAugmentDefault] = useState("Skip augment");
  const [splitDefault, setSplitDefault] = useState("80 / 10 / 10");
  const [trainDevice, setTrainDevice] = useState("cuda");
  useEffect(() => {
    setPseudoModel((current) => availableWorldModels.includes(current) ? current : availableWorldModels[0] ?? "");
    setTrainModel((current) => current || models.input_models[0] || "yolov8n.pt");
  }, [models.world_models, models.world_model_details, models.input_models]);
  return (
    <section className="panel-grid settings-grid">
      <section className="panel wide settings-panel">
        <div className="sidebar-header"><div><h2>{ui("Workflow defaults")}</h2><p className="muted">{ui("Defaults used when entering each workflow tab. They keep the project flow explicit without hiding build selectors.")}</p></div></div>
        <div className="settings-control-grid">
          <label><span>{ui("Pseudo default model")}</span><select value={pseudoModel} disabled={!availableWorldModels.length} onChange={(event) => setPseudoModel(event.target.value)}>{availableWorldModels.length ? availableWorldModels.map((model) => {
            const info = models.world_model_details.find((item) => item.name === model);
            return <option key={model} value={model}>{info ? worldModelLabel(info) : model}</option>;
          }) : <option value="">{ui("No supported local world models")}</option>}</select></label>
          <label><span>{ui("Train input model")}</span><select value={trainModel} onChange={(event) => setTrainModel(event.target.value)}>{(models.input_models.length ? models.input_models : ["yolov8n.pt"]).map((model) => <option key={model}>{model}</option>)}</select></label>
          <label><span>{ui("Augment default")}</span><select value={augmentDefault} onChange={(event) => setAugmentDefault(event.target.value)}><option value="Skip augment">{ui("Skip augment")}</option><option>x3</option><option>x5</option><option>x8</option><option>x10</option></select></label>
          <label><span>{ui("Split ratio preset")}</span><select value={splitDefault} onChange={(event) => setSplitDefault(event.target.value)}><option>80 / 10 / 10</option><option>70 / 20 / 10</option><option>90 / 5 / 5</option></select></label>
          <label><span>{ui("Train device")}</span><select value={trainDevice} onChange={(event) => setTrainDevice(event.target.value)}><option>cuda</option><option>cpu</option></select></label>
        </div>
        <p className="inline-feedback">{ui("These are UI defaults for faster setup. Every workflow tab still shows the exact input build before running.")}</p>
      </section>

      <section className="panel settings-panel">
        <h2>{ui("Project storage")}</h2>
        <dl className="settings-detail-list">
          <div><dt>{ui("Active project")}</dt><dd>{activeProject?.name ?? ui("No project selected")}</dd></div>
          <div><dt>{ui("Project folder")}</dt><dd>{activeProject?.root_path ?? ui("Create or select a project first.")}</dd></div>
          <div><dt>{ui("Sources / pseudo / augment / split")}</dt><dd>{context ? ui("{v0} sources · {v1} pseudo builds · {v2} augment/source builds · {v3} splits", {v0: context.counts.sources, v1: context.counts.pseudo_label_runs ?? 0, v2: context.counts.augmentation_runs ?? 0, v3: context.counts.dataset_splits}) : ui("Loading project context…")}</dd></div>
          <div><dt>{ui("Training / packages")}</dt><dd>{context ? ui("{v0} training runs · {v1} model sources · {v2} conversion packages · {v3} export bundles", {v0: context.counts.training_runs, v1: context.counts.model_sources, v2: context.counts.conversion_packages, v3: context.counts.export_bundles}) : ui("Loading project context…")}</dd></div>
        </dl>
      </section>

      <section className="panel settings-panel">
        <h2>{ui("Runtime deployment")}</h2>
        <div className="runtime-mode-grid">
          <article><strong>{ui("Desktop x86_64")}</strong><span>{ui("Uses docker-compose.yml and the CUDA PyTorch desktop image. Use `./run.sh --mode desktop` on x86 workstations.")}</span></article>
          <article><strong>{ui("Jetson ARM64")}</strong><span>{ui("Uses docker-compose.jetson.yml and NVIDIA igpu/L4T PyTorch images. Use `./run.sh --mode jetson` on Orin/JetPack systems.")}</span></article>
          <article><strong>{ui("Private Tailscale HTTPS")}</strong><span>{ui("Use `./run.sh --tailscale-up`; access is for registered tailnet devices only and remains governed by your tailnet policy.")}</span></article>
        </div>
        <p className="muted">{ui("Run `./run.sh --detect` or `./run.sh --plan desktop` to inspect runtime details. Use `./run.sh --tailscale-status` to inspect private HTTPS without changing it.")}</p>
      </section>

      <ModelList title={t("worldModels")} subtitle={ui("Open-vocabulary weights used by Pseudo; Seg checkpoints persist bbox labels only.")} items={models.world_models.map((name) => {
        const info = models.world_model_details.find((item) => item.name === name);
        return info ? worldModelLabel(info) : name;
      })} />
      <ModelList title={t("inputModels")} subtitle={ui("Pretrained YOLO weights used by Train.")} items={models.input_models} />
      <ModelList title={t("outputModels")} subtitle={ui("Global/project model index used by Validate and Convert.")} items={models.output_models} />
    </section>
  );
}

function ModelList({ title, items, subtitle }: { title: string; items: string[]; subtitle?: string }) {
  const ui = useUiText();
  return (
    <div className="panel settings-panel">
      <h2>{title}</h2>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      {items.length ? items.map((item) => <span className="file-pill" key={item}>{item}</span>) : <span className="muted">{ui("No files")}</span>}
    </div>
  );
}

function Placeholder({ title, models }: { title: string; models?: string[] }) {
  const ui = useUiText();
  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted">{models?.join(", ") || ui("Backend endpoints will be connected in the next task.")}</p>
    </div>
  );
}
