import { describe, expect, it } from "vitest";

import { DEFAULT_REVIEW_FILTERS, REVIEW_QUEUE_TILES, getNextImageId } from "./reviewConfig";

describe("reviewConfig", () => {
  it("defaults the queue to pending review work", () => {
    expect(DEFAULT_REVIEW_FILTERS).toEqual({ review_status: "pending_review" });
  });

  it("surfaces the extra review queue tiles requested by the operator flow", () => {
    expect(REVIEW_QUEUE_TILES.map((tile) => tile.key)).toEqual([
      "pending_review",
      "unreviewed",
      "needs_fix",
      "reviewed",
      "skipped",
      "edited",
      "low_confidence"
    ]);
  });

  it("returns the next image id for save-and-next navigation", () => {
    expect(
      getNextImageId(
        [
          { id: "image-1", review_status: "pending_review" },
          { id: "image-2", review_status: "pending_review" },
          { id: "image-3", review_status: "reviewed" }
        ],
        "image-1"
      )
    ).toBe("image-2");
  });

  it("keeps the current image when already at the end of the queue", () => {
    expect(
      getNextImageId(
        [
          { id: "image-1", review_status: "pending_review" },
          { id: "image-2", review_status: "reviewed" }
        ],
        "image-2"
      )
    ).toBe("image-2");
  });
});
