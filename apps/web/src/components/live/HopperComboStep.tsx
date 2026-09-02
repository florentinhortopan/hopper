"use client";

import { useEffect, useMemo, useState } from "react";
import type { LibraryItem, MatrixCell } from "@attatta/shared";
import { LiveThumb } from "@/components/live/LiveThumb";
import { api } from "@/lib/api";

const AXIS_ORDER = ["attire", "background", "hands", "prop"] as const;
type AxisKey = (typeof AXIS_ORDER)[number];

const AXIS_LABEL: Record<AxisKey, string> = {
  attire: "Attire",
  background: "Background",
  hands: "Hands",
  prop: "Prop",
};

function cellAxisId(cell: MatrixCell, axis: AxisKey): string | null {
  if (axis === "hands") return cell.handsId?.trim() || null;
  if (axis === "attire") return cell.attireId?.trim() || null;
  if (axis === "background") return cell.backgroundId?.trim() || null;
  return cell.propIds?.[0]?.trim() || null;
}

type Props = {
  campaignId: string;
  cells: MatrixCell[];
  busyId: string | null;
  onToggle: (cellId: string, selectedForGen: boolean) => void;
  onSelectAll: (selectedForGen: boolean) => void;
};

/**
 * Compact Advanced-style combo picker for Hopper:
 * rows = variants, columns = ingredient kinds with readable labels.
 * Precedes the plate review / Keep-Kill step in the column scroll.
 */
export function HopperComboStep({
  campaignId,
  cells,
  busyId,
  onToggle,
  onSelectAll,
}: Props) {
  const [libById, setLibById] = useState<Map<string, LibraryItem>>(
    () => new Map(),
  );

  const ingredientIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const c of cells) {
      if (c.attireId?.trim()) ids.add(c.attireId);
      if (c.backgroundId?.trim()) ids.add(c.backgroundId);
      if (c.handsId?.trim()) ids.add(c.handsId);
      for (const p of c.propIds ?? []) {
        if (p?.trim()) ids.add(p);
      }
    }
    return [...ids].sort().join(",");
  }, [cells]);

  useEffect(() => {
    let cancelled = false;
    void api
      .campaignIngredients(campaignId)
      .then((res) => {
        if (cancelled) return;
        setLibById(new Map(res.items.map((i) => [i.id, i])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId, ingredientIdsKey]);

  const axes = useMemo(() => {
    return AXIS_ORDER.filter((axis) => {
      if (axis === "attire") {
        // Show attire column when any cell has attire OR any has explicit none + another plate
        const anyAttire = cells.some((c) => cellAxisId(c, "attire"));
        const anyNoneWithVisual = cells.some(
          (c) =>
            !cellAxisId(c, "attire") &&
            (cellAxisId(c, "background") ||
              cellAxisId(c, "hands") ||
              cellAxisId(c, "prop")),
        );
        return anyAttire || anyNoneWithVisual;
      }
      return cells.some((c) => cellAxisId(c, axis));
    });
  }, [cells]);

  const selectedCount = cells.filter((c) => c.selectedForGen !== false).length;
  const selectBusy = busyId === "sel:all" || Boolean(busyId?.startsWith("sel:"));

  function plateLabel(id: string | null, axis: AxisKey): string {
    if (!id) {
      if (axis === "attire") return "none";
      return "—";
    }
    return libById.get(id)?.label || id;
  }

  if (!cells.length) {
    return (
      <section className="border-b border-ink-100 px-3 py-3 text-xs">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Step · Pick combinations
        </p>
        <p className="mt-1 text-[11px] text-ink-500">
          Run Magic prepare — ingredient combos appear here to select for
          generate.
        </p>
      </section>
    );
  }

  return (
    <section className="border-b border-ink-100 px-3 py-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Step · Pick combinations
        </p>
        <span className="text-[10px] text-ink-500">
          {selectedCount} of {cells.length} for generate
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[9px] hover:bg-ink-50 disabled:opacity-40"
            disabled={selectBusy}
            onClick={() => onSelectAll(true)}
          >
            All
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[9px] hover:bg-ink-50 disabled:opacity-40"
            disabled={selectBusy}
            onClick={() => onSelectAll(false)}
          >
            None
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-600">
        Each row is one visual combo. Check what Magic should generate —
        Magic’s list updates to match.
      </p>

      <div className="mt-2 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[18rem] border-collapse text-left text-[10px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/80 text-[9px] uppercase tracking-wide text-ink-500">
              <th className="w-8 px-1.5 py-1.5 text-center">Gen</th>
              <th className="w-8 px-1 py-1.5">#</th>
              {axes.map((axis) => (
                <th key={axis} className="px-1.5 py-1.5 font-medium">
                  {AXIS_LABEL[axis]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((cell, idx) => {
              const forGen = cell.selectedForGen !== false;
              return (
                <tr
                  key={cell.cellId}
                  className={`border-b border-ink-50 last:border-0 ${
                    forGen ? "bg-white" : "bg-ink-50/40 opacity-70"
                  }`}
                >
                  <td className="px-1.5 py-1.5 text-center align-middle">
                    <input
                      type="checkbox"
                      className="accent-ink-900"
                      checked={forGen}
                      disabled={selectBusy}
                      aria-label={`Generate combo ${idx + 1}`}
                      onChange={(e) =>
                        onToggle(cell.cellId, e.target.checked)
                      }
                    />
                  </td>
                  <td className="px-1 py-1.5 align-middle font-mono text-ink-400">
                    {idx + 1}
                  </td>
                  {axes.map((axis) => {
                    const id = cellAxisId(cell, axis);
                    const item = id ? libById.get(id) : null;
                    const label = plateLabel(id, axis);
                    return (
                      <td key={axis} className="px-1.5 py-1 align-middle">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {item ? (
                            <div className="h-7 w-7 shrink-0 overflow-hidden rounded">
                              <LiveThumb
                                libraryItem={item}
                                label={label}
                                emptyHint="…"
                                size="sm"
                              />
                            </div>
                          ) : (
                            <span
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-ink-50 text-[9px] text-ink-400"
                              title={label}
                            >
                              {axis === "attire" && !id ? "∅" : "—"}
                            </span>
                          )}
                          <span
                            className={`min-w-0 truncate ${
                              !id && axis === "attire"
                                ? "italic text-ink-500"
                                : "text-ink-800"
                            }`}
                            title={label}
                          >
                            {label}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
