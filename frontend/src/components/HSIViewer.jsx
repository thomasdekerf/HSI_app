import React, { useEffect, useRef, useState } from "react";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";
import { hexToBase64 } from "../utils/image";

const REGION_COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
  "#5856d6",
  "#5ac8fa",
  "#ff2d55",
  "#bf5af2",
];

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
  const [selections, setSelections] = useState([]);
  const colorIndexRef = useRef(0);

  useEffect(() => {
    setSelections([]);
    colorIndexRef.current = 0;
  }, [bands]);

  const handle = (i, val) => {
    const newIdx = [...idxs];
    const numericVal = Number(val);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    newIdx[i] = clamped;
    onChange(newIdx);
  };

  const handleRegion = async (rect) => {
    const selectionId = `${Date.now()}-${Math.random()}`;
    const color = REGION_COLORS[colorIndexRef.current % REGION_COLORS.length];
    colorIndexRef.current += 1;

    setSelections((prev) => [
      ...prev,
      {
        id: selectionId,
        rect,
        color,
        spectra: null,
        loading: true,
      },
    ]);

    try {
      const res = await fetch("http://127.0.0.1:8000/spectra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rect }),
      });
      const data = await res.json();
      if (data.spectra) {
        setSelections((prev) =>
          prev.map((sel) =>
            sel.id === selectionId
              ? { ...sel, spectra: data.spectra, loading: false }
              : sel
          )
        );
      } else {
        setSelections((prev) =>
          prev.map((sel) =>
            sel.id === selectionId ? { ...sel, loading: false } : sel
          )
        );
        if (data.error) {
          alert(data.error);
        }
      }
    } catch (error) {
      setSelections((prev) => prev.filter((sel) => sel.id !== selectionId));
      alert("Failed to fetch spectra for the selected region.");
    }
  };

  const handleClearSelections = () => {
    setSelections([]);
    colorIndexRef.current = 0;
  };

  const imageUrl = rgb ? `data:image/jpeg;base64,${hexToBase64(rgb)}` : null;
  const regions = selections.map((sel) => ({ id: sel.id, rect: sel.rect, color: sel.color }));

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <div>
        <ViewerCanvas imageUrl={imageUrl} regions={regions} onRegion={handleRegion} />
        {selections.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button type="button" onClick={handleClearSelections}>
              Clear selections
            </button>
          </div>
        )}
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
      <SpectraPlot bands={bands} selections={selections} />
    </div>
  );
}
