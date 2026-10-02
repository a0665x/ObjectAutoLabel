import {useUiText} from '../../uiText';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Focus, Trash2 } from "lucide-react";

import type { Annotation, ClassItem } from "../../types";
import type { ReviewCommand } from "./reviewCommands";

type AnnotationContextMenuProps = {
  point: { x: number; y: number };
  annotations: Annotation[];
  ids: string[];
  classes: ClassItem[];
  commands: {
    duplicate: ReviewCommand;
    delete: ReviewCommand;
    relabel: ReviewCommand;
    cancel?: ReviewCommand;
  };
  onRelabelClass: (item: ClassItem) => void;
  onZoom: () => void;
  onClose: () => void;
};

export function AnnotationContextMenu({
  point,
  annotations,
  ids,
  classes,
  commands,
  onRelabelClass,
  onZoom,
  onClose
}: AnnotationContextMenuProps) {
  const ui = useUiText();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const [position, setPosition] = useState(point);
  const selected = useMemo(() => {
    const wanted = new Set(ids);
    return annotations.filter((annotation) => wanted.has(annotation.id));
  }, [annotations, ids]);
  const classNames = new Set(selected.map((annotation) => annotation.class_name));
  const single = selected.length === 1 ? selected[0] : null;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(point.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - bounds.height - 8))
    });
  }, [point]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    return () => {
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (commands.cancel) return;
      const target = event.target;
      if (event.key !== "Escape" || (target instanceof Node && menuRef.current?.contains(target))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commands.cancel, onClose]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = index < 0 || index === items.length - 1 ? 0 : index + 1;
        break;
      case "ArrowUp":
        nextIndex = index <= 0 ? items.length - 1 : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (commands.cancel?.enabled) void commands.cancel.run();
        else onClose();
        return;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    items[nextIndex]?.focus();
  };

  if (!selected.length) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="review-context-menu"
      role="menu"
      aria-label={ui("Annotation actions")}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      <strong>{ui(selected.length === 1 ? "{count} box selected" : "{count} boxes selected", {count:selected.length})}</strong>
      <div className="context-menu-metadata">
        <span>{classNames.size === 1 ? ui("Class {v0}", {v0: selected[0].class_name}) : ui("Mixed classes")}</span>
        {single?.confidence != null ? <span>{ui("Confidence")} {(single.confidence * 100).toFixed(1)}%</span> : null}
        {single ? <span>{ui("Source")} {ui(single.source_type)}</span> : null}
        {single?.source_descriptor ? <span>{ui("Descriptor")} {single.source_descriptor}</span> : null}
      </div>
      <strong>{ui("Change class")}</strong>
      <div className="context-menu-classes">
        {classes.map((item, index) => (
          <button
            key={item.class_id}
            type="button"
            role="menuitem"
            disabled={!commands.relabel.enabled}
            onClick={() => onRelabelClass(item)}
          >
            <span>ID {item.class_id} · {item.class_name}{classNames.size === 1 && selected[0].class_id === item.class_id ? " ✓" : ""}</span>
            {index < 9 ? <kbd>{ui("Key")} {index + 1}</kbd> : null}
          </button>
        ))}
      </div>
      <button type="button" role="menuitem" aria-label={ui("Duplicate selected")} disabled={!commands.duplicate.enabled} onClick={() => void commands.duplicate.run()}>
        <Copy size={15} /><span>{ui(commands.duplicate.label)}</span>{commands.duplicate.shortcut ? <kbd>{commands.duplicate.shortcut}</kbd> : null}
      </button>
      <button type="button" role="menuitem" onClick={onZoom}><Focus size={15} />{ui("Zoom to selection")}</button>
      <button
        type="button"
        role="menuitem"
        aria-label={ui("Delete selected")}
        className={commands.delete.danger ? "danger" : undefined}
        disabled={!commands.delete.enabled}
        onClick={() => void commands.delete.run()}
      >
        <Trash2 size={15} /><span>{ui(commands.delete.label)}</span>{commands.delete.shortcut ? <kbd>{commands.delete.shortcut}</kbd> : null}
      </button>
    </div>,
    document.body
  );
}
