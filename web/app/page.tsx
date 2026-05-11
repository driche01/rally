// Phase A landing. Minimal scaffold until Step 3 (trip creation flow).
// The marketing landing page that currently lives on rallysurveys.netlify.app
// will eventually move here, but that's outside Phase A scope.

export default function Home() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">
          Rally · v1 web
        </p>
        <h1 className="font-display text-4xl leading-tight text-ink mb-3">
          Group trips with friends, planned together.
        </h1>
        <p className="text-muted">
          This is the Phase A scaffold. The full home page lands later in the
          build. For now, dev routes live under{" "}
          <code className="font-mono text-sm">/api</code> and{" "}
          <code className="font-mono text-sm">/invite/[token]</code>.
        </p>
      </div>
    </main>
  );
}
