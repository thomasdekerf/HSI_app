import React, { useMemo, useState } from "react";

export default function AnalysisImageViewer({ visuals, selectedId, onSelect }) {
  const [zoomPercent, setZoomPercent] = useState(150);

  const selectedVisual = useMemo(
    () => visuals.find((visual) => visual.id === selectedId) || null,
    [visuals, selectedId],
  );

  const handleZoomChange = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const next = Math.min(400, Math.max(50, numeric));
    setZoomPercent(next);
  };

  if (!visuals.length) {
    return (
      <div className="analysis-viewer__empty">
        Run PCA or k-means to populate analysis visuals. Results you generate will
        appear here with zoom controls.
      </div>
    );
  }

  return (
    <div className="analysis-viewer__inner">
      <div className="analysis-viewer__controls">
        <label htmlFor="analysis-viewer-select" className="field-label">
          Analysis view
        </label>
        <select
          id="analysis-viewer-select"
          value={selectedId || ""}
          onChange={(event) => onSelect(event.target.value)}
          className="field-input field-input--select"
        >
          {visuals.map((visual) => (
            <option key={visual.id} value={visual.id}>
              {visual.label}
            </option>
          ))}
        </select>
      </div>

      <div className="analysis-viewer__controls analysis-viewer__controls--zoom">
        <span className="field-label">Zoom</span>
        <div className="zoom-buttons">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleZoomChange(zoomPercent - 25)}
          >
            −
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleZoomChange(zoomPercent + 25)}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleZoomChange(100)}
          >
            Reset
          </button>
        </div>
        <input
          type="range"
          min={50}
          max={400}
          step={10}
          value={zoomPercent}
          onChange={(event) => handleZoomChange(event.target.value)}
          className="zoom-slider"
        />
        <span className="zoom-readout">
          {Math.round(zoomPercent)}%
        </span>
      </div>

      <div className="analysis-viewer__pane">
        {selectedVisual ? (
          <div className="analysis-viewer__image" style={{ transform: `scale(${zoomPercent / 100})` }}>
            <img src={selectedVisual.image} alt={selectedVisual.label} />
          </div>
        ) : (
          <div className="analysis-viewer__placeholder">Select a result to inspect.</div>
        )}
      </div>

      {selectedVisual?.description && (
        <div className="analysis-viewer__description">{selectedVisual.description}</div>
      )}
    </div>
  );
}
