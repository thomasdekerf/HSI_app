import React, { useEffect, useRef, useState } from "react";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";
import { hexToBase64 } from "../utils/image";

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

export default function HSIViewer({
  measurementName,
  bands,
  rgb,
  idxs,
  onChange,
  selections = [],
  allSelections = [],
  onRegion,
  onClearSelections,
}) {
  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [drawMode, setDrawMode] = useState("rectangle");

  useEffect(() => {
    setDrawMode("rectangle");
  }, [measurementName]);

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

  const handleBandChange = (index, value) => {
    const numericVal = Number(value);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    const next = [...idxs];
    next[index] = clamped;
    onChange(next);
  };

  const imageUrl = rgb ? `data:image/jpeg;base64,${hexToBase64(rgb)}` : null;
  const regions = selections.map((selection) => ({
    id: selection.id,
    shape: selection.shape || { type: "rectangle", ...selection.bounds },
    color: selection.color,
  }));

  return (
    <div className="viewer-workbench">
      <section className="window-panel viewer-window">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">False RGB Viewer</h3>
            <div className="window-panel__meta">
              {measurementName || "No measurement loaded"}
            </div>
          </div>
          {selections.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={onClearSelections}>
              Clear measurement annotations
            </button>
          )}
        </header>

        <div className="viewer-window__body">
          <div className="viewer-panel__stage" ref={stageContainerRef}>
            <ViewerCanvas
              imageUrl={imageUrl}
              regions={regions}
              onRegion={onRegion}
              maxWidth={stageWidth}
              maxHeight={760}
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

            <div className="band-sliders">
              {["R", "G", "B"].map((channel, index) => (
                <div key={channel} className="band-sliders__item">
                  <label className="band-sliders__label">
                    {channel}-band <span>{formatBandLabel(bands[idxs[index]])}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={bands.length - 1}
                    value={idxs[index]}
                    onChange={(event) => handleBandChange(index, event.target.value)}
                    className="band-slider"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="window-panel spectra-window">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">Spectra Window</h3>
            <div className="window-panel__meta">
              Current and previously annotated spectra remain visible.
            </div>
          </div>
        </header>
        <SpectraPlot bands={bands} selections={allSelections} currentSelections={selections} />
      </section>
    </div>
  );
}
