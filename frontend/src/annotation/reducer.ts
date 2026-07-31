import type { Annotation } from "../types";

import { clampRect, rectToYolo } from "./geometry";
import type { Rect, Size } from "./geometry";

export type AnnotationAction =
  | { type: "add"; annotation: Annotation }
  | { type: "delete"; id: string }
  | { type: "changeClass"; id: string; class_id: number; class_name: string }
  | { type: "move"; id: string; rect: Rect; image: Size }
  | { type: "resize"; id: string; rect: Rect; image: Size }
  | { type: "mergeSameClass"; iouThreshold: number }
  | { type: "replace"; annotations: Annotation[] };

function updateAnnotation(state: Annotation[], id: string, updater: (annotation: Annotation) => Annotation): Annotation[] {
  return state.map((annotation) => (annotation.id === id ? updater(annotation) : annotation));
}

function updateGeometry(annotation: Annotation, rect: Rect, image: Size): Annotation {
  return {
    ...annotation,
    ...rectToYolo(clampRect(rect, image), image),
    edited: true
  };
}

function toBox(annotation: Annotation): { x1: number; y1: number; x2: number; y2: number } {
  const halfWidth = annotation.width / 2;
  const halfHeight = annotation.height / 2;
  return {
    x1: annotation.x_center - halfWidth,
    y1: annotation.y_center - halfHeight,
    x2: annotation.x_center + halfWidth,
    y2: annotation.y_center + halfHeight
  };
}

function annotationIou(first: Annotation, second: Annotation): number {
  const a = toBox(first);
  const b = toBox(second);
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const firstArea = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const secondArea = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = firstArea + secondArea - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function mergeGroup(group: Annotation[]): Annotation {
  const best = group.reduce((currentBest, item) => ((item.confidence ?? 0) > (currentBest.confidence ?? 0) ? item : currentBest));
  const descriptors = Array.from(
    new Set(group.map((item) => item.source_descriptor).filter((descriptor): descriptor is string => Boolean(descriptor)))
  );
  return {
    ...best,
    source_descriptor: descriptors.length ? descriptors.join(" | ") : best.source_descriptor,
    source_type: group.length > 1 ? "pseudo_merged" : best.source_type,
    edited: group.length > 1 ? true : best.edited
  };
}

function mergeSameClassAnnotations(state: Annotation[], iouThreshold: number): Annotation[] {
  const used = new Set<number>();
  const next: Annotation[] = [];
  state.forEach((annotation, index) => {
    if (used.has(index)) return;
    const group = [annotation];
    used.add(index);
    state.forEach((candidate, otherIndex) => {
      if (otherIndex <= index || used.has(otherIndex)) return;
      if (candidate.class_id !== annotation.class_id) return;
      if (annotationIou(annotation, candidate) >= iouThreshold) {
        group.push(candidate);
        used.add(otherIndex);
      }
    });
    next.push(mergeGroup(group));
  });
  return next;
}

export function annotationReducer(state: Annotation[], action: AnnotationAction): Annotation[] {
  switch (action.type) {
    case "add":
      return [...state, action.annotation];
    case "delete":
      return state.filter((annotation) => annotation.id !== action.id);
    case "changeClass":
      return updateAnnotation(state, action.id, (annotation) => ({
        ...annotation,
        class_id: action.class_id,
        class_name: action.class_name,
        edited: true
      }));
    case "move":
    case "resize":
      return updateAnnotation(state, action.id, (annotation) => updateGeometry(annotation, action.rect, action.image));
    case "mergeSameClass":
      return mergeSameClassAnnotations(state, action.iouThreshold);
    case "replace":
      return action.annotations;
    default:
      return state;
  }
}
