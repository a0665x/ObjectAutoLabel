import type { Annotation } from "../types";

import { clampRect, rectToYolo } from "./geometry";
import type { Rect, Size } from "./geometry";

export type AnnotationAction =
  | { type: "add"; annotation: Annotation }
  | { type: "delete"; id: string }
  | { type: "changeClass"; id: string; class_id: number; class_name: string }
  | { type: "move"; id: string; rect: Rect; image: Size }
  | { type: "resize"; id: string; rect: Rect; image: Size }
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
    case "replace":
      return action.annotations;
    default:
      return state;
  }
}
