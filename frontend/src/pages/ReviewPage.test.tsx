// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { api, type ImageFilters } from "../api/client";
import type { Annotation, Project, ProjectImage, ReviewImagePosition } from "../types";
import { ReviewPage } from "./ReviewPage";

const project: Project = {
  id: "project-1",
  name: "Review test",
  description: "",
  root_path: "/tmp/project"
};

const image: ProjectImage = {
  id: "image-1",
  project_id: project.id,
  path: "/tmp/project/image.jpg",
  width: 1000,
  height: 500,
  review_status: "pending_review"
};

const annotations: Annotation[] = [
  {
    id: "box-1",
    class_id: 0,
    class_name: "car",
    x_center: 0.3,
    y_center: 0.5,
    width: 0.1,
    height: 0.2,
    confidence: 0.9,
    source_descriptor: "car",
    source_type: "pseudo",
    edited: false
  },
  {
    id: "box-2",
    class_id: 0,
    class_name: "car",
    x_center: 0.6,
    y_center: 0.5,
    width: 0.1,
    height: 0.2,
    confidence: 0.8,
    source_descriptor: "car",
    source_type: "pseudo",
    edited: false
  }
];

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockReviewApi() {
  vi.spyOn(api, "sources").mockResolvedValue([]);
  vi.spyOn(api, "classSchemas").mockResolvedValue([
    {
      id: "schema-1",
      project_id: project.id,
      name: "default",
      classes: [
        { class_id: 0, class_name: "car", descriptors: ["car"] },
        { class_id: 1, class_name: "person", descriptors: ["person"] }
      ]
    }
  ]);
  vi.spyOn(api, "activeOpenDataImport").mockResolvedValue(null);
  vi.spyOn(api, "reviewSourceCounts").mockResolvedValue({ pseudo: 1, augment: 0, open_data: 0 });
  vi.spyOn(api, "bboxHistogram").mockResolvedValue([{ class_id: 0, class_name: "car", bins: [{ lower: 0, upper: 1, count: 1 }, { lower: 1, upper: 5, count: 1 }, { lower: 5, upper: 10, count: 0 }, { lower: 10, upper: 25, count: 0 }, { lower: 25, upper: 50, count: 0 }, { lower: 50, upper: 100, count: 0 }] }]);
  vi.spyOn(api, "reviewStats").mockResolvedValue({
    unreviewed: 0,
    pending_review: 1,
    needs_fix: 0,
    reviewed: 0,
    skipped: 0,
    edited: 0,
    low_confidence: 0
  });
  vi.spyOn(api, "images").mockResolvedValue([image]);
  vi.spyOn(api, "imagePosition").mockResolvedValue({
    filtered_index: 1,
    filtered_total: 1,
    project_index: 1,
    project_total: 1
  });
  vi.spyOn(api, "annotations").mockResolvedValue({ image, annotations });
  vi.spyOn(api, "saveAnnotations").mockImplementation(async (_imageId, payload) => ({
    annotations: payload.annotations,
    label_path: "/tmp/project/image.txt"
  }));
}

function deferImagePosition() {
  let resolvePosition: ((position: ReviewImagePosition) => void) | undefined;
  let rejectPosition: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<ReviewImagePosition>((resolve, reject) => {
    resolvePosition = resolve;
    rejectPosition = reject;
  });
  return {
    promise,
    resolve(position: ReviewImagePosition) {
      resolvePosition?.(position);
    },
    reject(reason = new Error("position request failed")) {
      rejectPosition?.(reason);
    }
  };
}

function deferImageQueue() {
  let resolveQueue: ((images: ProjectImage[]) => void) | undefined;
  const promise = new Promise<ProjectImage[]>((resolve) => {
    resolveQueue = resolve;
  });
  return {
    promise,
    resolve(images: ProjectImage[]) {
      resolveQueue?.(images);
    }
  };
}

function deferAnnotations() {
  let resolveAnnotations: ((result: { image: ProjectImage; annotations: Annotation[] }) => void) | undefined;
  let rejectAnnotations: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<{ image: ProjectImage; annotations: Annotation[] }>((resolve, reject) => {
    resolveAnnotations = resolve;
    rejectAnnotations = reject;
  });
  return {
    promise,
    resolve(result: { image: ProjectImage; annotations: Annotation[] }) {
      resolveAnnotations?.(result);
    },
    reject(reason = new Error("annotation request failed")) {
      rejectAnnotations?.(reason);
    }
  };
}

function setCanvasBounds(container: HTMLElement) {
  const svg = container.querySelector(".annotation-overlay") as SVGSVGElement;
  Object.defineProperty(svg, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) })
  });
  return svg;
}

function openBoxMenu(container: HTMLElement, index = 0) {
  fireEvent.contextMenu(container.querySelectorAll(".bbox-group")[index] as SVGGElement, { clientX: 300, clientY: 200 });
  return screen.findByRole("menu", { name: "Annotation actions" });
}

async function waitForActiveImageReady() {
  await screen.findByText("2 annotations");
  await screen.findByText("Ready");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect((screen.getByRole("menuitem", { name: /Remove Image From Project/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

function deferSaveAnnotations() {
  let resolveSave: ((result: { annotations: Annotation[]; label_path: string }) => void) | undefined;
  vi.mocked(api.saveAnnotations).mockImplementation(() => new Promise((resolve) => {
    resolveSave = resolve;
  }));
  return {
    resolve(result: { annotations: Annotation[]; label_path?: string }) {
      resolveSave?.({ label_path: "/tmp/project/image.txt", ...result });
    }
  };
}

describe("ReviewPage selection", () => {
  it("keeps every lasso-selected annotation selected for a bulk relabel", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);

    await screen.findByText("2 annotations");
    const svg = setCanvasBounds(container);

    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 700, clientY: 400 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 700, clientY: 400 });
    await screen.findByText("Selected annotation");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      const boxes = container.querySelectorAll(".bbox-group > rect:first-child");
      expect(boxes[0]?.getAttribute("x")).toBe("251");
      expect(boxes[1]?.getAttribute("x")).toBe("551");
    });

    fireEvent.click(screen.getByRole("button", { name: /person\s+Key 2/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /\d\. person/ })).toHaveLength(2);
    });

    fireEvent.contextMenu(container.querySelector(".bbox-group") as SVGGElement, { clientX: 300, clientY: 200 });
    await screen.findByText("2 boxes selected");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate selected" }));
    await screen.findByText("4 annotations");

    fireEvent.contextMenu(container.querySelectorAll(".bbox-group")[2] as SVGGElement, { clientX: 300, clientY: 200 });
    await screen.findByText("2 boxes selected");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete selected" }));
    await screen.findByText("2 annotations");
  });
});

describe("ReviewPage position indicator", () => {
  it("places wide maps below the workflow guide and keeps only the inspector on the right", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    const wide = container.querySelector(".review-wide-panels") as HTMLElement;
    expect(container.querySelector(".review-page")?.firstElementChild).toBe(wide);
    expect(wide.querySelector(".image-map-panel")?.nextElementSibling?.classList.contains("annotation-histogram-panel")).toBe(true);
    expect(container.querySelector(".review-sidebar .source-composition")).toBeNull();
    expect(screen.queryByLabelText(/Review status|Status/)).toBeNull();
  });

  it("saves precise legal boxes and switches with ArrowRight without an unsaved prompt", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const precise = [{ ...annotations[0], width: .123456789, height: .234567891 }];
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : precise
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("1 annotations");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save$/ }).hasAttribute("disabled")).toBe(false));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(confirm).not.toHaveBeenCalled();
    await screen.findByText("0 annotations");
    expect(api.saveAnnotations).toHaveBeenCalledWith(image.id, expect.objectContaining({ annotations: precise }));
  });

  it("saves and advances with N", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    fireEvent.keyDown(window, { key: "n" });
    await screen.findByText("0 annotations");
    expect(api.saveAnnotations).toHaveBeenCalledOnce();
  });

  it("keeps the newest image position when an older response resolves last", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const firstPosition = deferImagePosition();
    const secondPosition = deferImagePosition();
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    vi.mocked(api.imagePosition)
      .mockImplementationOnce(() => firstPosition.promise)
      .mockImplementationOnce(() => secondPosition.promise);
    render(<ReviewPage project={project} t={(key) => key} />);

    await waitFor(() => expect(api.imagePosition).toHaveBeenCalledWith(project.id, image.id, { review_status: undefined, has_low_confidence: undefined, source_asset_id: undefined, source_origin: undefined, source_groups: ["pseudo", "augment", "open_data"] }));
    fireEvent.click(screen.getByRole("button", { name: /Image 2/i }));
    await waitFor(() => expect(api.imagePosition).toHaveBeenLastCalledWith(project.id, secondImage.id, { review_status: undefined, has_low_confidence: undefined, source_asset_id: undefined, source_origin: undefined, source_groups: ["pseudo", "augment", "open_data"] }));

    await act(async () => {
      secondPosition.resolve({ filtered_index: 2, filtered_total: 2, project_index: 5, project_total: 8 });
    });
    expect(screen.getByText("Filtered queue 2 / 2")).toBeTruthy();

    await act(async () => {
      firstPosition.resolve({ filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 8 });
    });
    expect(screen.getByText("Filtered queue 2 / 2")).toBeTruthy();
  });

  it("waits for the matching filtered queue before requesting or rendering a new filter position", async () => {
    const reviewedImage = { ...image, id: "image-reviewed", path: "/tmp/project/reviewed.jpg", review_status: "reviewed" };
    const nextQueue = deferImageQueue();
    const initialPosition = deferImagePosition();
    const nextPosition = deferImagePosition();
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image])
      .mockImplementationOnce(() => nextQueue.promise);
    vi.mocked(api.annotations).mockResolvedValue({ image: reviewedImage, annotations: [] });
    vi.mocked(api.imagePosition)
      .mockImplementationOnce(() => initialPosition.promise)
      .mockImplementationOnce(() => nextPosition.promise);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);

    await waitFor(() => expect(api.imagePosition).toHaveBeenCalledOnce());
    await act(async () => {
      initialPosition.resolve({ filtered_index: 1, filtered_total: 1, project_index: 1, project_total: 2 });
    });
    expect(screen.getByText("Filtered queue 1 / 1")).toBeTruthy();

    const queueFilters = container.querySelector(".source-composition") as HTMLElement;
    fireEvent.click(within(queueFilters).getByRole("button", { name: /Augment images/ }));
    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Filtered queue 1 / 1")).toBeNull();
    expect(api.imagePosition).toHaveBeenCalledOnce();

    await act(async () => {
      nextQueue.resolve([reviewedImage]);
    });
    await waitFor(() => expect(api.imagePosition).toHaveBeenLastCalledWith(project.id, reviewedImage.id, { review_status: undefined, has_low_confidence: undefined, source_asset_id: undefined, source_origin: undefined, source_groups: ["pseudo", "open_data"] }));
    await act(async () => {
      nextPosition.resolve({ filtered_index: 1, filtered_total: 1, project_index: 2, project_total: 2 });
    });
    expect(screen.getByText("Filtered queue 1 / 1")).toBeTruthy();
  });

  it("does not clear a newer position when an older request fails", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const firstPosition = deferImagePosition();
    const secondPosition = deferImagePosition();
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    vi.mocked(api.imagePosition)
      .mockImplementationOnce(() => firstPosition.promise)
      .mockImplementationOnce(() => secondPosition.promise);
    render(<ReviewPage project={project} t={(key) => key} />);

    await waitFor(() => expect(api.imagePosition).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /Image 2/i }));
    await waitFor(() => expect(api.imagePosition).toHaveBeenCalledTimes(2));
    await act(async () => {
      secondPosition.resolve({ filtered_index: 2, filtered_total: 2, project_index: 2, project_total: 2 });
    });
    expect(screen.getByText("Filtered queue 2 / 2")).toBeTruthy();

    await act(async () => {
      firstPosition.reject();
    });
    expect(screen.getByText("Filtered queue 2 / 2")).toBeTruthy();
  });
});

describe("ReviewPage shared commands", () => {
  it("waits for the active image annotations before Shift+X can snapshot and restore them", async () => {
    const deferred = deferAnnotations();
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([image]);
    vi.mocked(api.annotations).mockImplementationOnce(() => deferred.promise);
    const removeProjectImage = vi.spyOn(api, "removeProjectImage").mockResolvedValue({
      operation_id: "removal-ready",
      image_id: image.id,
      next_image_id: null
    });
    const restoreProjectImage = vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ReviewPage project={project} t={(key) => key} />);

    await screen.findByText("Loading annotations...");
    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(removeProjectImage).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve({ image, annotations });
    });
    await waitForActiveImageReady();
    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await waitFor(() => expect(removeProjectImage).toHaveBeenCalledWith(project.id, image.id));
    expect((await screen.findAllByText("No image selected")).length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(restoreProjectImage).toHaveBeenCalledWith(project.id, "removal-ready"));
    await screen.findByText("2 annotations");
  });

  it("cancels Shift+X without calling the removal API", async () => {
    mockReviewApi();
    const removeProjectImage = vi.spyOn(api, "removeProjectImage").mockResolvedValue({
      operation_id: "removal-1",
      image_id: image.id,
      next_image_id: null
    });
    vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.keyDown(window, { key: "X", shiftKey: true });

    expect(confirm).toHaveBeenCalledOnce();
    expect(removeProjectImage).not.toHaveBeenCalled();
    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
  });

  it("confirms Shift+X, removes the active project image, navigates to the backend successor, and refreshes queue counts", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, nextImage])
      .mockResolvedValueOnce([nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    vi.mocked(api.imagePosition).mockImplementation(async (_projectId, imageId) => (
      imageId === nextImage.id
        ? { filtered_index: 1, filtered_total: 1, project_index: 1, project_total: 1 }
        : { filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 2 }
    ));
    const removeProjectImage = vi.spyOn(api, "removeProjectImage").mockResolvedValue({
      operation_id: "removal-1",
      image_id: image.id,
      next_image_id: nextImage.id
    });
    vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.keyDown(window, { key: "x", shiftKey: true });

    await waitFor(() => expect(removeProjectImage).toHaveBeenCalledWith(project.id, image.id));
    await screen.findByText("0 annotations");
    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.reviewStats).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText(nextImage.path).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /image\.jpg/i })).toBeNull();
    const confirmation = String(confirm.mock.calls[0]?.[0]);
    expect(confirmation).toMatch(/project image and (?:its )?labels.*removed/i);
    expect(confirmation).toMatch(/raw input.*kept/i);
    expect(confirmation).toMatch(/Undo.*session-only/i);
  });

  it("undoes a removal once, reinserts the matching image, and restores its annotations", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, nextImage])
      .mockResolvedValueOnce([nextImage])
      .mockResolvedValueOnce([image, nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    vi.spyOn(api, "removeProjectImage").mockResolvedValue({
      operation_id: "removal-1",
      image_id: image.id,
      next_image_id: nextImage.id
    });
    const restoreProjectImage = vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect((screen.getByRole("menuitem", { name: /Remove Image From Project/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await screen.findByText("0 annotations");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(restoreProjectImage).toHaveBeenCalledWith(project.id, "removal-1"));
    await screen.findByText("2 annotations");
    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(restoreProjectImage).toHaveBeenCalledOnce();
  });

  it("redoes a restored removal without reconfirming and stores the replacement operation id for Undo", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockImplementation(async () => (
      vi.mocked(api.removeProjectImage).mock.calls.length > vi.mocked(api.restoreProjectImage).mock.calls.length
        ? [nextImage]
        : [image, nextImage]
    ));
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    const removeProjectImage = vi.spyOn(api, "removeProjectImage")
      .mockResolvedValueOnce({ operation_id: "removal-1", image_id: image.id, next_image_id: nextImage.id })
      .mockResolvedValueOnce({ operation_id: "removal-2", image_id: image.id, next_image_id: nextImage.id });
    const restoreProjectImage = vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("2 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(restoreProjectImage).toHaveBeenLastCalledWith(project.id, "removal-2"));
    expect(removeProjectImage).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("restores unsaved annotations when a dirty image removal is undone", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, nextImage])
      .mockResolvedValueOnce([nextImage])
      .mockResolvedValueOnce([image, nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    vi.spyOn(api, "removeProjectImage").mockResolvedValue({ operation_id: "removal-1", image_id: image.id, next_image_id: nextImage.id });
    vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));

    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await screen.findByText("2 annotations");
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251");
    expect(screen.getByText("Unsaved")).toBeTruthy();
  });

  it("does not let an older filter request reinsert an image after removal", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const staleQueue = deferImageQueue();
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, nextImage])
      .mockImplementationOnce(() => staleQueue.promise)
      .mockResolvedValueOnce([nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    vi.spyOn(api, "removeProjectImage").mockResolvedValue({ operation_id: "removal-1", image_id: image.id, next_image_id: nextImage.id });
    vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();
    fireEvent.click(within(container.querySelector(".source-composition") as HTMLElement).getByRole("button", { name: /Augment images/ }));
    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));

    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await screen.findByText("0 annotations");
    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(3));
    await act(async () => {
      staleQueue.resolve([image, nextImage]);
    });

    expect(screen.queryByRole("button", { name: /image\.jpg/i })).toBeNull();
    expect(screen.getAllByText(nextImage.path).length).toBeGreaterThan(0);
  });

  it("disables direct and keyboard saves while image removal is pending", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    let resolveRemoval: ((value: { operation_id: string; image_id: string; next_image_id: string }) => void) | undefined;
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValueOnce([image, nextImage]).mockResolvedValueOnce([nextImage]);
    const removeProjectImage = vi.spyOn(api, "removeProjectImage").mockImplementation(() => new Promise((resolve) => {
      resolveRemoval = resolve;
    }));
    vi.spyOn(api, "restoreProjectImage").mockResolvedValue({ image, annotations });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await waitFor(() => expect(removeProjectImage).toHaveBeenCalledOnce());
    const saveControls = [
      ...screen.getAllByRole("button", { name: "Removing…" }),
      ...screen.getAllByRole("button", { name: /Save & next/i })
    ];
    expect(saveControls.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    const saveShortcut = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(saveShortcut);
    expect(api.saveAnnotations).not.toHaveBeenCalled();

    await act(async () => {
      resolveRemoval?.({ operation_id: "removal-1", image_id: image.id, next_image_id: nextImage.id });
    });
  });

  it("locks Review mutations and history synchronously while a removal is pending", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    let rejectRemoval: ((reason?: unknown) => void) | undefined;
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValueOnce([image, nextImage]);
    vi.spyOn(api, "removeProjectImage").mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRemoval = reject;
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.click(screen.getByRole("button", { name: /1\. car/i }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250"));

    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    expect((await screen.findAllByText("Removing…")).length).toBeGreaterThan(0);
    expect(container.querySelector(".review-page")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".annotation-canvas-shell")?.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Merge boxes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Draw.*B/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /person\s+Key 2/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Delete annotation" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByRole("menuitem", { name: /Redo/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250");
    fireEvent.keyDown(window, { key: "b" });
    expect(container.querySelector(".annotation-canvas-shell.mode-select")).toBeTruthy();

    await act(async () => {
      rejectRemoval?.(new Error("remove failed"));
    });
    await screen.findByRole("alert");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));
  });

  it("does not repeat or consume removal history while restore and redo are pending", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    let resolveRestore: ((result: { image: ProjectImage; annotations: Annotation[] }) => void) | undefined;
    let resolveRedo: ((result: { operation_id: string; image_id: string; next_image_id: string }) => void) | undefined;
    mockReviewApi();
    vi.mocked(api.images).mockImplementation(async () => (
      vi.mocked(api.removeProjectImage).mock.calls.length > vi.mocked(api.restoreProjectImage).mock.calls.length
        ? [nextImage]
        : [image, nextImage]
    ));
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    const removeProjectImage = vi.spyOn(api, "removeProjectImage")
      .mockResolvedValueOnce({ operation_id: "removal-1", image_id: image.id, next_image_id: nextImage.id })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRedo = resolve;
      }));
    const restoreProjectImage = vi.spyOn(api, "restoreProjectImage").mockImplementation(() => new Promise((resolve) => {
      resolveRestore = resolve;
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect((screen.getByRole("menuitem", { name: /Remove Image From Project/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    await screen.findByText("0 annotations");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect((await screen.findAllByText("Restoring…")).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(restoreProjectImage).toHaveBeenCalledOnce();
    expect(removeProjectImage).toHaveBeenCalledOnce();
    await act(async () => {
      resolveRestore?.({ image, annotations });
    });
    await screen.findByText("2 annotations");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect((await screen.findAllByText("Removing…")).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(restoreProjectImage).toHaveBeenCalledOnce();
    expect(removeProjectImage).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveRedo?.({ operation_id: "removal-2", image_id: image.id, next_image_id: nextImage.id });
    });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(restoreProjectImage).toHaveBeenCalledTimes(2));
  });

  it("prefers the backend successor after the refreshed queue replaces a capped page", async () => {
    const provisionalImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const backendNextImage = { ...image, id: "image-501", path: "/tmp/project/image-501.jpg" };
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, provisionalImage])
      .mockResolvedValueOnce([provisionalImage, backendNextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === image.id ? image : imageId === provisionalImage.id ? provisionalImage : backendNextImage,
      annotations: imageId === image.id ? annotations : []
    }));
    vi.spyOn(api, "removeProjectImage").mockResolvedValue({
      operation_id: "removal-cap-shift",
      image_id: image.id,
      next_image_id: backendNextImage.id
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();

    fireEvent.keyDown(window, { key: "x", shiftKey: true });

    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(backendNextImage.path).length).toBeGreaterThan(0));
    expect(container.querySelector(".review-stage-panel strong")?.textContent).toBe(backendNextImage.path);
    expect(screen.getByText("Filtered queue 1 / 1")).toBeTruthy();
  });

  it("cancels an active canvas gesture before removal and cannot commit it after failure", async () => {
    let rejectRemoval: ((reason?: unknown) => void) | undefined;
    mockReviewApi();
    vi.spyOn(api, "removeProjectImage").mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRemoval = reject;
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await waitForActiveImageReady();
    const svg = setCanvasBounds(container);
    const firstBox = container.querySelector(".bbox-group > rect") as SVGRectElement;

    fireEvent.pointerDown(firstBox, { button: 0, pointerId: 41, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 400, clientY: 250 });
    fireEvent.keyDown(window, { key: "x", shiftKey: true });
    expect((await screen.findAllByText("Removing…")).length).toBeGreaterThan(0);
    await act(async () => {
      rejectRemoval?.(new Error("remove failed"));
    });
    await screen.findByRole("alert");

    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 400, clientY: 250 });
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250");
    expect(screen.queryByText("Unsaved")).toBeNull();
  });

  it("shows discoverable D/B/H tool controls without the retired V/W tool hints", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    expect(screen.getByRole("button", { name: /Select.*D/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draw.*B/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pan.*H/ })).toBeTruthy();

    fireEvent.keyDown(window, { key: "b" });
    expect(container.querySelector(".annotation-canvas-shell.mode-draw")).toBeTruthy();
    fireEvent.keyDown(window, { key: "d" });
    expect(container.querySelector(".annotation-canvas-shell.mode-select")).toBeTruthy();
    fireEvent.keyDown(window, { key: "h" });
    expect(container.querySelector(".annotation-canvas-shell.mode-pan")).toBeTruthy();

    const toolGroup = screen.getByRole("tablist", { name: "Annotation tools" });
    expect(toolGroup.getAttribute("title") ?? "").not.toMatch(/\b[ VW]\b|Ctrl\+D/);
    expect(within(toolGroup).getByRole("button", { name: /Draw.*B/ }).getAttribute("title")).not.toContain("Ctrl+D");
  });

  it("shares copy, paste, duplicate, delete, undo, and redo between keyboard and Edit menu", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    const disabledPaste = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(disabledPaste);
    expect(disabledPaste.defaultPrevented).toBe(false);

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await screen.findByText("3 annotations");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("2 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await screen.findByText("3 annotations");

    fireEvent.keyDown(window, { key: "Backspace" });
    await screen.findByText("2 annotations");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await screen.findByText("3 annotations");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Duplicate/ }));
    await screen.findByText("4 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("3 annotations");
  });

  it("routes context-menu relabel through history and keeps Edit-menu relabel on the restored class", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.click(screen.getByRole("menuitem", { name: /ID 1.*person/ }));
    await waitFor(() => expect(container.querySelector(".bbox-group text")?.textContent).toBe("person"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(container.querySelector(".bbox-group text")?.textContent).toBe("car"));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Relabel$/ }));
    await waitFor(() => expect(container.querySelector(".bbox-group text")?.textContent).toBe("car"));
  });

  it("records one Draw history entry and Escape aborts a gesture before closing menu or deselecting", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    const svg = setCanvasBounds(container);

    fireEvent.keyDown(window, { key: "b" });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 41, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 300, clientY: 250 });
    await openBoxMenu(container);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("menu", { name: "Annotation actions" })).toBeTruthy();
    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 300, clientY: 250 });
    expect(screen.getByText("2 annotations")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Annotation actions" })).toBeNull();
    expect(container.querySelectorAll(".bbox-group.is-selected")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelectorAll(".bbox-group.is-selected")).toHaveLength(0);

    fireEvent.pointerDown(svg, { button: 0, pointerId: 42, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 42, clientX: 300, clientY: 250 });
    await screen.findByText("3 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("2 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText("2 annotations")).toBeTruthy();
  });

  it("keeps clipboard and history usable across ordinary image navigation", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await screen.findByText("3 annotations");
    fireEvent.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByText("0 annotations");
    await waitFor(() => expect(container.querySelector(".review-canvas-shell.is-loading")).toBeNull());
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await screen.findByText("1 annotations");
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await screen.findByText("2 annotations");
    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    expect(confirm).not.toHaveBeenCalled();
  });


  it("invalidates stale Redo after a successful non-history merge", async () => {
    mockReviewApi();
    vi.mocked(api.annotations).mockResolvedValue({
      image,
      annotations: [annotations[0], { ...annotations[1], x_center: annotations[0].x_center, y_center: annotations[0].y_center }]
    });
    vi.spyOn(window, "prompt").mockReturnValue("0.75");
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Merge boxes" }));
    await screen.findByText("1 annotations");

    const redo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(redo);

    expect(redo.defaultPrevented).toBe(false);
    expect(screen.getByText("1 annotations")).toBeTruthy();
  });

  it("resets past history when Merge semantically replaces annotations", async () => {
    mockReviewApi();
    vi.mocked(api.annotations).mockResolvedValue({
      image,
      annotations: [annotations[0], { ...annotations[1], x_center: annotations[0].x_center, y_center: annotations[0].y_center }]
    });
    vi.spyOn(window, "prompt").mockReturnValue("0.75");
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Merge boxes" }));
    await screen.findByText("1 annotations");

    const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(undo);

    expect(undo.defaultPrevented).toBe(false);
    expect(screen.getByText("1 annotations")).toBeTruthy();
  });

  it("resets past and future when a save response applies normalized annotations", async () => {
    mockReviewApi();
    vi.mocked(api.saveAnnotations).mockImplementation(async (_imageId, payload) => ({
      annotations: payload.annotations.slice(0, 1),
      label_path: "/tmp/project/image.txt"
    }));
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await screen.findByText("1 annotations");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect((screen.getByRole("menuitem", { name: /^Undo/ }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    const redo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(undo);
    window.dispatchEvent(redo);

    expect(undo.defaultPrevented).toBe(false);
    expect(redo.defaultPrevented).toBe(false);
    expect(screen.getByText("1 annotations")).toBeTruthy();
  });

  it("keeps compatible history when a save response does not replace annotations", async () => {
    mockReviewApi();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    const undo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(undo);

    expect(undo.defaultPrevented).toBe(true);
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250"));
  });

  it("preserves edits made while a normalizing save response is pending", async () => {
    mockReviewApi();
    const save = deferSaveAnnotations();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));

    await act(async () => {
      save.resolve({ annotations: [annotations[0]] });
    });

    await waitFor(() => expect(screen.getByText("2 annotations")).toBeTruthy());
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(api.images).toHaveBeenCalledOnce();
  });

  it("preserves an edit batched with a Save & Next response", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const save = deferSaveAnnotations();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);

    fireEvent.click(screen.getByRole("button", { name: /^Save & next$/i }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await act(async () => {
      save.resolve({ annotations });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(api.images).toHaveBeenCalledOnce();
  });

  it("preserves an Undo batched with a queue refresh response", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    let resolveQueue: ((images: ProjectImage[]) => void) | undefined;
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, secondImage])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveQueue = resolve;
      }));
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));

    fireEvent.click(screen.getByRole("button", { name: /^Save & next$/i }));
    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveQueue?.([image, secondImage]);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("250");
    expect(screen.getByText("Unsaved")).toBeTruthy();
  });


  it("gates position updates until a save-refreshed filtered queue selects its next image", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const refreshedQueue = deferImageQueue();
    mockReviewApi();
    vi.mocked(api.images)
      .mockResolvedValueOnce([image, nextImage])
      .mockImplementationOnce(() => refreshedQueue.promise);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : annotations
    }));
    vi.mocked(api.imagePosition)
      .mockResolvedValueOnce({ filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 2 })
      .mockResolvedValueOnce({ filtered_index: 1, filtered_total: 1, project_index: 2, project_total: 2 });
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);

    await screen.findByText("Filtered queue 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(api.saveAnnotations).toHaveBeenLastCalledWith(image.id, expect.objectContaining({ review_status: "pending_review" })));

    await waitFor(() => expect(api.images).toHaveBeenCalledTimes(2));
    expect(api.imagePosition).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Filtered queue 0/)).toBeNull();
    expect(screen.queryByText("Filtered queue 1 / 2")).toBeNull();

    await act(async () => {
      refreshedQueue.resolve([nextImage]);
    });
    await waitFor(() => expect(api.imagePosition).toHaveBeenLastCalledWith(project.id, nextImage.id, { review_status: undefined, has_low_confidence: undefined, source_asset_id: undefined, source_origin: undefined, source_groups: ["pseudo", "augment", "open_data"] }));
    expect(screen.getByText("Filtered queue 1 / 1")).toBeTruthy();
  });

  it("removes a source that gains a low-confidence box from a false low-confidence queue after a newer edit", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    let sourceRequests = 0;
    mockReviewApi();
    const save = deferSaveAnnotations();
    vi.mocked(api.images).mockResolvedValue([image, nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: imageId === nextImage.id ? [] : [annotations[0]]
    }));
    vi.mocked(api.imagePosition).mockImplementation(async (_projectId, imageId) => {
      if (imageId === image.id) {
        sourceRequests += 1;
        return sourceRequests === 1
          ? { filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 2 }
          : { filtered_index: 0, filtered_total: 1, project_index: 1, project_total: 2 };
      }
      return { filtered_index: 1, filtered_total: 1, project_index: 2, project_total: 2 };
    });
    const pageProps = {
      project,
      t: (key: string) => key,
      initialFilters: { review_status: "pending_review", has_low_confidence: false } satisfies ImageFilters
    };
    const { container } = render(<ReviewPage {...pageProps} />);

    await screen.findByText("Filtered queue 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));
    await act(async () => {
      save.resolve({ annotations: [{ ...annotations[0], confidence: 0.4 }] });
    });

    await waitFor(() => expect(screen.getByText("Unsaved")).toBeTruthy());
    expect(sourceRequests).toBe(1);
    expect(screen.queryByText(/Filtered queue 0/)).toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTitle("Next image (ArrowRight)"));
    await waitFor(() => expect(api.imagePosition).toHaveBeenCalledWith(project.id, nextImage.id, expect.anything()));
    await screen.findByText("Filtered queue 1 / 1");
  });

  it("removes a source that loses its low-confidence box from a true low-confidence queue after a newer edit", async () => {
    const nextImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    const initialLowAnnotation = { ...annotations[0], confidence: 0.4 };
    let sourceRequests = 0;
    mockReviewApi();
    const save = deferSaveAnnotations();
    vi.mocked(api.images).mockResolvedValue([image, nextImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === nextImage.id ? nextImage : image,
      annotations: [initialLowAnnotation]
    }));
    vi.mocked(api.imagePosition).mockImplementation(async (_projectId, imageId) => {
      if (imageId === image.id) {
        sourceRequests += 1;
        return sourceRequests === 1
          ? { filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 2 }
          : { filtered_index: 0, filtered_total: 1, project_index: 1, project_total: 2 };
      }
      return { filtered_index: 1, filtered_total: 1, project_index: 2, project_total: 2 };
    });
    const pageProps = {
      project,
      t: (key: string) => key,
      initialFilters: { review_status: "pending_review", has_low_confidence: true } satisfies ImageFilters
    };
    const { container } = render(<ReviewPage {...pageProps} />);

    await screen.findByText("Filtered queue 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));
    await act(async () => {
      save.resolve({ annotations: [{ ...initialLowAnnotation, confidence: 0.8 }] });
    });

    await waitFor(() => expect(screen.getByText("Unsaved")).toBeTruthy());
    expect(sourceRequests).toBe(1);
    expect(screen.queryByText(/Filtered queue 0/)).toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTitle("Next image (ArrowRight)"));
    await screen.findByText("Filtered queue 1 / 1");
  });

  it("does not advance Save & Next when annotations changed while saving", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const save = deferSaveAnnotations();
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    fireEvent.click(screen.getByRole("button", { name: /^Save & next$/i }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    await openBoxMenu(container);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251"));

    await act(async () => {
      save.resolve({ annotations });
    });

    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    expect(container.querySelector(".bbox-group > rect")?.getAttribute("x")).toBe("251");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(api.images).toHaveBeenCalledOnce();
  });


  it("scopes a late save response to its source after navigation", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const save = deferSaveAnnotations();
    render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByText("0 annotations");

    await act(async () => {
      save.resolve({ annotations: [annotations[0]] });
    });

    expect(screen.getAllByText(secondImage.path).length).toBeGreaterThan(0);
    expect(screen.getByText("0 annotations")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(api.images).toHaveBeenCalledOnce();
  });

  it("keeps the destination position valid when a save response arrives after navigation", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    vi.mocked(api.imagePosition).mockImplementation(async (_projectId, imageId) => (
      imageId === secondImage.id
        ? { filtered_index: 2, filtered_total: 2, project_index: 2, project_total: 2 }
        : { filtered_index: 1, filtered_total: 2, project_index: 1, project_total: 2 }
    ));
    const save = deferSaveAnnotations();
    render(<ReviewPage project={project} t={(key) => key} />);

    await screen.findByText("Filtered queue 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByText("Filtered queue 2 / 2");

    await act(async () => {
      save.resolve({ annotations });
    });

    await waitFor(() => expect(screen.getByText("Filtered queue 2 / 2")).toBeTruthy());
    expect(vi.mocked(api.imagePosition).mock.calls.slice(1).every(([, imageId]) => imageId === secondImage.id)).toBe(true);
  });

  it("does not advance after navigating away from and back to the save source", async () => {
    const secondImage = { ...image, id: "image-2", path: "/tmp/project/image-2.jpg" };
    mockReviewApi();
    vi.mocked(api.images).mockResolvedValue([image, secondImage]);
    vi.mocked(api.annotations).mockImplementation(async (imageId) => ({
      image: imageId === secondImage.id ? secondImage : image,
      annotations: imageId === secondImage.id ? [] : annotations
    }));
    const save = deferSaveAnnotations();
    render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");

    fireEvent.click(screen.getByRole("button", { name: /^Save & next$/i }));
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByText("0 annotations");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await screen.findByText("2 annotations");

    await act(async () => {
      save.resolve({ annotations });
    });

    expect(screen.getAllByText(image.path).length).toBeGreaterThan(0);
    expect(screen.getByText("2 annotations")).toBeTruthy();
    expect(api.images).toHaveBeenCalledOnce();
  });

  it("restores the selected class with history before zero-argument Relabel", async () => {
    mockReviewApi();
    vi.mocked(api.annotations).mockResolvedValue({
      image,
      annotations: [annotations[0], { ...annotations[1], class_id: 1, class_name: "person" }]
    });
    const { container } = render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    const svg = setCanvasBounds(container);

    await openBoxMenu(container);
    fireEvent.click(screen.getByRole("menuitem", { name: /ID 1.*person/ }));
    await waitFor(() => expect(container.querySelector(".bbox-group text")?.textContent).toBe("person"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(container.querySelector(".bbox-group text")?.textContent).toBe("car"));
    expect(screen.getByRole("button", { name: /car.*Key 1/i }).classList.contains("is-active")).toBe(true);

    fireEvent.pointerDown(svg, { button: 0, pointerId: 55, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 55, clientX: 700, clientY: 400 });
    fireEvent.pointerUp(svg, { pointerId: 55, clientX: 700, clientY: 400 });
    await waitFor(() => expect(container.querySelectorAll(".bbox-group.is-selected")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Relabel$/ }));

    await waitFor(() => {
      expect(Array.from(container.querySelectorAll(".bbox-group text"), (node) => node.textContent)).toEqual(["car", "car"]);
    });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => {
      expect(Array.from(container.querySelectorAll(".bbox-group text"), (node) => node.textContent)).toEqual(["car", "person"]);
    });
  });

  it("leaves Review-owned shortcuts inert inside editable controls and preserves Shift+S", async () => {
    mockReviewApi();
    render(<ReviewPage project={project} t={(key) => key} />);
    await screen.findByText("2 annotations");
    const status = screen.getAllByRole("combobox")[0];

    fireEvent.keyDown(status, { key: "b" });
    expect(screen.getByRole("button", { name: /Select.*D/ }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "S", shiftKey: true });
    await waitFor(() => expect(api.saveAnnotations).toHaveBeenCalledOnce());
  });
});
