import { useState, useEffect } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
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

  const handleLoaded = (data) => {
    const parsedBands = normalizeBands(data.bands || []);
    setBands(parsedBands);
    setIdxs(chooseInitialIndices(parsedBands));
    setWarning(data.warning || "");
    setRgb(null);
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
        <HSIViewer bands={bands} rgb={rgb} idxs={idxs} onChange={setIdxs} />
      )}
    </div>
  );
}
