import React, { useState, useEffect } from "react";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";

function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return window.btoa(bin);
}

function formatBandLabel(band) {
  if (band === undefined || band === null) return "-";
  if (typeof band === "number" && Number.isFinite(band)) {
    return `${band.toFixed(1)} nm`;
  }
  const numeric = Number(band);
  if (Number.isFinite(numeric)) {
    return `${numeric.toFixed(1)} nm`;
  }
  return String(band);
}

export default function HSIViewer({ bands, rgb, idxs, onChange }) {
  const [spectra, setSpectra] = useState(null);

  useEffect(() => {
    setSpectra(null);
  }, [bands]);

  const handle = (i, val) => {
    const newIdx = [...idxs];
    const numericVal = Number(val);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    newIdx[i] = clamped;
    onChange(newIdx);
  };

  const handleRegion = async (rect) => {
    const res = await fetch("http://127.0.0.1:8000/spectra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rect }),
    });
    const data = await res.json();
    if (data.spectra) {
      setSpectra(data.spectra);
    } else {
      setSpectra(null);
    }
  };

  const imageUrl = rgb ? `data:image/jpeg;base64,${hexToBase64(rgb)}` : null;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <div>
        <ViewerCanvas imageUrl={imageUrl} onRegion={handleRegion} />
        {["R", "G", "B"].map((ch, i) => (
          <div key={ch} style={{ marginTop: 10 }}>
            <label>
              {ch}-band: {formatBandLabel(bands[idxs[i]])}
            </label>
            <input
              type="range"
              min={0}
              max={bands.length - 1}
              value={idxs[i]}
              onChange={(e) => handle(i, e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        ))}
      </div>
      <SpectraPlot bands={bands} spectra={spectra} />
    </div>
  );
}
