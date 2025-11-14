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
  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [drawMode, setDrawMode] = useState("rectangle");

  useEffect(() => {
    setSelections([]);
    colorIndexRef.current = 0;
    setDrawMode("rectangle");
  }, [bands]);

  useEffect(() => {
    if (!stageContainerRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setStageWidth(entry.contentRect.width);
      }
    });
    observer.observe(stageContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const handle = (i, val) => {
    const newIdx = [...idxs];
    const numericVal = Number(val);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    newIdx[i] = clamped;
    onChange(newIdx);
  };

  const handleRegion = async (shapeData) => {
    if (!shapeData?.shape || !shapeData?.bounds) {
      return;
    }
    const selectionId = `${Date.now()}-${Math.random()}`;
    const color = REGION_COLORS[colorIndexRef.current % REGION_COLORS.length];
    colorIndexRef.current += 1;

    setSelections((prev) => [
      ...prev,
      {
        id: selectionId,
        shape: shapeData.shape,
        bounds: shapeData.bounds,
        color,
        spectra: null,
        loading: true,
        stddev: null,
      },
    ]);

    try {
      const res = await fetch("http://127.0.0.1:8000/spectra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rect: shapeData.bounds, shape: shapeData.shape }),
      });
      const data = await res.json();
      if (data.spectra) {
        setSelections((prev) =>
          prev.map((sel) =>
            sel.id === selectionId
              ? {
                  ...sel,
                  spectra: data.spectra,
                  stddev: data.stddev || null,
                  loading: false,
                }
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
  const regions = selections.map((sel) => ({
    id: sel.id,
    shape: sel.shape || { type: "rectangle", ...sel.bounds },
    color: sel.color,
  }));

  return (
    <div className="viewer-panel">
      <div className="viewer-panel__canvas">
        <div className="viewer-panel__stage" ref={stageContainerRef}>
          <ViewerCanvas
            imageUrl={imageUrl}
            regions={regions}
            onRegion={handleRegion}
            maxWidth={stageWidth}
            drawMode={drawMode}
          />
        </div>
        <div className="viewer-panel__controls">
          <div className="annotation-tools">
            <span className="annotation-tools__label">Annotation shape</span>
            <div className="annotation-tools__options">
              {[
                { id: "rectangle", label: "Rectangle" },
                { id: "circle", label: "Circle" },
                { id: "point", label: "Point" },
                { id: "polygon", label: "Polygon" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`annotation-tools__button${drawMode === option.id ? " is-active" : ""}`}
                  onClick={() => setDrawMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {drawMode === "circle" && (
              <div className="annotation-tools__hint">
                Click to set the center and drag outward to adjust the radius.
              </div>
            )}
            {drawMode === "polygon" && (
              <div className="annotation-tools__hint">
                Click to add vertices and double-click to close the polygon.
              </div>
            )}
          </div>
          {selections.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleClearSelections}
            >
              Clear selections
            </button>
          )}
          <div className="band-sliders">
            {["R", "G", "B"].map((ch, i) => (
              <div key={ch} className="band-sliders__item">
                <label className="band-sliders__label">
                  {ch}-band <span>{formatBandLabel(bands[idxs[i]])}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={bands.length - 1}
                  value={idxs[i]}
                  onChange={(e) => handle(i, e.target.value)}
                  className="band-slider"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="viewer-panel__plot">
        <SpectraPlot bands={bands} selections={selections} />
      </div>
    </div>
  );
}
