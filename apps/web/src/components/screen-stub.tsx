/**
 * Scaffold placeholder for an app screen. The high-fidelity design for each screen
 * lives in docs/design-handover/showcase (screens/*.js) — port it into this route next.
 */
export function ScreenStub({
  title,
  subtitle,
  body,
}: {
  title: string;
  subtitle: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="t-h1">{title}</h1>
      <p className="mt-1 text-muted-foreground">{subtitle}</p>
      <div className="card mt-6 p-6">
        <span className="badge-ai">Scaffold</span>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          {body ??
            "Scaffolded route — theme, tokens, and the app shell are wired. The high-fidelity design for this screen lives in docs/design-handover/showcase; port it here next."}
        </p>
      </div>
    </div>
  );
}
