import type { ImageFilters, ReviewStats, ReviewStatus } from "../../api/client";
import type { ProjectImage, SourceAsset } from "../../types";

type ImageQueueProps = {
  images: ProjectImage[];
  activeImageId: string | null;
  filters: ImageFilters;
  stats: ReviewStats;
  sources: SourceAsset[];
  loading: boolean;
  onSelectImage: (id: string) => void;
  onFilterChange: (partial: Partial<ImageFilters>) => void;
};

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "pending_review", label: "Pending review" },
  { value: "needs_fix", label: "Needs fix" },
  { value: "reviewed", label: "Reviewed" },
  { value: "skipped", label: "Skipped" }
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
  onSelectImage,
  onFilterChange
}: ImageQueueProps) {
  return (
    <aside className="panel review-sidebar-section">
      <div className="sidebar-header">
        <div>
          <strong>Queue</strong>
          <p className="muted">{images.length} images in the current filter</p>
        </div>
      </div>

      <div className="review-stats-grid">
        <div className="stat-tile">
          <span>Unreviewed</span>
          <strong>{stats.unreviewed}</strong>
        </div>
        <div className="stat-tile">
          <span>Needs fix</span>
          <strong>{stats.needs_fix}</strong>
        </div>
        <div className="stat-tile">
          <span>Reviewed</span>
          <strong>{stats.reviewed}</strong>
        </div>
        <div className="stat-tile">
          <span>Low confidence</span>
          <strong>{stats.low_confidence}</strong>
        </div>
      </div>

      <div className="queue-filters">
        <label>
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
