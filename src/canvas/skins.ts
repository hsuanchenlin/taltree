import { FillGradient, Graphics, Rectangle, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";
import type { NodeKind } from "../domain/types";

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

function radial(inner: number, outer: number): FillGradient {
  return new FillGradient({
    type: "radial",
    colorStops: [
      { offset: 0, color: inner },
      { offset: 1, color: outer },
    ],
  });
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

function bake(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    resolution: 2,
    frame: new Rectangle(
      CENTER - FRAME_RADIUS,
      CENTER - FRAME_RADIUS,
      FRAME_RADIUS * 2,
      FRAME_RADIUS * 2,
    ),
  });
  g.destroy();
  return texture;
}

function drawBlocked(g: Graphics): void {
  g.circle(CENTER, CENTER, RIM_RADIUS).fill(COLORS.granite);
  speckle(g, 20260827);
  g.circle(CENTER, CENTER, RIM_RADIUS - 5).stroke({
    width: 2,
    color: COLORS.ironDark,
    alpha: 0.8,
  });
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 8, color: COLORS.iron });
  // Lock glyph: shackle arc + body.
  g.arc(CENTER, CENTER - 4, 10, Math.PI, Math.PI * 2).stroke({
    width: 5,
    color: COLORS.lockGlyph,
  });
  g.roundRect(CENTER - 13, CENTER - 4, 26, 20, 4).fill(COLORS.lockGlyph);
}

function drawEligible(g: Graphics): void {
  g.circle(CENTER, CENTER, RIM_RADIUS - 4).fill(
    radial(COLORS.gemBright, COLORS.gemDeep),
  );
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

function drawCompleted(g: Graphics): void {
  g.circle(CENTER, CENTER, RIM_RADIUS - 4).fill(
    radial(COLORS.moltenBright, COLORS.moltenDeep),
  );
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

function drawDeferred(g: Graphics): void {
  g.circle(CENTER, CENTER, RIM_RADIUS - 4).fill(
    radial(COLORS.moonBright, COLORS.moonDeep),
  );
  g.circle(CENTER, CENTER, RIM_RADIUS).stroke({ width: 8, color: COLORS.pewter });
  // Pause bars glyph.
  g.roundRect(CENTER - 13, CENTER - 15, 9, 30, 2).fill(COLORS.bars);
  g.roundRect(CENTER + 4, CENTER - 15, 9, 30, 2).fill(COLORS.bars);
}

export function bakeRelicSkins(renderer: Renderer): RelicSkins {
  return {
    sockets: {
      blocked: bake(renderer, drawBlocked),
      eligible: bake(renderer, drawEligible),
      completed: bake(renderer, drawCompleted),
      deferred: bake(renderer, drawDeferred),
    },
    glow: bake(renderer, (g) => {
      g.circle(CENTER, CENTER, 60).fill(
        new FillGradient({
          type: "radial",
          colorStops: [
            { offset: 0, color: "#ffffff" },
            { offset: 0.55, color: "rgba(255,255,255,0.45)" },
            { offset: 1, color: "rgba(255,255,255,0)" },
          ],
        }),
      );
    }),
    halo: bake(renderer, (g) => {
      g.circle(CENTER, CENTER, 58).stroke({ width: 5, color: COLORS.cyan });
    }),
  };
}

export function destroyRelicSkins(skins: RelicSkins): void {
  for (const texture of Object.values(skins.sockets)) texture.destroy(true);
  skins.glow.destroy(true);
  skins.halo.destroy(true);
}
