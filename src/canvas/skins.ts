import { Graphics, Rectangle, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";
import { recordDiagnosticEvent } from "../diagnostics/errorLog";
import type { NodeKind } from "../domain/types";
import { compositeAlphas, mixColor, radialRadii } from "./radialFill";

/**
 * Procedural relic-slab skins. All socket art is baked once into textures at
 * startup (zero image assets, zero network) and reused by every socket sprite.
 */

export interface RelicSkins {
  sockets: Record<NodeKind, Texture>;
  /** Soft radial glow, tinted per use (eligible breathing, selection aura). */
  glow: Texture;
  /** Cyan halo ring for unlocks-next. */
  halo: Texture;
}

const SIZE = 128;
const CENTER = SIZE / 2;
const RIM_RADIUS = 56;
/** Radius of the soft glow disc, in the same 128px art space as the sockets. */
const GLOW_RADIUS = 60;
/** Outer edge of the rim stroke: the radius every sprite size is quoted at. */
const ART_RADIUS = RIM_RADIUS + 4;
/** The completed skin's outer halo reaches furthest, so every skin bakes here. */
const FRAME_RADIUS = RIM_RADIUS + 6;

/**
 * Baked frame over quoted art radius. Without one shared frame each skin's own
 * bounds would set its on-screen scale, and the completed socket - alone in
 * carrying an outer halo - would visibly shrink the moment a node completes.
 */
export const SKIN_FRAME_SCALE = FRAME_RADIUS / ART_RADIUS;

const COLORS = {
  iron: 0x6a7078,
  ironDark: 0x2c2f34,
  granite: 0x41454c,
  graniteDark: 0x2e3136,
  graniteLight: 0x565b63,
  lockGlyph: 0xb9c0c9,
  gold: 0xd9a441,
  goldBright: 0xf7d98a,
  goldDeep: 0x7a5413,
  gemBright: 0x46c78f,
  gemDeep: 0x103b30,
  parchment: 0xf6ecd9,
  moltenBright: 0xf2c25c,
  moltenDeep: 0x7c4f0e,
  radiant: 0xf6cd67,
  radiantHalo: 0xffe9b0,
  check: 0x3a2405,
  pewter: 0x7d8794,
  moonBright: 0x93a0b5,
  moonDeep: 0x303845,
  bars: 0xe4eaf2,
  cyan: 0x59e0f2,
} as const;

/**
 * A radial fill drawn as a stack of plain opaque circles instead of a
 * `FillGradient`. A gradient fill makes Pixi bake a canvas 2D gradient into a
 * texture of its own and draw the shape through a local-space UV transform: an
 * extra texture upload and shader path, per skin, on contexts where that path
 * is exactly what fails silently and leaves the socket blank. Stacked circles
 * use nothing but the flat fills the rest of the skin already draws, and bake
 * without a DOM canvas, so every skin is unit-testable in the node environment.
 */
function fillRadial(
  g: Graphics,
  radius: number,
  inner: number,
  outer: number,
): void {
  const radii = radialRadii(radius);
  for (let i = 0; i < radii.length; i += 1) {
    const t = i / (radii.length - 1);
    g.circle(CENTER, CENTER, radii[i]!).fill(mixColor(outer, inner, t));
  }
}

/**
 * The soft white glow, drawn the same way but fading to transparent. Alpha
 * compounds where circles overlap, so each circle carries the alpha that lifts
 * the accumulated coverage to the falloff the glow wants at that radius.
 */
function fillGlow(g: Graphics, radius: number): void {
  const radii = radialRadii(radius);
  const targets = radii.map((r) => glowAlphaAt(r / radius));
  const alphas = compositeAlphas(targets);
  for (let i = 0; i < radii.length; i += 1) {
    if (alphas[i]! <= 0) continue;
    g.circle(CENTER, CENTER, radii[i]!).fill({
      color: 0xffffff,
      alpha: alphas[i]!,
    });
  }
}

/** Opacity the glow wants at a normalised radius: 1 at the core, 0 at the rim. */
function glowAlphaAt(u: number): number {
  const knee = 0.55;
  if (u >= 1) return 0;
  if (u <= knee) return 1 + (0.45 - 1) * (u / knee);
  return 0.45 * (1 - (u - knee) / (1 - knee));
}

/** Deterministic tiny PRNG so granite speckles bake identically every launch. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(g: Graphics, seed: number): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < 26; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = rand() * (RIM_RADIUS - 10);
    const x = CENTER + Math.cos(angle) * radius;
    const y = CENTER + Math.sin(angle) * radius;
    const color = rand() > 0.5 ? COLORS.graniteDark : COLORS.graniteLight;
    g.circle(x, y, 1 + rand() * 1.6).fill({ color, alpha: 0.35 });
  }
}

/**
 * Bake one skin into a texture. `generateTexture` is the one step here that
 * needs a working renderer, and a renderer that cannot honour it must not take
 * the whole board down with it: the failure is recorded for diagnostics and the
 * sprite falls back to a plain white square. A visibly wrong socket beats a
 * board that paints nothing and says nothing about why.
 */
function bake(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  try {
    draw(g);
    return renderer.generateTexture({
      target: g,
      resolution: 2,
      frame: new Rectangle(
        CENTER - FRAME_RADIUS,
        CENTER - FRAME_RADIUS,
        FRAME_RADIUS * 2,
        FRAME_RADIUS * 2,
      ),
    });
  } catch (error) {
    recordDiagnosticEvent("skins.bake", error);
    return Texture.WHITE;
  } finally {
    g.destroy();
  }
}

/** Exported so its subpaths can be asserted on without a renderer. */
export function drawBlocked(g: Graphics): void {
  g.circle(CENTER, CENTER, RIM_RADIUS).fill(COLORS.granite);
  speckle(g, 20260827);
  g.circle(CENTER, CENTER, RIM_RADIUS - 5).stroke({
    width: 2,
    color: COLORS.ironDark,
    alpha: 0.8,
  });
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 8, color: COLORS.iron });
  // Lock glyph: shackle arc + body. `beginPath` is required - a bare `arc`
  // appends to the subpath the previous `stroke` left open, which strokes a
  // stray connector from that point across the granite face into the shackle.
  g.beginPath();
  g.arc(CENTER, CENTER - 4, 10, Math.PI, Math.PI * 2).stroke({
    width: 5,
    color: COLORS.lockGlyph,
  });
  g.roundRect(CENTER - 13, CENTER - 4, 26, 20, 4).fill(COLORS.lockGlyph);
}

export function drawEligible(g: Graphics): void {
  fillRadial(g, RIM_RADIUS - 4, COLORS.gemBright, COLORS.gemDeep);
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 8, color: COLORS.gold });
  g.circle(CENTER, CENTER, RIM_RADIUS - 5).stroke({
    width: 1.5,
    color: COLORS.goldDeep,
  });
  // Filigree: eight bright beads around the rim.
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4 + Math.PI / 8;
    g.circle(
      CENTER + Math.cos(angle) * RIM_RADIUS,
      CENTER + Math.sin(angle) * RIM_RADIUS,
      2.2,
    ).fill(COLORS.goldBright);
  }
  // Play glyph.
  g.poly([CENTER - 11, CENTER - 15, CENTER + 16, CENTER, CENTER - 11, CENTER + 15])
    .fill(COLORS.parchment);
}

export function drawCompleted(g: Graphics): void {
  fillRadial(g, RIM_RADIUS - 4, COLORS.moltenBright, COLORS.moltenDeep);
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 7, color: COLORS.radiant });
  g.circle(CENTER, CENTER, RIM_RADIUS + 5).stroke({
    width: 2,
    color: COLORS.radiantHalo,
    alpha: 0.9,
  });
  // Check glyph.
  g.moveTo(CENTER - 15, CENTER + 2)
    .lineTo(CENTER - 4, CENTER + 13)
    .lineTo(CENTER + 16, CENTER - 12)
    .stroke({
      width: 7,
      color: COLORS.check,
      cap: "round",
      join: "round",
    });
}

export function drawDeferred(g: Graphics): void {
  fillRadial(g, RIM_RADIUS - 4, COLORS.moonBright, COLORS.moonDeep);
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 8, color: COLORS.pewter });
  // Pause bars glyph.
  g.roundRect(CENTER - 13, CENTER - 15, 9, 30, 2).fill(COLORS.bars);
  g.roundRect(CENTER + 4, CENTER - 15, 9, 30, 2).fill(COLORS.bars);
}

/** Centre and radius of the frame every skin bakes into, for the same test. */
export const SKIN_ART_CENTER = CENTER;
export const SKIN_FRAME_RADIUS = FRAME_RADIUS;

export function bakeRelicSkins(renderer: Renderer): RelicSkins {
  return {
    sockets: {
      blocked: bake(renderer, drawBlocked),
      eligible: bake(renderer, drawEligible),
      completed: bake(renderer, drawCompleted),
      deferred: bake(renderer, drawDeferred),
    },
    glow: bake(renderer, (g) => fillGlow(g, GLOW_RADIUS)),
    halo: bake(renderer, (g) => {
      g.circle(CENTER, CENTER, 58).stroke({ width: 5, color: COLORS.cyan });
    }),
  };
}

export function destroyRelicSkins(skins: RelicSkins): void {
  for (const texture of Object.values(skins.sockets)) release(texture);
  release(skins.glow);
  release(skins.halo);
}

/**
 * A baked skin owns its texture and frees it; the shared `Texture.WHITE` a
 * failed bake falls back to is Pixi's own and outlives every world.
 */
function release(texture: Texture): void {
  if (texture === Texture.WHITE) return;
  texture.destroy(true);
}
