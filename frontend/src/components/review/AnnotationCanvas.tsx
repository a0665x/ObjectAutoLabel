import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Ref } from "react";

import { annotationReducer } from "../../annotation/reducer";
import { clampRect, rectToYolo, yoloToRect } from "../../annotation/geometry";
import type { Rect, Size } from "../../annotation/geometry";
import type { Annotation, ClassItem, ProjectImage } from "../../types";
import { getCanvasAffordance } from "./canvasAffordance";
import {
  clientPointToImage,
  previewRectFromPoints,
  resolveEffectiveTool
} from "./canvasInteraction";
import type { CanvasInteraction } from "./canvasInteraction";
import { clampSharedDelta } from "./annotationCommands";
import { clampZoom, fitZoom, zoomToRects } from "./viewport";

export type CanvasViewportApi = {
  fit: () => void;
  actualSize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToAnnotationIds: (ids: string[]) => void;
  cancelInteraction: () => boolean;
};

type AnnotationCanvasProps = {
  image: ProjectImage;
  annotations: Annotation[];
  selectedId: string | null;
  selectedIds?: string[];
  highlightedIds?: string[];
  selectedClass: ClassItem | null;
  mode: "select" | "draw" | "pan";
  locked?: boolean;
  onChange: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
  onSelectMany?: (ids: string[]) => void;
  onContextMenu?: (annotationId: string, point: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
  viewportApiRef?: Ref<CanvasViewportApi>;
};

type Point = { x: number; y: number };

type CanvasHit =
  | { kind: "background" }
  | { kind: "box"; annotation: Annotation }
  | { kind: "handle"; annotation: Annotation; rect: Rect; handle: "nw" | "ne" | "sw" | "se" };

const CLASS_SWATCHES = ["#0a84ff", "#30d158", "#ff9f0a", "#ff375f", "#5e5ce6", "#64d2ff", "#bf5af2", "#ffd60a"];

function colorForClass(classId: number): string {
  return CLASS_SWATCHES[Math.abs(classId) % CLASS_SWATCHES.length];
}

function annotationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `annotation-${Date.now()}`;
}

function getHandleAnchor(rect: Rect, handle: "nw" | "ne" | "sw" | "se"): Point {
  switch (handle) {
    case "nw":
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    case "ne":
      return { x: rect.x, y: rect.y + rect.height };
    case "sw":
      return { x: rect.x + rect.width, y: rect.y };
    case "se":
      return { x: rect.x, y: rect.y };
    default:
      return { x: rect.x, y: rect.y };
  }
}

function rectsIntersect(a: Rect, b: Rect) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function AnnotationCanvas({
  image,
  annotations,
  selectedId,
  selectedIds = [],
  highlightedIds = [],
  selectedClass,
  mode,
  locked = false,
  onChange,
  onSelect,
  onSelectMany,
  onContextMenu,
  onZoomChange,
  viewportApiRef
}: AnnotationCanvasProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointerCaptureTargetRef = useRef<SVGSVGElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const movePreviewPointRef = useRef<Point | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const [, requestPreviewRender] = useReducer((value) => value + 1, 0);
  const lastEditToolRef = useRef<"select" | "draw">(mode === "draw" ? "draw" : "select");
  const [spacePressed, setSpacePressed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitZoomValue, setFitZoomValue] = useState(1);
  const pendingZoomAnchor = useRef<{ image: Point; pointer: Point } | null>(null);
  const viewportFrame = useRef<number | null>(null);
  const viewportGeneration = useRef(0);
  const imageSize = useMemo<Size>(() => {
    const width = image.width ?? naturalSize?.width ?? 0;
    const height = image.height ?? naturalSize?.height ?? 0;
    return { width, height };
  }, [image.height, image.width, naturalSize]);
  const overlayReady = imageSize.width > 0 && imageSize.height > 0;
  const rects = useMemo(
    () =>
      overlayReady
        ? annotations.map((annotation) => ({ annotation, rect: yoloToRect(annotation, imageSize) })).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
        : [],
    [annotations, imageSize, overlayReady]
  );

  useEffect(() => {
    const pointerId = interactionRef.current?.pointerId;
    if (pointerId !== undefined) abortInteraction(pointerId);
    if (mode !== "pan") lastEditToolRef.current = mode;
  }, [image.id, mode]);

  useEffect(() => {
    if (!locked) return;
    const pointerId = interactionRef.current?.pointerId;
    if (pointerId !== undefined) abortInteraction(pointerId);
  }, [locked]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    const handleBlur = () => {
      setSpacePressed(false);
      const pointerId = interactionRef.current?.pointerId;
      if (pointerId !== undefined) abortInteraction(pointerId);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    return () => {
      const pointerId = interactionRef.current?.pointerId;
      if (pointerId !== undefined) releasePointerCapture(pointerId);
      interactionRef.current = null;
      movePreviewPointRef.current = null;
      if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    onZoomChange?.(zoom);
  }, [onZoomChange, zoom]);

  useEffect(() => {
    if (!overlayReady) {
      setRenderedWidth(0);
      return;
    }

    const element = svgRef.current;
    if (!element) return;

    const updateRenderedWidth = () => {
      setRenderedWidth(element.getBoundingClientRect().width);
    };

    updateRenderedWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateRenderedWidth);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateRenderedWidth);
    return () => window.removeEventListener("resize", updateRenderedWidth);
  }, [image.id, overlayReady]);

  const affordance = useMemo(
    () => getCanvasAffordance({ imageWidth: imageSize.width, renderedWidth }),
    [imageSize.width, renderedWidth]
  );

  const invalidateViewportWork = useCallback(() => {
    pendingZoomAnchor.current = null;
    viewportGeneration.current += 1;
    if (viewportFrame.current !== null) {
      cancelAnimationFrame(viewportFrame.current);
      viewportFrame.current = null;
    }
  }, []);

  const scheduleViewportFrame = useCallback((callback: () => void) => {
    invalidateViewportWork();
    const generation = viewportGeneration.current;
    let ranSynchronously = false;
    const frame = requestAnimationFrame(() => {
      ranSynchronously = true;
      if (generation !== viewportGeneration.current) return;
      viewportFrame.current = null;
      callback();
    });
    if (!ranSynchronously && generation === viewportGeneration.current) viewportFrame.current = frame;
  }, [invalidateViewportWork]);

  const setViewportZoom = useCallback((value: number, pointer?: Point) => {
    const nextZoom = clampZoom(value);
    const scroller = scrollRef.current;
    invalidateViewportWork();
    if (scroller && pointer && nextZoom !== zoom) {
      pendingZoomAnchor.current = {
        image: {
          x: (scroller.scrollLeft + pointer.x) / zoom,
          y: (scroller.scrollTop + pointer.y) / zoom
        },
        pointer
      };
    }
    setZoom(nextZoom);
  }, [invalidateViewportWork, zoom]);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchor.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;

    pendingZoomAnchor.current = null;
    scroller.scrollLeft = anchor.image.x * zoom - anchor.pointer.x;
    scroller.scrollTop = anchor.image.y * zoom - anchor.pointer.y;
  }, [zoom]);

  const fitViewport = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !overlayReady) return;
    const nextZoom = fitZoom(imageSize, { width: scroller.clientWidth, height: scroller.clientHeight });
    setFitZoomValue(nextZoom);
    setZoom(nextZoom);
    scheduleViewportFrame(() => {
      scroller.scrollLeft = Math.max(0, (imageSize.width * nextZoom - scroller.clientWidth) / 2);
      scroller.scrollTop = Math.max(0, (imageSize.height * nextZoom - scroller.clientHeight) / 2);
    });
  }, [imageSize, overlayReady, scheduleViewportFrame]);

  useLayoutEffect(() => {
    invalidateViewportWork();
  }, [image.id, invalidateViewportWork]);

  useEffect(() => {
    return () => invalidateViewportWork();
  }, [invalidateViewportWork]);

  useEffect(() => {
    fitViewport();
  }, [fitViewport, image.id]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = scroller.getBoundingClientRect();
      const direction = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      setViewportZoom(zoom * direction, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, [setViewportZoom, zoom]);

  useImperativeHandle(viewportApiRef, () => ({
    fit: fitViewport,
    actualSize: () => setViewportZoom(1),
    zoomIn: () => setViewportZoom(zoom * 1.2),
    zoomOut: () => setViewportZoom(zoom / 1.2),
    cancelInteraction: () => {
      const pointerId = interactionRef.current?.pointerId;
      if (pointerId === undefined) return false;
      abortInteraction(pointerId);
      return true;
    },
    zoomToAnnotationIds: (ids: string[]) => {
      const scroller = scrollRef.current;
      const selected = new Set(ids);
      const selectedRects = rects.filter(({ annotation }) => selected.has(annotation.id)).map(({ rect }) => rect);
      if (!scroller || !selectedRects.length) return;
      const target = zoomToRects(selectedRects, { width: scroller.clientWidth, height: scroller.clientHeight }, 40);
      setZoom(target.zoom);
      scheduleViewportFrame(() => {
        scroller.scrollLeft = Math.max(0, target.centerX * target.zoom - scroller.clientWidth / 2);
        scroller.scrollTop = Math.max(0, target.centerY * target.zoom - scroller.clientHeight / 2);
      });
    }
  }), [fitViewport, rects, scheduleViewportFrame, setViewportZoom, zoom]);

  function pointFromClient(event: { clientX: number; clientY: number }): Point | null {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds || !overlayReady) return null;
    return clientPointToImage(event, bounds, imageSize);
  }

  function startPointerCapture(pointerId: number) {
    const element = svgRef.current;
    if (!element) return;
    pointerCaptureTargetRef.current = element;
    element.setPointerCapture(pointerId);
  }

  function releasePointerCapture(pointerId: number) {
    const element = pointerCaptureTargetRef.current ?? svgRef.current;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    pointerCaptureTargetRef.current = null;
  }

  function abortInteraction(pointerId?: number) {
    if (pointerId !== undefined) releasePointerCapture(pointerId);
    interactionRef.current = null;
    movePreviewPointRef.current = null;
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    requestPreviewRender();
  }

  function schedulePreview() {
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      requestPreviewRender();
    });
  }

  function captureInteraction(interaction: CanvasInteraction) {
    interactionRef.current = interaction;
    movePreviewPointRef.current = interaction.kind === "move" ? interaction.start : null;
    startPointerCapture(interaction.pointerId);
    requestPreviewRender();
  }

  function startPan(event: React.PointerEvent<SVGElement>) {
    const scroller = scrollRef.current;
    captureInteraction({
      kind: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      scrollLeft: scroller?.scrollLeft ?? 0,
      scrollTop: scroller?.scrollTop ?? 0
    });
  }

  function beginInteraction(event: React.PointerEvent<SVGElement>, hit: CanvasHit) {
    if (locked || !overlayReady) return;
    if (event.button === 2) return;
    const modifier = event.ctrlKey || event.metaKey;
    const effectiveTool = resolveEffectiveTool({
      persistent: mode,
      lastEdit: lastEditToolRef.current,
      button: event.button,
      space: spacePressed,
      modifier,
      shift: event.shiftKey,
      hit: hit.kind
    });
    const directZoomPan =
      mode === "select" &&
      effectiveTool === "select" &&
      hit.kind === "background" &&
      event.button === 0 &&
      !modifier &&
      !event.shiftKey &&
      zoom > fitZoomValue + 0.001;

    if (effectiveTool === "pan" || directZoomPan) {
      event.preventDefault();
      startPan(event);
      return;
    }

    const point = pointFromClient(event);
    if (!point) {
      abortInteraction(event.pointerId);
      return;
    }

    if (effectiveTool === "draw") {
      if (!selectedClass) return;
      onSelect(null);
      captureInteraction({ kind: "draw", pointerId: event.pointerId, start: point, current: point });
      return;
    }

    if (hit.kind === "background") {
      onSelect(null);
      captureInteraction({ kind: "lasso", pointerId: event.pointerId, start: point, current: point });
      return;
    }

    if (hit.kind === "box") {
      const keepSelection = selectedIds.includes(hit.annotation.id);
      const ids = keepSelection ? selectedIds : [hit.annotation.id];
      if (!keepSelection) onSelect(hit.annotation.id);
      const selected = new Set(ids);
      const originals = new Map(
        annotations
          .filter((annotation) => selected.has(annotation.id))
          .map((annotation) => [annotation.id, yoloToRect(annotation, imageSize)] as const)
      );
      captureInteraction({ kind: "move", pointerId: event.pointerId, ids, start: point, originals });
      return;
    }

    if (!selectedIds.includes(hit.annotation.id)) onSelect(hit.annotation.id);
    captureInteraction({
      kind: "resize",
      pointerId: event.pointerId,
      id: hit.annotation.id,
      anchor: getHandleAnchor(hit.rect, hit.handle),
      current: point
    });
  }

  function handleStagePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    beginInteraction(event, { kind: "background" });
  }

  function handleBoxPointerDown(annotation: Annotation, event: React.PointerEvent<SVGRectElement>) {
    event.stopPropagation();
    beginInteraction(event, { kind: "box", annotation });
  }

  function handleHandlePointerDown(
    annotation: Annotation,
    rect: Rect,
    handle: "nw" | "ne" | "sw" | "se",
    event: React.PointerEvent<SVGCircleElement>
  ) {
    event.stopPropagation();
    beginInteraction(event, { kind: "handle", annotation, rect, handle });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (locked) {
      if (interaction) abortInteraction(interaction.pointerId);
      return;
    }
    if (!interaction || !overlayReady) return;
    if (interaction.pointerId !== event.pointerId) return;

    if (interaction.kind === "pan") {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollLeft = interaction.scrollLeft - (event.clientX - interaction.startClient.x);
      scroller.scrollTop = interaction.scrollTop - (event.clientY - interaction.startClient.y);
      return;
    }

    const point = pointFromClient(event);
    if (!point) {
      abortInteraction(event.pointerId);
      return;
    }

    if (interaction.kind === "draw" || interaction.kind === "lasso" || interaction.kind === "resize") {
      interaction.current = point;
    } else if (interaction.kind === "move") {
      movePreviewPointRef.current = point;
    }
    schedulePreview();
  }

  function completeInteraction(event: React.PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (locked) {
      if (interaction) abortInteraction(interaction.pointerId);
      return;
    }
    if (!interaction || !overlayReady) return;
    if (interaction.pointerId !== event.pointerId) return;

    if (interaction.kind === "pan") {
      abortInteraction(event.pointerId);
      return;
    }

    const endPoint = pointFromClient(event);
    if (!endPoint) {
      abortInteraction(event.pointerId);
      return;
    }

    if (interaction.kind === "draw" && selectedClass) {
      const rect = clampRect(previewRectFromPoints(interaction.start, endPoint), imageSize);
      if (rect.width >= 4 && rect.height >= 4) {
        onChange(
          annotationReducer(annotations, {
            type: "add",
            annotation: {
              id: annotationId(),
              class_id: selectedClass.class_id,
              class_name: selectedClass.class_name,
              ...rectToYolo(rect, imageSize),
              confidence: null,
              source_descriptor: null,
              source_type: "manual",
              edited: true
            }
          })
        );
      }
    }

    if (interaction.kind === "lasso") {
      const rect = clampRect(previewRectFromPoints(interaction.start, endPoint), imageSize);
      const selected = rects.filter(({ rect: item }) => rectsIntersect(rect, item)).map(({ annotation }) => annotation.id);
      onSelectMany?.(selected);
    }

    if (interaction.kind === "move") {
      const delta = clampSharedDelta(
        [...interaction.originals.values()],
        { x: endPoint.x - interaction.start.x, y: endPoint.y - interaction.start.y },
        imageSize
      );
      const next = interaction.ids.reduce((state, id) => {
        const original = interaction.originals.get(id);
        if (!original) return state;
        return annotationReducer(state, {
          type: "move",
          id,
          rect: { ...original, x: original.x + delta.x, y: original.y + delta.y },
          image: imageSize
        });
      }, annotations);
      onChange(next);
    }

    if (interaction.kind === "resize") {
      onChange(
        annotationReducer(annotations, {
          type: "resize",
          id: interaction.id,
          rect: {
            x: interaction.anchor.x,
            y: interaction.anchor.y,
            width: endPoint.x - interaction.anchor.x,
            height: endPoint.y - interaction.anchor.y
          },
          image: imageSize
        })
      );
    }

    abortInteraction(event.pointerId);
  }

  function handlePointerAbort(event: React.PointerEvent<SVGSVGElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    abortInteraction(event.pointerId);
  }

  const interaction = interactionRef.current;
  const preview = interaction?.kind === "draw"
    ? clampRect(previewRectFromPoints(interaction.start, interaction.current), imageSize)
    : null;
  const lassoPreview = interaction?.kind === "lasso"
    ? clampRect(previewRectFromPoints(interaction.start, interaction.current), imageSize)
    : null;
  const movePreviewDelta = interaction?.kind === "move" && movePreviewPointRef.current
    ? clampSharedDelta(
        [...interaction.originals.values()],
        {
          x: movePreviewPointRef.current.x - interaction.start.x,
          y: movePreviewPointRef.current.y - interaction.start.y
        },
        imageSize
      )
    : null;

  function displayedRect(annotation: Annotation, rect: Rect): Rect {
    if (interaction?.kind === "move" && interaction.ids.includes(annotation.id)) {
      const original = interaction.originals.get(annotation.id);
      if (original && movePreviewDelta) {
        return {
          ...original,
          x: original.x + movePreviewDelta.x,
          y: original.y + movePreviewDelta.y
        };
      }
    }
    if (interaction?.kind === "resize" && interaction.id === annotation.id) {
      return clampRect(previewRectFromPoints(interaction.anchor, interaction.current), imageSize);
    }
    return rect;
  }
  const imageUrl = `/api/files?path=${encodeURIComponent(image.path)}`;

  return (
    <div
      className={`annotation-canvas-shell mode-${mode} ${locked ? "is-locked" : ""} ${interaction?.kind === "pan" ? "is-panning" : ""} ${spacePressed ? "is-pan-ready" : ""} ${mode === "select" && zoom > fitZoomValue + 0.001 ? "is-direct-pan-ready" : ""}`}
      ref={scrollRef}
      aria-busy={locked}
      style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
    >
      <div
        className="annotation-canvas-media"
        style={overlayReady ? {
          width: `${imageSize.width * zoom}px`,
          height: `${imageSize.height * zoom}px`,
          maxWidth: "none",
          maxHeight: "none"
        } : undefined}
      >
        <img
          src={imageUrl}
          alt={image.path}
          draggable={false}
          style={overlayReady ? { width: "100%", height: "100%", maxWidth: "none", maxHeight: "none" } : undefined}
          onLoad={(event) =>
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
        />
        {overlayReady && (
          <svg
            ref={svgRef}
            className="annotation-overlay"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={completeInteraction}
            onPointerCancel={handlePointerAbort}
            onLostPointerCapture={handlePointerAbort}
          >
            {rects.map(({ annotation, rect: sourceRect }) => {
              const rect = displayedRect(annotation, sourceRect);
              const selected = annotation.id === selectedId || selectedIds.includes(annotation.id);
              const color = colorForClass(annotation.class_id);
              const labelWidth = Math.max(
                affordance.minLabelWidth,
                annotation.class_name.length * affordance.labelCharWidth + affordance.labelPaddingX * 2
              );
              const labelY =
                rect.y >= affordance.labelHeight + affordance.labelGap
                  ? rect.y - affordance.labelHeight - affordance.labelGap
                  : Math.min(imageSize.height - affordance.labelHeight, rect.y + rect.height + affordance.labelGap);
              const handles = [
                { key: "nw", x: rect.x, y: rect.y },
                { key: "ne", x: rect.x + rect.width, y: rect.y },
                { key: "sw", x: rect.x, y: rect.y + rect.height },
                { key: "se", x: rect.x + rect.width, y: rect.y + rect.height }
              ] as const;

              return (
                <g
                  key={annotation.id}
                  className={`bbox-group${selected ? " is-selected" : ""}${highlightedIds.includes(annotation.id) ? " is-highlighted" : ""}`}
                  tabIndex={-1}
                  onContextMenu={(event) => {
                    if (locked) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.focus();
                    onSelectMany?.(selectedIds.includes(annotation.id) ? selectedIds : [annotation.id]);
                    onContextMenu?.(annotation.id, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    rx={affordance.cornerRadius}
                    ry={affordance.cornerRadius}
                    fill={selected ? `${color}22` : "transparent"}
                    stroke={color}
                    strokeWidth={selected ? affordance.selectedStrokeWidth : affordance.strokeWidth}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(event) => handleBoxPointerDown(annotation, event)}
                  />
                  <rect
                    x={rect.x}
                    y={labelY}
                    width={labelWidth}
                    height={affordance.labelHeight}
                    rx={affordance.cornerRadius}
                    ry={affordance.cornerRadius}
                    fill={color}
                  />
                  <text
                    x={rect.x + affordance.labelPaddingX}
                    y={labelY + affordance.labelBaselineOffset}
                    fill="#081018"
                    fontSize={affordance.fontSize}
                    fontWeight="700"
                  >
                    {annotation.class_name}
                  </text>
                  {selected &&
                    mode === "select" &&
                    handles.map((handle) => (
                      <circle
                        key={handle.key}
                        cx={handle.x}
                        cy={handle.y}
                        r={affordance.handleRadius}
                        fill="#ffffff"
                        stroke={color}
                        strokeWidth={affordance.handleStrokeWidth}
                        vectorEffect="non-scaling-stroke"
                        onPointerDown={(event) =>
                          handleHandlePointerDown(annotation, rect, handle.key, event)
                        }
                      />
                    ))}
                </g>
              );
            })}
            {preview && (
              <rect
                x={preview.x}
                y={preview.y}
                width={preview.width}
                height={preview.height}
                rx={affordance.cornerRadius}
                ry={affordance.cornerRadius}
                fill="rgba(10, 132, 255, 0.14)"
                stroke="#0a84ff"
                strokeWidth={affordance.strokeWidth}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {lassoPreview && (
              <rect
                x={lassoPreview.x}
                y={lassoPreview.y}
                width={lassoPreview.width}
                height={lassoPreview.height}
                rx={affordance.cornerRadius}
                ry={affordance.cornerRadius}
                fill="rgba(48, 209, 88, 0.10)"
                stroke="#30d158"
                strokeWidth={affordance.strokeWidth}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
