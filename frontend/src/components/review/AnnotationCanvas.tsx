import { useEffect, useMemo, useRef, useState } from "react";

import { annotationReducer } from "../../annotation/reducer";
import { clampRect, rectToYolo, yoloToRect } from "../../annotation/geometry";
import type { Rect, Size } from "../../annotation/geometry";
import type { Annotation, ClassItem, ProjectImage } from "../../types";
import { getCanvasAffordance } from "./canvasAffordance";

type AnnotationCanvasProps = {
  image: ProjectImage;
  annotations: Annotation[];
  selectedId: string | null;
  selectedClass: ClassItem | null;
  mode: "select" | "draw" | "pan";
  onChange: (annotations: Annotation[]) => void;
  onSelect: (id: string | null) => void;
};

type Point = { x: number; y: number };

type Interaction =
  | { kind: "draw"; start: Point; current: Point }
  | { kind: "move"; id: string; pointerStart: Point; rectStart: Rect }
  | { kind: "resize"; id: string; anchor: Point }
  | { kind: "pan"; startClient: Point; scrollLeft: number; scrollTop: number };

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

function previewRect(start: Point, current: Point): Rect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

export function AnnotationCanvas({
  image,
  annotations,
  selectedId,
  selectedClass,
  mode,
  onChange,
  onSelect
}: AnnotationCanvasProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const imageSize = useMemo<Size>(() => {
    const width = image.width ?? naturalSize?.width ?? 0;
    const height = image.height ?? naturalSize?.height ?? 0;
    return { width, height };
  }, [image.height, image.width, naturalSize]);
  const overlayReady = imageSize.width > 0 && imageSize.height > 0;
  const rects = useMemo(
    () =>
      overlayReady
        ? annotations.map((annotation) => ({ annotation, rect: yoloToRect(annotation, imageSize) }))
        : [],
    [annotations, imageSize, overlayReady]
  );

  useEffect(() => {
    setInteraction(null);
  }, [image.id, mode]);

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

  function pointFromClient(event: { clientX: number; clientY: number }): Point {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0 || !overlayReady) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * imageSize.width,
      y: ((event.clientY - bounds.top) / bounds.height) * imageSize.height
    };
  }

  function startPointerCapture(pointerId: number) {
    svgRef.current?.setPointerCapture(pointerId);
  }

  function releasePointerCapture(pointerId: number) {
    if (svgRef.current?.hasPointerCapture(pointerId)) {
      svgRef.current.releasePointerCapture(pointerId);
    }
  }

  function updateAnnotation(nextAnnotations: Annotation[]) {
    onChange(nextAnnotations);
  }

  function handleStagePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!overlayReady) return;
    const point = pointFromClient(event);
    startPointerCapture(event.pointerId);

    if (mode === "draw" && selectedClass) {
      onSelect(null);
      setInteraction({ kind: "draw", start: point, current: point });
      return;
    }

    if (mode === "pan") {
      const scroller = scrollRef.current;
      setInteraction({
        kind: "pan",
        startClient: { x: event.clientX, y: event.clientY },
        scrollLeft: scroller?.scrollLeft ?? 0,
        scrollTop: scroller?.scrollTop ?? 0
      });
      return;
    }

    onSelect(null);
  }

  function handleBoxPointerDown(annotation: Annotation, rect: Rect, event: React.PointerEvent<SVGRectElement>) {
    event.stopPropagation();
    startPointerCapture(event.pointerId);

    if (mode === "pan") {
      const scroller = scrollRef.current;
      setInteraction({
        kind: "pan",
        startClient: { x: event.clientX, y: event.clientY },
        scrollLeft: scroller?.scrollLeft ?? 0,
        scrollTop: scroller?.scrollTop ?? 0
      });
      return;
    }

    onSelect(annotation.id);
    if (mode !== "select") return;

    setInteraction({
      kind: "move",
      id: annotation.id,
      pointerStart: pointFromClient(event),
      rectStart: rect
    });
  }

  function handleHandlePointerDown(
    annotation: Annotation,
    rect: Rect,
    handle: "nw" | "ne" | "sw" | "se",
    event: React.PointerEvent<SVGCircleElement>
  ) {
    event.stopPropagation();
    if (mode !== "select") return;
    startPointerCapture(event.pointerId);
    onSelect(annotation.id);
    setInteraction({
      kind: "resize",
      id: annotation.id,
      anchor: getHandleAnchor(rect, handle)
    });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!interaction || !overlayReady) return;

    if (interaction.kind === "pan") {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollLeft = interaction.scrollLeft - (event.clientX - interaction.startClient.x);
      scroller.scrollTop = interaction.scrollTop - (event.clientY - interaction.startClient.y);
      return;
    }

    const point = pointFromClient(event);

    if (interaction.kind === "draw") {
      setInteraction({ ...interaction, current: point });
      return;
    }

    if (interaction.kind === "move") {
      const dx = point.x - interaction.pointerStart.x;
      const dy = point.y - interaction.pointerStart.y;
      updateAnnotation(
        annotationReducer(annotations, {
          type: "move",
          id: interaction.id,
          rect: {
            x: interaction.rectStart.x + dx,
            y: interaction.rectStart.y + dy,
            width: interaction.rectStart.width,
            height: interaction.rectStart.height
          },
          image: imageSize
        })
      );
      return;
    }

    updateAnnotation(
      annotationReducer(annotations, {
        type: "resize",
        id: interaction.id,
        rect: {
          x: interaction.anchor.x,
          y: interaction.anchor.y,
          width: point.x - interaction.anchor.x,
          height: point.y - interaction.anchor.y
        },
        image: imageSize
      })
    );
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!interaction || !overlayReady) return;

    if (interaction.kind === "draw" && selectedClass) {
      const endPoint = pointFromClient(event);
      const rect = clampRect(previewRect(interaction.start, endPoint), imageSize);
      if (rect.width >= 4 && rect.height >= 4) {
        updateAnnotation(
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

    releasePointerCapture(event.pointerId);
    setInteraction(null);
  }

  const preview = interaction?.kind === "draw" ? clampRect(previewRect(interaction.start, interaction.current), imageSize) : null;
  const imageUrl = `/api/files?path=${encodeURIComponent(image.path)}`;

  return (
    <div className={`annotation-canvas-shell mode-${mode}`} ref={scrollRef}>
      <div className="annotation-canvas-media">
        <img
          src={imageUrl}
          alt={image.path}
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
            onPointerUp={handlePointerUp}
          >
            {rects.map(({ annotation, rect }) => {
              const selected = annotation.id === selectedId;
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
                <g key={annotation.id} className={selected ? "bbox-group is-selected" : "bbox-group"}>
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
                    onPointerDown={(event) => handleBoxPointerDown(annotation, rect, event)}
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
                strokeDasharray={affordance.previewDashArray}
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
