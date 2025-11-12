import { useState, useEffect, useCallback } from "react";
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
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [loadError, setLoadError] = useState("");

  const handleLoaded = useCallback(async (path) => {
    if (!path) {
      setLoadError("Please provide a folder or .hdr path.");
      return;
    }

    setLoadingDataset(true);
    setLoadError("");
    try {
      const body = new FormData();
      body.append("folder_path", path);
      const res = await fetch("http://127.0.0.1:8000/load", {
        method: "POST",
        body,
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load dataset");
      }

      const parsedBands = normalizeBands(data.bands || []);
      setBands(parsedBands);
      setIdxs(chooseInitialIndices(parsedBands));
      setWarning(data.warning || "");
      setRgb(null);
    } catch (err) {
      console.error("Failed to load dataset", err);
      setLoadError(err.message || "Failed to load dataset");
    } finally {
      setLoadingDataset(false);
    }
  }, []);

  // when idxs or bands change, re-fetch image
  useEffect(() => {
    if (bands.length > 0 && idxs.every((idx) => idx >= 0 && idx < bands.length)) {
      getRGB(idxs).then(setRgb);
    }
  }, [idxs, bands]);

  return (
    <div style={{ padding: 20, height: "100%", boxSizing: "border-box" }}>
      <h2>HSI Viewer</h2>
      <HSIViewer
        bands={bands}
        rgb={rgb}
        idxs={idxs}
        onChange={setIdxs}
        onLoadDataset={handleLoaded}
        loadingDataset={loadingDataset}
        loadError={loadError}
        warning={warning}
      />
    </div>
  );
}
