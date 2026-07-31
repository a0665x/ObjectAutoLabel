import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { api, type ImageFilters, type ReviewStats, type ReviewStatus } from "../api/client";
import { annotationReducer } from "../annotation/reducer";
import { AnnotationCanvas } from "../components/review/AnnotationCanvas";
import { AnnotationInspector } from "../components/review/AnnotationInspector";
import { AnnotationToolbar } from "../components/review/AnnotationToolbar";
import { ClassPalette } from "../components/review/ClassPalette";
import { ImageQueue } from "../components/review/ImageQueue";
import {
  createReviewBaseline,
  hasDirtyReviewState,
  shouldProceedWithReviewNavigation
} from "./reviewState";
import { DEFAULT_REVIEW_FILTERS, getNextImageId } from "./reviewConfig";
import type { Annotation, ClassItem, Project, ProjectImage, SourceAsset } from "../types";

type ReviewPageProps = {
  project: Project;
  t: (key: string) => string;
  onDirtyChange?: (dirty: boolean) => void;
};

const EMPTY_STATS: ReviewStats = {
  unreviewed: 0,
  pending_review: 0,
  needs_fix: 0,
  reviewed: 0,
  skipped: 0,
  edited: 0,
  low_confidence: 0
};

function normalizeReviewStatus(status: string): ReviewStatus {
  switch (status) {
    case "unreviewed":
    case "pending_review":
    case "needs_fix":
    case "reviewed":
    case "skipped":
      return status;
    default:
      return "reviewed";
  }
}

export function ReviewPage({ project, t, onDirtyChange }: ReviewPageProps) {
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [stats, setStats] = useState<ReviewStats>(EMPTY_STATS);
  const [filters, setFilters] = useState<ImageFilters>(DEFAULT_REVIEW_FILTERS);
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [baseline, setBaseline] = useState(() => createReviewBaseline([], "reviewed"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [mode, setMode] = useState<"select" | "draw" | "pan">("select");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("reviewed");
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const annotationCache = useRef(new Map<string, { image: ProjectImage; annotations: Annotation[] }>());
  const imagePreloadCache = useRef(new Set<string>());
  const image = useMemo(() => images.find((item) => item.id === activeImageId) ?? null, [activeImageId, images]);
  const currentIndex = image ? images.findIndex((item) => item.id === image.id) : -1;
  const selectedAnnotation = useMemo(
    () => annotations.find((item) => item.id === selectedId) ?? null,
    [annotations, selectedId]
  );
  const selectedClass = useMemo(
    () => classes.find((item) => item.class_id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );
  const dirty = hasDirtyReviewState(baseline, annotations, reviewStatus);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const refreshStats = useCallback(async () => {
    setStats(await api.reviewStats(project.id));
  }, [project.id]);

  useEffect(() => {
    let ignore = false;

    Promise.all([api.sources(project.id), api.classSchemas(project.id), api.reviewStats(project.id)])
      .then(([nextSources, schemas, nextStats]) => {
        if (ignore) return;
        setSources(nextSources);
        setClasses(schemas[0]?.classes ?? []);
        setSelectedClassId((current) => current ?? schemas[0]?.classes[0]?.class_id ?? null);
        setStats(nextStats);
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        setError(reason instanceof Error ? reason.message : "Failed to load review metadata.");
      });

    return () => {
      ignore = true;
    };
  }, [project.id]);

  useEffect(() => {
    let ignore = false;
    setLoadingImages(true);
    setError(null);

    api.images(project.id, filters)
      .then((items) => {
        if (ignore) return;
        setImages(items);
        setActiveImageId((current) => (current && items.some((candidate) => candidate.id === current) ? current : items[0]?.id ?? null));
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        setError(reason instanceof Error ? reason.message : "Failed to load image queue.");
      })
      .finally(() => {
        if (!ignore) setLoadingImages(false);
      });

    refreshStats().catch(console.error);

    return () => {
      ignore = true;
    };
  }, [filters, project.id, refreshStats]);

  useEffect(() => {
    if (!image) {
      setAnnotations([]);
      setReviewStatus("reviewed");
      setBaseline(createReviewBaseline([], "reviewed"));
      setSelectedId(null);
      setSelectedIds([]);
      setContextMenu(null);
      return;
    }

    let ignore = false;
    setLoadingAnnotations(true);
    setAnnotations([]);
    setBaseline(createReviewBaseline([], normalizeReviewStatus(image.review_status)));
    setSelectedId(null);
    setSelectedIds([]);
    setContextMenu(null);
    setError(null);

    const cached = annotationCache.current.get(image.id);
    if (cached) {
      const nextReviewStatus = normalizeReviewStatus(cached.image.review_status);
      setAnnotations(cached.annotations);
      setReviewStatus(nextReviewStatus);
      setBaseline(createReviewBaseline(cached.annotations, nextReviewStatus));
      setSelectedId(null);
      setSelectedIds([]);
      setContextMenu(null);
      setLoadingAnnotations(false);
      return;
    }

    api.annotations(image.id)
      .then((result) => {
        if (ignore) return;
        annotationCache.current.set(image.id, result);
        const nextReviewStatus = normalizeReviewStatus(result.image.review_status);
        setAnnotations(result.annotations);
        setReviewStatus(nextReviewStatus);
        setBaseline(createReviewBaseline(result.annotations, nextReviewStatus));
        setSelectedId(null);
        setSelectedIds([]);
        setContextMenu(null);
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        setError(reason instanceof Error ? reason.message : "Failed to load annotations.");
      })
      .finally(() => {
        if (!ignore) setLoadingAnnotations(false);
      });

    return () => {
      ignore = true;
    };
  }, [image?.id]);

  useEffect(() => {
    if (!images.length || currentIndex < 0) return;
    let cancelled = false;
    const candidates = [images[currentIndex + 1], images[currentIndex + 2], images[currentIndex - 1]].filter(Boolean);
    if (!candidates.length) return;
    setPrefetching(true);
    Promise.allSettled(candidates.map(async (candidate) => {
      if (!annotationCache.current.has(candidate.id)) {
        const result = await api.annotations(candidate.id);
        if (!cancelled) annotationCache.current.set(candidate.id, result);
      }
      if (!imagePreloadCache.current.has(candidate.path)) {
        await new Promise<void>((resolve) => {
          const img = new globalThis.Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = `/api/files?path=${encodeURIComponent(candidate.path)}`;
        });
        if (!cancelled) imagePreloadCache.current.add(candidate.path);
      }
    })).finally(() => {
      if (!cancelled) setPrefetching(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentIndex, images]);

  useEffect(() => {
    if (selectedId && !annotations.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
    if (selectedId) setSelectedAnnotations([selectedId]);
  }, [annotations, selectedId]);

  useEffect(() => {
    if (images.length === 0) {
      setActiveImageId(null);
      return;
    }
    if (!activeImageId || !images.some((item) => item.id === activeImageId)) {
      setActiveImageId(images[0].id);
    }
  }, [activeImageId, images]);

  useEffect(() => {
    if (!classes.length) {
      setSelectedClassId(null);
      return;
    }
    if (selectedClassId === null || !classes.some((item) => item.class_id === selectedClassId)) {
      setSelectedClassId(classes[0].class_id);
    }
  }, [classes, selectedClassId]);

  const applyAnnotationAction = useCallback((action: Parameters<typeof annotationReducer>[1]) => {
    setAnnotations((current) => annotationReducer(current, action));
  }, []);

  const bulkSelectionIds = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
  function setSelectedAnnotations(ids: string[]) {
    setSelectedIds(ids);
    setSelectedId(ids[0] ?? null);
  }
  function deleteSelectedAnnotations(ids = bulkSelectionIds) {
    if (!ids.length) return;
    setAnnotations((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedAnnotations([]);
    setContextMenu(null);
  }
  function changeSelectedClass(classItem: ClassItem, ids = bulkSelectionIds) {
    if (!ids.length) return;
    setAnnotations((current) => current.map((item) => ids.includes(item.id) ? { ...item, class_id: classItem.class_id, class_name: classItem.class_name, edited: true } : item));
    setContextMenu(null);
  }

  const updateAnnotationList = useCallback((nextAnnotations: Annotation[]) => {
    setAnnotations(nextAnnotations);
  }, []);

  const handleSelect = useCallback(
    (annotationId: string | null) => {
      setSelectedId(annotationId);
      setContextMenu(null);
      if (!annotationId) {
        setSelectedIds([]);
        return;
      }
      setSelectedIds([annotationId]);
      const annotation = annotations.find((item) => item.id === annotationId);
      if (annotation) setSelectedClassId(annotation.class_id);
    },
    [annotations]
  );

  const handleClassSelect = useCallback(
    (item: ClassItem) => {
      setSelectedClassId(item.class_id);
      if (bulkSelectionIds.length) {
        changeSelectedClass(item, bulkSelectionIds);
      }
    },
    [bulkSelectionIds, changeSelectedClass]
  );

  const handleInspectorClassChange = useCallback(
    (annotationId: string, classId: number) => {
      const item = classes.find((candidate) => candidate.class_id === classId);
      if (!item) return;
      setSelectedClassId(item.class_id);
      applyAnnotationAction({
        type: "changeClass",
        id: annotationId,
        class_id: item.class_id,
        class_name: item.class_name
      });
    },
    [applyAnnotationAction, classes]
  );

  const handleDelete = useCallback(
    (annotationId: string) => {
      deleteSelectedAnnotations(selectedIds.includes(annotationId) ? selectedIds : [annotationId]);
    },
    [selectedIds]
  );

  const handleMergeSameClass = useCallback(() => {
    const value = window.prompt("Merge same-class boxes with IoU >=", "0.75");
    if (value === null) return;
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      window.alert("Merge IoU threshold must be a number from 0 to 1.");
      return;
    }
    applyAnnotationAction({ type: "mergeSameClass", iouThreshold: threshold });
    setSelectedId(null);
  }, [applyAnnotationAction]);

  const persistAnnotations = useCallback(async (advanceToNext = false) => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      const nextReviewStatus = normalizeReviewStatus(reviewStatus);
      const nextImageId = advanceToNext ? getNextImageId(images, image.id) : image.id;
      const result = await api.saveAnnotations(image.id, { annotations, review_status: reviewStatus });
      annotationCache.current.set(image.id, { image: { ...image, review_status: nextReviewStatus }, annotations: result.annotations });
      setAnnotations(result.annotations);
      setReviewStatus(nextReviewStatus);
      setBaseline(createReviewBaseline(result.annotations, nextReviewStatus));
      setImages((current) =>
        current.map((item) => (item.id === image.id ? { ...item, review_status: nextReviewStatus } : item))
      );
      const nextImages = await api.images(project.id, filters);
      setImages(nextImages);
      setActiveImageId(
        nextImageId && nextImages.some((candidate) => candidate.id === nextImageId) ? nextImageId : nextImages[0]?.id ?? null
      );
      await refreshStats();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to save annotations.");
    } finally {
      setSaving(false);
    }
  }, [annotations, filters, image, project.id, refreshStats, reviewStatus]);

  const confirmReviewNavigation = useCallback(() => shouldProceedWithReviewNavigation(dirty, window.confirm), [dirty]);

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= images.length) return;
      if (!confirmReviewNavigation()) return;
      setActiveImageId(images[nextIndex].id);
    },
    [confirmReviewNavigation, images]
  );

  const goPrevious = useCallback(() => {
    if (currentIndex > 0) navigateToIndex(currentIndex - 1);
  }, [currentIndex, navigateToIndex]);

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < images.length - 1) navigateToIndex(currentIndex + 1);
  }, [currentIndex, images.length, navigateToIndex]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }
      const usesShortcutModifier = event.metaKey || event.ctrlKey;
      if (usesShortcutModifier && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        persistAnnotations().catch(console.error);
        return;
      }
      if (usesShortcutModifier && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        setMode((current) => (current === "draw" ? "select" : "draw"));
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === "Delete" && bulkSelectionIds.length) {
        event.preventDefault();
        deleteSelectedAnnotations(bulkSelectionIds);
        return;
      }
      if (event.key === "w" || event.key === "W") {
        event.preventDefault();
        setMode("draw");
        return;
      }
      if (event.key === "v" || event.key === "V") {
        event.preventDefault();
        setMode("select");
        return;
      }
      if ((event.key === "s" || event.key === "S") && event.shiftKey) {
        event.preventDefault();
        persistAnnotations(true).catch(console.error);
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        persistAnnotations().catch(console.error);
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const item = classes[Number(event.key) - 1];
        if (!item) return;
        event.preventDefault();
        handleClassSelect(item);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bulkSelectionIds, classes, deleteSelectedAnnotations, goNext, goPrevious, handleClassSelect, persistAnnotations]);

  return (
    <section className="review-page">
      <div className="review-main">
        <AnnotationToolbar
          mode={mode}
          reviewStatus={reviewStatus}
          canGoPrev={currentIndex > 0}
          canGoNext={currentIndex >= 0 && currentIndex < images.length - 1}
          dirty={dirty}
          saving={saving}
          onModeChange={setMode}
          onReviewStatusChange={setReviewStatus}
          onPrevious={goPrevious}
          onNext={goNext}
          onSave={() => {
            persistAnnotations().catch(console.error);
          }}
          onSaveAndNext={() => {
            persistAnnotations(true).catch(console.error);
          }}
          onMergeSameClass={handleMergeSameClass}
        />

        {error && (
          <div className="review-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <section className="panel review-stage-panel">
          <div className="sidebar-header">
            <div>
              <strong>{image?.path ?? t("review")}</strong>
              <p className="muted">
                {loadingAnnotations ? "Loading annotations..." : "Draw, move, resize, relabel, then save."}
              </p>
            </div>
            {loadingAnnotations && <LoaderCircle className="spin" size={18} />}
          </div>
          {image ? (
            <div className={`review-canvas-shell ${loadingAnnotations ? "is-loading" : ""}`}>
              {loadingAnnotations && <div className="review-loading-overlay"><LoaderCircle className="spin" size={18} />Loading fresh boxes…</div>}
              <AnnotationCanvas
                key={image.id}
                image={image}
                annotations={annotations}
                selectedId={selectedId}
                selectedIds={selectedIds}
                selectedClass={selectedClass}
                mode={mode}
                onChange={updateAnnotationList}
                onSelect={handleSelect}
                onSelectMany={setSelectedAnnotations}
                onContextMenu={(annotationId, point) => setContextMenu({ x: point.x, y: point.y, ids: bulkSelectionIds.includes(annotationId) ? bulkSelectionIds : [annotationId] })}
              />
              {contextMenu && contextMenu.ids.length > 0 && (
                <div className="review-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                  <strong>{contextMenu.ids.length} box{contextMenu.ids.length > 1 ? "es" : ""} selected</strong>
                  <span className="muted">Change class</span>
                  {classes.map((item) => <button key={item.class_id} type="button" onClick={() => changeSelectedClass(item, contextMenu.ids)}>ID {item.class_id} · {item.class_name}</button>)}
                  <button type="button" className="danger" onClick={() => deleteSelectedAnnotations(contextMenu.ids)}>Delete selected</button>
                </div>
              )}
            </div>
          ) : (
            <div className="review-empty">
              <strong>No image selected</strong>
              <span>Adjust the queue filters or pick an image to begin reviewing.</span>
            </div>
          )}
        </section>

        <ClassPalette
          classes={classes}
          selectedClassId={selectedClassId}
          selectedAnnotation={selectedAnnotation}
          onSelectClass={handleClassSelect}
        />
      </div>

      <div className="review-sidebar">
        <ImageQueue
          images={images}
          activeImageId={activeImageId}
          filters={filters}
          stats={stats}
          sources={sources}
          loading={loadingImages}
          prefetching={prefetching}
          onSelectImage={(id) => {
            if (id === activeImageId) return;
            if (!confirmReviewNavigation()) return;
            setActiveImageId(id);
          }}
          onFilterChange={(partial) => {
            if (!confirmReviewNavigation()) return;
            setFilters((current) => ({ ...current, ...partial }));
          }}
        />
        <AnnotationInspector
          image={image}
          annotations={annotations}
          selectedId={selectedId}
          classes={classes}
          reviewStatus={reviewStatus}
          dirty={dirty}
          loading={loadingAnnotations}
          saving={saving}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onClassChange={handleInspectorClassChange}
          onReviewStatusChange={setReviewStatus}
          onSave={() => {
            persistAnnotations().catch(console.error);
          }}
          onSaveAndNext={() => {
            persistAnnotations(true).catch(console.error);
          }}
        />
      </div>
    </section>
  );
}
