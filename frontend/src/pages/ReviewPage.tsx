import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { api, type ImageFilters, type ReviewStats, type ReviewStatus } from "../api/client";
import { annotationReducer } from "../annotation/reducer";
import { AnnotationCanvas } from "../components/review/AnnotationCanvas";
import { AnnotationInspector } from "../components/review/AnnotationInspector";
import { AnnotationToolbar } from "../components/review/AnnotationToolbar";
import { ClassPalette } from "../components/review/ClassPalette";
import { ImageQueue } from "../components/review/ImageQueue";
import type { Annotation, ClassItem, Project, ProjectImage, SourceAsset } from "../types";

type ReviewPageProps = {
  project: Project;
  t: (key: string) => string;
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

function serializeAnnotations(annotations: Annotation[]): string {
  return JSON.stringify(annotations);
}

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

export function ReviewPage({ project, t }: ReviewPageProps) {
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [stats, setStats] = useState<ReviewStats>(EMPTY_STATS);
  const [filters, setFilters] = useState<ImageFilters>({ review_status: "unreviewed" });
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [baseline, setBaseline] = useState(serializeAnnotations([]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [mode, setMode] = useState<"select" | "draw" | "pan">("select");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("reviewed");
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const dirty = baseline !== serializeAnnotations(annotations);

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
      setBaseline(serializeAnnotations([]));
      setSelectedId(null);
      return;
    }

    let ignore = false;
    setLoadingAnnotations(true);
    setError(null);

    api.annotations(image.id)
      .then((result) => {
        if (ignore) return;
        setAnnotations(result.annotations);
        setBaseline(serializeAnnotations(result.annotations));
        setSelectedId(null);
        setReviewStatus(normalizeReviewStatus(result.image.review_status));
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
    if (selectedId && !annotations.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
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

  const updateAnnotationList = useCallback((nextAnnotations: Annotation[]) => {
    setAnnotations(nextAnnotations);
  }, []);

  const handleSelect = useCallback(
    (annotationId: string | null) => {
      setSelectedId(annotationId);
      if (!annotationId) return;
      const annotation = annotations.find((item) => item.id === annotationId);
      if (annotation) setSelectedClassId(annotation.class_id);
    },
    [annotations]
  );

  const handleClassSelect = useCallback(
    (item: ClassItem) => {
      setSelectedClassId(item.class_id);
      if (selectedId) {
        applyAnnotationAction({
          type: "changeClass",
          id: selectedId,
          class_id: item.class_id,
          class_name: item.class_name
        });
      }
    },
    [applyAnnotationAction, selectedId]
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
      applyAnnotationAction({ type: "delete", id: annotationId });
      setSelectedId((current) => (current === annotationId ? null : current));
    },
    [applyAnnotationAction]
  );

  const persistAnnotations = useCallback(async () => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveAnnotations(image.id, { annotations, review_status: reviewStatus });
      setAnnotations(result.annotations);
      setBaseline(serializeAnnotations(result.annotations));
      setImages((current) =>
        current.map((item) => (item.id === image.id ? { ...item, review_status: reviewStatus } : item))
      );
      const nextImages = await api.images(project.id, filters);
      setImages(nextImages);
      await refreshStats();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to save annotations.");
    } finally {
      setSaving(false);
    }
  }, [annotations, filters, image, project.id, refreshStats, reviewStatus]);

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= images.length) return;
      if (dirty && !window.confirm("You have unsaved annotation changes. Switch images anyway?")) return;
      setActiveImageId(images[nextIndex].id);
    },
    [dirty, images]
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
      if (event.key === "Delete" && selectedId) {
        event.preventDefault();
        handleDelete(selectedId);
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
  }, [classes, goNext, goPrevious, handleClassSelect, handleDelete, persistAnnotations, selectedId]);

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
            <AnnotationCanvas
              image={image}
              annotations={annotations}
              selectedId={selectedId}
              selectedClass={selectedClass}
              mode={mode}
              onChange={updateAnnotationList}
              onSelect={handleSelect}
            />
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
          onSelectImage={(id) => {
            if (id === activeImageId) return;
            if (dirty && !window.confirm("You have unsaved annotation changes. Switch images anyway?")) return;
            setActiveImageId(id);
          }}
          onFilterChange={(partial) => setFilters((current) => ({ ...current, ...partial }))}
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
        />
      </div>
    </section>
  );
}
