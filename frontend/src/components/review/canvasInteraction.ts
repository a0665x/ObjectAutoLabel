import type { Rect, Size } from "../../annotation/geometry";

export type Point = { x: number; y: number };
export type PersistentTool = "select" | "draw" | "pan";
export type EffectiveTool = PersistentTool | "lasso";
export type CanvasInteraction =
  | { kind: "draw"; pointerId: number; start: Point; current: Point }
  | { kind: "lasso"; pointerId: number; start: Point; current: Point }
  | { kind: "move"; pointerId: number; ids: string[]; start: Point; originals: Map<string, Rect> }
  | { kind: "resize"; pointerId: number; id: string; anchor: Point; current: Point }
  | { kind: "pan"; pointerId: number; startClient: Point; scrollLeft: number; scrollTop: number };

export function clientPointToImage(
  client: Pick<PointerEvent, "clientX" | "clientY">,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  image: Size
): Point | null {
  if (bounds.width <= 0 || bounds.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const x = ((client.clientX - bounds.left) / bounds.width) * image.width;
  const y = ((client.clientY - bounds.top) / bounds.height) * image.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function resolveEffectiveTool(input: {
  persistent: PersistentTool;
  lastEdit: "select" | "draw";
  button: number;
  space: boolean;
  modifier: boolean;
  shift: boolean;
  hit: "background" | "box" | "handle";
}): EffectiveTool {
  if (input.button === 1 || input.space) return "pan";
  if (input.modifier) return input.persistent === "select" ? "draw" : input.persistent === "draw" ? "select" : input.lastEdit;
  if (input.persistent === "select" && input.shift && input.hit === "background") return "lasso";
  return input.persistent;
}

export function previewRectFromPoints(start: Point, current: Point): Rect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}
