import type { Annotation, ClassItem } from "../../types";

type ClassPaletteProps = {
  classes: ClassItem[];
  selectedClassId: number | null;
  selectedAnnotation: Annotation | null;
  onSelectClass: (item: ClassItem) => void;
};

const CLASS_SWATCHES = ["#0a84ff", "#30d158", "#ff9f0a", "#ff375f", "#5e5ce6", "#64d2ff", "#bf5af2", "#ffd60a"];

function colorForClass(classId: number): string {
  return CLASS_SWATCHES[Math.abs(classId) % CLASS_SWATCHES.length];
}

export function ClassPalette({ classes, selectedClassId, selectedAnnotation, onSelectClass }: ClassPaletteProps) {
  return (
    <section className="panel class-palette">
      <div className="sidebar-header">
        <div>
          <strong>Class palette</strong>
          <p className="muted">
            {selectedAnnotation ? "Selecting a class relabels the active box." : "Choose the class used for new boxes."}
          </p>
        </div>
      </div>
      <div className="class-grid">
        {classes.map((item, index) => {
          const active = item.class_id === selectedClassId;
          const hotkey = index < 9 ? String(index + 1) : null;
          return (
            <button
              key={item.class_id}
              type="button"
              className={active ? "class-chip is-active" : "class-chip"}
              onClick={() => onSelectClass(item)}
            >
              <span className="class-swatch" style={{ background: colorForClass(item.class_id) }} />
              <span className="class-chip-label">
                <strong>{item.class_name}</strong>
                <span>{hotkey ? `Key ${hotkey}` : `Class ${item.class_id}`}</span>
              </span>
            </button>
          );
        })}
        {classes.length === 0 && <p className="muted">No classes loaded. Save a class schema to start annotating.</p>}
      </div>
    </section>
  );
}
