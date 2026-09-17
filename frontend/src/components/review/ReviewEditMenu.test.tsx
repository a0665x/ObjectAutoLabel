// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReviewCommands, type ReviewCommandContext } from "./reviewCommands";
import { ReviewEditMenu } from "./ReviewEditMenu";

afterEach(cleanup);

function renderMenu(overrides: Partial<ReviewCommandContext> = {}) {
  const handlers: ReviewCommandContext["handlers"] = {
    setTool: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
    relabel: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    removeImage: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    saveAndNext: vi.fn()
  };
  const commands = createReviewCommands({
    tool: "draw",
    hasImage: true,
    hasSelection: false,
    hasClipboard: true,
    canUndo: true,
    canRedo: false,
    saving: false,
    handlers,
    ...overrides
  });
  render(<ReviewEditMenu commands={commands} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  return { commands, handlers };
}

describe("ReviewEditMenu", () => {
  it("renders the open menu in the document overlay layer so the review canvas cannot cover it", () => {
    renderMenu();

    const menu = screen.getByRole("menu", { name: "Edit commands" });
    expect(menu.parentElement).toBe(document.body);
    expect(menu.closest(".review-toolbar")).toBeNull();
  });

  it("renders approved groups in order with command parity", () => {
    const { commands } = renderMenu();
    const menu = screen.getByRole("menu", { name: "Edit commands" });
    const visibleCommands = commands.filter((command) => command.id !== "cancel");

    expect(within(menu).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Tools",
      "Selection",
      "History",
      "Image",
      "Workflow"
    ]);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.replace("✓", "").trim())).toEqual(
      visibleCommands.map((command) => `${command.label}${command.shortcut ?? ""}`)
    );
    expect(screen.getByRole("menuitem", { name: /Draw Box/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /Duplicate/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Paste/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("menuitem", { name: /Redo/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Remove Image From Project/ }).hasAttribute("disabled")).toBe(false);
  });

  it("runs the same command handler and closes after an enabled item is chosen", () => {
    const { handlers } = renderMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));

    expect(handlers.paste).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "Edit commands" })).toBeNull();
  });

  it("focuses and navigates enabled items without leaking menu keys to page shortcuts", () => {
    const pageKeyDown = vi.fn();
    window.addEventListener("keydown", pageKeyDown);

    try {
      renderMenu({
        hasImage: false,
        hasSelection: false,
        hasClipboard: false,
        canUndo: true,
        canRedo: true,
        saving: true
      });
      const trigger = screen.getByRole("button", { name: "Edit" });
      const menu = screen.getByRole("menu", { name: "Edit commands" });
      const undo = screen.getByRole("menuitem", { name: /Undo/ });
      const redo = screen.getByRole("menuitem", { name: /Redo/ });

      expect(document.activeElement).toBe(undo);

      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(redo);
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(undo);
      fireEvent.keyDown(menu, { key: "ArrowUp" });
      expect(document.activeElement).toBe(redo);
      fireEvent.keyDown(menu, { key: "Home" });
      expect(document.activeElement).toBe(undo);
      fireEvent.keyDown(menu, { key: "End" });
      expect(document.activeElement).toBe(redo);
      fireEvent.keyDown(menu, { key: "ArrowLeft" });
      fireEvent.keyDown(menu, { key: "ArrowRight" });
      const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      fireEvent(redo, space);
      expect(space.defaultPrevented).toBe(false);
      fireEvent.keyDown(menu, { key: "Escape" });

      expect(screen.queryByRole("menu", { name: "Edit commands" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(pageKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageKeyDown);
    }
  });

  it("focuses the menu fallback and closes on Escape when every command is disabled", () => {
    const pageKeyDown = vi.fn();
    window.addEventListener("keydown", pageKeyDown);

    try {
      renderMenu({
        hasImage: false,
        hasSelection: false,
        hasClipboard: false,
        canUndo: false,
        canRedo: false,
        saving: true
      });
      const trigger = screen.getByRole("button", { name: "Edit" });
      const menu = screen.getByRole("menu", { name: "Edit commands" });

      expect(document.activeElement).toBe(menu);
      fireEvent.keyDown(menu, { key: "Escape" });

      expect(screen.queryByRole("menu", { name: "Edit commands" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(pageKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageKeyDown);
    }
  });

  it("restores trigger focus when a controlled parent closes the menu", () => {
    const { commands } = renderMenu();
    cleanup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<ReviewEditMenu commands={commands} open onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Edit" });

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Select \/ Drag/ }));
    rerender(<ReviewEditMenu commands={commands} open={false} onOpenChange={onOpenChange} />);

    expect(document.activeElement).toBe(trigger);
  });
});
