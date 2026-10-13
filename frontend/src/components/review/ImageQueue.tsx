import {useUiText} from '../../uiText';
import type { ImageFilters, ReviewStats } from "../../api/client";
import type { OpenDataImport, ProjectImage, SourceAsset } from "../../types";

type SourceGroup = "pseudo" | "augment" | "open_data";
type ImageQueueProps = { images: ProjectImage[]; activeImageId: string | null; filters: ImageFilters; stats: ReviewStats; sourceCounts?: Record<SourceGroup, number>; sourceVersions?:{pseudo:string|null;augment:string|null}; sources: SourceAsset[]; openDataImport?: OpenDataImport | null; loading: boolean; prefetching?: boolean; onSelectImage: (id: string) => void; onFilterChange: (partial: Partial<ImageFilters>) => void; };

export function confidenceRisk(image: ProjectImage): number | null {
  if (image.mean_confidence == null) return null;
  const mean = image.mean_confidence;
  const minimum = image.min_confidence ?? mean;
  const maximum = image.max_confidence ?? mean;
  const count = Math.max(1, image.annotation_count ?? 1);
  const lowRatio = (image.low_confidence_count ?? 0) / count;
  const sparsePenalty = 1 / Math.sqrt(count + 1);
  return .48 * (1 - mean) + .24 * (1 - minimum) + .14 * (maximum - minimum) + .1 * lowRatio + .04 * sparsePenalty;
}

export function confidenceLevels(images: ProjectImage[]): Map<string, number> {
  const scored = images.map((image) => ({ id: image.id, risk: confidenceRisk(image) })).filter((item): item is { id: string; risk: number } => item.risk != null).sort((a, b) => b.risk - a.risk);
  const levels = new Map<string, number>();
  const maximum = scored[0]?.risk ?? 0;
  const minimum = scored[scored.length - 1]?.risk ?? maximum;
  const range = maximum - minimum;
  scored.forEach((item) => levels.set(item.id, range < 1e-9 ? 3 : Math.min(5, 1 + Math.floor(((maximum - item.risk) / range) * 4.999999))));
  return levels;
}

const LABELS: Record<SourceGroup, string> = { pseudo: "Pseudo Label images", augment: "Augment images", open_data: "Open Sources" };
export function imageSourceGroup(image: ProjectImage): SourceGroup { return image.source_origin === "open_data" ? "open_data" : image.augmentation_run_id ? "augment" : "pseudo"; }

export function ImageQueue({ images, activeImageId, filters, stats, sourceCounts = { pseudo: 0, augment: 0, open_data: 0 }, sourceVersions, openDataImport, loading, prefetching = false, onSelectImage, onFilterChange }: ImageQueueProps) {
  const ui = useUiText();
  const selected = filters.source_groups ?? ["pseudo", "augment", "open_data"];
  const levels = confidenceLevels(images);
  const toggle = (group: SourceGroup) => { const next = selected.includes(group) ? selected.filter((item) => item !== group) : [...selected, group]; if (next.length) onFilterChange({ source_groups: next }); };
  return <section className="panel review-wide-section image-map-panel">
    <strong>{ui("Image map")}</strong>
    <p className="muted">{images.length} {ui("selected images")}{prefetching ? ui(" · preloading next boxes") : ""}</p>
    <p className="muted">{ui("Cell color is relative risk within this selection.")}</p>
    <div className="source-composition" role="group" aria-label={ui("Dataset composition")}>
      {(["pseudo", "augment", "open_data"] as SourceGroup[]).map((group) => {
        const name=group==='open_data'?openDataImport?.version_name:sourceVersions?.[group];
        const unavailable=group==='open_data'?!openDataImport:sourceVersions!==undefined&&!name;
        return <button type="button" key={group} aria-pressed={!unavailable&&selected.includes(group)} disabled={unavailable} onClick={() => toggle(group)}><span>{ui(LABELS[group])}{sourceVersions&&<small className="review-assigned-source">{name??ui('Assigned: {name}',{name:ui('None')})}</small>}</span><strong>{sourceCounts[group]}</strong></button>;
      })}
    </div>
    <div className="confidence-legend"><span>{ui("Needs attention")}</span>{[1,2,3,4,5].map((level) => <i key={level} className={`confidence-cell confidence-${level}`} />)}<span>{ui("Most consistent")}</span></div>
    <p className="muted">{ui("Ranking combines mean/min confidence, box spread, low-confidence ratio and box count. Gray has no model confidence.")}</p>
    {loading && <p className="muted">{ui("Loading queue...")}</p>}{prefetching && !loading && <p className="inline-feedback">{ui("Preloading next image boxes…")}</p>}{!loading && images.length === 0 && <p className="muted">{ui("No images in the selected sources.")}</p>}
    <div className="confidence-grid" role="group" aria-label={ui("Image confidence map")}>{images.map((image,index) => { const mean = image.mean_confidence == null ? ui("No model confidence") : ui("Mean {value}%", {value:(image.mean_confidence*100).toFixed(1)}); return <button key={image.id} type="button" className={`confidence-cell confidence-${levels.get(image.id) ?? 0}${image.id===activeImageId?" is-active":""}`} aria-label={ui("Image {v0} · {v1} · {v2}", {v0: index+1, v1: ui(LABELS[imageSourceGroup(image)]), v2: mean})} aria-pressed={image.id===activeImageId} title={ui("Image {v0} · {v1} · {v2} boxes", {v0: index+1, v1: mean, v2: image.annotation_count ?? 0})} onClick={() => onSelectImage(image.id)} />; })}</div>
  </section>;
}
