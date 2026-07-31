import { ChevronLeft, ChevronRight, Hand, LocateFixed, Save, SkipForward, SquarePen } from "lucide-react";

import type { ReviewStatus } from "../../api/client";

type AnnotationToolbarProps = {
  mode: "select" | "draw" | "pan";
  reviewStatus: ReviewStatus;
  canGoPrev: boolean;
  canGoNext: boolean;
  dirty: boolean;
  saving: boolean;
  onModeChange: (mode: "select" | "draw" | "pan") => void;
  onReviewStatusChange: (status: ReviewStatus) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onMergeSameClass: () => void;
};

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "pending_review", label: "Not checked" },
  { value: "reviewed", label: "Checked" }
];

export function AnnotationToolbar({
  mode,
  reviewStatus,
  canGoPrev,
  canGoNext,
  dirty,
  saving,
  onModeChange,
  onReviewStatusChange,
  onPrevious,
  onNext,
  onSave,
  onSaveAndNext,
  onMergeSameClass
}: AnnotationToolbarProps) {
  return (
    <section className="review-toolbar panel">
      <div className="toolbar-cluster">
        <button type="button" className="icon-button action-navigate" onClick={onPrevious} disabled={!canGoPrev} title="Previous image (ArrowLeft)">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="icon-button action-navigate" onClick={onNext} disabled={!canGoNext} title="Next image (ArrowRight)">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="segmented-control" role="tablist" aria-label="Annotation tools">
        <button
          type="button"
          className={`tool-select ${mode === "select" ? "is-active" : ""}`}
          onClick={() => onModeChange("select")}
          title="Select mode: click an existing box to move/resize/relabel it (V)"
        >
          <LocateFixed size={16} />
          <span>Select</span>
        </button>
        <button
          type="button"
          className={`tool-draw ${mode === "draw" ? "is-active" : ""}`}
          onClick={() => onModeChange("draw")}
          title="Draw mode: drag on the image to create a new box (W or Ctrl+D)"
        >
          <SquarePen size={16} />
          <span>Draw</span>
        </button>
        <button
          type="button"
          className={`tool-pan ${mode === "pan" ? "is-active" : ""}`}
          onClick={() => onModeChange("pan")}
          title="Pan mode: drag the stage without editing boxes"
        >
          <Hand size={16} />
          <span>Pan</span>
        </button>
      </div>
      <div className="toolbar-cluster toolbar-review-status">
        <label title="Review marker only: all labeled images can be trained. Use Checked to count images you have inspected.">
          <span>Status</span>
          <select value={reviewStatus} onChange={(event) => onReviewStatusChange(event.target.value as ReviewStatus)}>
            {REVIEW_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar-cluster">
        <button
          type="button"
          className="secondary action-merge"
          onClick={onMergeSameClass}
          title="Merge overlapping boxes on this image when they map to the same training class id. You will be asked for the IoU threshold."
        >
          Merge boxes
        </button>
      </div>
      <div className="toolbar-cluster toolbar-save">
        <span className={dirty ? "dirty-flag is-dirty" : "dirty-flag"}>{dirty ? "Unsaved" : "Saved"}</span>
        <button type="button" className="primary action-save" onClick={onSave} disabled={saving} title="Save annotations for this image (S or Ctrl+S)">
          <Save size={16} />
          <span>{saving ? "Saving..." : "Save"}</span>
        </button>
        <button
          type="button"
          className="secondary action-save-next"
          onClick={onSaveAndNext}
          disabled={saving}
          title="Save and move to the next image (Shift+S); confidence is the confidence score assigned by YOLO-World"
        >
          <SkipForward size={16} />
          <span>Save & next</span>
        </button>
      </div>
    </section>
  );
}
