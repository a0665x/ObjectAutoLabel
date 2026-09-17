import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import type { ReviewCommand } from "./reviewCommands";

type ReviewEditMenuProps = {
  commands: ReviewCommand[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const GROUPS: Array<{ id: ReviewCommand["group"]; label: string }> = [
  { id: "tools", label: "Tools" },
  { id: "selection", label: "Selection" },
  { id: "history", label: "History" },
  { id: "image", label: "Image" },
  { id: "workflow", label: "Workflow" }
];

export function ReviewEditMenu({ commands, open, onOpenChange }: ReviewEditMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const closeMenu = () => {
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (isOpen) {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (menu && trigger) {
        const triggerBounds = trigger.getBoundingClientRect();
        const menuBounds = menu.getBoundingClientRect();
        setMenuPosition({
          left: Math.max(8, Math.min(triggerBounds.right - menuBounds.width, window.innerWidth - menuBounds.width - 8)),
          top: Math.max(8, Math.min(triggerBounds.bottom + 8, window.innerHeight - menuBounds.height - 8))
        });
      }
      const firstEnabledItem = menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
      (firstEnabledItem ?? menu)?.focus();
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, onOpenChange, open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    const contain = (preventDefault = true) => {
      if (preventDefault) event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    };

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
      case "ArrowLeft":
      case "ArrowRight":
        contain();
        return;
      case " ":
        contain(false);
        return;
      case "Escape":
        contain();
        closeMenu();
        return;
      default:
        return;
    }

    contain();
    items[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="review-edit-menu-root">
      <button
        ref={triggerRef}
        type="button"
        className="secondary review-edit-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? closeMenu() : setOpen(true))}
      >
        <span>Edit</span>
        <ChevronDown size={14} />
      </button>
      {isOpen ? createPortal(
        <div
          ref={menuRef}
          className="review-edit-menu"
          role="menu"
          aria-label="Edit commands"
          tabIndex={-1}
          style={menuPosition}
          onKeyDown={handleMenuKeyDown}
        >
          {GROUPS.map((group) => {
            const items = commands.filter((command) => command.group === group.id && command.id !== "cancel");
            if (!items.length) return null;
            return (
              <section key={group.id} className="review-edit-menu-group">
                <h3>{group.label}</h3>
                {items.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    aria-checked={command.checked === undefined ? undefined : command.checked}
                    className={command.danger ? "danger" : undefined}
                    disabled={!command.enabled}
                    onClick={() => {
                      if (!command.enabled) return;
                      void command.run();
                      closeMenu();
                    }}
                  >
                    <span className="review-edit-command-label">
                      {command.checked ? <Check size={14} aria-hidden="true" /> : null}
                      {command.label}
                    </span>
                    {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                  </button>
                ))}
              </section>
            );
          })}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
