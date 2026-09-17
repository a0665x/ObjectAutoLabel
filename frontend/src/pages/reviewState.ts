import type { Annotation } from "../types";
import { clipAnnotation } from "../annotation/geometry";

export const UNSAVED_REVIEW_CHANGES_MESSAGE = "You have unsaved review changes. Switch anyway?";

export function createReviewBaseline(annotations: Annotation[]): string {
  return JSON.stringify(annotations.map(clipAnnotation));
}

export function hasDirtyReviewState(baseline: string, annotations: Annotation[]): boolean {
  return baseline !== createReviewBaseline(annotations);
}

export function shouldProceedWithReviewNavigation(
  dirty: boolean,
  confirmNavigation: (message: string) => boolean
): boolean {
  if (!dirty) return true;
  return confirmNavigation(UNSAVED_REVIEW_CHANGES_MESSAGE);
}

export function shouldProceedWithReviewExit(
  isReviewPage: boolean,
  dirty: boolean,
  confirmNavigation: (message: string) => boolean
): boolean {
  if (!isReviewPage) return true;
  return shouldProceedWithReviewNavigation(dirty, confirmNavigation);
}
