import type { Size } from "../../annotation/geometry";
import type { Annotation } from "../../types";
import { applySharedDuplicateOffset } from "./annotationCommands";

export type ReviewClipboardEntry = Pick<
  Annotation,
  "class_id" | "class_name" | "x_center" | "y_center" | "width" | "height" | "source_descriptor"
>;

function hasSameGeometry(
  annotation: Pick<Annotation, "x_center" | "y_center" | "width" | "height">,
  entry: ReviewClipboardEntry
): boolean {
  return (
    annotation.x_center === entry.x_center &&
    annotation.y_center === entry.y_center &&
    annotation.width === entry.width &&
    annotation.height === entry.height
  );
}

export function copyAnnotations(state: Annotation[], ids: string[]): ReviewClipboardEntry[] {
  const selected = new Set(ids);
  return state
    .filter((item) => selected.has(item.id))
    .map(({ class_id, class_name, x_center, y_center, width, height, source_descriptor }) => ({
      class_id,
      class_name,
      x_center,
      y_center,
      width,
      height,
      source_descriptor
    }));
}

export function pasteAnnotations(
  state: Annotation[],
  clipboard: ReviewClipboardEntry[],
  createId: () => string,
  image?: Size
): { annotations: Annotation[]; selectedIds: string[] } {
  const copies = clipboard.map((item) => ({
    ...item,
    id: createId(),
    confidence: null,
    source_type: "manual",
    edited: true
  }));
  const everyCopyIsCovered = copies.every((copy) => state.some((annotation) => hasSameGeometry(annotation, copy)));
  const positionedCopies = image && copies.length && everyCopyIsCovered ? applySharedDuplicateOffset(copies, image) : copies;

  return {
    annotations: [...state, ...positionedCopies],
    selectedIds: positionedCopies.map((item) => item.id)
  };
}
