import { ChevronLeft, ChevronRight, Hand, LocateFixed, Maximize2, Save, Scan, SkipForward, SquarePen, ZoomIn, ZoomOut } from "lucide-react";

import type { ReviewImagePosition } from "../../types";
import { ReviewEditMenu } from "./ReviewEditMenu";
import type { ReviewCommand } from "./reviewCommands";

type AnnotationToolbarProps = {
  mode: "select" | "draw" | "pan";
  canGoPrev: boolean;
  canGoNext: boolean;
  dirty: boolean;
  saving: boolean;
  locked?: boolean;
  busyLabel?: string | null;
  zoom: number;
  position?: ReviewImagePosition | null;
  commands?: ReviewCommand[];
  editMenuOpen?: boolean;
  onEditMenuOpenChange?: (open: boolean) => void;
  onModeChange?: (mode: "select" | "draw" | "pan") => void;
  onPrevious: () => void;
  onNext: () => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onMergeSameClass: () => void;
  onFit: () => void;
  onActualSize: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function AnnotationToolbar({
  mode,
  canGoPrev,
  canGoNext,
  dirty,
  saving,
  locked = false,
  busyLabel = null,
  zoom,
  position,
  commands,
  editMenuOpen,
  onEditMenuOpenChange,
  onModeChange,
  onPrevious,
  onNext,
  onSave,
  onSaveAndNext,
  onMergeSameClass,
  onFit,
  onActualSize,
  onZoomIn,
  onZoomOut
}: AnnotationToolbarProps) {
  const command = (id: string) => commands?.find((item) => item.id === id);
  const selectCommand = command("tool-select");
  const drawCommand = command("tool-draw");
  const panCommand = command("tool-pan");
  const saveCommand = command("save");
  const saveNextCommand = command("save-next");
  const toolChecked = (item: ReviewCommand | undefined, fallback: "select" | "draw" | "pan") =>
    commands ? Boolean(item?.checked) : mode === fallback;
  const commandDisabled = (item: ReviewCommand | undefined, fallback: boolean) =>
    commands ? !item?.enabled : fallback;
  const runTool = (id: string, fallback: "select" | "draw" | "pan") => {
    const item = command(id);
    if (item?.enabled) void item.run();
    else if (!commands) onModeChange?.(fallback);
  };
  const runSave = (id: "save" | "save-next", fallback: () => void) => {
    const item = command(id);
    if (item?.enabled) void item.run();
    else if (!commands) fallback();
  };

  return (
    <section className="review-toolbar panel" aria-busy={locked}>
      <div className="toolbar-primary-row">
        <div className="toolbar-cluster toolbar-view-group">
          <button type="button" className="icon-button action-navigate" onClick={onPrevious} disabled={!canGoPrev} title="Previous image (ArrowLeft)">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="icon-button action-navigate" onClick={onNext} disabled={!canGoNext} title="Next image (ArrowRight)">
            <ChevronRight size={18} />
          </button>
          <div className="toolbar-cluster toolbar-zoom" aria-label="Image zoom controls">
            <button type="button" className="icon-button" onClick={onZoomOut} title="Zoom out"><ZoomOut size={16} /></button>
            <button type="button" className="secondary zoom-readout" onClick={onActualSize} title="Show image at 100%"><Scan size={16} /><span>{Math.round(zoom * 100)}%</span></button>
            <button type="button" className="icon-button" onClick={onZoomIn} title="Zoom in"><ZoomIn size={16} /></button>
            <button type="button" className="secondary" onClick={onFit} title="Fit image in viewport"><Maximize2 size={16} /><span>Fit</span></button>
          </div>
          {position ? (
            <div className="review-image-position" aria-live="polite">
              <strong>Filtered queue {position.filtered_index} / {position.filtered_total}</strong>
              <span> · Project total {position.project_index} / {position.project_total}</span>
            </div>
          ) : null}
        </div>
        <div className="toolbar-cluster toolbar-commit-group">
          {commands ? (
            <ReviewEditMenu commands={commands} open={editMenuOpen} onOpenChange={onEditMenuOpenChange} />
          ) : null}
          <button type="button" className="secondary action-merge" onClick={onMergeSameClass} disabled={locked} title="Merge overlapping boxes on this image when they map to the same training class id. You will be asked for the IoU threshold.">
            Merge boxes
          </button>
          <span className={dirty ? "dirty-flag is-dirty" : "dirty-flag"}>{dirty ? "Unsaved" : "Saved"}</span>
          <button type="button" className="primary action-save" onClick={() => runSave("save", onSave)} disabled={commandDisabled(saveCommand, saving || locked)} title="Save annotations for this image (Ctrl+S or Cmd+S)">
            <Save size={16} />
            <span>{busyLabel ?? (saving ? "Saving..." : "Save")}</span>
          </button>
          <button type="button" className="secondary action-save-next" onClick={() => runSave("save-next", onSaveAndNext)} disabled={commandDisabled(saveNextCommand, saving || locked)} title="Save and move to the next image (N or Shift+S); confidence is the confidence score assigned by YOLO-World">
            <SkipForward size={16} />
            <span>Save & next</span>
          </button>
        </div>
      </div>
      <div className="toolbar-secondary-row">
        <div className="segmented-control toolbar-tool-group" role="tablist" aria-label="Annotation tools">
          <button type="button" aria-pressed={toolChecked(selectCommand, "select")} disabled={commandDisabled(selectCommand, false)} className={`tool-select ${toolChecked(selectCommand, "select") ? "is-active" : ""}`} onClick={() => runTool("tool-select", "select")} title="Select mode: click an existing box to move, resize, or relabel it (D)">
            <LocateFixed size={16} /><span>Select</span><kbd>D</kbd>
          </button>
          <button type="button" aria-pressed={toolChecked(drawCommand, "draw")} disabled={commandDisabled(drawCommand, false)} className={`tool-draw ${toolChecked(drawCommand, "draw") ? "is-active" : ""}`} onClick={() => runTool("tool-draw", "draw")} title="Draw mode: drag on the image to create a new box (B)">
            <SquarePen size={16} /><span>Draw</span><kbd>B</kbd>
          </button>
          <button type="button" aria-pressed={toolChecked(panCommand, "pan")} disabled={commandDisabled(panCommand, false)} className={`tool-pan ${toolChecked(panCommand, "pan") ? "is-active" : ""}`} onClick={() => runTool("tool-pan", "pan")} title="Pan mode: drag the stage without editing boxes (H)">
            <Hand size={16} /><span>Pan</span><kbd>H</kbd>
          </button>
        </div>
        <div className="review-shortcuts" aria-label="Review shortcuts">
          <span><kbd>Zoomed drag</kbd> pan</span>
          <span><kbd>Shift+drag</kbd> select boxes</span>
          <span><kbd>Space+drag</kbd> pan</span>
          <span><kbd>Middle-drag</kbd> pan</span>
          <span><kbd>Ctrl+wheel</kbd> zoom</span>
          <span><kbd>Ctrl+D</kbd> duplicate</span>
          <span><kbd>Right-click</kbd> actions</span>
          <span><kbd>Arrow keys</kbd> move · <kbd>Shift</kbd> ×10</span>
        </div>
      </div>
    </section>
  );
}
