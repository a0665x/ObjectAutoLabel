// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation, ClassItem } from "../../types";
import { AnnotationContextMenu } from "./AnnotationContextMenu";
import type { ReviewCommand } from "./reviewCommands";

const classes: ClassItem[] = [
  { class_id: 0, class_name: "car", descriptors: ["car"] },
  { class_id: 1, class_name: "person", descriptors: ["person"] }
];

const annotation: Annotation = {
  id: "box-1",
  class_id: 0,
  class_name: "car",
  x_center: 0.5,
  y_center: 0.5,
  width: 0.2,
  height: 0.2,
  confidence: 0.42,
  source_descriptor: "red sedan",
  source_type: "pseudo",
  edited: false
};

afterEach(cleanup);

function renderMenu(annotations = [annotation], ids = [annotation.id]) {
  const command = (id: string, label: string, run: () => void, danger = false): ReviewCommand => ({
    id,
    group: "selection",
    label,
    enabled: true,
    danger,
    run
  });
  const callbacks = {
    onRelabelClass: vi.fn(),
    onZoom: vi.fn(),
    onClose: vi.fn()
  };
  const commandRuns = { duplicate: vi.fn(), delete: vi.fn(), relabel: vi.fn() };
  render(
    <AnnotationContextMenu
      point={{ x: 100, y: 100 }}
      annotations={annotations}
      ids={ids}
      classes={classes}
      commands={{
        duplicate: command("duplicate", "Duplicate", commandRuns.duplicate),
        delete: command("delete", "Delete", commandRuns.delete, true),
        relabel: command("relabel", "Relabel", commandRuns.relabel)
      }}
      {...callbacks}
    />
  );
  return { ...callbacks, commandRuns };
}

describe("AnnotationContextMenu", () => {
  it("portals the viewport-positioned menu directly to the document body", () => {
    const callbacks = {
      onRelabelClass: vi.fn(),
      onZoom: vi.fn(),
      onClose: vi.fn()
    };
    const command = (id: string, label: string): ReviewCommand => ({ id, group: "selection", label, enabled: true, run: vi.fn() });
    const { container } = render(
      <div className="filtered-review-panel">
        <AnnotationContextMenu
          point={{ x: 320, y: 180 }}
          annotations={[annotation]}
          ids={[annotation.id]}
          classes={classes}
          commands={{
            duplicate: command("duplicate", "Duplicate"),
            delete: { ...command("delete", "Delete"), danger: true },
            relabel: command("relabel", "Relabel")
          }}
          {...callbacks}
        />
      </div>
    );

    const menu = screen.getByRole("menu");
    expect(container.querySelector(".review-context-menu")).toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe("320px");
    expect(menu.style.top).toBe("180px");
  });

  it("shows labeling metadata and actions for one box", () => {
    renderMenu();

    expect(screen.getByText("1 box selected")).toBeTruthy();
    expect(screen.getByText("Confidence 42.0%")).toBeTruthy();
    expect(screen.getByText("Source pseudo")).toBeTruthy();
    expect(screen.getByText("Descriptor red sedan")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Duplicate/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Zoom to selection" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeTruthy();
  });

  it("identifies mixed classes for multiple boxes", () => {
    renderMenu([annotation, { ...annotation, id: "box-2", class_id: 1, class_name: "person" }], ["box-1", "box-2"]);

    expect(screen.getByText("2 boxes selected")).toBeTruthy();
    expect(screen.getByText("Mixed classes")).toBeTruthy();
  });

  it("closes on Escape and outside pointer down", () => {
    const callbacks = renderMenu();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
  });

  it("focuses its first action, supports menu navigation, and restores focus when closed", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const callbacks = renderMenu();
    const menu = screen.getByRole("menu");
    const classAction = screen.getByRole("menuitem", { name: /ID 0/ });
    const deleteAction = screen.getByRole("menuitem", { name: /Delete/ });

    expect(document.activeElement).toBe(classAction);

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(deleteAction);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(classAction);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /ID 1/ }));
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("runs the shared duplicate/delete commands and the shared relabel mutation path", () => {
    const callbacks = renderMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Duplicate/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /ID 1/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));

    expect(callbacks.commandRuns.duplicate).toHaveBeenCalledOnce();
    expect(callbacks.onRelabelClass).toHaveBeenCalledWith(classes[1]);
    expect(callbacks.commandRuns.delete).toHaveBeenCalledOnce();
  });
});
