import type { Annotation, ClassItem } from "../../types";
import { rectToYolo, yoloToRect } from "../../annotation/geometry";
import type { Rect, Size } from "../../annotation/geometry";

type Point = { x: number; y: number };

export function keyboardNudgeDelta(key: string, accelerated: boolean): Point | null {
  const step = accelerated ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}

function selectedRects(state: Annotation[], ids: Set<string>, image: Size): Rect[] {
  return state.filter((annotation) => ids.has(annotation.id)).map((annotation) => yoloToRect(annotation, image));
}

export function clampSharedDelta(rects: Rect[], delta: Point, image: Size): Point {
  if (!rects.length) return { x: 0, y: 0 };
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: Math.min(Math.max(delta.x, -left), image.width - right),
    y: Math.min(Math.max(delta.y, -top), image.height - bottom)
  };
}

function moveRect(rect: Rect, delta: Point): Rect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y };
}

export function applySharedDuplicateOffset(annotations: Annotation[], image: Size): Annotation[] {
  const clamped = clampSharedDelta(
    annotations.map((annotation) => yoloToRect(annotation, image)),
    { x: 8, y: 8 },
    image
  );
  return annotations.map((annotation) => ({
    ...annotation,
    ...rectToYolo(moveRect(yoloToRect(annotation, image), clamped), image)
  }));
}

export function moveAnnotations(state: Annotation[], ids: string[], delta: Point, image: Size): Annotation[] {
  const selected = new Set(ids);
  const clamped = clampSharedDelta(selectedRects(state, selected, image), delta, image);
  return state.map((annotation) => {
    if (!selected.has(annotation.id)) return annotation;
    return {
      ...annotation,
      ...rectToYolo(moveRect(yoloToRect(annotation, image), clamped), image),
      edited: true
    };
  });
}

function defaultAnnotationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function duplicateAnnotations(
  state: Annotation[],
  ids: string[],
  image: Size,
  createId: () => string = defaultAnnotationId
): { annotations: Annotation[]; selectedIds: string[] } {
  const selected = new Set(ids);
  const originals = state.filter((annotation) => selected.has(annotation.id));
  const copies = applySharedDuplicateOffset(
    originals.map((annotation) => ({
      ...annotation,
      id: createId(),
      confidence: null,
      source_descriptor: null,
      source_type: "manual",
      edited: true
    })),
    image
  );
  return { annotations: [...state, ...copies], selectedIds: copies.map((annotation) => annotation.id) };
}

export function changeAnnotationClasses(state: Annotation[], ids: string[], item: ClassItem): Annotation[] {
  const selected = new Set(ids);
  return state.map((annotation) =>
    selected.has(annotation.id)
      ? { ...annotation, class_id: item.class_id, class_name: item.class_name, edited: true }
      : annotation
  );
}

export function deleteAnnotations(state: Annotation[], ids: string[]): Annotation[] {
  const selected = new Set(ids);
  return state.filter((annotation) => !selected.has(annotation.id));
}
