type CanvasScaleInput = {
  imageWidth: number;
  renderedWidth: number;
};

type CanvasAffordance = {
  cornerRadius: number;
  strokeWidth: number;
  selectedStrokeWidth: number;
  handleRadius: number;
  handleStrokeWidth: number;
  labelHeight: number;
  labelPaddingX: number;
  labelGap: number;
  labelBaselineOffset: number;
  labelCharWidth: number;
  minLabelWidth: number;
  fontSize: number;
};

export function screenPixelsToImageUnits(pixels: number, { imageWidth, renderedWidth }: CanvasScaleInput): number {
  if (imageWidth <= 0 || renderedWidth <= 0) return pixels;
  return pixels * (imageWidth / renderedWidth);
}

export function getCanvasAffordance(scale: CanvasScaleInput): CanvasAffordance {
  // SVG non-scaling strokes already use screen pixels. Only geometry needs conversion.
  return {
    cornerRadius: screenPixelsToImageUnits(6, scale),
    strokeWidth: 4,
    selectedStrokeWidth: 6,
    handleRadius: screenPixelsToImageUnits(7, scale),
    handleStrokeWidth: 4,
    labelHeight: screenPixelsToImageUnits(20, scale),
    labelPaddingX: screenPixelsToImageUnits(8, scale),
    labelGap: screenPixelsToImageUnits(4, scale),
    labelBaselineOffset: screenPixelsToImageUnits(14, scale),
    labelCharWidth: screenPixelsToImageUnits(7, scale),
    minLabelWidth: screenPixelsToImageUnits(54, scale),
    fontSize: screenPixelsToImageUnits(12, scale)
  };
}
