/**
 * Host/canvas sizing for the relic slab.
 *
 * Pixi's `resizeTo` only listens for window resizes, and a canvas without an
 * explicit CSS fill can desync from its host: a 0x0 drawing buffer, or the
 * 800x600 default stretched into a black rectangle. These helpers are DOM- and
 * Pixi-free so they carry their own unit tests; `TalentTreePixi` applies them.
 */

export interface ContentSize {
  width: number;
  height: number;
}

export function hostContentSize(host: {
  clientWidth: number;
  clientHeight: number;
}): ContentSize | null {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Stretch the canvas to its host so CSS pixels and the drawing buffer can agree. */
export function applyCanvasFillStyle(style: {
  display: string;
  width: string;
  height: string;
}): void {
  style.display = "block";
  style.width = "100%";
  style.height = "100%";
}

/**
 * Size the renderer to the host's current CSS box. Returns null when the host
 * has not been measured yet, so the caller can wait instead of baking 0x0.
 */
export function resizeRendererToHost(
  renderer: { resize: (width: number, height: number) => void },
  host: { clientWidth: number; clientHeight: number },
): ContentSize | null {
  const size = hostContentSize(host);
  if (!size) return null;
  renderer.resize(size.width, size.height);
  return size;
}
