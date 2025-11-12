import React, { useState, useEffect, useMemo } from "react";
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

const REGION_COLORS = [
  "#ff4d4f",
  "#1890ff",
  "#52c41a",
  "#faad14",
  "#9c27b0",
  "#00bcd4",
  "#ff69b4",
  "#795548",
];

export default function HSIViewer({
  bands,
  rgb,
  idxs,
  onChange,
  onLoadDataset,
  loadingDataset,
  loadError,
  warning,
}) {
  const [regions, setRegions] = useState([]);
  const [showLoader, setShowLoader] = useState(!bands.length);

  useEffect(() => {
    setRegions([]);
  }, [bands]);

  useEffect(() => {
    setShowLoader(!bands.length);
  }, [bands.length]);

  const regionColorForIndex = (index) =>
    REGION_COLORS[index % REGION_COLORS.length] || REGION_COLORS[0];

  const handle = (i, val) => {
    const newIdx = [...idxs];
    const numericVal = Number(val);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    newIdx[i] = clamped;
    onChange(newIdx);
  };

  const handleRegion = async (rect) => {
    if (!rect || !bands.length) return;
    const color = regionColorForIndex(regions.length);
    const label = `Region ${regions.length + 1}`;
    const regionId = `${Date.now()}-${Math.random()}`;
    const pendingRegion = {
      id: regionId,
      rect,
      color,
      label,
      spectra: null,
    };
    setRegions((prev) => [...prev, pendingRegion]);

    try {
      const res = await fetch("http://127.0.0.1:8000/spectra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rect }),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.spectra) {
        setRegions((prev) =>
          prev.map((region) =>
            region.id === regionId ? { ...region, spectra: data.spectra } : region
          )
        );
      }
    } catch (error) {
      console.error("Failed to fetch spectra", error);
      setRegions((prev) => prev.filter((region) => region.id !== regionId));
      window.alert(error.message || "Failed to fetch spectra for region");
    }
  };

  const imageUrl = rgb ? `data:image/jpeg;base64,${hexToBase64(rgb)}` : null;

  const hasDataset = bands.length > 0;

  const regionLegend = useMemo(
    () =>
      regions.map((region) => (
        <div key={region.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: region.color,
            }}
          />
          <span>{region.label}</span>
        </div>
      )),
    [regions]
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        alignItems: "stretch",
        marginTop: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 480px", position: "relative", minWidth: 0 }}>
        <ViewerCanvas
          imageUrl={imageUrl}
          regions={regions}
          onRegion={handleRegion}
          disabled={loadingDataset || !hasDataset}
          showOverlay={showLoader}
        />
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => setShowLoader((prev) => !prev)}
            style={{ padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}
          >
            {hasDataset ? "Load Another Dataset" : "Load Dataset"}
          </button>
          {regions.length > 0 && (
            <button
              type="button"
              onClick={() => setRegions([])}
              style={{ padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}
            >
              Clear Regions
            </button>
          )}
        </div>
        {showLoader && (
          <DatasetLoaderOverlay
            onClose={hasDataset ? () => setShowLoader(false) : null}
            onLoad={onLoadDataset}
            loading={loadingDataset}
            error={loadError}
          />
        )}
        {warning && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              right: 12,
              background: "rgba(255, 243, 205, 0.9)",
              color: "#b58900",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {warning}
          </div>
        )}
        {regions.length > 0 && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: 64,
              background: "rgba(255,255,255,0.9)",
              padding: "10px 12px",
              borderRadius: 6,
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {regionLegend}
          </div>
        )}
      </div>
      <div style={{ flex: "0 1 420px", minWidth: 320 }}>
        <SpectraPlot bands={bands} regions={regions} />
        <div style={{ marginTop: 20 }}>
          {["R", "G", "B"].map((ch, i) => (
            <div key={ch} style={{ marginTop: i === 0 ? 0 : 12 }}>
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
      </div>
    </div>
  );
}

function DatasetLoaderOverlay({ onClose, onLoad, loading, error }) {
  const [path, setPath] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (onLoad) {
      await onLoad(path.trim());
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 10,
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>Load hyperspectral dataset</h3>
        <p style={{ margin: 0, fontSize: 14, color: "#555" }}>
          Enter a folder path or .hdr file that is accessible to the server.
        </p>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/data/sample_scene"
          style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc" }}
        />
        {error && (
          <div style={{ color: "#d93025", fontSize: 13 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "8px 14px", borderRadius: 6, cursor: "pointer" }}
              disabled={loading}
            >
              Close
            </button>
          )}
          <button
            type="submit"
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              cursor: "pointer",
            }}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </form>
    </div>
  );
}
