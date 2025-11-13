import React from "react";
import Plot from "react-plotly.js";

export default function SpectraPlot({ bands, selections }) {
  if (!Array.isArray(selections) || selections.length === 0) return null;
  const numericBands = bands.map((band, idx) => {
    const num = Number(band);
    return Number.isFinite(num) ? num : idx;
  });
  const traces = selections
    .map((sel, idx) => ({ sel, idx }))
    .filter(({ sel }) => Array.isArray(sel.spectra))
    .map(({ sel, idx }) => ({
      x: numericBands,
      y: sel.spectra,
      mode: "lines",
      line: { color: sel.color },
      name: `Region ${idx + 1}`,
    }));

  if (traces.length === 0) return null;
  return (
    <div className="spectra-plot-card card">
      <div className="card__title">Spectral signatures</div>
      <Plot
        data={traces}
        layout={{
          title: "Mean spectra",
          autosize: true,
          margin: { t: 40, r: 24, l: 56, b: 56 },
          paper_bgcolor: "rgba(255,255,255,0)",
          plot_bgcolor: "rgba(255,255,255,0)",
          font: { family: "'SF Pro Display', 'Segoe UI', sans-serif", color: "#0b172a" },
          xaxis: {
            title: "Wavelength (nm)",
            gridcolor: "rgba(12,29,54,0.08)",
            zeroline: false,
          },
          yaxis: {
            title: "Reflectance",
            gridcolor: "rgba(12,29,54,0.08)",
            zeroline: false,
          },
          legend: { orientation: "h", x: 0, y: 1.1 },
        }}
        config={{ displaylogo: false, responsive: true }}
        useResizeHandler
        className="spectra-plot"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
