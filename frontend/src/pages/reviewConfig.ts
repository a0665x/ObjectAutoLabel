import type { ReviewStats, ReviewStatus } from "../api/client";

export const DEFAULT_REVIEW_FILTERS = { review_status: "pending_review" } as const;

export const REVIEW_QUEUE_TILES: Array<{ key: keyof ReviewStats; label: string; status?: ReviewStatus }> = [
  { key: "pending_review", label: "Pending review", status: "pending_review" },
  { key: "unreviewed", label: "Unreviewed", status: "unreviewed" },
  { key: "needs_fix", label: "Needs fix", status: "needs_fix" },
  { key: "reviewed", label: "Reviewed", status: "reviewed" },
  { key: "skipped", label: "Skipped", status: "skipped" },
  { key: "edited", label: "Edited" },
  { key: "low_confidence", label: "Low confidence" },
];

type QueueImage = {
  id: string;
  [key: string]: unknown;
};

export function getNextImageId(images: QueueImage[], currentImageId: string | null): string | null {
  if (images.length === 0) return null;
  if (!currentImageId) return images[0].id;
  const currentIndex = images.findIndex((image) => image.id === currentImageId);
  if (currentIndex < 0) return images[0].id;
  if (currentIndex >= images.length - 1) return images[currentIndex].id;
  return images[currentIndex + 1].id;
}
