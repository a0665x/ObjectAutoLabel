import type { ImageFilters, ReviewStats, ReviewStatus } from "../../api/client";
import { REVIEW_QUEUE_TILES } from "../../pages/reviewConfig";
import type { ProjectImage, SourceAsset } from "../../types";

type ImageQueueProps = {
  images: ProjectImage[];
  activeImageId: string | null;
  filters: ImageFilters;
  stats: ReviewStats;
  sources: SourceAsset[];
  loading: boolean;
  prefetching?: boolean;
  onSelectImage: (id: string) => void;
  onFilterChange: (partial: Partial<ImageFilters>) => void;
};

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "pending_review", label: "Not checked" },
  { value: "reviewed", label: "Checked" }
];

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function sourceName(source: SourceAsset): string {
  return fileName(source.path);
}

export function ImageQueue({
  images,
  activeImageId,
  filters,
  stats,
  sources,
  loading,
  prefetching = false,
  onSelectImage,
  onFilterChange
}: ImageQueueProps) {
  return (
    <aside className="panel review-sidebar-section">
      <div className="sidebar-header">
        <div>
          <strong>Queue</strong>
          <p className="muted">{images.length} images in the current filter{prefetching ? " · preloading next boxes" : ""}</p>
        </div>
      </div>

      <p className="muted">Checked {stats.reviewed}/{Math.max(1, stats.unreviewed + stats.pending_review + stats.needs_fix + stats.reviewed + stats.skipped)} images ({Math.round((stats.reviewed / Math.max(1, stats.unreviewed + stats.pending_review + stats.needs_fix + stats.reviewed + stats.skipped)) * 100)}%). All labeled images remain trainable.</p>

      <div className="review-stats-grid">
        {REVIEW_QUEUE_TILES.map((tile) => (
          <div key={tile.key} className="stat-tile">
            <span>{tile.label}</span>
            <strong>{stats[tile.key]}</strong>
          </div>
        ))}
      </div>

      <div className="queue-filters">
        <label title="Review marker only. Split/training uses all images with labels; Checked just tracks how many you already looked at.">
          <span>Status</span>
          <select
            value={filters.review_status ?? ""}
            onChange={(event) =>
              onFilterChange({
                review_status: event.target.value ? (event.target.value as ReviewStatus) : undefined
              })
            }
          >
            <option value="">All statuses</option>
            {REVIEW_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Source</span>
          <select
            value={filters.source_asset_id ?? ""}
            onChange={(event) =>
              onFilterChange({
                source_asset_id: event.target.value || undefined
              })
            }
          >
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {sourceName(source)}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.has_low_confidence ?? false}
            onChange={(event) => onFilterChange({ has_low_confidence: event.target.checked || undefined })}
          />
          <span>Only low confidence</span>
        </label>
      </div>

      <div className="queue-list">
        {loading && <p className="muted">Loading queue...</p>}
        {prefetching && !loading && <p className="inline-feedback">Preloading next image boxes…</p>}
        {!loading && images.length === 0 && <p className="muted">No images match the current filters.</p>}
        {images.map((image) => (
          <button
            key={image.id}
            type="button"
            className={image.id === activeImageId ? "queue-row is-active" : "queue-row"}
            onClick={() => onSelectImage(image.id)}
          >
            <strong>{fileName(image.path)}</strong>
            <span>{image.review_status.replaceAll("_", " ")}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
