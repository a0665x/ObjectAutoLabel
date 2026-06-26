import type { ReviewStatus } from "../api/client";
import type { Annotation } from "../types";

export const UNSAVED_REVIEW_CHANGES_MESSAGE = "You have unsaved review changes. Switch anyway?";

type ReviewBaseline = {
  annotations: Annotation[];
  reviewStatus: ReviewStatus;
};

export function createReviewBaseline(annotations: Annotation[], reviewStatus: ReviewStatus): string {
  const baseline: ReviewBaseline = { annotations, reviewStatus };
  return JSON.stringify(baseline);
}

export function hasDirtyReviewState(
  baseline: string,
  annotations: Annotation[],
  reviewStatus: ReviewStatus
): boolean {
  return baseline !== createReviewBaseline(annotations, reviewStatus);
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
