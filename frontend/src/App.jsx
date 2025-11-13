import { useState, useEffect } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
import AnalysisPanel from "./components/AnalysisPanel";
import SupervisedPanel from "./components/SupervisedPanel";
import { getRGB } from "./api";
import "./App.css";

const TARGET_WAVELENGTHS = [460, 550, 640];

function normalizeBands(bands) {
  if (!Array.isArray(bands)) return [];
  return bands.map((band, idx) => {
    const num = Number(band);
    return Number.isFinite(num) ? num : idx;
  });
}

function chooseInitialIndices(bands) {
  if (!bands.length) return [0, 0, 0];
  if (bands.length < 3) {
    return Array.from({ length: 3 }, (_, i) => Math.min(i, bands.length - 1));
  }

  return TARGET_WAVELENGTHS.map((target, idx) => {
    let bestIndex = Math.min(idx * Math.floor(bands.length / 3), bands.length - 1);
    let bestDiff = Infinity;
    bands.forEach((band, bandIdx) => {
      const diff = Math.abs(band - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = bandIdx;
      }
    });
    return bestIndex;
  });
}

export default function App() {
  const [bands, setBands] = useState([]);
  const [rgb, setRgb] = useState(null);
  const [idxs, setIdxs] = useState([0, 0, 0]);
  const [warning, setWarning] = useState("");
  const [cubeShape, setCubeShape] = useState(null);
  const [activeTab, setActiveTab] = useState("viewer");

  const handleLoaded = (data) => {
    const parsedBands = normalizeBands(data.bands || []);
    setBands(parsedBands);
    setIdxs(chooseInitialIndices(parsedBands));
    setWarning(data.warning || "");
    setCubeShape(Array.isArray(data.shape) ? data.shape : null);
    setRgb(null);
    setActiveTab("viewer");
  };

  // when idxs or bands change, re-fetch image
  useEffect(() => {
    if (bands.length > 0 && idxs.every((idx) => idx >= 0 && idx < bands.length)) {
      getRGB(idxs).then(setRgb);
    }
  }, [idxs, bands]);

  const tabs = [
    { id: "viewer", label: "Visualization" },
    { id: "analysis", label: "Unsupervised Analysis" },
    { id: "supervised", label: "Supervised Classification" },
  ];

  return (
    <div className="app-root">
      <header className="app-hero">
        <div className="app-hero__badge">HSI Studio</div>
        <h1 className="app-hero__title">Hyperspectral exploration made effortless</h1>
        <p className="app-hero__subtitle">
          Upload a cube or provide a dataset path to unlock rich visualizations, spectral
          analysis, and classification workflows in an intuitive workspace.
        </p>
      </header>
      <main className="app-shell">
        <DropZone onLoaded={handleLoaded} />
        {warning && <div className="warning-banner">{warning}</div>}
        {bands.length > 0 && (
          <section className="interactive-area">
            <nav className="tab-bar" aria-label="Primary views">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="panel-surface">
              {activeTab === "analysis" ? (
                <AnalysisPanel bands={bands} cubeShape={cubeShape} />
              ) : activeTab === "supervised" ? (
                <SupervisedPanel
                  bands={bands}
                  rgb={rgb}
                  idxs={idxs}
                  onChange={setIdxs}
                  cubeShape={cubeShape}
                />
              ) : (
                <HSIViewer bands={bands} rgb={rgb} idxs={idxs} onChange={setIdxs} />
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
