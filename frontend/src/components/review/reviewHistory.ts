import type { Annotation, ProjectImage } from "../../types";

export type AnnotationHistoryEntry = {
  kind: "annotations";
  imageId: string;
  before: Annotation[];
  after: Annotation[];
};

export type ImageRemovalHistoryEntry = {
  kind: "image-removal";
  imageId: string;
  operationId: string;
  image: ProjectImage;
  annotations: Annotation[];
  reviewStatus: string;
  before?: never;
  after?: never;
};

export type ReviewHistoryEntry = AnnotationHistoryEntry | ImageRemovalHistoryEntry;

export type ReviewHistoryState = {
  past: ReviewHistoryEntry[];
  future: ReviewHistoryEntry[];
};

function snapshot(entry: ReviewHistoryEntry): ReviewHistoryEntry {
  if (entry.kind === "image-removal") {
    return {
      ...entry,
      image: { ...entry.image },
      annotations: entry.annotations.map((annotation) => ({ ...annotation }))
    };
  }
  return {
    ...entry,
    before: entry.before.map((annotation) => ({ ...annotation })),
    after: entry.after.map((annotation) => ({ ...annotation }))
  };
}

function snapshots(entries: ReviewHistoryEntry[]): ReviewHistoryEntry[] {
  return entries.map(snapshot);
}

export function pushHistory(state: ReviewHistoryState, entry: ReviewHistoryEntry): ReviewHistoryState {
  return { past: [...snapshots(state.past), snapshot(entry)], future: [] };
}

export function undoHistory(state: ReviewHistoryState): { state: ReviewHistoryState; entry: ReviewHistoryEntry | null } {
  const entry = state.past.at(-1);
  if (!entry) return { state: { past: snapshots(state.past), future: snapshots(state.future) }, entry: null };

  const restored = snapshot(entry);
  return {
    state: { past: snapshots(state.past.slice(0, -1)), future: [snapshot(entry), ...snapshots(state.future)] },
    entry: restored
  };
}

export function redoHistory(state: ReviewHistoryState): { state: ReviewHistoryState; entry: ReviewHistoryEntry | null } {
  const entry = state.future[0];
  if (!entry) return { state: { past: snapshots(state.past), future: snapshots(state.future) }, entry: null };

  const restored = snapshot(entry);
  return {
    state: { past: [...snapshots(state.past), snapshot(entry)], future: snapshots(state.future.slice(1)) },
    entry: restored
  };
}
