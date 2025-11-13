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
    return <div className="spectra-card spectra-card--empty">No spectra available yet.</div>;
  }

  return (
    <div className="spectra-card">
      <Plot
        data={traces}
        layout={{
          title,
          autosize: true,
          height: 340,
          margin: { t: 50, r: 24, l: 64, b: 64 },
          xaxis: {
            title: "Wavelength (nm)",
            gridcolor: "rgba(12, 29, 54, 0.1)",
            zeroline: false,
          },
          yaxis: {
            title: "Reflectance",
            gridcolor: "rgba(12, 29, 54, 0.1)",
            zeroline: false,
          },
          legend: { orientation: "h", y: -0.2 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { family: "SF Pro Display, 'Segoe UI', sans-serif", color: "#0b1f3a" },
        }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
        config={{ displaylogo: false, responsive: true }}
      />
    </div>
  );
}
