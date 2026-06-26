import type { Annotation } from "../types";

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeRect(rect: Rect): Rect {
  const left = Math.min(rect.x, rect.x + rect.width);
  const right = Math.max(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const bottom = Math.max(rect.y, rect.y + rect.height);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function yoloToRect(
  box: Pick<Annotation, "x_center" | "y_center" | "width" | "height">,
  image: Size
): Rect {
  const width = round6(box.width * image.width);
  const height = round6(box.height * image.height);

  return {
    x: round6(box.x_center * image.width - width / 2),
    y: round6(box.y_center * image.height - height / 2),
    width,
    height
  };
}

export function rectToYolo(rect: Rect, image: Size): Pick<Annotation, "x_center" | "y_center" | "width" | "height"> {
  return {
    x_center: round6((rect.x + rect.width / 2) / image.width),
    y_center: round6((rect.y + rect.height / 2) / image.height),
    width: round6(rect.width / image.width),
    height: round6(rect.height / image.height)
  };
}

export function clampRect(rect: Rect, image: Size): Rect {
  const normalized = normalizeRect(rect);
  const left = Math.min(Math.max(normalized.x, 0), image.width);
  const top = Math.min(Math.max(normalized.y, 0), image.height);
  const right = Math.min(Math.max(normalized.x + normalized.width, 0), image.width);
  const bottom = Math.min(Math.max(normalized.y + normalized.height, 0), image.height);

  return {
    x: round6(left),
    y: round6(top),
    width: round6(Math.max(right - left, 0)),
    height: round6(Math.max(bottom - top, 0))
  };
}
