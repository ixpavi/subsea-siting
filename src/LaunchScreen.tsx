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
import { useEffect } from "react";

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

  // `ready` only ever goes false -> true (steps complete and stay complete),
  // so it needs no latching state of its own -- it is derived during render.
  // An earlier version mirrored it into state via an effect, which is the
  // cascading-render pattern React Compiler warns about, for no behaviour.

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onLaunch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, onLaunch]);

  return (
    <div className="launch-screen" role="dialog" aria-label="Loading">
      <div className="launch-inner">
        <div className="launch-orbit" aria-hidden="true">
          <span className="launch-orbit-ring" />
          <span className="launch-orbit-ring launch-orbit-ring--2" />
          <span className="launch-orbit-core" />
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
          {steps.map((s) => (
            <li key={s.id} className={s.done ? "is-done" : ""}>
              <span className="launch-step-dot" />
              {s.label}
            </li>
          ))}
        </ul>

        {error ? (
          <p className="launch-error">
            Could not load the datasets: {error}
          </p>
        ) : (
          <button
            type="button"
            className={`launch-button${ready ? " is-ready" : ""}`}
            onClick={onLaunch}
            disabled={!ready}
          >
            {ready ? "Launch" : `Loading ${pct}%`}
          </button>
        )}
      </div>
    </div>
  );
}
