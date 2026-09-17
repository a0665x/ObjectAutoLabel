// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  createReviewCommands,
  dispatchReviewShortcut,
  type ReviewCommandContext,
  type ReviewTool
} from "./reviewCommands";

function commandContext(overrides: Partial<ReviewCommandContext> = {}) {
  const handlers = {
    setTool: vi.fn<(tool: ReviewTool) => void>(),
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
  const context: ReviewCommandContext = {
    tool: "select",
    hasImage: true,
    hasSelection: true,
    hasClipboard: true,
    canUndo: true,
    canRedo: true,
    saving: false,
    handlers,
    ...overrides
  };
  return { context, handlers, commands: createReviewCommands(context) };
}

function keyEvent(
  key: string,
  overrides: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">> = {}
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: window,
    preventDefault: vi.fn(),
    ...overrides
  };
}

describe("review command registry", () => {
  it.each([
    ["d", "select"],
    ["B", "draw"],
    ["h", "pan"]
  ] as const)("dispatches %s through the persistent %s tool command", (key, tool) => {
    const { commands, handlers } = commandContext();
    const event = keyEvent(key);

    expect(dispatchReviewShortcut(event, commands)).toBe(true);
    expect(handlers.setTool).toHaveBeenCalledWith(tool);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    ["c", "copy"],
    ["v", "paste"],
    ["d", "duplicate"],
    ["z", "undo"]
  ] as const)("dispatches Ctrl/Cmd+%s through the %s command", (key, handler) => {
    const { commands, handlers } = commandContext();
    const event = keyEvent(key, { ctrlKey: true });

    expect(dispatchReviewShortcut(event, commands)).toBe(true);
    expect(handlers[handler]).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("dispatches Delete, Escape, and Ctrl/Cmd+Shift+Z through their commands", () => {
    const { commands, handlers } = commandContext();

    expect(dispatchReviewShortcut(keyEvent("Backspace"), commands)).toBe(true);
    expect(dispatchReviewShortcut(keyEvent("Escape"), commands)).toBe(true);
    expect(dispatchReviewShortcut(keyEvent("Z", { metaKey: true, shiftKey: true }), commands)).toBe(true);

    expect(handlers.delete).toHaveBeenCalledOnce();
    expect(handlers.cancel).toHaveBeenCalledOnce();
    expect(handlers.redo).toHaveBeenCalledOnce();
  });

  it.each([keyEvent("n"), keyEvent("S", { shiftKey: true })])("dispatches Save & Next through N and Shift+S", (event) => {
    const { commands, handlers } = commandContext();
    expect(dispatchReviewShortcut(event, commands)).toBe(true);
    expect(handlers.saveAndNext).toHaveBeenCalledOnce();
  });

  it("does not own disabled commands or shortcuts originating in editable controls", () => {
    const input = document.createElement("input");
    const { commands, handlers } = commandContext({ hasSelection: false, hasClipboard: false });
    const disabledDuplicate = keyEvent("d", { ctrlKey: true });
    const editableDraw = keyEvent("b", { target: input });

    expect(dispatchReviewShortcut(disabledDuplicate, commands)).toBe(false);
    expect(dispatchReviewShortcut(editableDraw, commands)).toBe(false);
    expect(disabledDuplicate.preventDefault).not.toHaveBeenCalled();
    expect(editableDraw.preventDefault).not.toHaveBeenCalled();
    expect(handlers.duplicate).not.toHaveBeenCalled();
    expect(handlers.setTool).not.toHaveBeenCalled();
  });

  it("defines the approved command order, labels, shortcuts, checks, and removal handler", () => {
    const { commands, handlers } = commandContext();

    expect(commands.map(({ id, group, label, shortcut }) => ({ id, group, label, shortcut }))).toEqual([
      { id: "tool-select", group: "tools", label: "Select / Drag", shortcut: "D" },
      { id: "tool-draw", group: "tools", label: "Draw Box", shortcut: "B" },
      { id: "tool-pan", group: "tools", label: "Pan", shortcut: "H" },
      { id: "copy", group: "selection", label: "Copy", shortcut: "Ctrl/Cmd + C" },
      { id: "paste", group: "selection", label: "Paste", shortcut: "Ctrl/Cmd + V" },
      { id: "duplicate", group: "selection", label: "Duplicate", shortcut: "Ctrl/Cmd + D" },
      { id: "delete", group: "selection", label: "Delete", shortcut: "Delete / Backspace" },
      { id: "relabel", group: "selection", label: "Relabel", shortcut: undefined },
      { id: "undo", group: "history", label: "Undo", shortcut: "Ctrl/Cmd + Z" },
      { id: "redo", group: "history", label: "Redo", shortcut: "Ctrl/Cmd + Shift + Z" },
      { id: "remove-image", group: "image", label: "Remove Image From Project", shortcut: "Shift + X" },
      { id: "save", group: "workflow", label: "Save", shortcut: "Ctrl/Cmd + S" },
      { id: "save-next", group: "workflow", label: "Save & Next", shortcut: "N / Shift + S" },
      { id: "cancel", group: "selection", label: "Cancel / Deselect", shortcut: "Escape" }
    ]);
    expect(commands.find((command) => command.id === "tool-select")?.checked).toBe(true);
    const removeImage = commands.find((command) => command.id === "remove-image");
    expect(removeImage?.enabled).toBe(true);
    void removeImage?.run();
    expect(handlers.removeImage).toHaveBeenCalledOnce();
  });

  it("disables image removal without an image and while saving or removing", () => {
    expect(commandContext({ hasImage: false }).commands.find((command) => command.id === "remove-image")?.enabled).toBe(false);
    expect(commandContext({ saving: true }).commands.find((command) => command.id === "remove-image")?.enabled).toBe(false);
    expect(commandContext({ removing: true }).commands.find((command) => command.id === "remove-image")?.enabled).toBe(false);
  });

  it("disables image removal until the active image annotations are ready", () => {
    const notReady = { imageReady: false } as unknown as Partial<ReviewCommandContext>;
    expect(commandContext(notReady).commands.find((command) => command.id === "remove-image")?.enabled).toBe(false);
  });

  it("disables every mutating and history command while removal or restore is busy", () => {
    const { commands } = commandContext({ removing: true });
    const lockedIds = [
      "tool-select",
      "tool-draw",
      "tool-pan",
      "paste",
      "duplicate",
      "delete",
      "relabel",
      "undo",
      "redo",
      "remove-image",
      "save",
      "save-next"
    ];

    expect(commands.filter((command) => lockedIds.includes(command.id)).every((command) => !command.enabled)).toBe(true);
  });
});
