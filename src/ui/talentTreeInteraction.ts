export interface ViewportBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function isPointInsideViewport(
  bounds: ViewportBounds,
  point: { clientX: number; clientY: number },
): boolean {
  return (
    point.clientX >= bounds.left &&
    point.clientX <= bounds.right &&
    point.clientY >= bounds.top &&
    point.clientY <= bounds.bottom
  );
}
