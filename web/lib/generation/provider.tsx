"use client";

/**
 * Background AI-generation provider.
 *
 * Mounted in the trip layout. Owns the list of "jobs" in flight
 * (itinerary, lodging, meals, cover image, etc.) so the planner can
 * tap "Generate" on one tab, navigate to another, and still see the
 * job's status via the persistent toast — without the request being
 * cancelled.
 *
 * Architecture:
 *   • The actual `fetch()` is owned by the BROWSER, not the React
 *     component that kicked it off. As long as the trip layout
 *     stays mounted (i.e., the user stays on the same trip), the
 *     fetch keeps running across tab navigation.
 *   • The provider tracks jobs by id + label + status.
 *   • On success: marks 'done', triggers router.refresh() so any
 *     mounted tab repaints with the new data.
 *   • On failure: marks 'failed' + records the error string.
 *   • Successful jobs auto-dismiss from the toast after 3s.
 *   • Failed jobs stick around for 8s so the user can read the
 *     error.
 *
 * Limitation: if the user navigates to a different TRIP, the layout
 * remounts and the provider's job list resets. The browser-level
 * fetch is still running but the toast won't show it anymore. That's
 * fine — the next generation tick will reflect the new state when
 * they come back.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import GenerationToast from "./toast";

export type JobKind =
  | "itinerary"
  | "lodging"
  | "meals"
  | "cover-image"
  | "flight-suggest"
  | "shopping-aggregate"
  | "trip-aggregate";

export interface GenerationJob {
  id: string;
  kind: JobKind;
  label: string;        // user-facing label, e.g. "Generating itinerary…"
  status: "running" | "done" | "failed";
  startedAt: number;
  error?: string;
}

interface GenerationContextValue {
  jobs: GenerationJob[];
  /** Start a background job. Returns the job id. */
  start: (input: {
    kind: JobKind;
    label: string;
    fetcher: () => Promise<Response>;
    onDone?: (data: unknown) => void;
  }) => string;
  isRunning: (kind: JobKind) => boolean;
}

const Ctx = createContext<GenerationContextValue | null>(null);

export function useGeneration(): GenerationContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGeneration must be used inside <GenerationProvider>");
  return v;
}

export default function GenerationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);

  const start = useCallback<GenerationContextValue["start"]>((input) => {
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `j-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setJobs((prev) => [
      ...prev,
      { id, kind: input.kind, label: input.label, status: "running", startedAt: Date.now() },
    ]);

    input.fetcher()
      .then(async (res) => {
        const ok = res.ok;
        let payload: unknown = null;
        let errMsg: string | undefined;
        if (ok) {
          try { payload = await res.clone().json(); } catch { /* non-json ok */ }
        } else {
          try {
            const body = await res.json();
            errMsg = body?.error?.code || body?.error?.message || `Failed (${res.status})`;
          } catch {
            errMsg = `Failed (${res.status})`;
          }
        }
        setJobs((prev) => prev.map((j) =>
          j.id === id ? { ...j, status: ok ? "done" : "failed", error: errMsg } : j,
        ));
        if (ok) {
          input.onDone?.(payload);
          router.refresh();
          // Auto-dismiss success after a beat.
          setTimeout(() => {
            setJobs((prev) => prev.filter((j) => j.id !== id));
          }, 3000);
        } else {
          // Keep failures visible longer so the user can read.
          setTimeout(() => {
            setJobs((prev) => prev.filter((j) => j.id !== id));
          }, 8000);
        }
      })
      .catch((err) => {
        setJobs((prev) => prev.map((j) =>
          j.id === id ? { ...j, status: "failed", error: err?.message ?? "Network error" } : j,
        ));
        setTimeout(() => {
          setJobs((prev) => prev.filter((j) => j.id !== id));
        }, 8000);
      });

    return id;
  }, [router]);

  const isRunning = useCallback<GenerationContextValue["isRunning"]>((kind) => {
    return jobs.some((j) => j.kind === kind && j.status === "running");
  }, [jobs]);

  return (
    <Ctx.Provider value={{ jobs, start, isRunning }}>
      {children}
      <GenerationToast jobs={jobs} />
    </Ctx.Provider>
  );
}
