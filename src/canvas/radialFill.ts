/**
 * Pure maths for drawing a radial fill as a stack of plain circles.
 *
 * The relic skins used to reach for Pixi's `FillGradient`, which bakes a canvas
 * 2D gradient into a texture of its own and draws the shape through a
 * local-space UV transform. That is a second texture upload and a second shader
 * path for art that is otherwise flat circles and strokes, and it is a path
 * that can come back empty without raising anything - a socket that silently
 * disappears. Stacking circles needs nothing but the flat fills the rest of the
 * skin already draws.
 *
 * Pixi- and DOM-free on purpose, so it carries its own unit tests.
 */

/**
 * Rings per unit of radius. A fixed ring count bands visibly on the widest
 * fill - the soft glow, whose opacity ramp is the one a person can see steps
 * in - so the count follows the radius instead: three rings per unit keeps
 * every ring under half a pixel at the 2x renderer resolution the skins draw at.
 */
const RINGS_PER_RADIUS = 3;

/** Floor for a tiny fill, so the ramp never collapses to a flat disc. */
export const MIN_RADIAL_STEPS = 8;

/** How many rings a fill of this radius is drawn from. */
export function radialSteps(radius: number): number {
  return Math.max(MIN_RADIAL_STEPS, Math.ceil(Math.abs(radius) * RINGS_PER_RADIUS));
}

/**
 * Ring radii from the rim inwards, so later (smaller) circles paint over
 * earlier ones. The last radius is 0 - it draws nothing, and exists so the
 * ring before it carries the full inner colour right into the centre.
 */
export function radialRadii(radius: number, steps = radialSteps(radius)): number[] {
  const count = Math.max(2, Math.floor(steps));
  const radii: number[] = [];
  for (let i = 0; i < count; i += 1) {
    radii.push((radius * (count - 1 - i)) / (count - 1));
  }
  return radii;
}

/** Linear blend between two 24-bit RGB colours; `t` 0 gives `from`, 1 gives `to`. */
export function mixColor(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const channel = (shift: number): number =>
    Math.round(
      ((from >> shift) & 0xff) +
        ((((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * clamped),
    );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * Per-circle opacities that composite to `targets`.
 *
 * Each circle covers every circle after it, so opacity accumulates: painting
 * `a` over accumulated coverage `acc` leaves `acc + a * (1 - acc)`. Inverting
 * that gives the opacity each circle must carry to lift the stack to the
 * opacity the fill wants at its radius. A target below what is already
 * accumulated cannot be reached by painting more, so it clamps to 0.
 */
export function compositeAlphas(targets: readonly number[]): number[] {
  const alphas: number[] = [];
  let accumulated = 0;
  for (const target of targets) {
    const wanted = Math.min(1, Math.max(0, target));
    if (accumulated >= 1) {
      alphas.push(0);
      continue;
    }
    const alpha = Math.min(1, Math.max(0, (wanted - accumulated) / (1 - accumulated)));
    alphas.push(alpha);
    accumulated += alpha * (1 - accumulated);
  }
  return alphas;
}

/** What `compositeAlphas` actually produces, for asserting the inverse holds. */
export function compositeCoverage(alphas: readonly number[]): number[] {
  const coverage: number[] = [];
  let accumulated = 0;
  for (const alpha of alphas) {
    accumulated += alpha * (1 - accumulated);
    coverage.push(accumulated);
  }
  return coverage;
}
