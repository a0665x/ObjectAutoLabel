// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationToolbar } from "./AnnotationToolbar";
import { createReviewCommands, type ReviewCommandContext } from "./reviewCommands";

afterEach(cleanup);

function renderToolbar(overrides: Partial<ReviewCommandContext> = {}) {
  const handlers: ReviewCommandContext["handlers"] = {
    setTool: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    relabel: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    saveAndNext: vi.fn()
  };
  const commands = createReviewCommands({
    tool: "pan",
    hasImage: true,
    hasSelection: false,
    hasClipboard: false,
    canUndo: false,
    canRedo: false,
    saving: false,
    handlers,
    ...overrides
  });

  render(
    <AnnotationToolbar
      mode="select"
      canGoPrev={false}
      canGoNext={false}
      dirty={false}
      saving={false}
      zoom={1}
      commands={commands}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onSave={vi.fn()}
      onSaveAndNext={vi.fn()}
      onMergeSameClass={vi.fn()}
      onFit={vi.fn()}
      onActualSize={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
    />
  );

  return { handlers };
}

describe("AnnotationToolbar shared commands", () => {
  it("derives checked tool state and clicks from the registry commands", () => {
    const { handlers } = renderToolbar();
    const toolGroup = screen.getByRole("tablist", { name: "Annotation tools" });
    const select = within(toolGroup).getByRole("button", { name: /Select/ });
    const draw = within(toolGroup).getByRole("button", { name: /Draw/ });
    const pan = within(toolGroup).getByRole("button", { name: /Pan/ });

    expect(select.getAttribute("aria-pressed")).toBe("false");
    expect(pan.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(draw);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Save & next$/i }));

    expect(handlers.setTool).toHaveBeenCalledWith("draw");
    expect(handlers.save).toHaveBeenCalledOnce();
    expect(handlers.saveAndNext).toHaveBeenCalledOnce();
  });

  it("visibly matches disabled no-image commands in the toolbar and Edit menu", () => {
    const { handlers } = renderToolbar({ hasImage: false });
    const toolGroup = screen.getByRole("tablist", { name: "Annotation tools" });

    for (const button of within(toolGroup).getAllByRole("button")) expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /^Save & next$/i }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("menuitem", { name: /Select \/ Drag/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /^Save Ctrl/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /^Save & Next/ }).hasAttribute("disabled")).toBe(true);
    expect(handlers.setTool).not.toHaveBeenCalled();
    expect(handlers.save).not.toHaveBeenCalled();
    expect(handlers.saveAndNext).not.toHaveBeenCalled();
  });

  it("visibly matches registry saving state even when the legacy prop differs", () => {
    const { handlers } = renderToolbar({ saving: true });

    expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /^Save & next$/i }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("menuitem", { name: /^Save Ctrl/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /^Save & Next/ }).hasAttribute("disabled")).toBe(true);
    expect(handlers.save).not.toHaveBeenCalled();
    expect(handlers.saveAndNext).not.toHaveBeenCalled();
  });
});
