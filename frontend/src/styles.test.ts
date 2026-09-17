import { describe, expect, it } from "vitest";

// @ts-expect-error Node's test runner provides this built-in without frontend typings.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("responsive layout CSS", () => {
  it("prevents native selection on annotation overlays and their labels", () => {
    expect(css).toMatch(/\.annotation-overlay,\s*\.annotation-overlay text\s*\{[^}]*user-select:\s*none;[^}]*-webkit-user-select:\s*none;/m);
  });

  it("allows the Review sidebar to shrink inside its grid column", () => {
    expect(css).toMatch(/\.review-sidebar,[^}]*min-width:\s*0;/m);
    expect(css).toMatch(/\.review-main,\s*\.review-sidebar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/m);
    expect(css).toMatch(/\.review-sidebar-section\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/m);
  });

  it("allows panels and source paths to shrink at narrow widths", () => {
    expect(css).toMatch(/\.panel,\s*\.list-panel\s*\{[^}]*min-width:\s*0;/m);
    expect(css).toMatch(/\.panel,\s*\.list-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/m);
    expect(css).toMatch(/\.row-card span\s*\{[^}]*overflow-wrap:\s*anywhere;/m);
    expect(css).toMatch(/\.sidebar-header\s*>\s*div\s*\{[^}]*min-width:\s*0;/m);
    expect(css).toMatch(/\.sidebar-header strong,\s*\.sidebar-header p\s*\{[^}]*overflow-wrap:\s*anywhere;/m);
    expect(css).toMatch(/\.help-tooltip-card\s*\{[^}]*display:\s*none;/m);
  });

  it("wraps long active-project names in the responsive top bar", () => {
    expect(css).toMatch(/\.topbar h1\s*\{[^}]*overflow-wrap:\s*anywhere;/m);
  });

  it("keeps navigation and form controls at 44px touch targets", () => {
    expect(css).toMatch(/\.nav button\s*\{[^}]*min-height:\s*44px;/m);
    expect(css).toMatch(/input, select, textarea\s*\{[^}]*min-height:\s*44px;/m);
    expect(css).toMatch(/\.annotation-select\s*\{[^}]*min-height:\s*44px;/m);
    expect(css).toMatch(/\.annotation-item-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+44px;/m);
  });

  it("uses the option-C toolbar breakpoint and preserves intrinsic panel actions", () => {
    expect(css).toMatch(/@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.toolbar-primary-row,\s*\.toolbar-secondary-row\s*\{[^}]*flex-direction:\s*column;/m);
    expect(css).toMatch(/@media \(max-width:\s*480px\)\s*\{[\s\S]*?\.panel\s*>\s*\.intrinsic-action,[\s\S]*?width:\s*100%;/m);
    expect(css).toMatch(/\.panel\s*>\s*\.primary,[\s\S]*?width:\s*fit-content;/m);
    expect(css).toMatch(/\.panel\s*>\s*\.intrinsic-action,[\s\S]*?min-width:\s*160px;[\s\S]*?max-width:\s*100%;/m);
  });

  it("contains Open Data tables and mapping lanes in the built-in mobile preview", () => {
    expect(css).toMatch(/\.app-shell\.viewport-mobile \.open-data-table\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/m);
    expect(css).toMatch(/\.app-shell\.viewport-mobile \.platform-dataset-row,\s*\.app-shell\.viewport-mobile \.mapping-board\s*\{[^}]*grid-template-columns:\s*1fr;/m);
  });
});
