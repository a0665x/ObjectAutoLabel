import type { CSSProperties } from "react";
import type { BboxHistogramBin, BboxHistogramClass } from "../../api/client";
import type { Annotation } from "../../types";

export type ActiveAreaBin = { classId: number; lower: number; upper: number };

function areaPercent(box: Pick<Annotation, "width" | "height">): number {
  return Math.max(0, Math.min(100, box.width * box.height * 100));
}

function belongsToBin(area: number, bin: Pick<BboxHistogramBin, "lower" | "upper">): boolean {
  return area >= bin.lower && (area < bin.upper || (bin.upper === 100 && area <= 100));
}

export function annotationIdsInAreaBin(annotations: Annotation[], classId: number, bin: Pick<BboxHistogramBin, "lower" | "upper">): string[] {
  return annotations.filter((box) => box.class_id === classId && belongsToBin(areaPercent(box), bin)).map((box) => box.id);
}

function formatBoundary(value: number): string {
  return String(Number(value.toFixed(3)));
}

type Props = {
  annotations: Annotation[];
  distribution: BboxHistogramClass[];
  loading: boolean;
  activeBin: ActiveAreaBin | null;
  onSelectBin: (classId: number, bin: BboxHistogramBin) => void;
};

export function AnnotationHistogram({ annotations, distribution, loading, activeBin, onSelectBin }: Props) {
  return (
    <section className="panel review-wide-section annotation-histogram-panel">
      <strong>Object size distribution</strong>
      <p className="muted">
        All boxes in the selected source groups. Dense ranges split automatically. Gold bins contain boxes from the current image; click a bin to highlight those boxes.
      </p>
      {loading ? <p className="muted">Loading distribution…</p> : distribution.length === 0 ? <p className="muted">No boxes in the selected sources.</p> : distribution.map((row) => {
        const currentBins = new Set(
          row.bins
            .filter((bin) => annotations.some((box) => box.class_id === row.class_id && belongsToBin(areaPercent(box), bin)))
            .map((bin) => `${bin.lower}:${bin.upper}`)
        );
        const max = Math.max(1, ...row.bins.map((bin) => bin.count));
        const columns = { "--histogram-columns": row.bins.length } as CSSProperties;
        return (
          <div key={row.class_id} className="area-histogram">
            <strong>{row.class_name} · {row.bins.reduce((sum, bin) => sum + bin.count, 0)} boxes</strong>
            <div className="histogram-bars" style={columns}>
              {row.bins.map((bin) => {
                const key = `${bin.lower}:${bin.upper}`;
                const containsCurrent = currentBins.has(key);
                const isActive = activeBin?.classId === row.class_id && activeBin.lower === bin.lower && activeBin.upper === bin.upper;
                return (
                  <button
                    type="button"
                    key={key}
                    className={`${containsCurrent ? "contains-current " : ""}${isActive ? "is-active" : ""}`}
                    aria-pressed={isActive}
                    aria-label={`${formatBoundary(bin.lower)} to ${formatBoundary(bin.upper)} percent, ${bin.count} boxes${containsCurrent ? ", current image" : ""}`}
                    onClick={() => onSelectBin(row.class_id, bin)}
                  >
                    <span className="histogram-bar" style={{ height: `${Math.max(3, Math.sqrt(bin.count / max) * 88)}px` }} />
                    <small>{formatBoundary(bin.lower)}–{formatBoundary(bin.upper)}%</small>
                    <b>{bin.count}</b>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
