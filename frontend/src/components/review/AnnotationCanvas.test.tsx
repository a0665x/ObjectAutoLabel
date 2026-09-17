// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation, ClassItem, ProjectImage } from "../../types";
import { AnnotationCanvas } from "./AnnotationCanvas";
import type { CanvasViewportApi } from "./AnnotationCanvas";

const image: ProjectImage = {
  id: "image-1",
  project_id: "project-1",
  path: "/tmp/image.jpg",
  width: 1000,
  height: 500,
  review_status: "pending_review"
};

const selectedClass: ClassItem = { class_id: 0, class_name: "car", descriptors: ["car"] };
const annotation: Annotation = {
  id: "box-1",
  class_id: 0,
  class_name: "car",
  x_center: 0.5,
  y_center: 0.5,
  width: 0.2,
  height: 0.2,
  confidence: 0.9,
  source_descriptor: "car",
  source_type: "pseudo",
  edited: false
};

beforeAll(() => {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: MockPointerEvent, configurable: true });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", { value: vi.fn(), configurable: true });
  Object.defineProperty(SVGElement.prototype, "hasPointerCapture", { value: vi.fn(() => true), configurable: true });
  Object.defineProperty(SVGElement.prototype, "releasePointerCapture", { value: vi.fn(), configurable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCanvas(overrides: Partial<React.ComponentProps<typeof AnnotationCanvas>> = {}) {
  const onZoomChange = vi.fn();
  const onSelectMany = vi.fn();
  const onChange = vi.fn();
  const props: React.ComponentProps<typeof AnnotationCanvas> = {
    image,
    annotations: [annotation],
    selectedId: null,
    selectedIds: [],
    selectedClass,
    mode: "select",
    onChange,
    onSelect: vi.fn(),
    onSelectMany,
    onZoomChange,
    ...overrides
  };
  const result = render(
    <AnnotationCanvas {...props} />
  );
  const scroller = result.container.querySelector(".annotation-canvas-shell") as HTMLDivElement;
  const svg = result.container.querySelector("svg") as SVGSVGElement;
  Object.defineProperties(scroller, {
    clientWidth: { value: 500, configurable: true },
    clientHeight: { value: 300, configurable: true }
  });
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true
  });
  return {
    ...result,
    scroller,
    svg,
    onChange,
    onZoomChange,
    onSelectMany,
    rerenderCanvas: (nextOverrides: Partial<React.ComponentProps<typeof AnnotationCanvas>>) =>
      result.rerender(<AnnotationCanvas {...props} {...nextOverrides} />)
  };
}

function queueAnimationFrames() {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  return {
    ids: () => [...frames.keys()],
    flush: (id: number) => {
      const callback = frames.get(id);
      if (!callback) return;
      frames.delete(id);
      callback(0);
    }
  };
}

function directPreviewRects(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.children).filter((element): element is SVGRectElement => element.tagName.toLowerCase() === "rect");
}

describe("AnnotationCanvas viewport interactions", () => {
  it("keeps the review canvas ancestors width-constrained so zoom creates a scrollable viewport", () => {
    const { scroller } = renderCanvas();

    expect(scroller.style.width).toBe("100%");
    expect(scroller.style.maxWidth).toBe("100%");
    expect(scroller.style.minWidth).toBe("0");
  });

  it("uses Ctrl+wheel to zoom and prevents browser zoom", () => {
    const { svg, scroller, onZoomChange } = renderCanvas();
    const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true });

    fireEvent(scroller, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onZoomChange).toHaveBeenLastCalledWith(1.2);
    const media = svg.closest(".annotation-canvas-media") as HTMLElement;
    expect(media.style.width).toBe("1200px");
    expect(media.style.height).toBe("600px");
    expect(media.style.maxWidth).toBe("none");
  });

  it("uses Cmd+wheel to zoom and prevents browser zoom", () => {
    const { scroller, onZoomChange } = renderCanvas();
    const event = new WheelEvent("wheel", { metaKey: true, deltaY: -100, bubbles: true, cancelable: true });

    fireEvent(scroller, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onZoomChange).toHaveBeenLastCalledWith(1.2);
  });

  it("keeps the pointer image coordinate anchored when Ctrl+wheel starts from Fit", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const viewportApiRef = { current: null as CanvasViewportApi | null };
    const { scroller, svg, onZoomChange } = renderCanvas({ viewportApiRef });
    let scrollLeft = 0;
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => {
          const media = scroller.querySelector(".annotation-canvas-media") as HTMLElement;
          const max = Math.max(0, Number.parseFloat(media.style.width) - scroller.clientWidth);
          scrollLeft = Math.min(Math.max(0, value), max);
        }
      },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          const media = scroller.querySelector(".annotation-canvas-media") as HTMLElement;
          const max = Math.max(0, Number.parseFloat(media.style.height) - scroller.clientHeight);
          scrollTop = Math.min(Math.max(0, value), max);
        }
      }
    });

    act(() => viewportApiRef.current?.fit());
    fireEvent(
      scroller,
      new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true })
    );

    expect(onZoomChange).toHaveBeenLastCalledWith(0.6);
    expect(scrollLeft).toBe(50);
    expect(scrollTop).toBe(0);
    const media = svg.closest(".annotation-canvas-media") as HTMLElement;
    expect(media.style.width).toBe("600px");
    expect(media.style.height).toBe("300px");
  });

  it("does not let a pending Fit frame overwrite a newer pointer-anchored Ctrl+wheel zoom", () => {
    const viewportApiRef = { current: null as CanvasViewportApi | null };
    const { scroller } = renderCanvas({ viewportApiRef });
    const frames = queueAnimationFrames();

    act(() => viewportApiRef.current?.fit());
    const [fitFrame] = frames.ids();
    fireEvent(
      scroller,
      new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true })
    );
    frames.flush(fitFrame!);

    expect(scroller.scrollLeft).toBe(50);
  });

  it("does not apply a pending Fit frame after the image changes", () => {
    const viewportApiRef = { current: null as CanvasViewportApi | null };
    const { rerenderCanvas, scroller } = renderCanvas({ viewportApiRef });
    const frames = queueAnimationFrames();

    act(() => viewportApiRef.current?.fit());
    const [fitFrame] = frames.ids();
    scroller.scrollLeft = 123;
    act(() => rerenderCanvas({ image: { ...image, id: "image-2", path: "/tmp/image-2.jpg" } }));
    frames.flush(fitFrame!);

    expect(scroller.scrollLeft).toBe(123);
  });

  it("does not apply a pending Fit frame after unmount", () => {
    const viewportApiRef = { current: null as CanvasViewportApi | null };
    const { scroller, unmount } = renderCanvas({ viewportApiRef });
    const frames = queueAnimationFrames();

    act(() => viewportApiRef.current?.fit());
    const [fitFrame] = frames.ids();
    scroller.scrollLeft = 123;
    unmount();
    frames.flush(fitFrame!);

    expect(scroller.scrollLeft).toBe(123);
  });

  it("applies the current queued zoom-to-selection frame", () => {
    const viewportApiRef = { current: null as CanvasViewportApi | null };
    const { scroller } = renderCanvas({ viewportApiRef });
    const frames = queueAnimationFrames();

    act(() => viewportApiRef.current?.zoomToAnnotationIds([annotation.id]));
    const [selectionFrame] = frames.ids();
    frames.flush(selectionFrame!);

    expect(scroller.scrollLeft).toBeCloseTo(583.3333333333334);
    expect(scroller.scrollTop).toBeCloseTo(266.6666666666667);
  });

  it("does not consume an ordinary wheel", () => {
    const { scroller } = renderCanvas();
    const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });

    fireEvent(scroller, event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("uses the middle button to pan in select mode", () => {
    const { svg, scroller, onSelectMany } = renderCanvas();

    fireEvent.pointerDown(svg, { button: 1, pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 150, clientY: 80 });

    expect(scroller.scrollLeft).toBe(50);
    expect(scroller.scrollTop).toBe(20);
    expect(onSelectMany).not.toHaveBeenCalled();
  });

  it("uses Space+left drag to pan without changing modes", () => {
    const { svg, scroller, onSelectMany } = renderCanvas();

    fireEvent.keyDown(window, { code: "Space", key: " " });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 175, clientY: 90 });
    fireEvent.keyUp(window, { code: "Space", key: " " });

    expect(scroller.scrollLeft).toBe(25);
    expect(scroller.scrollTop).toBe(10);
    expect(onSelectMany).not.toHaveBeenCalled();
  });

  it("uses a plain background drag to pan after zooming in", () => {
    const { svg, scroller, onSelectMany } = renderCanvas();
    fireEvent(
      scroller,
      new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true })
    );
    const startLeft = scroller.scrollLeft;
    const startTop = scroller.scrollTop;

    fireEvent.pointerDown(svg, { button: 0, pointerId: 3, clientX: 300, clientY: 180 });
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 250, clientY: 150 });

    expect(scroller.scrollLeft).toBe(startLeft + 50);
    expect(scroller.scrollTop).toBe(startTop + 30);
    expect(onSelectMany).not.toHaveBeenCalled();
  });

  it("keeps Shift+background drag as lasso after zooming", () => {
    const { svg, scroller, onSelectMany } = renderCanvas();
    fireEvent(
      scroller,
      new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true })
    );
    const startLeft = scroller.scrollLeft;

    fireEvent.pointerDown(svg, { button: 0, shiftKey: true, pointerId: 4, clientX: 350, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 4, clientX: 650, clientY: 350 });
    fireEvent.pointerUp(svg, { pointerId: 4, clientX: 650, clientY: 350 });

    expect(scroller.scrollLeft).toBe(startLeft);
    expect(onSelectMany).toHaveBeenCalled();
  });

  it("keeps a plain background drag as lasso at Fit zoom", () => {
    const { svg, scroller, onSelectMany } = renderCanvas();

    fireEvent.pointerDown(svg, { button: 0, pointerId: 5, clientX: 350, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 650, clientY: 350 });
    fireEvent.pointerUp(svg, { pointerId: 5, clientX: 650, clientY: 350 });

    expect(scroller.scrollLeft).toBe(0);
    expect(onSelectMany).toHaveBeenCalled();
  });

  it("moves an annotation once on pointerup instead of panning", () => {
    const { container, svg, scroller, onChange } = renderCanvas();
    fireEvent(
      scroller,
      new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 150, bubbles: true, cancelable: true })
    );
    const box = container.querySelector(".bbox-group > rect") as SVGRectElement;
    const startLeft = scroller.scrollLeft;

    fireEvent.pointerDown(box, { button: 0, pointerId: 6, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 6, clientX: 520, clientY: 260 });

    expect(onChange).not.toHaveBeenCalled();
    expect(scroller.scrollLeft).toBe(startLeft);

    fireEvent.pointerUp(svg, { pointerId: 6, clientX: 540, clientY: 270 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ x_center: 0.54, y_center: 0.54 });
  });

  it("opens the annotation context menu from its label", () => {
    const onContextMenu = vi.fn();
    const { getByText } = renderCanvas({ onContextMenu });

    fireEvent.contextMenu(getByText("car"), { clientX: 320, clientY: 180 });

    expect(onContextMenu).toHaveBeenCalledWith("box-1", { x: 320, y: 180 });
  });
});

describe("AnnotationCanvas pointer gesture lifecycle", () => {
  it("draws over an existing bbox when Ctrl is held in select mode", () => {
    const { container, svg, onChange } = renderCanvas({ mode: "select" });
    const box = container.querySelector(".bbox-group > rect") as SVGRectElement;
    fireEvent.pointerDown(box, { button: 0, ctrlKey: true, pointerId: 20, clientX: 450, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 20, clientX: 650, clientY: 350 });
    fireEvent.pointerUp(svg, { pointerId: 20, clientX: 650, clientY: 350 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });

  it("uses pointerup as the final draw corner", () => {
    const { svg, onChange } = renderCanvas({ mode: "draw" });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 21, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 21, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { pointerId: 21, clientX: 300, clientY: 250 });
    expect(onChange.mock.calls[0][0].at(-1)).toMatchObject({ x_center: 0.2, y_center: 0.35, width: 0.2, height: 0.3 });
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("does not commit on %s", (eventName) => {
    const { svg, onChange } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 22, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 22, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));
    expect(directPreviewRects(svg)).toHaveLength(1);

    fireEvent[eventName](svg, { pointerId: 22, clientX: 0, clientY: 0 });

    expect(onChange).not.toHaveBeenCalled();
    expect(directPreviewRects(svg)).toHaveLength(0);
  });

  it("aborts a captured gesture on window blur", () => {
    const { svg, onChange } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 23, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 23, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));
    expect(directPreviewRects(svg)).toHaveLength(1);

    fireEvent.blur(window);

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(23);
    expect(directPreviewRects(svg)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes an imperative cancel that reports and aborts the active gesture", () => {
    const viewportApiRef = { current: null } as React.MutableRefObject<CanvasViewportApi | null>;
    const { svg, onChange } = renderCanvas({ mode: "draw", viewportApiRef });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 35, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 35, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));
    expect(directPreviewRects(svg)).toHaveLength(1);

    let canceled = false;
    act(() => {
      canceled = viewportApiRef.current?.cancelInteraction() ?? false;
    });
    expect(canceled).toBe(true);

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(35);
    expect(directPreviewRects(svg)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(viewportApiRef.current?.cancelInteraction()).toBe(false);
  });

  it("aborts a captured gesture when the active image changes", () => {
    const { svg, onChange, rerenderCanvas } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 24, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 24, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));

    act(() => rerenderCanvas({ image: { ...image, id: "image-2", path: "/tmp/image-2.jpg" } }));

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(24);
    expect(directPreviewRects(svg)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aborts a captured gesture when the persistent mode changes", () => {
    const { svg, onChange, rerenderCanvas } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 25, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 25, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));

    act(() => rerenderCanvas({ mode: "select" }));

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(25);
    expect(directPreviewRects(svg)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aborts a captured gesture on unmount", () => {
    const { container, svg, onChange, unmount } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 26, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 26, clientX: 400, clientY: 300 });
    act(() => frames.flush(frames.ids()[0]!));

    unmount();

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(26);
    expect(container.querySelector(".annotation-overlay")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("aborts rather than committing when the final point cannot be mapped", () => {
    const { svg, onChange } = renderCanvas({ mode: "draw" });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 27, clientX: 100, clientY: 100 });
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true
    });

    fireEvent.pointerUp(svg, { pointerId: 27, clientX: 300, clientY: 250 });

    expect(SVGElement.prototype.releasePointerCapture).toHaveBeenCalledWith(27);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits resize once using the pointerup point", () => {
    const { container, svg, onChange } = renderCanvas({ selectedId: annotation.id, selectedIds: [annotation.id] });
    const handle = container.querySelector(".bbox-group circle") as SVGCircleElement;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 28, clientX: 400, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 28, clientX: 350, clientY: 150 });

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(svg, { pointerId: 28, clientX: 300, clientY: 100 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ x_center: 0.45, y_center: 0.4, width: 0.3, height: 0.4 });
  });

  it("keeps a multi-selection together during a box move", () => {
    const second = { ...annotation, id: "box-2", x_center: 0.7 };
    const { container, svg, onChange } = renderCanvas({
      annotations: [annotation, second],
      selectedId: annotation.id,
      selectedIds: [annotation.id, second.id]
    });
    const box = container.querySelector(".bbox-group > rect") as SVGRectElement;
    fireEvent.pointerDown(box, { button: 0, pointerId: 29, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 29, clientX: 525, clientY: 250 });
    fireEvent.pointerUp(svg, { pointerId: 29, clientX: 550, clientY: 250 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].map((item: Annotation) => item.x_center)).toEqual([0.55, 0.75]);
  });

  it("uses one shared clamped delta for a multi-selection move preview", () => {
    const edge = { ...annotation, id: "box-2", x_center: 0.9 };
    const { container, svg, onChange } = renderCanvas({
      annotations: [annotation, edge],
      selectedId: annotation.id,
      selectedIds: [annotation.id, edge.id]
    });
    const box = container.querySelector(".bbox-group > rect") as SVGRectElement;
    const frames = queueAnimationFrames();

    fireEvent.pointerDown(box, { button: 0, pointerId: 30, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 30, clientX: 700, clientY: 250 });
    act(() => frames.flush(frames.ids()[0]!));

    const previewBoxes = Array.from(container.querySelectorAll(".bbox-group")).map(
      (group) => group.querySelector("rect") as SVGRectElement
    );
    expect(previewBoxes.map((rect) => Number(rect.getAttribute("x")))).toEqual([400, 800]);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses one shared clamped delta for multi-selection move completion", () => {
    const edge = { ...annotation, id: "box-2", x_center: 0.9 };
    const { container, svg, onChange } = renderCanvas({
      annotations: [annotation, edge],
      selectedId: annotation.id,
      selectedIds: [annotation.id, edge.id]
    });
    const box = container.querySelector(".bbox-group > rect") as SVGRectElement;

    fireEvent.pointerDown(box, { button: 0, pointerId: 31, clientX: 500, clientY: 250 });
    fireEvent.pointerUp(svg, { pointerId: 31, clientX: 700, clientY: 250 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].map((item: Annotation) => item.x_center)).toEqual([0.5, 0.9]);
  });

  it("coalesces dense draw moves into one frame and previews the latest point", () => {
    const { svg } = renderCanvas({ mode: "draw" });
    const frames = queueAnimationFrames();

    fireEvent.pointerDown(svg, { button: 0, pointerId: 32, clientX: 100, clientY: 100 });
    for (let index = 1; index <= 100; index += 1) {
      fireEvent.pointerMove(svg, {
        pointerId: 32,
        clientX: 100 + index * 3,
        clientY: 100 + index * 2
      });
    }

    expect(frames.ids()).toHaveLength(1);
    act(() => frames.flush(frames.ids()[0]!));

    const [preview] = directPreviewRects(svg);
    expect(preview.getAttribute("width")).toBe("300");
    expect(preview.getAttribute("height")).toBe("200");
  });

  it.each([
    { previewKind: "draw", mode: "draw" as const, pointerId: 33 },
    { previewKind: "lasso", mode: "select" as const, pointerId: 34 }
  ])("renders the $previewKind preview with a solid stroke", ({ mode, pointerId }) => {
    const { svg } = renderCanvas({ mode });
    const frames = queueAnimationFrames();

    fireEvent.pointerDown(svg, { button: 0, pointerId, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId, clientX: 300, clientY: 250 });
    act(() => frames.flush(frames.ids()[0]!));

    const [preview] = directPreviewRects(svg);
    expect(preview).toBeDefined();
    expect(preview.hasAttribute("stroke-dasharray")).toBe(false);
  });
});

describe("AnnotationCanvas histogram highlighting", () => {
  it("adds a glow hook only to histogram-matched boxes", () => {
    const { container } = renderCanvas({ highlightedIds: [annotation.id] });
    expect(container.querySelector(".bbox-group.is-highlighted")).toBeTruthy();
  });
});
