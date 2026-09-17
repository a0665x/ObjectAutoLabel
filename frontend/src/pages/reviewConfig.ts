export const DEFAULT_REVIEW_FILTERS = { source_groups: ["pseudo", "augment", "open_data"] as Array<"pseudo" | "augment" | "open_data">, limit: 1_000_000 } as const;

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
