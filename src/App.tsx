import { useEffect, useState } from "react";
import Globe from "./Globe";
import Legend from "./Legend";
import DetailPanel from "./DetailPanel";
import type { CableFeature, LandDC, SubseaDC, LayerToggles, Selection } from "./types";
import "./App.css";

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export default function App() {
  const [cables, setCables] = useState<CableFeature[]>([]);
  const [landDCs, setLandDCs] = useState<LandDC[]>([]);
  const [subseaDCs, setSubseaDCs] = useState<SubseaDC[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [rotating, setRotating] = useState(true);
  const [toggles, setToggles] = useState<LayerToggles>({
    cables: true,
    landDCs: true,
    subseaDCs: true,
    connectors: true,
  });

  useEffect(() => {
    Promise.all([
      fetchJSON<CableFeature[]>("/data/cables.json"),
      fetchJSON<LandDC[]>("/data/land-dcs.json"),
      fetchJSON<SubseaDC[]>("/data/subsea-dcs.json"),
    ])
      .then(([c, l, s]) => {
        setCables(c);
        setLandDCs(l);
        setSubseaDCs(s);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app-root">
      <header className="title-bar">
        <h1>Subsea Cable &amp; Data Centre Planning Globe</h1>
        <p>
          {cables.length.toLocaleString()} cable routes · {landDCs.length.toLocaleString()} land
          facilities (PeeringDB) · {subseaDCs.length} subsea DC sites
        </p>
      </header>

      {loading && <div className="loading-overlay">Loading globe data…</div>}
      {error && <div className="error-overlay">{error}</div>}

      {!loading && !error && (
        <>
          <Globe
            cables={cables}
            landDCs={landDCs}
            subseaDCs={subseaDCs}
            toggles={toggles}
            rotating={rotating}
            onUserInteracted={() => setRotating(false)}
            onSelect={setSelected}
          />
          <button
            className="rotate-toggle"
            onClick={() => setRotating((r) => !r)}
            title={rotating ? "Pause rotation" : "Resume rotation"}
          >
            {rotating ? "⏸ Pause rotation" : "▶ Resume rotation"}
          </button>
          <Legend
            toggles={toggles}
            onChange={setToggles}
            counts={{ cables: cables.length, landDCs: landDCs.length, subseaDCs: subseaDCs.length }}
          />
          {selected && <DetailPanel selection={selected} onClose={() => setSelected(null)} />}
        </>
      )}
    </div>
  );
}
