import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { api, type BboxHistogramClass, type ImageFilters, type ReviewStats, type ReviewStatus } from "../api/client";
import { annotationReducer } from "../annotation/reducer";
import { AnnotationCanvas } from "../components/review/AnnotationCanvas";
import type { CanvasViewportApi } from "../components/review/AnnotationCanvas";
import { AnnotationContextMenu } from "../components/review/AnnotationContextMenu";
import { AnnotationHistogram, annotationIdsInAreaBin, type ActiveAreaBin } from "../components/review/AnnotationHistogram";
import { AnnotationInspector } from "../components/review/AnnotationInspector";
import { clipAnnotation } from "../annotation/geometry";
import { AnnotationToolbar } from "../components/review/AnnotationToolbar";
import {
  changeAnnotationClasses,
  deleteAnnotations,
  duplicateAnnotations,
  keyboardNudgeDelta,
  moveAnnotations
} from "../components/review/annotationCommands";
import { ClassPalette } from "../components/review/ClassPalette";
import { ImageQueue } from "../components/review/ImageQueue";
import { copyAnnotations, pasteAnnotations } from "../components/review/reviewClipboard";
import type { ReviewClipboardEntry } from "../components/review/reviewClipboard";
import {
  createReviewCommands,
  dispatchReviewShortcut,
  getReviewCommand,
  isReviewEditableTarget
} from "../components/review/reviewCommands";
import {
  pushHistory,
  redoHistory,
  undoHistory
} from "../components/review/reviewHistory";
import type { ImageRemovalHistoryEntry, ReviewHistoryEntry, ReviewHistoryState } from "../components/review/reviewHistory";
import {
  createReviewBaseline,
  hasDirtyReviewState,
  shouldProceedWithReviewNavigation
} from "./reviewState";
import { DEFAULT_REVIEW_FILTERS, getNextImageId } from "./reviewConfig";
import type { Annotation, ClassItem, OpenDataImport, Project, ProjectImage, ReviewImagePosition, SourceAsset } from "../types";

type ReviewPageProps = {
  project: Project;
  t: (key: string) => string;
  onDirtyChange?: (dirty: boolean) => void;
  initialFilters?: ImageFilters;
};

type AnnotationSelection = {
  ids: string[];
  activeId: string | null;
};

type RemovalPhase = "removing" | "restoring" | null;

const EMPTY_STATS: ReviewStats = {
  unreviewed: 0,
  pending_review: 0,
  needs_fix: 0,
  reviewed: 0,
  skipped: 0,
  edited: 0,
  low_confidence: 0
};
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const REMOVE_IMAGE_CONFIRMATION = "The project image and its labels will be removed from this project. The raw input is kept. Undo is session-only and is unavailable after refresh or closing Review. Continue?";

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

function filteredQueueKey(projectId: string, filters: ImageFilters): string {
  return JSON.stringify([
    projectId,
    filters.review_status ?? null,
    filters.has_low_confidence ?? null,
    filters.source_asset_id ?? null,
    filters.source_origin ?? null,
    filters.source_groups ?? null
  ]);
}

function imagePositionKey(projectId: string, imageId: string | null, filters: ImageFilters): string {
  return JSON.stringify([filteredQueueKey(projectId, filters), imageId]);
}

function imageMatchesFilters(
  image: ProjectImage,
  reviewStatus: ReviewStatus,
  nextAnnotations: Annotation[],
  filters: ImageFilters
): boolean {
  if (filters.review_status !== undefined && reviewStatus !== filters.review_status) return false;
  if (filters.source_asset_id !== undefined && image.source_asset_id !== filters.source_asset_id) return false;
  if (filters.source_origin !== undefined && (image.source_origin ?? "project") !== filters.source_origin) return false;
  if (filters.source_groups?.length) {
    const group = image.source_origin === "open_data" ? "open_data" : image.augmentation_run_id ? "augment" : "pseudo";
    if (!filters.source_groups.includes(group)) return false;
  }
  if (filters.has_low_confidence === undefined) return true;
  const hasLowConfidence = nextAnnotations.some(
    (annotation) => annotation.confidence !== null && annotation.confidence !== undefined && annotation.confidence < LOW_CONFIDENCE_THRESHOLD
  );
  return hasLowConfidence === filters.has_low_confidence;
}

function annotationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function annotationsMatch(left: Annotation[], right: Annotation[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ReviewPage({ project, t, onDirtyChange, initialFilters }: ReviewPageProps) {
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [openDataImport, setOpenDataImport] = useState<OpenDataImport | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [stats, setStats] = useState<ReviewStats>(EMPTY_STATS);
  const statsRequestRef = useRef(0);
  const [filters, setFilters] = useState<ImageFilters>(() => ({ ...DEFAULT_REVIEW_FILTERS, ...initialFilters }));
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [sourceCounts, setSourceCounts] = useState({ pseudo: 0, augment: 0, open_data: 0 });
  const [bboxDistribution, setBboxDistribution] = useState<BboxHistogramClass[]>([]);
  const [histogramLoading, setHistogramLoading] = useState(false);
  const [activeAreaBin, setActiveAreaBin] = useState<ActiveAreaBin | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [locallyExcludedImageIds, setLocallyExcludedImageIds] = useState<Set<string>>(() => new Set());
  const [loadedQueueKey, setLoadedQueueKey] = useState<string | null>(null);
  const queueRequestGenerationRef = useRef(0);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [imagePosition, setImagePosition] = useState<ReviewImagePosition | null>(null);
  const activeImageIdRef = useRef(activeImageId);
  activeImageIdRef.current = activeImageId;
  const navigationGenerationRef = useRef(0);
  const positionRequestRef = useRef({ generation: 0, key: "" });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [baseline, setBaseline] = useState(() => createReviewBaseline([]));
  const [selection, setSelection] = useState<AnnotationSelection>({ ids: [], activeId: null });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [clipboard, setClipboard] = useState<ReviewClipboardEntry[]>([]);
  const [history, setHistory] = useState<ReviewHistoryState>({ past: [], future: [] });
  const historyRef = useRef(history);
  historyRef.current = history;
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [mode, setMode] = useState<"select" | "draw" | "pan">("select");
  const [zoom, setZoom] = useState(1);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("reviewed");
  const reviewStatusRef = useRef(reviewStatus);
  reviewStatusRef.current = reviewStatus;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removalPhase, setRemovalPhase] = useState<RemovalPhase>(null);
  const removalBusyRef = useRef(false);
  const removalGenerationRef = useRef(0);
  const [readyImageId, setReadyImageId] = useState<string | null>(null);
  const readyImageIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const annotationCache = useRef(new Map<string, { image: ProjectImage; annotations: Annotation[] }>());
  const pendingHistoryRestore = useRef<{ imageId: string; annotations: Annotation[]; selectedIds: string[]; reviewStatus?: ReviewStatus } | null>(null);
  const canceledGestureRef = useRef(false);
  const viewportApi = useRef<CanvasViewportApi | null>(null);
  const imagePreloadCache = useRef(new Set<string>());
  const image = useMemo(() => images.find((item) => item.id === activeImageId) ?? null, [activeImageId, images]);
  const currentIndex = image ? images.findIndex((item) => item.id === image.id) : -1;
  const selectedId = selection.activeId;
  const selectedIds = selection.ids;
  const selectedAnnotation = useMemo(
    () => annotations.find((item) => item.id === selectedId) ?? null,
    [annotations, selectedId]
  );
  const selectedClass = useMemo(
    () => classes.find((item) => item.class_id === selectedClassId) ?? null,
    [classes, selectedClassId]
  );
  const dirty = hasDirtyReviewState(baseline, annotations);
  const removing = removalPhase !== null;
  const removalBusyLabel = removalPhase === "removing" ? "Removing…" : removalPhase === "restoring" ? "Restoring…" : null;
  const positionFilters = useMemo<ImageFilters>(() => ({
    review_status: filters.review_status,
    has_low_confidence: filters.has_low_confidence,
    source_asset_id: filters.source_asset_id,
    source_origin: filters.source_origin,
    source_groups: filters.source_groups
  }), [filters.has_low_confidence, filters.review_status, filters.source_asset_id, filters.source_origin, filters.source_groups]);
  const currentQueueKey = filteredQueueKey(project.id, positionFilters);

  const selectActiveImage = useCallback((imageId: string | null) => {
    if (activeImageIdRef.current === imageId) return;
    navigationGenerationRef.current += 1;
    readyImageIdRef.current = null;
    setReadyImageId(null);
    activeImageIdRef.current = imageId;
    setActiveImageId(imageId);
  }, []);

  const updateLiveAnnotations = useCallback((nextAnnotations: Annotation[]) => {
    const clipped = nextAnnotations.map(clipAnnotation);
    annotationsRef.current = clipped;
    setAnnotations(clipped);
  }, []);

  const changeReviewStatus = useCallback((status: ReviewStatus) => {
    if (removalBusyRef.current) return;
    reviewStatusRef.current = status;
    setReviewStatus(status);
  }, []);

  const updateSelectedAnnotations = useCallback((ids: string[], requestedActiveId?: string | null) => {
    setSelection((current) => {
      const nextIds = Array.from(new Set(ids));
      const activeId =
        requestedActiveId !== undefined && requestedActiveId !== null && nextIds.includes(requestedActiveId)
          ? requestedActiveId
          : current.activeId && nextIds.includes(current.activeId)
            ? current.activeId
            : nextIds[0] ?? null;
      return { ids: nextIds, activeId };
    });
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const refreshStats = useCallback(async () => {
    const generation = statsRequestRef.current + 1;
    statsRequestRef.current = generation;
    const nextStats = await api.reviewStats(project.id);
    if (statsRequestRef.current === generation) setStats(nextStats);
  }, [project.id]);

  useEffect(() => {
    let ignore = false;

    Promise.all([api.sources(project.id), api.classSchemas(project.id), api.activeOpenDataImport(project.id), api.reviewSourceCounts(project.id)])
      .then(([nextSources, schemas, nextOpenDataImport, nextSourceCounts]) => {
        if (ignore) return;
        setSources(nextSources);
        setSourceCounts(nextSourceCounts);
        setOpenDataImport(nextOpenDataImport);
        setClasses(schemas[0]?.classes ?? []);
        setSelectedClassId((current) => current ?? schemas[0]?.classes[0]?.class_id ?? null);
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
    const requestedQueueKey = filteredQueueKey(project.id, filters);
    const queueGeneration = queueRequestGenerationRef.current + 1;
    queueRequestGenerationRef.current = queueGeneration;
    setLoadingImages(true);
    setLoadedQueueKey(null);
    setError(null);

    Promise.all([api.images(project.id, filters), api.reviewSourceCounts(project.id)])
      .then(([items, nextSourceCounts]) => {
        if (ignore || queueRequestGenerationRef.current !== queueGeneration) return;
        setImages(items);
        setSourceCounts(nextSourceCounts);
        setLocallyExcludedImageIds(new Set());
        setLoadedQueueKey(requestedQueueKey);
        const currentImageId = activeImageIdRef.current;
        selectActiveImage(
          currentImageId && items.some((candidate) => candidate.id === currentImageId)
            ? currentImageId
            : items[0]?.id ?? null
        );
      })
      .catch((reason: unknown) => {
        if (ignore || queueRequestGenerationRef.current !== queueGeneration) return;
        setError(reason instanceof Error ? reason.message : "Failed to load image queue.");
      })
      .finally(() => {
        if (!ignore && queueRequestGenerationRef.current === queueGeneration) setLoadingImages(false);
      });

    refreshStats().catch(console.error);

    return () => {
      ignore = true;
    };
  }, [filters, project.id, refreshStats, selectActiveImage]);

  useEffect(() => {
    let ignore = false;
    setHistogramLoading(true);
    api.bboxHistogram(project.id, { source_groups: filters.source_groups })
      .then((rows) => { if (!ignore) setBboxDistribution(rows); })
      .catch((reason: unknown) => { if (!ignore) setError(reason instanceof Error ? reason.message : "Failed to load bbox distribution."); })
      .finally(() => { if (!ignore) setHistogramLoading(false); });
    setActiveAreaBin(null);
    return () => { ignore = true; };
  }, [filters.source_groups, project.id]);

  useEffect(() => {
    const key = imagePositionKey(project.id, activeImageId, positionFilters);
    const request = {
      generation: positionRequestRef.current.generation + 1,
      key
    };
    positionRequestRef.current = request;
    setImagePosition(null);

    const activeImageIsInLoadedQueue = Boolean(
      activeImageId &&
      loadedQueueKey === currentQueueKey &&
      !locallyExcludedImageIds.has(activeImageId) &&
      images.some((candidate) => candidate.id === activeImageId)
    );
    if (!activeImageIsInLoadedQueue || !activeImageId) {
      return;
    }

    api.imagePosition(project.id, activeImageId, positionFilters)
      .then((position) => {
        if (
          positionRequestRef.current.generation === request.generation &&
          positionRequestRef.current.key === request.key
        ) {
          setImagePosition(position);
        }
      })
      .catch(() => {
        if (
          positionRequestRef.current.generation === request.generation &&
          positionRequestRef.current.key === request.key
        ) {
          setImagePosition(null);
        }
      });

    return () => {
      if (positionRequestRef.current.generation === request.generation) {
        positionRequestRef.current = {
          generation: request.generation + 1,
          key: request.key
        };
      }
    };
  }, [activeImageId, currentQueueKey, images, loadedQueueKey, locallyExcludedImageIds, positionFilters, project.id]);

  useEffect(() => {
    if (locallyExcludedImageIds.size === 0) return;
    setImages((current) => {
      const next = current.filter((candidate) => candidate.id === activeImageId || !locallyExcludedImageIds.has(candidate.id));
      return next.length === current.length ? current : next;
    });
  }, [activeImageId, locallyExcludedImageIds]);

  useEffect(() => {
    if (!image) {
      readyImageIdRef.current = null;
      setReadyImageId(null);
      updateLiveAnnotations([]);
      reviewStatusRef.current = "reviewed";
      setReviewStatus("reviewed");
      setBaseline(createReviewBaseline([]));
      updateSelectedAnnotations([], null);
      setContextMenu(null);
      return;
    }

    let ignore = false;
    const restored = pendingHistoryRestore.current?.imageId === image.id ? pendingHistoryRestore.current : null;
    if (restored) pendingHistoryRestore.current = null;
    readyImageIdRef.current = null;
    setReadyImageId(null);
    setLoadingAnnotations(true);
    updateLiveAnnotations([]);
    const queuedReviewStatus = normalizeReviewStatus(image.review_status);
    reviewStatusRef.current = queuedReviewStatus;
    setReviewStatus(queuedReviewStatus);
    setBaseline(createReviewBaseline([]));
    updateSelectedAnnotations([], null);
    setContextMenu(null);
    setError(null);

    const cached = annotationCache.current.get(image.id);
    if (cached && cached.image.id !== image.id) annotationCache.current.delete(image.id);
    if (cached?.image.id === image.id) {
      const nextReviewStatus = normalizeReviewStatus(cached.image.review_status);
      const displayedReviewStatus = restored?.reviewStatus ?? nextReviewStatus;
      updateLiveAnnotations(restored?.annotations ?? cached.annotations);
      reviewStatusRef.current = displayedReviewStatus;
      setReviewStatus(displayedReviewStatus);
      setBaseline(createReviewBaseline(cached.annotations));
      updateSelectedAnnotations(restored?.selectedIds ?? [], restored?.selectedIds[0] ?? null);
      setContextMenu(null);
      setLoadingAnnotations(false);
      readyImageIdRef.current = image.id;
      setReadyImageId(image.id);
      return;
    }

    api.annotations(image.id)
      .then((result) => {
        if (ignore) return;
        if (result.image.id !== image.id) throw new Error("The server returned annotations for an unexpected image.");
        annotationCache.current.set(image.id, result);
        const nextReviewStatus = normalizeReviewStatus(result.image.review_status);
        const displayedReviewStatus = restored?.reviewStatus ?? nextReviewStatus;
        updateLiveAnnotations(restored?.annotations ?? result.annotations);
        reviewStatusRef.current = displayedReviewStatus;
        setReviewStatus(displayedReviewStatus);
        setBaseline(createReviewBaseline(result.annotations));
        updateSelectedAnnotations(restored?.selectedIds ?? [], restored?.selectedIds[0] ?? null);
        setContextMenu(null);
        readyImageIdRef.current = image.id;
        setReadyImageId(image.id);
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
  }, [image?.id, updateLiveAnnotations, updateSelectedAnnotations]);

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
    const availableIds = new Set(annotations.map((item) => item.id));
    setSelection((current) => {
      const ids = current.ids.filter((id) => availableIds.has(id));
      const activeId = current.activeId && ids.includes(current.activeId) ? current.activeId : ids[0] ?? null;
      return ids.length === current.ids.length && activeId === current.activeId ? current : { ids, activeId };
    });
  }, [annotations]);

  useEffect(() => {
    if (images.length === 0) {
      selectActiveImage(null);
      return;
    }
    if (!activeImageId || !images.some((item) => item.id === activeImageId)) {
      selectActiveImage(images[0].id);
    }
  }, [activeImageId, images, selectActiveImage]);

  useEffect(() => {
    if (!classes.length) {
      setSelectedClassId(null);
      return;
    }
    if (selectedClassId === null || !classes.some((item) => item.class_id === selectedClassId)) {
      setSelectedClassId(classes[0].class_id);
    }
  }, [classes, selectedClassId]);

  const bulkSelectionIds = selectedIds;
  const commitAnnotationList = useCallback((nextAnnotations: Annotation[]) => {
    if (removalBusyRef.current || !image || annotationsMatch(annotations, nextAnnotations)) return false;
    setHistory((current) => pushHistory(current, {
      kind: "annotations",
      imageId: image.id,
      before: annotations,
      after: nextAnnotations
    }));
    updateLiveAnnotations(nextAnnotations);
    return true;
  }, [annotations, image, updateLiveAnnotations]);

  const deleteSelectedAnnotations = useCallback((ids = bulkSelectionIds) => {
    if (removalBusyRef.current || !ids.length) return;
    commitAnnotationList(deleteAnnotations(annotations, ids));
    updateSelectedAnnotations([], null);
    setContextMenu(null);
  }, [annotations, bulkSelectionIds, commitAnnotationList, updateSelectedAnnotations]);

  const relabelSelectedAnnotations = useCallback((classItem: ClassItem, ids = bulkSelectionIds) => {
    if (removalBusyRef.current || !ids.length) return;
    setSelectedClassId(classItem.class_id);
    commitAnnotationList(changeAnnotationClasses(annotations, ids, classItem));
    setContextMenu(null);
  }, [annotations, bulkSelectionIds, commitAnnotationList]);

  const duplicateSelectedAnnotations = useCallback((ids = bulkSelectionIds) => {
    if (removalBusyRef.current || !ids.length || !image?.width || !image.height) return;
    const result = duplicateAnnotations(annotations, ids, { width: image.width, height: image.height });
    if (!commitAnnotationList(result.annotations)) return;
    updateSelectedAnnotations(result.selectedIds, result.selectedIds[0] ?? null);
    setContextMenu(null);
  }, [annotations, bulkSelectionIds, commitAnnotationList, image, updateSelectedAnnotations]);

  const copySelectedAnnotations = useCallback(() => {
    if (removalBusyRef.current || !bulkSelectionIds.length) return;
    setClipboard(copyAnnotations(annotations, bulkSelectionIds));
  }, [annotations, bulkSelectionIds]);

  const pasteClipboardAnnotations = useCallback(() => {
    if (removalBusyRef.current || !clipboard.length || !image?.width || !image.height) return;
    const result = pasteAnnotations(annotations, clipboard, annotationId, { width: image.width, height: image.height });
    if (!commitAnnotationList(result.annotations)) return;
    updateSelectedAnnotations(result.selectedIds, result.selectedIds[0] ?? null);
    setContextMenu(null);
  }, [annotations, clipboard, commitAnnotationList, image, updateSelectedAnnotations]);

  const updateAnnotationList = useCallback((nextAnnotations: Annotation[]) => {
    commitAnnotationList(nextAnnotations);
  }, [commitAnnotationList]);

  const resetAnnotationHistory = useCallback((imageId: string) => {
    setHistory((current) => {
      const past = current.past.filter((entry) => entry.imageId !== imageId);
      const future = current.future.filter((entry) => entry.imageId !== imageId);
      return past.length === current.past.length && future.length === current.future.length
        ? current
        : { past, future };
    });
  }, []);

  const replaceAnnotationsWithoutHistory = useCallback((imageId: string, nextAnnotations: Annotation[]) => {
    if (removalBusyRef.current || annotationsMatch(annotationsRef.current, nextAnnotations)) return false;
    resetAnnotationHistory(imageId);
    updateLiveAnnotations(nextAnnotations);
    return true;
  }, [resetAnnotationHistory, updateLiveAnnotations]);

  const handleSelect = useCallback(
    (annotationId: string | null) => {
      if (removalBusyRef.current) return;
      setContextMenu(null);
      if (!annotationId) {
        updateSelectedAnnotations([], null);
        return;
      }
      updateSelectedAnnotations([annotationId], annotationId);
      const annotation = annotations.find((item) => item.id === annotationId);
      if (annotation) setSelectedClassId(annotation.class_id);
    },
    [annotations, updateSelectedAnnotations]
  );

  const handleClassSelect = useCallback(
    (item: ClassItem) => {
      if (removalBusyRef.current) return;
      setSelectedClassId(item.class_id);
      if (bulkSelectionIds.length) {
        relabelSelectedAnnotations(item, bulkSelectionIds);
      }
    },
    [bulkSelectionIds, relabelSelectedAnnotations]
  );

  const handleInspectorClassChange = useCallback(
    (annotationId: string, classId: number) => {
      const item = classes.find((candidate) => candidate.class_id === classId);
      if (!item) return;
      relabelSelectedAnnotations(item, [annotationId]);
    },
    [classes, relabelSelectedAnnotations]
  );

  const handleDelete = useCallback(
    (annotationId: string) => {
      deleteSelectedAnnotations(selectedIds.includes(annotationId) ? selectedIds : [annotationId]);
    },
    [deleteSelectedAnnotations, selectedIds]
  );

  const handleMergeSameClass = useCallback(() => {
    if (removalBusyRef.current) return;
    const value = window.prompt("Merge same-class boxes with IoU >=", "0.75");
    if (value === null) return;
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      window.alert("Merge IoU threshold must be a number from 0 to 1.");
      return;
    }
    if (!image) return;
    replaceAnnotationsWithoutHistory(
      image.id,
      annotationReducer(annotations, { type: "mergeSameClass", iouThreshold: threshold })
    );
    updateSelectedAnnotations([], null);
  }, [annotations, image, replaceAnnotationsWithoutHistory, updateSelectedAnnotations]);

  const persistAnnotations = useCallback(async (advanceToNext = false) => {
    if (removalBusyRef.current || !image) return;
    const sourceImage = image;
    const sourceImageId = sourceImage.id;
    const submittedAnnotations = annotations;
    const submittedReviewStatus = reviewStatus;
    const submittedFilters = filters;
    const submittedNavigationGeneration = navigationGenerationRef.current;
    const savedReviewStatus = normalizeReviewStatus(submittedReviewStatus);
    const nextImageId = advanceToNext ? getNextImageId(images, sourceImageId) : sourceImageId;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveAnnotations(sourceImageId, {
        annotations: submittedAnnotations,
        review_status: submittedReviewStatus
      });
      const serverNormalizedAnnotations = !annotationsMatch(result.annotations, submittedAnnotations);
      annotationCache.current.set(sourceImageId, {
        image: { ...sourceImage, review_status: savedReviewStatus },
        annotations: result.annotations
      });
      if (serverNormalizedAnnotations) resetAnnotationHistory(sourceImageId);
      const stillOnSource =
        activeImageIdRef.current === sourceImageId &&
        navigationGenerationRef.current === submittedNavigationGeneration;
      const annotationsUnchanged = annotationsMatch(annotationsRef.current, submittedAnnotations);
      const statusUnchanged = reviewStatusRef.current === submittedReviewStatus;
      const filtersUnchanged = JSON.stringify(filtersRef.current) === JSON.stringify(submittedFilters);
      const shouldRefreshQueue = stillOnSource && annotationsUnchanged && statusUnchanged && filtersUnchanged;
      const sourceMatchesCurrentFilters = imageMatchesFilters(
        sourceImage,
        savedReviewStatus,
        result.annotations,
        filtersRef.current
      );
      // Retain the active source until a guarded refresh installs its
      // replacement queue; newer unsaved edits need the same protection.
      const keepSourceVisible =
        stillOnSource && (shouldRefreshQueue || !annotationsUnchanged || !statusUnchanged);

      if (shouldRefreshQueue) {
        positionRequestRef.current = {
          generation: positionRequestRef.current.generation + 1,
          key: ""
        };
        setLoadedQueueKey(null);
        setImagePosition(null);
      }
      setImages((current) =>
        current.flatMap((item) => {
          if (item.id !== sourceImageId) return [item];
          if (!sourceMatchesCurrentFilters && !keepSourceVisible) return [];
          return [{ ...item, review_status: savedReviewStatus }];
        })
      );
      setLocallyExcludedImageIds((current) => {
        const shouldExcludeSource = !sourceMatchesCurrentFilters && keepSourceVisible;
        if (current.has(sourceImageId) === shouldExcludeSource) return current;
        const next = new Set(current);
        if (shouldExcludeSource) next.add(sourceImageId);
        else next.delete(sourceImageId);
        return next;
      });

      if (stillOnSource) {
        if (annotationsUnchanged) {
          updateLiveAnnotations(result.annotations);
        }
        if (statusUnchanged) {
          changeReviewStatus(savedReviewStatus);
        }
        setBaseline(createReviewBaseline(result.annotations));
      }

      if (shouldRefreshQueue) {
        const queueNavigationGeneration = navigationGenerationRef.current;
        const nextImages = await api.images(project.id, submittedFilters);
        const canApplyRefresh =
          activeImageIdRef.current === sourceImageId &&
          navigationGenerationRef.current === queueNavigationGeneration &&
          JSON.stringify(filtersRef.current) === JSON.stringify(submittedFilters) &&
          (!sourceMatchesCurrentFilters ||
            (annotationsMatch(annotationsRef.current, result.annotations) &&
              reviewStatusRef.current === savedReviewStatus));
        if (canApplyRefresh) {
          setImages(nextImages);
          setLocallyExcludedImageIds(new Set());
          setLoadedQueueKey(filteredQueueKey(project.id, submittedFilters));
          const nextActiveImageId =
            nextImageId && nextImages.some((candidate) => candidate.id === nextImageId)
              ? nextImageId
              : nextImages[0]?.id ?? null;
          selectActiveImage(nextActiveImageId);
        }
      }
      await refreshStats();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to save annotations.");
    } finally {
      setSaving(false);
    }
  }, [annotations, changeReviewStatus, filters, image, images, project.id, refreshStats, resetAnnotationHistory, reviewStatus, selectActiveImage, updateLiveAnnotations]);

  const confirmReviewNavigation = useCallback(() => shouldProceedWithReviewNavigation(dirty, window.confirm), [dirty]);

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      if (removalBusyRef.current) return;
      if (nextIndex < 0 || nextIndex >= images.length) return;
      if (!confirmReviewNavigation()) return;
      selectActiveImage(images[nextIndex].id);
    },
    [confirmReviewNavigation, images, selectActiveImage]
  );

  const goPrevious = useCallback(() => {
    if (currentIndex > 0) navigateToIndex(currentIndex - 1);
  }, [currentIndex, navigateToIndex]);

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < images.length - 1) navigateToIndex(currentIndex + 1);
  }, [currentIndex, images.length, navigateToIndex]);

  const invalidateQueuePosition = useCallback(() => {
    queueRequestGenerationRef.current += 1;
    positionRequestRef.current = {
      generation: positionRequestRef.current.generation + 1,
      key: ""
    };
    setLoadedQueueKey(null);
    setImagePosition(null);
  }, []);

  const refreshAfterImageMutation = useCallback(async (
    generation: number,
    preferredImageId: string | null
  ) => {
    const requestedFilters = { ...filtersRef.current };
    const queueGeneration = queueRequestGenerationRef.current + 1;
    queueRequestGenerationRef.current = queueGeneration;
    const [queueResult, statsResult] = await Promise.allSettled([
      api.images(project.id, requestedFilters),
      refreshStats()
    ]);
    if (
      removalGenerationRef.current !== generation ||
      queueRequestGenerationRef.current !== queueGeneration
    ) return;
    if (queueResult.status === "rejected") {
      setLoadedQueueKey(filteredQueueKey(project.id, requestedFilters));
      setLoadingImages(false);
      setError(queueResult.reason instanceof Error ? queueResult.reason.message : "Image changed, but the Review queue could not be refreshed.");
      return;
    }
    if (JSON.stringify(filtersRef.current) !== JSON.stringify(requestedFilters)) return;

    const nextImages = queueResult.value;
    const currentImageId = activeImageIdRef.current;
    const nextActiveImageId =
      preferredImageId && nextImages.some((candidate) => candidate.id === preferredImageId)
        ? preferredImageId
        : currentImageId && nextImages.some((candidate) => candidate.id === currentImageId)
          ? currentImageId
          : nextImages[0]?.id ?? null;
    setImages(nextImages);
    setLoadingImages(false);
    setLocallyExcludedImageIds(new Set());
    setLoadedQueueKey(filteredQueueKey(project.id, requestedFilters));
    selectActiveImage(nextActiveImageId);
    if (statsResult.status === "rejected") {
      setError(statsResult.reason instanceof Error ? statsResult.reason.message : "Image changed, but Review counts could not be refreshed.");
    }
  }, [project.id, refreshStats, selectActiveImage]);

  const performImageRemoval = useCallback(async (
    sourceImage: ProjectImage,
    redo?: { entry: ImageRemovalHistoryEntry; state: ReviewHistoryState }
  ) => {
    if (removalBusyRef.current || saving) return;
    if (!redo && readyImageIdRef.current !== sourceImage.id) return;
    removalBusyRef.current = true;
    viewportApi.current?.cancelInteraction();
    setContextMenu(null);
    setRemovalPhase("removing");
    setEditMenuOpen(false);
    setError(null);
    const generation = removalGenerationRef.current + 1;
    removalGenerationRef.current = generation;
    const submittedNavigationGeneration = navigationGenerationRef.current;
    const sourceWasActive = activeImageIdRef.current === sourceImage.id;
    const removalAnnotations = sourceWasActive
      ? annotationsRef.current.map((annotation) => ({ ...annotation }))
      : (redo?.entry.annotations ?? []).map((annotation) => ({ ...annotation }));
    const removalReviewStatus = sourceWasActive
      ? reviewStatusRef.current
      : normalizeReviewStatus(redo?.entry.reviewStatus ?? sourceImage.review_status);

    try {
      const result = await api.removeProjectImage(project.id, sourceImage.id);
      if (result.image_id !== sourceImage.id) throw new Error("The server removed an unexpected image.");
      if (removalGenerationRef.current !== generation) return;

      annotationCache.current.delete(sourceImage.id);
      imagePreloadCache.current.delete(sourceImage.path);
      invalidateQueuePosition();
      const remainingImages = imagesRef.current.filter((candidate) => candidate.id !== sourceImage.id);
      setImages(remainingImages);
      setLocallyExcludedImageIds((current) => new Set(current).add(sourceImage.id));
      const mayNavigate =
        sourceWasActive &&
        activeImageIdRef.current === sourceImage.id &&
        navigationGenerationRef.current === submittedNavigationGeneration;
      const preferredImageId =
        result.next_image_id && remainingImages.some((candidate) => candidate.id === result.next_image_id)
          ? result.next_image_id
          : remainingImages[0]?.id ?? null;
      if (mayNavigate) selectActiveImage(preferredImageId);

      const historyEntry: ImageRemovalHistoryEntry = {
        kind: "image-removal",
        imageId: sourceImage.id,
        operationId: result.operation_id,
        image: { ...sourceImage },
        annotations: removalAnnotations,
        reviewStatus: removalReviewStatus
      };
      if (redo) {
        const past = [...redo.state.past];
        past[past.length - 1] = historyEntry;
        setHistory({ ...redo.state, past });
      } else {
        setHistory((current) => pushHistory(current, historyEntry));
      }

      await refreshAfterImageMutation(generation, mayNavigate ? result.next_image_id : activeImageIdRef.current);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to remove the project image.");
    } finally {
      if (removalGenerationRef.current === generation) {
        removalBusyRef.current = false;
        setRemovalPhase(null);
      }
    }
  }, [invalidateQueuePosition, project.id, refreshAfterImageMutation, saving, selectActiveImage]);

  const restoreImageRemoval = useCallback(async (
    entry: ImageRemovalHistoryEntry,
    restoredHistory: ReviewHistoryState
  ) => {
    if (removalBusyRef.current || saving) return;
    removalBusyRef.current = true;
    viewportApi.current?.cancelInteraction();
    setContextMenu(null);
    setRemovalPhase("restoring");
    setEditMenuOpen(false);
    setError(null);
    const generation = removalGenerationRef.current + 1;
    removalGenerationRef.current = generation;
    const submittedNavigationGeneration = navigationGenerationRef.current;

    try {
      const restored = await api.restoreProjectImage(project.id, entry.operationId);
      if (restored.image.id !== entry.imageId) throw new Error("The server restored an unexpected image.");
      if (removalGenerationRef.current !== generation) return;

      annotationCache.current.set(entry.imageId, restored);
      pendingHistoryRestore.current = {
        imageId: entry.imageId,
        annotations: entry.annotations.map((annotation) => ({ ...annotation })),
        selectedIds: [],
        reviewStatus: normalizeReviewStatus(entry.reviewStatus)
      };
      invalidateQueuePosition();
      setLocallyExcludedImageIds((current) => {
        if (!current.has(entry.imageId)) return current;
        const next = new Set(current);
        next.delete(entry.imageId);
        return next;
      });
      const restoredStatus = normalizeReviewStatus(restored.image.review_status);
      const matchesCurrentFilters = imageMatchesFilters(
        restored.image,
        restoredStatus,
        restored.annotations,
        filtersRef.current
      );
      if (matchesCurrentFilters) {
        setImages((current) => (
          [...current.filter((candidate) => candidate.id !== entry.imageId), restored.image]
            .sort((left, right) => left.path.localeCompare(right.path))
        ));
        if (navigationGenerationRef.current === submittedNavigationGeneration) {
          selectActiveImage(entry.imageId);
        }
      }
      setHistory(restoredHistory);
      await refreshAfterImageMutation(generation, matchesCurrentFilters ? entry.imageId : activeImageIdRef.current);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to restore the project image.");
    } finally {
      if (removalGenerationRef.current === generation) {
        removalBusyRef.current = false;
        setRemovalPhase(null);
      }
    }
  }, [invalidateQueuePosition, project.id, refreshAfterImageMutation, saving, selectActiveImage]);

  const removeCurrentImage = useCallback(async () => {
    if (!image || readyImageIdRef.current !== image.id || removalBusyRef.current || saving) return;
    if (!window.confirm(REMOVE_IMAGE_CONFIRMATION)) return;
    await performImageRemoval(image);
  }, [image, performImageRemoval, saving]);

  const restoreHistoryEntry = useCallback((entry: Extract<ReviewHistoryEntry, { kind: "annotations" }>, nextAnnotations: Annotation[]) => {
    const otherAnnotations = nextAnnotations === entry.before ? entry.after : entry.before;
    const otherById = new Map(otherAnnotations.map((annotation) => [annotation.id, annotation]));
    const changedIds = nextAnnotations
      .filter((annotation) => {
        const other = otherById.get(annotation.id);
        return !other || JSON.stringify(other) !== JSON.stringify(annotation);
      })
      .map((annotation) => annotation.id);
    const activeRestoredAnnotation = nextAnnotations.find((annotation) => annotation.id === changedIds[0]);
    if (activeRestoredAnnotation) setSelectedClassId(activeRestoredAnnotation.class_id);
    updateSelectedAnnotations(changedIds, changedIds[0] ?? null);
    setContextMenu(null);
    setEditMenuOpen(false);
    if (entry.imageId === image?.id) {
      updateLiveAnnotations(nextAnnotations);
      return;
    }
    if (images.some((item) => item.id === entry.imageId)) {
      pendingHistoryRestore.current = { imageId: entry.imageId, annotations: nextAnnotations, selectedIds: changedIds };
      selectActiveImage(entry.imageId);
      return;
    }
    const cached = annotationCache.current.get(entry.imageId);
    if (cached) annotationCache.current.set(entry.imageId, { ...cached, annotations: nextAnnotations });
  }, [image?.id, images, selectActiveImage, updateLiveAnnotations, updateSelectedAnnotations]);

  const undoReview = useCallback(async () => {
    if (removalBusyRef.current) return;
    const result = undoHistory(historyRef.current);
    if (!result.entry) return;
    if (result.entry.imageId !== image?.id && !confirmReviewNavigation()) return;
    if (result.entry.kind === "image-removal") {
      await restoreImageRemoval(result.entry, result.state);
      return;
    }
    setHistory(result.state);
    restoreHistoryEntry(result.entry, result.entry.before);
  }, [confirmReviewNavigation, image?.id, restoreHistoryEntry, restoreImageRemoval]);

  const redoReview = useCallback(async () => {
    if (removalBusyRef.current) return;
    const result = redoHistory(historyRef.current);
    if (!result.entry) return;
    if (result.entry.imageId !== image?.id && !confirmReviewNavigation()) return;
    if (result.entry.kind === "image-removal") {
      await performImageRemoval(result.entry.image, { entry: result.entry, state: result.state });
      return;
    }
    setHistory(result.state);
    restoreHistoryEntry(result.entry, result.entry.after);
  }, [confirmReviewNavigation, image?.id, performImageRemoval, restoreHistoryEntry]);

  const cancelReview = useCallback(() => {
    canceledGestureRef.current = Boolean(viewportApi.current?.cancelInteraction());
    if (canceledGestureRef.current) return;
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    if (editMenuOpen) {
      setEditMenuOpen(false);
      return;
    }
    updateSelectedAnnotations([], null);
  }, [contextMenu, editMenuOpen, updateSelectedAnnotations]);

  const commands = useMemo(() => createReviewCommands({
    tool: mode,
    hasImage: Boolean(image),
    imageReady: Boolean(image && readyImageId === image.id),
    hasSelection: bulkSelectionIds.length > 0,
    hasClipboard: clipboard.length > 0,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saving,
    removing,
    handlers: {
      setTool: setMode,
      copy: copySelectedAnnotations,
      paste: pasteClipboardAnnotations,
      duplicate: duplicateSelectedAnnotations,
      delete: deleteSelectedAnnotations,
      relabel: () => {
        if (selectedClass) relabelSelectedAnnotations(selectedClass, bulkSelectionIds);
      },
      undo: undoReview,
      redo: redoReview,
      removeImage: removeCurrentImage,
      cancel: cancelReview,
      save: () => persistAnnotations().catch(console.error),
      saveAndNext: () => persistAnnotations(true).catch(console.error)
    }
  }), [
    bulkSelectionIds,
    cancelReview,
    clipboard.length,
    copySelectedAnnotations,
    deleteSelectedAnnotations,
    duplicateSelectedAnnotations,
    history.future.length,
    history.past.length,
    image,
    mode,
    pasteClipboardAnnotations,
    persistAnnotations,
    redoReview,
    relabelSelectedAnnotations,
    removeCurrentImage,
    removing,
    readyImageId,
    saving,
    selectedClass,
    undoReview
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isReviewEditableTarget(event.target)) return;
      canceledGestureRef.current = false;
      if (dispatchReviewShortcut(event, commands)) {
        if (canceledGestureRef.current) event.stopImmediatePropagation();
        return;
      }
      if (removalBusyRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const nudge = keyboardNudgeDelta(event.key, event.shiftKey);
      if (nudge && bulkSelectionIds.length && image?.width && image.height) {
        event.preventDefault();
        commitAnnotationList(moveAnnotations(annotations, bulkSelectionIds, nudge, { width: image.width, height: image.height }));
        setContextMenu(null);
        return;
      }

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
      if (/^[1-9]$/.test(event.key)) {
        const item = classes[Number(event.key) - 1];
        if (!item) return;
        event.preventDefault();
        handleClassSelect(item);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [annotations, bulkSelectionIds, classes, commands, commitAnnotationList, goNext, goPrevious, handleClassSelect, image]);

  return (
    <section className="review-page" aria-busy={removing}>
      <div className="review-wide-panels">
        <ImageQueue
          images={images}
          activeImageId={activeImageId}
          filters={filters}
          stats={stats}
          sourceCounts={sourceCounts}
          sources={sources}
          openDataImport={openDataImport}
          loading={loadingImages}
          prefetching={prefetching}
          onSelectImage={(id) => {
            if (removalBusyRef.current) return;
            if (id === activeImageId) return;
            if (!confirmReviewNavigation()) return;
            selectActiveImage(id);
          }}
          onFilterChange={(partial) => {
            if (removalBusyRef.current) return;
            if (!confirmReviewNavigation()) return;
            const nextFilters = { ...filtersRef.current, ...partial };
            filtersRef.current = nextFilters;
            setFilters(nextFilters);
          }}
        />
        <AnnotationHistogram
          annotations={annotations}
          distribution={bboxDistribution}
          loading={loadingAnnotations || histogramLoading}
          activeBin={activeAreaBin}
          onSelectBin={(classId, bin) => setActiveAreaBin((current) =>
            current?.classId === classId && current.lower === bin.lower && current.upper === bin.upper
              ? null
              : { classId, lower: bin.lower, upper: bin.upper }
          )}
        />
      </div>
      <div className="review-main">
        <AnnotationToolbar
          mode={mode}
          commands={commands}
          editMenuOpen={editMenuOpen}
          onEditMenuOpenChange={setEditMenuOpen}
          canGoPrev={!removing && currentIndex > 0}
          canGoNext={!removing && currentIndex >= 0 && currentIndex < images.length - 1}
          dirty={dirty}
          saving={saving}
          locked={removing}
          busyLabel={removalBusyLabel}
          zoom={zoom}
          position={imagePosition}
          onModeChange={setMode}
          onPrevious={goPrevious}
          onNext={goNext}
          onSave={() => {
            persistAnnotations().catch(console.error);
          }}
          onSaveAndNext={() => {
            persistAnnotations(true).catch(console.error);
          }}
          onMergeSameClass={handleMergeSameClass}
          onFit={() => viewportApi.current?.fit()}
          onActualSize={() => viewportApi.current?.actualSize()}
          onZoomIn={() => viewportApi.current?.zoomIn()}
          onZoomOut={() => viewportApi.current?.zoomOut()}
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
                {loadingAnnotations ? "Loading annotations..." : "B: draw · Right-click a box to change class · Ctrl/Cmd+S: save"}
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
                highlightedIds={activeAreaBin == null ? [] : annotationIdsInAreaBin(annotations, activeAreaBin.classId, activeAreaBin)}
                selectedClass={selectedClass}
                mode={mode}
                locked={removing}
                onChange={updateAnnotationList}
                onSelect={handleSelect}
                onSelectMany={updateSelectedAnnotations}
                onZoomChange={setZoom}
                viewportApiRef={viewportApi}
                onContextMenu={(annotationId, point) => setContextMenu({ x: point.x, y: point.y, ids: bulkSelectionIds.includes(annotationId) ? bulkSelectionIds : [annotationId] })}
              />
              {contextMenu && contextMenu.ids.length > 0 && (
                <AnnotationContextMenu
                  point={contextMenu}
                  annotations={annotations}
                  ids={contextMenu.ids}
                  classes={classes}
                  commands={{
                    duplicate: getReviewCommand(commands, "duplicate"),
                    delete: getReviewCommand(commands, "delete"),
                    relabel: { ...getReviewCommand(commands, "relabel"), enabled: !removing && contextMenu.ids.length > 0 },
                    cancel: getReviewCommand(commands, "cancel")
                  }}
                  onRelabelClass={(item) => relabelSelectedAnnotations(item, contextMenu.ids)}
                  onZoom={() => {
                    viewportApi.current?.zoomToAnnotationIds(contextMenu.ids);
                    setContextMenu(null);
                  }}
                  onClose={() => setContextMenu(null)}
                />
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
          disabled={removing}
          onSelectClass={handleClassSelect}
        />
      </div>

      <div className="review-sidebar">
        <AnnotationInspector
          image={image} annotations={annotations} selectedId={selectedId} classes={classes}
          dirty={dirty} loading={loadingAnnotations} saving={saving}
          locked={removing} busyLabel={removalBusyLabel} onSelect={handleSelect} onDelete={handleDelete}
          onClassChange={handleInspectorClassChange}
          onSave={() => { persistAnnotations().catch(console.error); }}
          onSaveAndNext={() => { persistAnnotations(true).catch(console.error); }}
        />
      </div>

    </section>
  );
}
