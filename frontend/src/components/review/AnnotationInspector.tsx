import { Trash2 } from "lucide-react";

import type { Annotation, ClassItem, ProjectImage } from "../../types";

type AnnotationInspectorProps = {
  image: ProjectImage | null;
  annotations: Annotation[];
  selectedId: string | null;
  classes: ClassItem[];
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  locked?: boolean;
  busyLabel?: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onClassChange: (annotationId: string, classId: number) => void;
  onSave: () => void;
  onSaveAndNext: () => void;
};

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function AnnotationInspector({
  image,
  annotations,
  selectedId,
  classes,
  dirty,
  loading,
  saving,
  locked = false,
  busyLabel = null,
  onSelect,
  onDelete,
  onClassChange,
  onSave,
  onSaveAndNext
}: AnnotationInspectorProps) {
  const selectedAnnotation = annotations.find((item) => item.id === selectedId) ?? null;

  return (
    <aside className="panel review-sidebar-section" aria-busy={locked}>
      <div className="sidebar-header">
        <div>
          <strong>{image ? fileName(image.path) : "No image selected"}</strong>
          <p className="muted">{image?.path ?? "Pick an image from the queue to start reviewing."}</p>
        </div>
        <span className={dirty ? "dirty-flag is-dirty" : "dirty-flag"}>{dirty ? "Dirty" : "Synced"}</span>
      </div>

      <div className="sidebar-field">
        <button type="button" className="primary" onClick={onSave} disabled={!image || saving || locked}>
          {busyLabel ?? (saving ? "Saving..." : "Save annotations")}
        </button>
        <button type="button" className="secondary" onClick={onSaveAndNext} disabled={!image || saving || locked}>
          Save & next (N)
        </button>
      </div>

      <div className="inspector-meta">
        <span>{annotations.length} annotations</span>
        <span>{loading ? "Loading..." : "Ready"}</span>
      </div>

      {selectedAnnotation && (
        <div className="sidebar-field">
          <strong>Selected annotation</strong>
          <div className="inspector-details">
            <span>Confidence</span>
            <strong>
              {selectedAnnotation.confidence === null || selectedAnnotation.confidence === undefined
                ? "N/A"
                : `${(selectedAnnotation.confidence * 100).toFixed(1)}%`}
            </strong>
            <span>Source descriptor</span>
            <strong>{selectedAnnotation.source_descriptor || "N/A"}</strong>
            <span>Source type</span>
            <strong>{selectedAnnotation.source_type}</strong>
            <span>Edited</span>
            <strong>{selectedAnnotation.edited ? "Yes" : "No"}</strong>
          </div>
        </div>
      )}

      <div className="annotation-list">
        {annotations.length === 0 && <p className="muted">No annotations on this image yet.</p>}
        {annotations.map((annotation, index) => {
          const isSelected = annotation.id === selectedId;
          return (
            <div key={annotation.id} className={isSelected ? "annotation-item is-active" : "annotation-item"}>
              <button type="button" className="annotation-select" onClick={() => onSelect(annotation.id)} disabled={locked}>
                <strong>
                  {index + 1}. {annotation.class_name}
                </strong>
                <span>
                  {(annotation.width * 100).toFixed(1)}% × {(annotation.height * 100).toFixed(1)}%
                </span>
              </button>
              <div className="annotation-item-actions">
                <select
                  value={annotation.class_id}
                  disabled={locked}
                  onChange={(event) => onClassChange(annotation.id, Number(event.target.value))}
                >
                  {classes.map((item) => (
                    <option key={item.class_id} value={item.class_id}>
                      {item.class_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-danger"
                  disabled={locked}
                  onClick={() => onDelete(annotation.id)}
                  title="Delete annotation"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
