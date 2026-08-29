import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Application, Ticker } from "pixi.js";
import type { Camera, LaidOutEdge, LaidOutGraph, LaidOutNode } from "../graph";
import { KIND_LABEL, pointsLabel } from "../ui/format";
import {
  cubicTangent,
  dashPath,
  diffWorldNodes,
  edgeCurve,
  PLAQUE_CAPTION_FONT_SIZE,
  PLAQUE_CAPTION_GAP,
  PLAQUE_OFFSET_Y,
  PLAQUE_PAD_BOTTOM,
  PLAQUE_PAD_TOP,
  PLAQUE_SUB_FONT_SIZE,
  PLAQUE_TITLE_FONT_SIZE,
  PLAQUE_TITLE_GAP,
  PLAQUE_WIDTH,
  PLAQUE_WRAP_WIDTH,
  plaqueHeight,
  plaqueScale,
  plaqueVisible,
  renderedPlaqueHeight,
  SOCKET_RADIUS,
  socketCenter,
} from "./relicGeometry";
import {
  layoutSkinGraphic,
  paintGlow,
  paintHalo,
  paintSocket,
  SKIN_FRAME_SCALE,
} from "./skins";

/**
 * Imperative Pixi scene for the relic slab. Pixi is a renderer only: it
 * consumes `LaidOutGraph` plus the existing camera and never re-derives kinds,
 * unlocks, layout, or camera math. React hands snapshots in via `update` and
 * `setCamera`; the world diffs by node id and mutates Graphics in place.
 */

const CONDUIT_GROOVE = 0x05070a;
const CONDUIT_DASH = 0x6d7681;
const CONDUIT_GOLD = 0xd9a441;
const CONDUIT_CYAN = 0x59e0f2;
const SELECTION_RING = 0x24563d;
const AURA_TINT = 0xf0c25a;

const BREATH_PERIOD_S = 2.4;
const BREATH_BASE = 0.46;
const BREATH_AMPLITUDE = 0.08;

/** Plaque fade speed (alpha per second) when the LOD threshold is crossed. */
const PLAQUE_FADE_RATE = 8;

const FONT_UI = '"Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif';

// Skin sizes are quoted at the art's rim radius; the shared frame is slightly
// wider so the completed halo fits, so every graphic scales up to match.
const SOCKET_SIZE = SOCKET_RADIUS * 2 * SKIN_FRAME_SCALE;
const AURA_SIZE = 112 * SKIN_FRAME_SCALE;
const GLOW_SIZE = 96 * SKIN_FRAME_SCALE;
const HALO_SIZE = 84 * SKIN_FRAME_SCALE;

/** Longest elision loop before the plaque keeps whatever is left. */
const ELIDE_STEPS = 40;

const CAPTION_COLORS = {
  blocked: 0xe0a08e,
  unlock: 0x7fd7e8,
  budget: 0xe8b25f,
} as const;

interface NodeView {
  container: Container;
  node: LaidOutNode;
  socket: Graphics;
  glow: Graphics;
  halo: Graphics;
  aura: Graphics;
  ring: Graphics;
  paintedKind: LaidOutNode["kind"];
  plaque: Container;
  plaqueBg: Graphics;
  plaqueTitle: Text;
  plaqueSub: Text;
  plaqueCaption: Text;
  /** Current plaque opacity; -1 until the first LOD pass snaps it into place. */
  plaqueAlpha: number;
  /** Opacity the plaque is fading toward (0 or 1). */
  plaqueTarget: number;
  renderedPlaqueHeight: number;
}

function edgeSignatureOf(edges: readonly LaidOutEdge[]): string {
  return edges
    .map((e) => `${e.from}>${e.to}:${e.kind}:${e.x1},${e.y1},${e.x2},${e.y2}`)
    .join(";");
}

function plaqueStackHeight(view: NodeView): number {
  const caption = view.plaqueCaption.visible
    ? view.plaqueCaption.height + PLAQUE_CAPTION_GAP
    : 0;
  const sub = view.plaqueSub.visible
    ? view.plaqueSub.height + PLAQUE_TITLE_GAP
    : 0;
  return (
    PLAQUE_PAD_TOP +
    view.plaqueTitle.height +
    sub +
    caption +
    PLAQUE_PAD_BOTTOM
  );
}

function trimTail(text: string): string {
  return text.slice(0, text.length - Math.max(1, Math.ceil(text.length * 0.15))).trimEnd();
}

/**
 * Shortens plaque text until it fits the allocated plaque height for the
 * node, so a very long title can neither spill past the plaque nor push the
 * drawn plaque beyond the box the tree hit-tests clicks against.
 */
function elideToFit(view: NodeView, node: LaidOutNode, height: number): void {
  let title = node.title;
  let caption = node.caption ?? "";
  if (plaqueStackHeight(view) > height && view.plaqueCaption.visible) {
    view.plaqueCaption.visible = false;
  }
  if (plaqueStackHeight(view) > height) view.plaqueSub.visible = false;
  for (let step = 0; step < ELIDE_STEPS; step += 1) {
    if (plaqueStackHeight(view) <= height) return;
    if (view.plaqueCaption.visible && caption.length > title.length) {
      caption = trimTail(caption);
      view.plaqueCaption.text = `${caption}…`;
    } else if (title.length > 1) {
      title = trimTail(title);
      view.plaqueTitle.text = `${title}…`;
    } else if (view.plaqueCaption.visible && caption.length > 1) {
      caption = trimTail(caption);
      view.plaqueCaption.text = `${caption}…`;
    } else {
      return;
    }
  }
}

export class RelicWorld {
  private readonly app: Application;
  private readonly root = new Container();
  private readonly conduits = new Graphics();
  private readonly nodeLayer = new Container();
  private readonly nodes = new Map<string, NodeView>();
  private lastNodes: readonly LaidOutNode[] = [];
  private edgeSignature = "";
  private cameraK = 1;
  private hoveredId: string | null = null;
  private breathTime = 0;
  private readonly reducedMotion: boolean;
  private disposed = false;

  constructor(app: Application) {
    this.app = app;
    // `root` is a plain transform container, deliberately *not* a render group.
    // A render group hands its subtree to the GPU as an instruction set of its
    // own, and a board this size gains nothing from that while inheriting a way
    // to fail that leaves no trace: when the group's instructions do not rebuild
    // for a scene that changes underneath them, the slab paints its clear colour
    // and nothing else, with no error anywhere. Without it the conduits and the
    // node layer draw in the stage's own render group.
    this.root.addChild(this.conduits);
    this.root.addChild(this.nodeLayer);
    app.stage.addChild(this.root);
    this.reducedMotion =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!this.reducedMotion) {
      app.ticker.add(this.tick, this);
    }
  }

  update(tree: LaidOutGraph): void {
    if (this.disposed) return;
    const diff = diffWorldNodes(this.lastNodes, tree.nodes);
    for (const id of diff.removed) {
      const view = this.nodes.get(id);
      if (!view) continue;
      this.nodeLayer.removeChild(view.container);
      view.container.destroy({ children: true });
      this.nodes.delete(id);
    }
    const changed = new Set([
      ...diff.added.map((n) => n.id),
      ...diff.updated.map((n) => n.id),
    ]);
    for (const node of tree.nodes) {
      let view = this.nodes.get(node.id);
      if (!view) {
        view = this.createNodeView(node);
        this.nodes.set(node.id, view);
        this.nodeLayer.addChild(view.container);
      }
      view.node = node;
      if (changed.has(node.id)) this.applyNode(view, node);
    }
    const signature = edgeSignatureOf(tree.edges);
    if (signature !== this.edgeSignature) {
      this.edgeSignature = signature;
      this.redrawConduits(tree.edges);
    }
    this.lastNodes = tree.nodes;
    this.updatePlaques();
  }

  setCamera(camera: Camera): void {
    if (this.disposed) return;
    this.root.position.set(camera.x, camera.y);
    this.root.scale.set(camera.k);
    if (camera.k !== this.cameraK) {
      this.cameraK = camera.k;
      this.updatePlaques();
    }
  }

  setHoveredId(id: string | null): void {
    if (this.disposed || id === this.hoveredId) return;
    this.hoveredId = id;
    this.updatePlaques();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.app.ticker.remove(this.tick, this);
    } catch {
      // The shared ticker may already be torn down by the Application.
    }
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    this.nodes.clear();
  }

  private tick(ticker: Ticker): void {
    this.breathTime += ticker.deltaMS / 1000;
    const phase = (this.breathTime % BREATH_PERIOD_S) / BREATH_PERIOD_S;
    const alpha =
      BREATH_BASE +
      BREATH_AMPLITUDE * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
    const fadeStep = Math.min(1, (ticker.deltaMS / 1000) * PLAQUE_FADE_RATE);
    for (const view of this.nodes.values()) {
      if (view.glow.visible) view.glow.alpha = alpha;
      if (view.plaqueAlpha !== view.plaqueTarget) {
        let next =
          view.plaqueAlpha +
          (view.plaqueTarget - view.plaqueAlpha) * fadeStep;
        if (Math.abs(view.plaqueTarget - next) < 0.02) next = view.plaqueTarget;
        view.plaqueAlpha = next;
        view.plaque.alpha = next;
        if (next === 0 && view.plaqueTarget === 0) view.plaque.visible = false;
      }
    }
  }

  private createNodeView(node: LaidOutNode): NodeView {
    const container = new Container();
    const aura = new Graphics();
    paintGlow(aura);
    layoutSkinGraphic(aura, AURA_SIZE);
    aura.tint = AURA_TINT;
    aura.alpha = 0.4;
    aura.blendMode = "add";
    const glow = new Graphics();
    paintGlow(glow);
    layoutSkinGraphic(glow, GLOW_SIZE);
    glow.tint = 0xffd27a;
    glow.alpha = this.reducedMotion ? BREATH_BASE + BREATH_AMPLITUDE : BREATH_BASE;
    glow.blendMode = "add";
    const halo = new Graphics();
    paintHalo(halo);
    layoutSkinGraphic(halo, HALO_SIZE);
    halo.alpha = 0.9;
    const socket = new Graphics();
    paintSocket(socket, node.kind);
    layoutSkinGraphic(socket, SOCKET_SIZE);
    const ring = new Graphics();

    const plaque = new Container();
    const plaqueBg = new Graphics();
    const plaqueTitle = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT_UI,
        fontSize: PLAQUE_TITLE_FONT_SIZE,
        fontWeight: "600",
        fill: 0xf1ebe0,
        align: "center",
        wordWrap: true,
        wordWrapWidth: PLAQUE_WRAP_WIDTH,
        breakWords: true,
      }),
    });
    plaqueTitle.anchor.set(0.5, 0);
    const plaqueSub = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT_UI,
        fontSize: PLAQUE_SUB_FONT_SIZE,
        fill: 0xc7bdab,
        align: "center",
      }),
    });
    plaqueSub.anchor.set(0.5, 0);
    const plaqueCaption = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT_UI,
        fontSize: PLAQUE_CAPTION_FONT_SIZE,
        fill: 0xc7bdab,
        align: "center",
        wordWrap: true,
        wordWrapWidth: PLAQUE_WRAP_WIDTH,
        breakWords: true,
      }),
    });
    plaqueCaption.anchor.set(0.5, 0);
    plaque.addChild(plaqueBg, plaqueTitle, plaqueSub, plaqueCaption);
    plaque.position.set(0, PLAQUE_OFFSET_Y);
    // Hidden until the first `updatePlaques` decides (and snaps) its LOD state.
    plaque.visible = false;
    plaque.alpha = 0;

    container.addChild(aura, glow, halo, socket, ring, plaque);
    container.eventMode = "none";
    return {
      container,
      node,
      socket,
      glow,
      halo,
      aura,
      ring,
      paintedKind: node.kind,
      plaque,
      plaqueBg,
      plaqueTitle,
      plaqueSub,
      plaqueCaption,
      plaqueAlpha: -1,
      plaqueTarget: 0,
      renderedPlaqueHeight: 0,
    };
  }

  private applyNode(view: NodeView, node: LaidOutNode): void {
    const center = socketCenter(node);
    view.container.position.set(center.x, center.y);
    if (view.paintedKind !== node.kind) {
      paintSocket(view.socket, node.kind);
      layoutSkinGraphic(view.socket, SOCKET_SIZE);
      view.paintedKind = node.kind;
    }
    view.glow.visible = node.kind === "eligible";
    view.halo.visible = node.unlocksIfCompleted;
    view.aura.visible = node.selected;

    view.ring.clear();
    if (node.selected) {
      view.ring
        .circle(0, 0, SOCKET_RADIUS + 3)
        .stroke({ width: 3, color: SELECTION_RING });
    }

    if (node.caption) {
      view.plaqueCaption.style.fill = node.captionTone
        ? CAPTION_COLORS[node.captionTone]
        : 0xc7bdab;
    }

    const height = plaqueVisible(node, this.cameraK, this.hoveredId)
      ? renderedPlaqueHeight(node, this.cameraK)
      : plaqueHeight(node);
    this.layoutPlaque(view, node, height);
  }

  private layoutPlaque(view: NodeView, node: LaidOutNode, height: number): void {
    view.plaqueTitle.text = node.title;
    view.plaqueSub.visible = true;
    view.plaqueSub.text = `${pointsLabel(node.cost)} · ${KIND_LABEL[node.kind]}`;
    view.plaqueCaption.visible = Boolean(node.caption);
    view.plaqueCaption.text = node.caption ?? "";
    elideToFit(view, node, height);
    view.plaqueTitle.position.set(0, PLAQUE_PAD_TOP);
    const subY = PLAQUE_PAD_TOP + view.plaqueTitle.height + PLAQUE_TITLE_GAP;
    view.plaqueSub.position.set(0, subY);
    view.plaqueCaption.position.set(
      0,
      subY + view.plaqueSub.height + PLAQUE_CAPTION_GAP,
    );

    view.plaqueBg
      .clear()
      .roundRect(-PLAQUE_WIDTH / 2, 0, PLAQUE_WIDTH, height, 6)
      .fill({ color: 0x0c1016, alpha: 0.72 })
      .stroke({ width: 1, color: 0x2a2f38, alpha: 0.9 });
    view.renderedPlaqueHeight = height;
  }

  /**
   * LOD plaque pass: which plaques show, how big they render, and where their
   * fade is heading. Highlighted plaques (selected, hovered, unlocks-next)
   * counter-scale below the LOD threshold so they stay legible; everything
   * else fades out smoothly instead of popping.
   */
  private updatePlaques(): void {
    for (const view of this.nodes.values()) {
      const visible = plaqueVisible(view.node, this.cameraK, this.hoveredId);
      const height = renderedPlaqueHeight(view.node, this.cameraK);
      if (visible && height !== view.renderedPlaqueHeight) {
        this.layoutPlaque(view, view.node, height);
      }
      view.plaque.scale.set(plaqueScale(view.node, this.cameraK));
      const target = visible ? 1 : 0;
      view.plaqueTarget = target;
      // First pass after creation snaps instead of fading in from nothing.
      if (this.reducedMotion || view.plaqueAlpha < 0) {
        view.plaqueAlpha = target;
        view.plaque.alpha = target;
        view.plaque.visible = visible;
        continue;
      }
      if (visible) view.plaque.visible = true;
    }
  }

  private redrawConduits(edges: readonly LaidOutEdge[]): void {
    const g = this.conduits;
    g.clear();
    for (const edge of edges) {
      const curve = edgeCurve(edge);
      // Carved groove first: every conduit sits in the same dark channel.
      g.moveTo(curve.from.x, curve.from.y)
        .bezierCurveTo(
          curve.c1.x,
          curve.c1.y,
          curve.c2.x,
          curve.c2.y,
          curve.to.x,
          curve.to.y,
        )
        .stroke({ width: 7, color: CONDUIT_GROOVE, alpha: 0.85, cap: "round" });

      let headColor: number = CONDUIT_DASH;
      if (edge.kind === "blocking") {
        // Empty groove: dashed iron fill.
        for (const dash of dashPath(edge)) {
          const first = dash[0];
          if (!first) continue;
          g.moveTo(first.x, first.y);
          for (const point of dash.slice(1)) g.lineTo(point.x, point.y);
          g.stroke({ width: 2.4, color: CONDUIT_DASH, cap: "round" });
        }
      } else if (edge.kind === "ready") {
        // Gold inlay: the completed path.
        g.moveTo(curve.from.x, curve.from.y)
          .bezierCurveTo(
            curve.c1.x,
            curve.c1.y,
            curve.c2.x,
            curve.c2.y,
            curve.to.x,
            curve.to.y,
          )
          .stroke({ width: 3, color: CONDUIT_GOLD, cap: "round" });
        headColor = CONDUIT_GOLD;
      } else {
        // Unlock channel: highlighted cyan stream with a gold core.
        g.moveTo(curve.from.x, curve.from.y)
          .bezierCurveTo(
            curve.c1.x,
            curve.c1.y,
            curve.c2.x,
            curve.c2.y,
            curve.to.x,
            curve.to.y,
          )
          .stroke({ width: 3.6, color: CONDUIT_CYAN, alpha: 0.9, cap: "round" })
          .moveTo(curve.from.x, curve.from.y)
          .bezierCurveTo(
            curve.c1.x,
            curve.c1.y,
            curve.c2.x,
            curve.c2.y,
            curve.to.x,
            curve.to.y,
          )
          .stroke({ width: 1.4, color: CONDUIT_GOLD, cap: "round" });
        headColor = CONDUIT_CYAN;
      }

      const tangent = cubicTangent(curve, 1);
      const tip = {
        x: curve.to.x + tangent.x * 2,
        y: curve.to.y + tangent.y * 2,
      };
      const base = {
        x: curve.to.x - tangent.x * 10,
        y: curve.to.y - tangent.y * 10,
      };
      const perp = { x: -tangent.y, y: tangent.x };
      g.poly([
        tip.x,
        tip.y,
        base.x + perp.x * 5,
        base.y + perp.y * 5,
        base.x - perp.x * 5,
        base.y - perp.y * 5,
      ]).fill({ color: headColor });
    }
  }
}
