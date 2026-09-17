import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Cloud, Dice5, Download, Library, LoaderCircle, Search, Trash2 } from "lucide-react";

import { api } from "../api/client";
import { versionedBuildName } from "../artifactNaming";
import type { ClassSchema, ImageSourceSummary, Job, OpenDataCatalogItem, OpenDataImport, OpenDataMapping, OpenDataPreview, Project } from "../types";

const TARGET_COLORS = ["#dff3ff", "#e8f6df", "#fff0d8", "#f1e5ff", "#ffe3ec", "#dcf6f1"];

function suggestedMapping(labels: string[], schema?: ClassSchema): Record<string, number | null | undefined> {
  const next: Record<string, number | null | undefined> = {};
  if (!schema) return next;
  const people = schema.classes.find((item) => ["people", "person"].includes(item.class_name.toLowerCase()));
  const car = schema.classes.find((item) => item.class_name.toLowerCase() === "car");
  for (const label of labels) {
    if (["pedestrian", "people"].includes(label) && people) next[label] = people.class_id;
    if (["car", "van", "truck", "bus"].includes(label) && car) next[label] = car.class_id;
  }
  return next;
}

export function OpenDataPage({ project, jobs, refreshJobs, artifactRevision }: { project: Project; jobs: Job[]; refreshJobs: () => Promise<void>; artifactRevision: number }) {
  const [sourceMode, setSourceMode] = useState<"official" | "platform">("official");
  const [catalog, setCatalog] = useState<OpenDataCatalogItem[]>([]);
  const [selectedDatasetKey, setSelectedDatasetKey] = useState("");
  const [platformUrl, setPlatformUrl] = useState("");
  const [platformApiKey, setPlatformApiKey] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [schemas, setSchemas] = useState<ClassSchema[]>([]);
  const [activeImport, setActiveImport] = useState<OpenDataImport | null>(null);
  const [imports, setImports] = useState<OpenDataImport[]>([]);
  const [schemaId, setSchemaId] = useState("");
  const [mapping, setMapping] = useState<Record<string, number | null | undefined>>({});
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedAssigned, setSelectedAssigned] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [samplePercentage, setSamplePercentage] = useState(50);
  const [projectImageCount, setProjectImageCount] = useState(0);
  const [sourceSummary, setSourceSummary] = useState<ImageSourceSummary>({ images: {}, classes: {} });
  const [loadedProjectId, setLoadedProjectId] = useState("");
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [preview, setPreview] = useState<OpenDataPreview | null>(null);
  const [previewSeed, setPreviewSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [versionName, setVersionName] = useState(() => versionedBuildName("OpenData"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingImportId, setDeletingImportId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const officialCatalog = catalog.filter((item) => item.provider === "built_in");
  const platformCatalog = catalog.filter((item) => item.provider === "ultralytics_platform");
  const visibleCatalog = sourceMode === "official" ? officialCatalog : platformCatalog;
  const dataset = visibleCatalog.find((item) => item.key === selectedDatasetKey) ?? visibleCatalog[0];
  const activeDatasetName = catalog.find((item) => item.key === activeImport?.dataset_key)?.name ?? activeImport?.dataset_key;
  const schema = schemas.find((item) => item.id === schemaId);
  const downloadJob = jobs.find((job) => job.name === "open_data_download" && job.project_id === project.id && ["queued", "running", "cancel_requested"].includes(job.status));
  const importJob = jobs.find((job) => job.name === "open_data_import" && job.project_id === project.id && ["queued", "running", "cancel_requested"].includes(job.status));

  async function load() {
    const [nextCatalog, nextSchemas, nextImport, nextImports, nextSummary] = await Promise.all([
      api.openDataCatalog(), api.classSchemas(project.id), api.activeOpenDataImport(project.id), api.openDataImports(project.id), api.imageSourceSummary(project.id)
    ]);
    const inspected = catalog.filter((item) => item.provider === "ultralytics_platform" && !nextCatalog.some((next) => next.key === item.key));
    const mergedCatalog = [...nextCatalog, ...inspected];
    setCatalog(mergedCatalog);
    setSchemas(nextSchemas);
    setActiveImport(nextImport);
    setImports(nextImports);
    setSourceSummary(nextSummary);
    setProjectImageCount(nextSummary.images.project ?? 0);
    const projectChanged = loadedProjectId !== project.id;
    const nextSchemaId = (projectChanged ? "" : schemaId) || nextImport?.schema_id || nextSchemas[0]?.id || "";
    setSchemaId(nextSchemaId);
    const nextSchema = nextSchemas.find((item) => item.id === nextSchemaId);
    const nextDataset = mergedCatalog.find((item) => item.key === nextImport?.dataset_key) ?? mergedCatalog.find((item) => item.key === selectedDatasetKey) ?? mergedCatalog[0];
    if (nextDataset && (projectChanged || !selectedDatasetKey)) {
      setSelectedDatasetKey(nextDataset.key);
      setSourceMode(nextDataset.provider === "ultralytics_platform" ? "platform" : "official");
    }
    if ((projectChanged || !Object.keys(mapping).length) && nextDataset) {
      setMapping(nextImport?.mapping ?? suggestedMapping(nextDataset.labels, nextSchema));
      if (nextImport) setSamplePercentage(nextImport.sample_percentage);
    }
    if (projectChanged) {
      setPreview(null);
      setSelectedSource("");
      setSelectedAssigned("");
      setSelectedTarget("");
      setLoadedProjectId(project.id);
      setVersionName(versionedBuildName("OpenData", nextImports.map((item) => item.version_name || "")));
    }
  }

  async function deleteImport(item: OpenDataImport) {
    const label = item.version_name || item.dataset_key;
    if (!window.confirm(`Delete Open Data history “${label}” and its downstream Split, Train, Conversion, and Export history? The shared download cache and original source files will be preserved.`)) return;
    setDeletingImportId(item.id);
    setDeleteError("");
    try {
      await api.deleteHistory(project.id, "open_data", item.id);
      await load();
      await refreshJobs();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Unable to delete Open Data history");
    } finally {
      setDeletingImportId("");
    }
  }

  useEffect(() => { load().catch((reason) => setError(String(reason))); }, [project.id, artifactRevision, jobs.map((job) => `${job.id}:${job.status}`).join("|")]);

  const unassigned = useMemo(() => (dataset?.labels ?? []).filter((label) => !Object.prototype.hasOwnProperty.call(mapping, label)), [dataset, mapping]);
  const resolvedCount = (dataset?.labels.length ?? 0) - unassigned.length;
  const mappingComplete = Boolean(dataset && dataset.labels.length > 0 && unassigned.length === 0);
  const selectedEstimate = dataset ? Math.ceil((dataset.train_count + dataset.val_count) * samplePercentage / 100) : 0;
  const combined = projectImageCount + (preview?.selected_image_count ?? selectedEstimate);
  const openShare = combined ? Math.round((preview?.selected_image_count ?? selectedEstimate) / combined * 100) : 0;

  function assign() {
    if (!selectedSource || !selectedTarget) return;
    setMapping((current) => ({ ...current, [selectedSource]: selectedTarget === "ignore" ? null : Number(selectedTarget) }));
    setSelectedSource("");
    setPreview(null);
  }

  function unassign() {
    if (!selectedAssigned) return;
    setMapping((current) => {
      const next = { ...current };
      delete next[selectedAssigned];
      return next;
    });
    setSelectedAssigned("");
    setPreview(null);
  }

  function payload(extra: { preview_seed?: number; version_name?: string } = {}) {
    return { dataset_key: dataset!.key, schema_id: schemaId, mapping: mapping as OpenDataMapping, sample_percentage: samplePercentage, seed: 42, ...extra };
  }

  function chooseDataset(key: string) {
    const next = catalog.find((item) => item.key === key);
    setSelectedDatasetKey(key);
    setMapping(suggestedMapping(next?.labels ?? [], schema));
    setSelectedSource("");
    setSelectedAssigned("");
    setSelectedTarget("");
    setLicenseAccepted(false);
    setPreview(null);
    setError("");
  }

  function chooseSourceMode(mode: "official" | "platform") {
    setSourceMode(mode);
    const next = catalog.find((item) => item.provider === (mode === "official" ? "built_in" : "ultralytics_platform"));
    if (next) chooseDataset(next.key);
    else {
      setSelectedDatasetKey("");
      setMapping({});
      setLicenseAccepted(false);
      setPreview(null);
      setError("");
    }
  }

  async function inspectPlatformDataset() {
    setInspecting(true);
    setError("");
    try {
      const inspected = await api.inspectOpenData(platformUrl);
      setCatalog((current) => [...current.filter((item) => item.key !== inspected.key), inspected]);
      setSourceMode("platform");
      setSelectedDatasetKey(inspected.key);
      setMapping(suggestedMapping(inspected.labels, schema));
      setLicenseAccepted(false);
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInspecting(false);
    }
  }

  async function loadPreview(seed = previewSeed) {
    setLoading(true);
    setError("");
    try {
      setPreviewSeed(seed);
      setPreview(await api.previewOpenData(project.id, payload({ preview_seed: seed })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="open-data-page">
      <section className="panel wide">
        <div className="sidebar-header"><div><h2>Open Data</h2><p className="muted">Optional · download once, map to the project schema, sample, preview, then add to Review.</p></div>{activeImport ? <span className="open-data-ready"><CheckCircle2 size={15} /> Active</span> : <span className="file-pill">Optional</span>}</div>
        {error ? <p className="review-error" role="alert">{error}</p> : null}
        <div className="open-data-source-switch" role="group" aria-label="Open Data source type">
          <button type="button" className={sourceMode === "official" ? "is-active" : ""} aria-pressed={sourceMode === "official"} onClick={() => chooseSourceMode("official")}><Library aria-hidden="true" size={18} />Official datasets</button>
          <button type="button" className={sourceMode === "platform" ? "is-active" : ""} aria-pressed={sourceMode === "platform"} onClick={() => chooseSourceMode("platform")}><Cloud aria-hidden="true" size={18} />Ultralytics Platform</button>
        </div>
        <p className="muted source-mode-help">{sourceMode === "official" ? "Curated adapters with verified download, annotation conversion and split rules. No API key required." : "Inspect a public Platform URL first. Download uses your Ultralytics API key, but the key is never saved."}</p>
        {sourceMode === "platform" ? <div className="platform-dataset-entry">
          <div className="platform-dataset-row">
            <label><span>Dataset URL</span><input type="url" value={platformUrl} placeholder="https://platform.ultralytics.com/owner/datasets/name" onChange={(event) => setPlatformUrl(event.target.value)} /></label>
            <a href="https://platform.ultralytics.com/explore" target="_blank" rel="noreferrer">Browse public Detect datasets</a>
            <button type="button" className="secondary" disabled={!platformUrl.trim() || inspecting} onClick={inspectPlatformDataset}>{inspecting ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}Inspect dataset</button>
          </div>
          <p className="muted">Paste one public dataset page. Task, classes, splits and compatibility are checked automatically.</p>
        </div> : null}
        {visibleCatalog.length ? <div className="open-data-catalog-controls">
          <label><span>{sourceMode === "official" ? "Official dataset" : "Inspected Platform dataset"}</span><select value={dataset?.key ?? ""} onChange={(event) => chooseDataset(event.target.value)}>{visibleCatalog.map((item) => <option key={item.key} value={item.key}>{item.name}{item.owner !== "ultralytics" ? ` · ${item.owner}` : ""}</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} /><span>I reviewed the source and usage notice</span></label>
          <button type="button" className="primary action-process" disabled={!dataset?.compatible || dataset?.downloaded || !licenseAccepted || Boolean(downloadJob)} onClick={async () => { setError(""); try { await api.downloadOpenData(project.id, dataset!.key, platformApiKey); setPlatformApiKey(""); await refreshJobs(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>
            {downloadJob ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{dataset?.downloaded ? "Downloaded · verified" : "Download to shared cache"}
          </button>
        </div> : sourceMode === "platform" ? <p className="open-data-empty">Inspect a Platform dataset URL to see its task, classes, license and download controls.</p> : null}
        {dataset?.provider === "ultralytics_platform" && dataset.compatible && !dataset.downloaded ? <label className="platform-api-key"><span>Ultralytics API key <small>Required to download; never saved</small></span><input type="password" value={platformApiKey} autoComplete="off" placeholder="Uses host setting when left empty" onChange={(event) => setPlatformApiKey(event.target.value)} /></label> : null}
        {dataset && !dataset.compatible ? <p className="review-error" role="status">{dataset.compatibility_reason} Choose a Detect dataset to continue.</p> : null}
        {visibleCatalog.length ? <table className="open-data-table"><thead><tr><th>Name</th><th>Task / images</th><th>Source labels</th><th>Status</th></tr></thead><tbody>{visibleCatalog.map((item) => <tr key={item.key} className={item.key === dataset?.key ? "selected-row" : ""}><td><strong>{item.name}</strong><small>{item.provider === "ultralytics_platform" ? `Ultralytics Platform · ${item.owner}` : "Official adapter"} · {item.license}</small></td><td>{item.task === "detect" ? "BBox detection" : item.task.toUpperCase()} · {item.image_count.toLocaleString()}<small>train {item.train_count.toLocaleString()} · val {item.val_count.toLocaleString()} · test {item.test_count.toLocaleString()} excluded</small></td><td>{item.labels.length ? item.labels.join(", ") : "No classes declared"}</td><td>{!item.compatible ? "Not compatible" : item.downloaded ? <span className="open-data-ready">Downloaded</span> : item.status}</td></tr>)}</tbody></table> : null}
        {downloadJob ? <div className="job-progress-inline"><span>Downloading {dataset?.name ?? "Open Data"} to the shared cache</span><progress value={downloadJob.progress} max={100} /><small>{downloadJob.progress}% · {downloadJob.message}</small></div> : null}
      </section>

      {dataset?.compatible ? <><section className="panel wide">
        <h2>1. Map source labels</h2>
        <label><span>Target Class schema</span><select value={schemaId} onChange={(event) => { const id = event.target.value; setSchemaId(id); setMapping(suggestedMapping(dataset?.labels ?? [], schemas.find((item) => item.id === id))); setPreview(null); }}>{schemas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p className="muted">Select one unassigned source label, select a target, then use the center arrow. The left side must be empty before preview.</p>
        <div className="mapping-board">
          <div className="mapping-lane"><strong>{dataset.name} source labels · {unassigned.length} remaining</strong><div className="mapping-cards">{unassigned.map((label, index) => <button type="button" key={label} className={selectedSource === label ? "mapping-card selected" : "mapping-card"} style={{ backgroundColor: TARGET_COLORS[index % TARGET_COLORS.length] }} onClick={() => { setSelectedSource(label); setSelectedAssigned(""); }}>{label}</button>)}</div>{unassigned.length === 0 ? <p className="mapping-empty"><CheckCircle2 size={17} /> All source labels assigned</p> : null}</div>
          <div className="mapping-arrows"><button type="button" aria-label="Assign selected source label" disabled={!selectedSource || !selectedTarget} onClick={assign}><ArrowRight /></button><button type="button" aria-label="Return selected assigned label" disabled={!selectedAssigned} onClick={unassign}><ArrowLeft /></button></div>
          <div className="mapping-lane"><strong>{schema?.name ?? "Project schema"}</strong><div className="mapping-targets">{schema?.classes.map((target, index) => { const assigned = (dataset?.labels ?? []).filter((label) => mapping[label] === target.class_id); return <button type="button" key={target.class_id} className={selectedTarget === String(target.class_id) ? "mapping-target selected" : "mapping-target"} style={{ backgroundColor: TARGET_COLORS[index % TARGET_COLORS.length] }} onClick={() => setSelectedTarget(String(target.class_id))}><b>{target.class_name}</b><span>{assigned.map((label) => <em key={label} className={selectedAssigned === label ? "selected" : ""} onClick={(event) => { event.stopPropagation(); setSelectedAssigned(label); setSelectedSource(""); }}>{label}</em>)}</span></button>; })}<button type="button" className={selectedTarget === "ignore" ? "mapping-target ignore selected" : "mapping-target ignore"} onClick={() => setSelectedTarget("ignore")}><b>Ignore</b><span>{(dataset?.labels ?? []).filter((label) => Object.prototype.hasOwnProperty.call(mapping, label) && mapping[label] === null).map((label) => <em key={label} className={selectedAssigned === label ? "selected" : ""} onClick={(event) => { event.stopPropagation(); setSelectedAssigned(label); }}>{label}</em>)}</span></button></div></div>
        </div>
        <p className={mappingComplete ? "inline-feedback" : "review-error"}>{mappingComplete ? `Ready · all ${resolvedCount} source labels assigned or ignored.` : `${unassigned.length} source labels still require a target or Ignore.`}</p>
      </section>

      <section className="panel wide">
        <h2>2. Select Open Data portion</h2>
        <label className="open-data-slider"><span>Use {samplePercentage}% of eligible {dataset.name} images</span><input type="range" min="1" max="100" value={samplePercentage} onChange={(event) => { setSamplePercentage(Number(event.target.value)); setPreview(null); }} /></label>
        <div className="dataset-ratio"><span style={{ width: `${100 - openShare}%` }} /><span style={{ width: `${openShare}%` }} /></div>
        <p className="muted">Current estimate: Project {projectImageCount.toLocaleString()} images + Open Data {(preview?.selected_image_count ?? selectedEstimate).toLocaleString()} images · combined share {100 - openShare}% / {openShare}%.</p>
        <button type="button" className="secondary action-preview" disabled={!dataset?.downloaded || !schemaId || !mappingComplete || loading} onClick={() => loadPreview()}>{loading ? <LoaderCircle className="spin" size={16} /> : null}Validate & Preview</button>
      </section></> : null}

      {preview ? <section className="panel wide"><div className="sidebar-header"><div><h2>3. Preview before adding</h2><p className="muted">Random visual sample; the fixed dataset seed and selected image set stay unchanged.</p></div><button type="button" className="secondary icon-action" aria-label="Reroll Open Data preview" title="Reroll preview images only" disabled={loading} onClick={() => loadPreview(previewSeed + 1)}>{loading ? <LoaderCircle className="spin" size={17} /> : <Dice5 size={17} />}Random sample</button></div><div className="open-data-summary"><span>Eligible <b>{preview.eligible_image_count.toLocaleString()}</b></span><span>Selected <b>{preview.selected_image_count.toLocaleString()}</b></span><span>BBoxes <b>{preview.selected_annotation_count.toLocaleString()}</b></span><span>Excluded empty <b>{preview.excluded_empty_count.toLocaleString()}</b></span></div><table className="open-data-table"><thead><tr><th>Target class</th><th>Project bboxes</th><th>Selected Open Data bboxes</th><th>Combined</th></tr></thead><tbody>{schema?.classes.map((item) => { const projectCount = sourceSummary.classes.project?.[item.class_name] ?? 0; const openCount = preview.target_class_counts[item.class_name] ?? 0; return <tr key={item.class_id}><td>{item.class_name}</td><td>{projectCount.toLocaleString()}</td><td>{openCount.toLocaleString()}</td><td>{(projectCount + openCount).toLocaleString()}</td></tr>; })}</tbody></table><div className="open-data-samples">{preview.samples.map((sample) => <article key={`${sample.split}-${sample.file_name}`}><div className="open-data-preview-frame"><img src={sample.image_url} alt={sample.file_name} />{sample.annotations.map((annotation, index) => <span key={index} style={{ left: `${(annotation.x_center - annotation.width / 2) * 100}%`, top: `${(annotation.y_center - annotation.height / 2) * 100}%`, width: `${annotation.width * 100}%`, height: `${annotation.height * 100}%` }} />)}</div><small>{sample.split} · {sample.file_name}</small></article>)}</div><label><span>Open Data version name</span><input value={versionName} maxLength={120} onChange={(event) => setVersionName(event.target.value)} /></label><button type="button" className="primary action-process" disabled={Boolean(importJob) || preview.selected_image_count === 0 || !versionName.trim()} onClick={async () => { setError(""); try { await api.importOpenData(project.id, payload({ version_name: versionName.trim() })); await refreshJobs(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>{importJob ? <LoaderCircle className="spin" size={16} /> : null}Process annotations & Add version to project</button></section> : null}

      {activeImport ? <section className="panel wide"><div className="sidebar-header"><div><h2>Active Project import</h2><p className="muted">{activeDatasetName} · {activeImport.sample_percentage}% · {activeImport.selected_image_count.toLocaleString()} images · available in Review.</p></div><button type="button" className="danger" onClick={async () => { if (!window.confirm("Remove Open Data from this project? The shared download stays available, but Current Split will need an update.")) return; await api.removeOpenDataImport(project.id); setPreview(null); await load(); }}><Trash2 size={16} />Remove from this project</button></div></section> : null}
      {imports.length ? <section className="panel wide"><h2>Open Data version history</h2><div className="version-list">{imports.map((item) => { const itemName = catalog.find((entry) => entry.key === item.dataset_key)?.name ?? item.dataset_key; const label = item.version_name || itemName; return <article className="history-row" key={item.id}><div><strong>{label}</strong><span>{itemName} · {item.sample_percentage}% · {item.selected_image_count.toLocaleString()} images · {item.status === "active" ? "Active in Review" : "Saved for Split"}</span></div><button type="button" className="secondary danger compact-action action-delete" disabled={deletingImportId === item.id || Boolean(importJob)} aria-label={`Delete open data history ${label}`} onClick={() => deleteImport(item)}><Trash2 size={16} />{deletingImportId === item.id ? "Deleting…" : "Delete"}</button></article>; })}</div>{deleteError ? <p className="review-error" role="alert">{deleteError}</p> : null}</section> : null}
    </section>
  );
}
