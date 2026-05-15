// Phase A landing. Minimal scaffold until Step 3 (trip creation flow).
// The marketing landing page that currently lives on rallysurveys.netlify.app
// will eventually move here, but that's outside Phase A scope.

import RallyLogo from "@/lib/brand/logo";

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col p-6">
      <header className="mb-12">
        <RallyLogo size="md" asLink={false} />
      </header>
      <div className="flex-1 flex items-center justify-center -mt-12">
        <div className="max-w-md text-center">
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
      </div>
    </main>
  );
}
