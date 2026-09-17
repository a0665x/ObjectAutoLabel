import { describe, expect, it } from "vitest";

import { DEFAULT_REVIEW_FILTERS, getNextImageId } from "./reviewConfig";

describe("reviewConfig", () => {
  it("defaults the queue to all three dataset source groups", () => {
    expect(DEFAULT_REVIEW_FILTERS).toEqual({
      source_groups: ["pseudo", "augment", "open_data"],
      limit: 1_000_000
    });
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
