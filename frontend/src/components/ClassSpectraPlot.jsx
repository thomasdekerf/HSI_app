import React, { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { hexToRgba } from "../utils/colors";

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
  const [showStdDev, setShowStdDev] = useState(false);
  const numericBands = useMemo(() => sanitizeBands(bands), [bands]);
  const traces = useMemo(() => {
    if (!Array.isArray(series)) return [];
    const items = [];
    series
      .filter((entry) => Array.isArray(entry?.spectra))
      .forEach((entry) => {
        const hasStd =
          showStdDev &&
          Array.isArray(entry.stddev) &&
          entry.stddev.length === entry.spectra.length &&
          entry.stddev.length === numericBands.length;
        if (hasStd) {
          const lower = entry.spectra.map((value, idx) => value - (entry.stddev[idx] || 0));
          const upper = entry.spectra.map((value, idx) => value + (entry.stddev[idx] || 0));
          items.push({
            x: numericBands,
            y: lower,
            mode: "lines",
            line: { width: 0 },
            hoverinfo: "skip",
            showlegend: false,
            name: `${entry.label} std lower`,
          });
          items.push({
            x: numericBands,
            y: upper,
            mode: "lines",
            line: { width: 0 },
            fill: "tonexty",
            fillcolor: hexToRgba(entry.color, 0.18),
            hoverinfo: "skip",
            showlegend: false,
            name: `${entry.label} std upper`,
          });
        }
        items.push({
          x: numericBands,
          y: entry.spectra,
          mode: "lines",
          line: { color: entry.color, width: 3 },
          name: entry.label,
        });
      });
    return items;
  }, [numericBands, series, showStdDev]);

  if (!traces.length) {
    return <div className="spectra-card spectra-card--empty">No spectra available yet.</div>;
  }

  return (
    <div className="spectra-card">
      <div className="spectra-plot-card__header">
        <div className="card__title">{title}</div>
        <label className="checkbox-toggle">
          <input
            type="checkbox"
            checked={showStdDev}
            onChange={() => setShowStdDev((prev) => !prev)}
          />
          <span>Show standard deviation</span>
        </label>
      </div>
      <Plot
        data={traces}
        layout={{
          autosize: true,
          height: 340,
          margin: { t: 20, r: 24, l: 64, b: 64 },
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
          legend: { orientation: "h", y: -0.25 },
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
