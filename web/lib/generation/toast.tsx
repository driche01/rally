"use client";

/**
 * Persistent generation toast — bottom-right corner of the trip
 * layout. Shows running / done / failed jobs as stacked cards.
 * The fun loading art is inline in the running state.
 */

import type { GenerationJob } from "./provider";
import TravelLoadingDance from "./loading-art";

export default function GenerationToast({ jobs }: { jobs: GenerationJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {jobs.map((job) => (
        <ToastCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function ToastCard({ job }: { job: GenerationJob }) {
  const isRunning = job.status === "running";
  const isDone    = job.status === "done";

  const accent = isDone
    ? "border-green/40 bg-green-soft"
    : job.status === "failed"
      ? "border-orange/40 bg-orange/10"
      : "border-line bg-cream";

  return (
    <div
      className={
        "pointer-events-auto rounded-2xl border shadow-md px-4 py-3 flex items-center gap-3 " +
        accent + " animate-slide-in-right"
      }
      role="status"
      aria-live="polite"
    >
      {isRunning ? (
        <TravelLoadingDance />
      ) : isDone ? (
        <span className="text-2xl" aria-hidden>✅</span>
      ) : (
        <span className="text-2xl" aria-hidden>⚠️</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink truncate">
          {isDone ? job.label.replace(/…$/, " ✓").replace(/^Generating/, "Generated").replace(/^Finding/, "Found")
                  : job.label}
        </p>
        {job.status === "failed" && job.error && (
          <p className="text-xs text-orange truncate">{job.error}</p>
        )}
        {isRunning && (
          <p className="text-xs text-muted">Keep browsing — we&rsquo;ll let you know when it&rsquo;s done.</p>
        )}
      </div>
    </div>
  );
}
