import React, { useMemo, useState } from "react";

const containerStyle = {
  border: "1px solid #d0d0d0",
  borderRadius: 10,
  padding: 16,
  backgroundColor: "#fdfdfd",
  minHeight: 520,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const viewerPaneStyle = {
  flex: "1 1 auto",
  border: "1px solid #c0c0c0",
  borderRadius: 8,
  backgroundColor: "#050505",
  overflow: "auto",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  padding: 0,
  maxHeight: 480,
};

const controlRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};

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
      <div style={containerStyle}>
        <div style={{ color: "#555" }}>
          Run PCA or k-means to populate analysis visuals. Results you generate will appear here with zoom controls.
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={controlRowStyle}>
        <label htmlFor="analysis-viewer-select" style={{ fontWeight: 600 }}>
          Analysis view
        </label>
        <select
          id="analysis-viewer-select"
          value={selectedId || ""}
          onChange={(event) => onSelect(event.target.value)}
          style={{
            minWidth: 220,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #999",
          }}
        >
          {visuals.map((visual) => (
            <option key={visual.id} value={visual.id}>
              {visual.label}
            </option>
          ))}
        </select>
      </div>

      <div style={controlRowStyle}>
        <span style={{ fontWeight: 600 }}>Zoom</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => handleZoomChange(zoomPercent - 25)}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #bbb" }}
          >
            -
          </button>
          <button
            type="button"
            onClick={() => handleZoomChange(zoomPercent + 25)}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #bbb" }}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleZoomChange(100)}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #bbb" }}
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
          style={{ flex: "1 1 160px", minWidth: 140 }}
        />
        <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(zoomPercent)}%
        </span>
      </div>

      <div style={viewerPaneStyle}>
        {selectedVisual ? (
          <div
            style={{
              transform: `scale(${zoomPercent / 100})`,
              transformOrigin: "top left",
              padding: 12,
            }}
          >
            <img
              src={selectedVisual.image}
              alt={selectedVisual.label}
              style={{
                display: "block",
                width: 640,
                height: "auto",
                borderRadius: 6,
                boxShadow: "0 6px 24px rgba(0, 0, 0, 0.45)",
              }}
            />
          </div>
        ) : (
          <div style={{ color: "#eee", padding: 20 }}>Select a result to inspect.</div>
        )}
      </div>

      {selectedVisual?.description && (
        <div style={{ color: "#444" }}>{selectedVisual.description}</div>
      )}
    </div>
  );
}
