import type { Rect, Size } from "../../annotation/geometry";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function fitZoom(image: Size, viewport: Size): number {
  if (!image.width || !image.height || !viewport.width || !viewport.height) return 1;
  return clampZoom(Math.min(viewport.width / image.width, viewport.height / image.height));
}

export function zoomAroundPoint(input: {
  zoom: number;
  nextZoom: number;
  scrollLeft: number;
  scrollTop: number;
  pointerX: number;
  pointerY: number;
}) {
  const ratio = input.nextZoom / input.zoom;
  return {
    scrollLeft: (input.scrollLeft + input.pointerX) * ratio - input.pointerX,
    scrollTop: (input.scrollTop + input.pointerY) * ratio - input.pointerY
  };
}

export function zoomToRects(rects: Rect[], viewport: Size, padding: number) {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const width = right - left + padding * 2;
  const height = bottom - top + padding * 2;
  return {
    zoom: clampZoom(Math.min(viewport.width / width, viewport.height / height)),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}
