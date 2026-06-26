import { describe, expect, it } from "vitest";

import { buildImageQuery } from "./client";

describe("buildImageQuery", () => {
  it("includes the review queue filters used by the workbench", () => {
    expect(
      buildImageQuery({
        review_status: "pending_review",
        has_low_confidence: true,
        source_asset_id: "source-1",
        limit: 25,
        offset: 50
      })
    ).toBe("?review_status=pending_review&has_low_confidence=true&source_asset_id=source-1&limit=25&offset=50");
  });

  it("omits empty filters", () => {
    expect(buildImageQuery({})).toBe("");
  });
});
