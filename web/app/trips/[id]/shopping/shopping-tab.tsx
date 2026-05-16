"use client";

/**
 * Shopping tab — auto-aggregated grocery list from cook-in meals.
 * Phase B Step 8 (the wow feature).
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import type { Trip } from "@shared/types";

export interface GoingMember { id: string; name: string; }
export interface ShoppingItemView {
  id: string;
  name: string;
  total_quantity: number;
  unit: string;
  category: string;
  assigned_respondent_id: string | null;
  is_acquired: boolean;
  source_meal_count: number;
}

const CATEGORY_ORDER = ["produce", "meat_fish", "dairy_fridge", "pantry", "other"];
const CATEGORY_LABEL: Record<string, string> = {
  produce: "Produce",
  meat_fish: "Meat + fish",
  dairy_fridge: "Dairy + fridge",
  pantry: "Pantry",
  other: "Other",
};
const CATEGORY_EMOJI: Record<string, string> = {
  produce: "🥬",
  meat_fish: "🥩",
  dairy_fridge: "🥛",
  pantry: "🥫",
  other: "🧂",
};

export default function ShoppingTab({
  tripId, tripTheme, canManage, cookInMealCount, goingMembers,
  items: initialItems,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  canManage: boolean;
  cookInMealCount: number;
  goingMembers: GoingMember[];
  items: ShoppingItemView[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<ShoppingItemView[]>(initialItems);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  // Bulk-assign mode state.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState<string>("");

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else              next.add(id);
      return next;
    });
  }
  function selectAllInCategory(category: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const i of items) if (i.category === category) next.add(i.id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  function exitSelectionMode() { setSelectionMode(false); clearSelection(); setBulkAssignee(""); }

  async function applyBulkAssign() {
    if (selectedIds.size === 0) return;
    setBusy(true); setErr(null);
    const assigneeId = bulkAssignee || null;
    // Optimistic.
    setItems((prev) =>
      prev.map((i) => selectedIds.has(i.id) ? { ...i, assigned_respondent_id: assigneeId } : i),
    );
    try {
      // Iterate — typical N is 10-40, no point in batching for now.
      const results = await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/trips/${tripId}/shopping/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assigned_respondent_id: assigneeId }),
          }).then((r) => r.ok),
        ),
      );
      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        setErr(`${failedCount} item${failedCount === 1 ? "" : "s"} failed to update`);
      }
      exitSelectionMode();
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      startTrans(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  // After router.refresh() the parent re-fetches and hands down a
  // new initialItems prop, but useState's initializer only fires
  // on mount. Sync the local state when the prop changes so the
  // "Build shopping list" + "Refresh from meals" flows actually
  // repaint after the POST returns.
  useEffect(() => { setItems(initialItems); }, [initialItems]);

  const t = themeClass(tripTheme);
  const hasItems = items.length > 0;
  const acquiredCount = items.filter((i) => i.is_acquired).length;

  async function aggregate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/shopping/aggregate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.message || body?.error?.code || `Aggregate failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function patchItem(itemId: string, patch: Partial<ShoppingItemView>) {
    setErr(null);
    // Optimistic
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    );
    const body: Record<string, unknown> = {};
    if (patch.assigned_respondent_id !== undefined) body.assigned_respondent_id = patch.assigned_respondent_id;
    if (patch.is_acquired !== undefined) body.is_acquired = patch.is_acquired;
    try {
      const res = await fetch(`/api/trips/${tripId}/shopping/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setErr(b?.error?.code || `Update failed (${res.status})`);
        startTrans(() => router.refresh());
      }
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      startTrans(() => router.refresh());
    }
  }

  const groups = CATEGORY_ORDER
    .map((cat) => ({ category: cat, items: items.filter((i) => i.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <h2 className={`text-2xl ${t.display}`}>Shopping list</h2>
        <div className="flex flex-wrap gap-2">
          {hasItems && canManage && (
            <button
              onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
              className={`h-10 px-4 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm`}
            >
              {selectionMode ? "Cancel selection" : "Bulk assign"}
            </button>
          )}
          {canManage && (
            <button
              onClick={aggregate}
              disabled={busy || cookInMealCount === 0}
              className={`h-10 px-4 rounded-full ${
                hasItems
                  ? `${t.surface} text-ink border ${t.surfaceBorder} hover:border-green`
                  : "bg-green text-cream font-bold hover:bg-green-2"
              } text-sm disabled:opacity-50`}
              title={cookInMealCount === 0 ? "Add cook-in meals first" : ""}
            >
              {busy
                ? "Aggregating…"
                : hasItems
                ? "Refresh from meals"
                : "Build shopping list →"}
            </button>
          )}
        </div>
      </div>
      <p className={`text-xs mb-6 ${t.meta}`}>
        Auto-aggregated from {cookInMealCount} cook-in meal{cookInMealCount === 1 ? "" : "s"}.
        {hasItems ? ` ${acquiredCount} of ${items.length} acquired.` : ""}
      </p>
      {err && <p className="text-orange text-sm mb-4">{err}</p>}

      {!hasItems && (
        <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-8 text-center`}>
          {cookInMealCount === 0 ? (
            <p className={`text-sm ${t.meta}`}>
              Add cook-in meals on the Meals tab first. We aggregate their ingredients automatically.
            </p>
          ) : (
            <p className={`text-sm ${t.meta}`}>
              {canManage
                ? "Tap “Build shopping list” to pull ingredients from your cook-in meals."
                : "Once the host builds the list, items will appear here."}
            </p>
          )}
        </div>
      )}

      <div className={`grid gap-6 ${selectionMode ? "pb-32" : ""}`}>
        {groups.map(({ category, items: groupItems }) => {
          const categorySelectedCount = groupItems.filter((i) => selectedIds.has(i.id)).length;
          return (
            <section key={category}>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className={`text-xs ${t.eyebrow}`}>
                  {CATEGORY_EMOJI[category]} {CATEGORY_LABEL[category] ?? category} · {groupItems.length}
                </h3>
                {selectionMode && (
                  <button
                    onClick={() => selectAllInCategory(category)}
                    className="text-xs text-green hover:underline"
                  >
                    {categorySelectedCount === groupItems.length ? "all selected" : `select all (${groupItems.length})`}
                  </button>
                )}
              </div>
              <ul className="grid gap-2">
                {groupItems.map((i) => (
                  <li key={i.id}>
                    <ShoppingRow
                      item={i}
                      t={t}
                      goingMembers={goingMembers}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(i.id)}
                      onToggleSelect={() => toggleSelection(i.id)}
                      onPatch={(p) => patchItem(i.id, p)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Bulk-assign action bar — pinned to bottom while in selection
          mode. Slides up out of view when not active. */}
      {selectionMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-cream border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-3xl mx-auto px-6 py-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink font-semibold flex-shrink-0">
              {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected
            </p>
            <button
              onClick={clearSelection}
              disabled={selectedIds.size === 0}
              className="text-xs text-muted hover:text-ink disabled:opacity-50"
            >
              clear
            </button>
            <div className="flex-1" />
            <select
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
              className={`h-10 px-3 rounded-full bg-card border ${t.surfaceBorder} text-sm`}
              disabled={busy}
            >
              <option value="">Unassign</option>
              {goingMembers.map((m) => (
                <option key={m.id} value={m.id}>Assign to {m.name}</option>
              ))}
            </select>
            <button
              onClick={applyBulkAssign}
              disabled={busy || selectedIds.size === 0}
              className="h-10 px-5 rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShoppingRow({
  item, t, goingMembers, onPatch,
  selectionMode, selected, onToggleSelect,
}: {
  item: ShoppingItemView;
  t: ReturnType<typeof themeClass>;
  goingMembers: GoingMember[];
  onPatch: (p: Partial<ShoppingItemView>) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const assignedName = item.assigned_respondent_id
    ? goingMembers.find((m) => m.id === item.assigned_respondent_id)?.name
    : null;

  // Selection mode: clicking anywhere on the row toggles selection.
  // Acquired checkbox + assign dropdown disable in this mode to avoid
  // ambiguity.
  const rowClasses =
    `${t.surface} border ${selected && selectionMode ? "border-green ring-1 ring-green" : t.surfaceBorder} ` +
    `rounded-xl p-3 flex items-center gap-3 ` +
    `${item.is_acquired ? "opacity-60" : ""} ` +
    `${selectionMode ? "cursor-pointer hover:border-green" : ""}`;

  const handleRowClick = selectionMode ? onToggleSelect : undefined;

  return (
    <div className={rowClasses} onClick={handleRowClick}>
      {selectionMode ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-5 accent-green flex-shrink-0"
          aria-label={`Select ${item.name}`}
        />
      ) : (
        <input
          type="checkbox"
          checked={item.is_acquired}
          onChange={(e) => onPatch({ is_acquired: e.target.checked })}
          className="h-5 w-5 accent-green flex-shrink-0"
          aria-label={`Mark ${item.name} acquired`}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className={`${item.is_acquired ? "line-through" : ""} ${t.body}`}>
          <span className="font-semibold">{formatQty(item.total_quantity)} {item.unit}</span>{" "}
          <span className="capitalize">{item.name}</span>
        </p>
        {item.source_meal_count > 1 && (
          <p className={`text-[11px] ${t.meta}`}>
            from {item.source_meal_count} meals
          </p>
        )}
      </div>
      {selectionMode ? (
        // Show the current assignment as a static chip during bulk
        // mode so the planner can still see who things are assigned
        // to without an interactive dropdown.
        <span className={`text-xs px-2 py-1 rounded-full ${t.surface} border ${t.surfaceBorder} flex-shrink-0 ${assignedName ? "" : "opacity-50"}`}>
          {assignedName ?? "—"}
        </span>
      ) : (
        <select
          value={item.assigned_respondent_id ?? ""}
          onChange={(e) => onPatch({ assigned_respondent_id: e.target.value || null })}
          className={`h-8 px-2 rounded-full bg-cream border ${t.surfaceBorder} text-xs flex-shrink-0`}
          aria-label="Assign to"
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">{assignedName ? "Unassign" : "Unassigned"}</option>
          {goingMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function formatQty(q: number): string {
  // Show ints as "3", floats as "1.5", trim trailing zeros.
  if (Number.isInteger(q)) return String(q);
  return Number(q.toFixed(2)).toString();
}
