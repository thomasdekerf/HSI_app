import React, { useMemo } from "react";
import Plot from "react-plotly.js";

function sanitizeBands(bands) {
  if (!Array.isArray(bands) || bands.length === 0) {
    return [];
  }
  return bands.map((band, index) => {
    const numeric = Number(band);
    return Number.isFinite(numeric) ? numeric : index;
  });
}

export default function ClassSpectraPlot({ title, bands, series }) {
  const numericBands = useMemo(() => sanitizeBands(bands), [bands]);
  const traces = useMemo(() => {
    if (!Array.isArray(series)) return [];
    return series
      .filter((entry) => Array.isArray(entry?.spectra))
      .map((entry) => ({
        x: numericBands,
        y: entry.spectra,
        mode: "lines",
        line: { color: entry.color, width: 3 },
        name: entry.label,
      }));
  }, [numericBands, series]);

  if (!traces.length) {
    return (
      <div
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          padding: 16,
          backgroundColor: "#fafafa",
          color: "#666",
        }}
      >
        No spectra available yet.
      </div>
    );
  }

  return (
    <Plot
      data={traces}
      layout={{
        title,
        autosize: true,
        height: 340,
        margin: { t: 50, r: 20, l: 60, b: 60 },
        xaxis: { title: "Wavelength (nm)" },
        yaxis: { title: "Reflectance" },
        legend: { orientation: "h", y: -0.2 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
      }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={{ displaylogo: false, responsive: true }}
    />
  );
}
