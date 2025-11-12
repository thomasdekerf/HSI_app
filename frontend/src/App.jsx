import { useState, useEffect } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
import AnalysisPanel from "./components/AnalysisPanel";
import SupervisedPanel from "./components/SupervisedPanel";
import { getRGB } from "./api";

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

  return (
    <div style={{ padding: 20 }}>
      <h2>HSI Viewer</h2>
      <DropZone onLoaded={handleLoaded} />
      {warning && (
        <div style={{ marginTop: 10, color: "#b58900" }}>{warning}</div>
      )}
      {bands.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {[
              { id: "viewer", label: "Visualization" },
              { id: "analysis", label: "Unsupervised Analysis" },
              { id: "supervised", label: "Supervised Classification" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #268bd2",
                  backgroundColor: activeTab === tab.id ? "#268bd2" : "white",
                  color: activeTab === tab.id ? "white" : "#268bd2",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
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
      )}
    </div>
  );
}
