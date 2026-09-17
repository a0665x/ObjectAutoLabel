export type ReviewTool = "select" | "draw" | "pan";

export type ReviewCommand = {
  id: string;
  group: "tools" | "selection" | "history" | "image" | "workflow";
  label: string;
  shortcut?: string;
  enabled: boolean;
  checked?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
};

export type ReviewCommandContext = {
  tool: ReviewTool;
  hasImage: boolean;
  imageReady?: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  removing?: boolean;
  handlers: {
    setTool: (tool: ReviewTool) => void;
    copy: () => void;
    paste: () => void;
    duplicate: () => void;
    delete: () => void;
    relabel: () => void;
    undo: () => void | Promise<void>;
    redo: () => void | Promise<void>;
    removeImage?: () => void | Promise<void>;
    cancel: () => void;
    save: () => void | Promise<void>;
    saveAndNext: () => void | Promise<void>;
  };
};

export type ReviewShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target" | "preventDefault"
>;

export function createReviewCommands(context: ReviewCommandContext): ReviewCommand[] {
  const { handlers } = context;
  const locked = Boolean(context.removing);
  const imageReady = context.imageReady ?? context.hasImage;
  return [
    { id: "tool-select", group: "tools", label: "Select / Drag", shortcut: "D", enabled: context.hasImage && !locked, checked: context.tool === "select", run: () => handlers.setTool("select") },
    { id: "tool-draw", group: "tools", label: "Draw Box", shortcut: "B", enabled: context.hasImage && !locked, checked: context.tool === "draw", run: () => handlers.setTool("draw") },
    { id: "tool-pan", group: "tools", label: "Pan", shortcut: "H", enabled: context.hasImage && !locked, checked: context.tool === "pan", run: () => handlers.setTool("pan") },
    { id: "copy", group: "selection", label: "Copy", shortcut: "Ctrl/Cmd + C", enabled: context.hasSelection && !locked, run: handlers.copy },
    { id: "paste", group: "selection", label: "Paste", shortcut: "Ctrl/Cmd + V", enabled: context.hasImage && context.hasClipboard && !locked, run: handlers.paste },
    { id: "duplicate", group: "selection", label: "Duplicate", shortcut: "Ctrl/Cmd + D", enabled: context.hasSelection && !locked, run: handlers.duplicate },
    { id: "delete", group: "selection", label: "Delete", shortcut: "Delete / Backspace", enabled: context.hasSelection && !locked, danger: true, run: handlers.delete },
    { id: "relabel", group: "selection", label: "Relabel", enabled: context.hasSelection && !locked, run: handlers.relabel },
    { id: "undo", group: "history", label: "Undo", shortcut: "Ctrl/Cmd + Z", enabled: context.canUndo && !locked, run: handlers.undo },
    { id: "redo", group: "history", label: "Redo", shortcut: "Ctrl/Cmd + Shift + Z", enabled: context.canRedo && !locked, run: handlers.redo },
    { id: "remove-image", group: "image", label: "Remove Image From Project", shortcut: "Shift + X", enabled: context.hasImage && imageReady && !context.saving && !locked, danger: true, run: () => handlers.removeImage?.() },
    { id: "save", group: "workflow", label: "Save", shortcut: "Ctrl/Cmd + S", enabled: context.hasImage && !context.saving && !locked, run: handlers.save },
    { id: "save-next", group: "workflow", label: "Save & Next", shortcut: "N / Shift + S", enabled: context.hasImage && !context.saving && !locked, run: handlers.saveAndNext },
    { id: "cancel", group: "selection", label: "Cancel / Deselect", shortcut: "Escape", enabled: true, run: handlers.cancel }
  ];
}

export function getReviewCommand(commands: ReviewCommand[], id: string): ReviewCommand {
  const command = commands.find((item) => item.id === id);
  if (!command) throw new Error(`Missing Review command: ${id}`);
  return command;
}

export function isReviewEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'))
  );
}

function commandIdForShortcut(event: ReviewShortcutEvent): string | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (mod) {
    if (event.shiftKey && key === "z") return "redo";
    if (event.shiftKey) return null;
    switch (key) {
      case "c": return "copy";
      case "v": return "paste";
      case "d": return "duplicate";
      case "z": return "undo";
      case "s": return "save";
      default: return null;
    }
  }

  if (event.shiftKey) {
    if (key === "s") return "save-next";
    if (key === "x") return "remove-image";
    return null;
  }

  switch (key) {
    case "d": return "tool-select";
    case "b": return "tool-draw";
    case "h": return "tool-pan";
    case "n": return "save-next";
    case "delete":
    case "backspace": return "delete";
    case "escape": return "cancel";
    default: return null;
  }
}

export function dispatchReviewShortcut(event: ReviewShortcutEvent, commands: ReviewCommand[]): boolean {
  if (isReviewEditableTarget(event.target)) return false;
  const commandId = commandIdForShortcut(event);
  if (!commandId) return false;
  const command = commands.find((item) => item.id === commandId);
  if (!command?.enabled) return false;
  event.preventDefault();
  void command.run();
  return true;
}
