import { useEffect, useMemo, useRef, useState } from "react";
import { buildTalentTree, graphSelectionFor, nearestNode } from "./graph";
import { BudgetBar } from "./ui/BudgetBar";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { formatDay } from "./ui/format";
import { TreeMark } from "./ui/glyphs";
import { HelpDialog } from "./ui/HelpDialog";
import { NodeDetail } from "./ui/NodeDetail";
import { NodeFormDialog } from "./ui/NodeFormDialog";
import { NodeList } from "./ui/NodeList";
import { TalentTree } from "./ui/TalentTree";
import { usePlanner } from "./ui/usePlanner";

type ViewMode = "tree" | "list";

type Dialog =
  | { type: "none" }
  | { type: "help" }
  | { type: "create" }
  | { type: "edit" }
  | { type: "reset" }
  | { type: "delete" };

export function App() {
  const planner = usePlanner();
  const [dialog, setDialog] = useState<Dialog>({ type: "none" });
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [focusSignal, setFocusSignal] = useState(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const plannerRef = useRef(planner);
  plannerRef.current = planner;
  const [titleDraft, setTitleDraft] = useState(planner.plan.title);
  const tree = useMemo(
    () =>
      buildTalentTree(
        planner.view,
        graphSelectionFor(planner.selectedId, planner.explanation),
      ),
    [planner.view, planner.selectedId, planner.explanation],
  );
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    setTitleDraft(planner.plan.title);
  }, [planner.plan.title]);

  useEffect(() => {
    if (viewMode !== "list" || !planner.selectedId) return;
    document.getElementById(`node-${planner.selectedId}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [viewMode, planner.selectedId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (dialog.type !== "none") return;
      const current = plannerRef.current;
      switch (event.key) {
        case "j":
          event.preventDefault();
          current.moveSelection(1);
          break;
        case "k":
          event.preventDefault();
          current.moveSelection(-1);
          break;
        case "ArrowDown":
        case "ArrowUp":
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          if (viewModeRef.current === "tree") {
            const direction =
              event.key === "ArrowDown"
                ? "down"
                : event.key === "ArrowUp"
                  ? "up"
                  : event.key === "ArrowLeft"
                    ? "left"
                    : "right";
            const next = nearestNode(
              treeRef.current.nodes,
              current.selectedId,
              direction,
            );
            if (next) current.select(next);
          } else {
            current.moveSelection(
              event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1,
            );
          }
          break;
        }
        case "v":
          event.preventDefault();
          setViewMode((mode) => (mode === "tree" ? "list" : "tree"));
          break;
        case "f":
          event.preventDefault();
          if (viewModeRef.current === "tree" && current.selectedId) {
            setFocusSignal((signal) => signal + 1);
          }
          break;
        case "c":
          event.preventDefault();
          current.complete();
          break;
        case "d":
          event.preventDefault();
          current.defer();
          break;
        case "u":
          event.preventDefault();
          current.undefer();
          break;
        case "n":
          event.preventDefault();
          current.clearError();
          setDialog({ type: "create" });
          break;
        case "e":
          if (!current.selected) break;
          event.preventDefault();
          current.clearError();
          setDialog({ type: "edit" });
          break;
        case "?":
          event.preventDefault();
          setDialog({ type: "help" });
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.type]);

  const formOpen = dialog.type === "create" || dialog.type === "edit";

  return (
    <div className="page">
      <a className="skip" href="#plan">
        Skip to plan
      </a>
      <header className="top">
        <div className="brand">
          <TreeMark />
          <div>
            <label className="title-edit">
              <span className="sr-only">Plan title</span>
              <input
                className="title-input"
                type="text"
                value={titleDraft}
                maxLength={200}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (titleDraft.trim()) planner.setPlanTitle(titleDraft);
                  else setTitleDraft(planner.plan.title);
                }}
              />
            </label>
            <p className="lede">
              Local-first talent tree · {formatDay(planner.plan.activeDate)}
            </p>
          </div>
        </div>
        <BudgetBar
          budget={planner.plan.dailyBudget}
          spent={planner.plan.spentToday}
          remaining={planner.remaining}
          onBudgetChange={planner.setBudget}
        />
        <div className="toolbar">
          <button
            type="button"
            className="primary"
            onClick={() => {
              planner.clearError();
              setDialog({ type: "create" });
            }}
          >
            New node
          </button>
          <button type="button" onClick={planner.exportPlan}>
            Export JSON
          </button>
          <button type="button" onClick={() => importRef.current?.click()}>
            Import JSON
          </button>
          <button type="button" onClick={() => setDialog({ type: "reset" })}>
            Load demo
          </button>
          <button type="button" onClick={() => setDialog({ type: "help" })}>
            Help
          </button>
          <input
            ref={importRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const text = await file.text();
              planner.importText(text);
            }}
          />
        </div>
        {planner.error ? (
          <p className="banner" role="alert">
            {planner.error}
            {planner.brokenRaw ? (
              <>
                {" "}
                <button type="button" className="text-btn" onClick={planner.downloadBroken}>
                  Download the unreadable file
                </button>
              </>
            ) : null}
          </p>
        ) : (
          <p className="local-note">
            This plan lives in this browser. Taltree does not send it anywhere.
            {planner.brokenRaw ? (
              <>
                {" "}
                An earlier saved plan could not be read; a backup is kept on this
                device.{" "}
                <button type="button" className="text-btn" onClick={planner.downloadBroken}>
                  Download the unreadable file
                </button>
              </>
            ) : null}
          </p>
        )}
      </header>

      <main id="plan" className="shell">
        <div className="workspace">
          <div className="workspace-head">
            <div>
              <h2>{viewMode === "tree" ? "Talent tree" : "Plan list"}</h2>
              <p>
                {viewMode === "tree"
                  ? "Hard prerequisites point downward. Completing an eligible node spends today's budget and may unlock what waits on it."
                  : "The same plan as a list, grouped by eligible, deferred, blocked, and completed. Keyboard: j and k move."}
              </p>
            </div>
            <div className="view-switch" role="group" aria-label="Plan view">
              <button
                type="button"
                aria-pressed={viewMode === "tree"}
                onClick={() => setViewMode("tree")}
              >
                Talent tree
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
            </div>
          </div>
          {viewMode === "tree" ? (
            <TalentTree
              tree={tree}
              remaining={planner.remaining}
              explanation={planner.explanation}
              focusSignal={focusSignal}
              onSelect={(id) => {
                planner.select(id);
                setMobileDetail(true);
              }}
            />
          ) : (
            <NodeList
              listings={planner.listings}
              selectedId={planner.selectedId}
              onSelect={(id) => {
                planner.select(id);
                setMobileDetail(true);
              }}
            />
          )}
        </div>
        <NodeDetail
          listing={planner.selected}
          explanation={planner.explanation}
          mobileOpen={mobileDetail}
          backLabel={viewMode === "tree" ? "Back to tree" : "Back to list"}
          onComplete={planner.complete}
          onDefer={planner.defer}
          onUndefer={planner.undefer}
          onEdit={() => {
            planner.clearError();
            setDialog({ type: "edit" });
          }}
          onDelete={() => setDialog({ type: "delete" })}
          onClose={() => setMobileDetail(false)}
        />
      </main>

      <footer className="colophon">
        <p className="shortcuts">
          <span><kbd>j</kbd> <kbd>k</kbd> move</span>
          <span><kbd>←</kbd> <kbd>→</kbd> tree</span>
          <span><kbd>f</kbd> focus</span>
          <span><kbd>c</kbd> complete</span>
          <span><kbd>d</kbd> defer</span>
          <span><kbd>v</kbd> view</span>
          <span><kbd>n</kbd> new</span>
          <span><kbd>?</kbd> help</span>
        </p>
        <p>Missed days are not punished. Unused points expire; unfinished nodes remain.</p>
      </footer>

      <NodeFormDialog
        open={formOpen}
        mode={dialog.type === "edit" ? "edit" : "create"}
        plan={planner.plan}
        node={dialog.type === "edit" ? planner.selected?.node ?? null : null}
        error={planner.error}
        onClose={() => setDialog({ type: "none" })}
        onSubmit={(input) =>
          dialog.type === "edit" ? planner.edit(input) : planner.create(input)
        }
      />
      <HelpDialog open={dialog.type === "help"} onClose={() => setDialog({ type: "none" })} />
      <ConfirmDialog
        open={dialog.type === "reset"}
        title="Replace this plan with the demo?"
        body="The demo stays on this device. Your current plan will be overwritten in local storage. Export first if you want a copy."
        confirmLabel="Load demo"
        onConfirm={planner.resetDemo}
        onClose={() => setDialog({ type: "none" })}
      />
      <ConfirmDialog
        open={dialog.type === "delete"}
        title="Delete this node?"
        body="It will be removed from the plan. Nodes that waited on it will drop that prerequisite."
        confirmLabel="Delete"
        onConfirm={planner.remove}
        onClose={() => setDialog({ type: "none" })}
      />
    </div>
  );
}
