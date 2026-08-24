// Startup screen shown while the real datasets and the globe texture load.
//
// WHY IT EXISTS. The app pulls four JSON datasets (724 cables, 5,260
// facilities, 1,920 landing points, the ocean grid) and a 4.2 MB Earth
// texture before it can render anything meaningful. Previously that happened
// behind an already-visible globe, so the first few seconds looked like a
// broken or stuttering app rather than one that was still loading.
//
// THE PROGRESS IS REAL. Every step below corresponds to a fetch that actually
// completed. A timed fake bar would be easier and would be lying to the user
// about what the app is doing -- and would still be sitting at 100% while the
// texture decoded. If a step is slow, the user can see which one.
import { useCallback, useEffect, useState } from "react";

/** Kept in step with the CSS transition on .launch-screen.is-dismissing. */
const FADE_MS = 620;

export interface LoadStep {
  id: string;
  label: string;
  done: boolean;
}

interface Props {
  steps: LoadStep[];
  error: string | null;
  onLaunch: () => void;
}

export default function LaunchScreen({ steps, error, onLaunch }: Props) {
  const done = steps.filter((s) => s.done).length;
  const ready = done === steps.length && !error;
  const pct = steps.length ? Math.round((100 * done) / steps.length) : 0;

  // The overlay fades out over its own transition and only then tells the app
  // it has launched. The globe underneath is already fully built by this
  // point, so the reveal shows a finished scene instead of one still
  // assembling -- which is what made the previous version stutter for several
  // seconds immediately after the click.
  const [dismissing, setDismissing] = useState(false);
  const launch = useCallback(() => {
    if (!ready || dismissing) return;
    setDismissing(true);
    window.setTimeout(onLaunch, FADE_MS);
  }, [ready, dismissing, onLaunch]);

  // `ready` only ever goes false -> true (steps complete and stay complete),
  // so it needs no latching state of its own -- it is derived during render.
  // An earlier version mirrored it into state via an effect, which is the
  // cascading-render pattern React Compiler warns about, for no behaviour.

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        launch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, launch]);

  return (
    <div
      className={`launch-screen${dismissing ? " is-dismissing" : ""}`}
      role="dialog"
      aria-label="Loading"
      aria-hidden={dismissing}
    >
      <div className="launch-starfield" aria-hidden="true" />
      <div className="launch-glow launch-glow--a" aria-hidden="true" />
      <div className="launch-glow launch-glow--b" aria-hidden="true" />
      <div className="launch-inner">
        <div className="launch-orbit" aria-hidden="true">
          <span className="launch-orbit-ring" />
          <span className="launch-orbit-ring launch-orbit-ring--2" />
          <span className="launch-orbit-core" />
        </div>

        {/* Percentage is a real fraction of completed steps, not a timer. */}
        <div className="launch-pct" aria-hidden="true">
          {pct}
          <span>%</span>
        </div>

        <h1 className="launch-title">Subsea Cable &amp; Data Centre Planning Globe</h1>
        <p className="launch-sub">
          Real submarine cable geometry, real facility locations, and a marine route
          model with its assumptions on the surface.
        </p>

        <div className="launch-progress" aria-hidden="true">
          <div className="launch-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        <ul className="launch-steps">
          {steps.map((s, i) => {
            // The first not-yet-done step is the one actually being waited on,
            // so the user can see WHICH thing is slow rather than a bar that
            // could be stuck on anything.
            const active = !s.done && steps.slice(0, i).every((x) => x.done);
            return (
              <li key={s.id} className={`${s.done ? "is-done" : ""}${active ? " is-active" : ""}`}>
                <span className="launch-step-dot">{s.done ? "✓" : ""}</span>
                {s.label}
              </li>
            );
          })}
        </ul>

        {error ? (
          <p className="launch-error">
            Could not load the datasets: {error}
          </p>
        ) : (
          <button
            type="button"
            className={`launch-button${ready ? " is-ready" : ""}`}
            onClick={launch}
            disabled={!ready}
          >
            {ready ? "Launch" : `Loading ${pct}%`}
          </button>
        )}
      </div>
    </div>
  );
}
