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
};

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "pending_review", label: "Pending review" },
  { value: "needs_fix", label: "Needs fix" },
  { value: "reviewed", label: "Reviewed" },
  { value: "skipped", label: "Skipped" }
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
  onSaveAndNext
}: AnnotationToolbarProps) {
  return (
    <section className="review-toolbar panel">
      <div className="toolbar-cluster">
        <button type="button" className="icon-button" onClick={onPrevious} disabled={!canGoPrev} title="Previous image (ArrowLeft)">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="icon-button" onClick={onNext} disabled={!canGoNext} title="Next image (ArrowRight)">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="segmented-control" role="tablist" aria-label="Annotation tools">
        <button
          type="button"
          className={mode === "select" ? "is-active" : ""}
          onClick={() => onModeChange("select")}
          title="Select mode (V)"
        >
          <LocateFixed size={16} />
          <span>Select</span>
        </button>
        <button
          type="button"
          className={mode === "draw" ? "is-active" : ""}
          onClick={() => onModeChange("draw")}
          title="Draw mode (W)"
        >
          <SquarePen size={16} />
          <span>Draw</span>
        </button>
        <button
          type="button"
          className={mode === "pan" ? "is-active" : ""}
          onClick={() => onModeChange("pan")}
          title="Pan mode"
        >
          <Hand size={16} />
          <span>Pan</span>
        </button>
      </div>
      <div className="toolbar-cluster toolbar-review-status">
        <label>
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
      <div className="toolbar-cluster toolbar-save">
        <span className={dirty ? "dirty-flag is-dirty" : "dirty-flag"}>{dirty ? "Unsaved" : "Saved"}</span>
        <button type="button" className="primary" onClick={onSave} disabled={saving}>
          <Save size={16} />
          <span>{saving ? "Saving..." : "Save"}</span>
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onSaveAndNext}
          disabled={saving}
          title="Save and move to the next image (Shift+S)"
        >
          <SkipForward size={16} />
          <span>Save & next</span>
        </button>
      </div>
    </section>
  );
}
