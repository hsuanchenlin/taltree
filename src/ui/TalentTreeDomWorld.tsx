import { useId } from "react";
import type { Camera, LaidOutGraph, LaidOutNode } from "../graph";
import { KIND_LABEL, pointsLabel } from "./format";
import { KindMark } from "./glyphs";

/**
 * The original SVG/DOM tree world. It remains the WebGL fallback (and the
 * markup the node-environment tests assert on) while the relic slab renders
 * through Pixi. Do not add canvas-only features here.
 */

interface TalentTreeDomWorldProps {
  tree: LaidOutGraph;
  camera: Camera;
  onSelect: (id: string) => void;
}

export function TalentTreeDomWorld({
  tree,
  camera,
  onSelect,
}: TalentTreeDomWorldProps) {
  const markerId = useId().replace(/:/g, "");
  return (
    <div
      className="tree-world"
      style={{
        width: tree.width,
        height: tree.height,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`,
      }}
    >
      <svg
        className="tree-edges"
        width={tree.width}
        height={tree.height}
        viewBox={`0 0 ${tree.width} ${tree.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <marker
            id={`${markerId}-ready`}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--completed)" />
          </marker>
          <marker
            id={`${markerId}-blocking`}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--blocked)" />
          </marker>
          <marker
            id={`${markerId}-unlock`}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--eligible)" />
          </marker>
        </defs>
        {tree.edges.map((item) => (
          <path
            key={`${item.from}->${item.to}`}
            className={`tree-edge tree-edge-${item.kind}`}
            d={item.d}
            data-edge={`${item.from}->${item.to}`}
            data-edge-kind={item.kind}
            markerEnd={`url(#${markerId}-${item.kind})`}
          />
        ))}
      </svg>
      {tree.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          id={`tree-node-${node.id}`}
          className={nodeClass(node)}
          style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
          tabIndex={node.selected ? 0 : -1}
          data-node-id={node.id}
          data-kind={node.kind}
          data-selected={node.selected ? "true" : "false"}
          data-unlocks={node.unlocksIfCompleted ? "true" : "false"}
          data-exceeds={node.exceedsBudget ? "true" : "false"}
          aria-current={node.selected ? "true" : undefined}
          aria-label={nodeLabel(node)}
          onClick={() => onSelect(node.id)}
        >
          <span className="tree-node-head">
            <KindMark kind={node.kind} />
            <span className="tree-node-cost">{pointsLabel(node.cost)}</span>
          </span>
          <span className="tree-node-title">{node.title}</span>
          {node.caption ? (
            <span className={`tree-node-note tone-${node.captionTone}`}>{node.caption}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function nodeClass(node: LaidOutNode): string {
  const parts = ["tree-node", `kind-${node.kind}`];
  if (node.selected) parts.push("selected");
  if (node.unlocksIfCompleted) parts.push("unlocks");
  if (node.exceedsBudget) parts.push("exceeds");
  return parts.join(" ");
}

function nodeLabel(node: LaidOutNode): string {
  const bits = [node.title, KIND_LABEL[node.kind], pointsLabel(node.cost)];
  if (node.caption) bits.push(node.caption);
  if (node.selected) bits.push("selected");
  return bits.join(", ");
}
