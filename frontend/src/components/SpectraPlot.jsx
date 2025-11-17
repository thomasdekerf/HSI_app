import React, { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { hexToRgba } from "../utils/colors";
import { exportSpectraCsv, toNumericBands } from "../utils/export";

export default function SpectraPlot({ bands, selections }) {
  const [showStdDev, setShowStdDev] = useState(false);
  const numericBands = useMemo(() => {
    const fallbackLength = Array.isArray(selections)
      ? selections.find((entry) => Array.isArray(entry?.spectra))?.spectra?.length
      : 0;
    return toNumericBands(bands, fallbackLength || 0);
  }, [bands, selections]);

  const traces = useMemo(() => {
    if (!Array.isArray(selections)) return [];
    const items = [];
    selections
      .map((sel, idx) => ({ sel, idx }))
      .filter(({ sel }) => Array.isArray(sel.spectra))
      .forEach(({ sel, idx }) => {
        const label = sel.label || `Region ${idx + 1}`;
        const hasStd =
          showStdDev &&
          Array.isArray(sel.stddev) &&
          sel.stddev.length === sel.spectra.length &&
          sel.stddev.length === numericBands.length;
        if (hasStd) {
          const lower = sel.spectra.map((value, i) => value - (sel.stddev[i] || 0));
          const upper = sel.spectra.map((value, i) => value + (sel.stddev[i] || 0));
          items.push({
            x: numericBands,
            y: lower,
            mode: "lines",
            line: { width: 0 },
            showlegend: false,
            hoverinfo: "skip",
            name: `${label} std lower`,
          });
          items.push({
            x: numericBands,
            y: upper,
            mode: "lines",
            line: { width: 0 },
            fill: "tonexty",
            fillcolor: hexToRgba(sel.color, 0.18),
            showlegend: false,
            hoverinfo: "skip",
            name: `${label} std upper`,
          });
        }
        items.push({
          x: numericBands,
          y: sel.spectra,
          mode: "lines",
          line: { color: sel.color, width: 3 },
          name: label,
        });
      });
    return items;
  }, [numericBands, selections, showStdDev]);

  const exportableSelections = useMemo(
    () =>
      (Array.isArray(selections) ? selections : [])
        .map((sel, idx) => ({
          ...sel,
          label: sel.label || `Region ${idx + 1}`,
          hasStd:
            Array.isArray(sel.stddev) &&
            sel.stddev.length === sel.spectra?.length &&
            sel.stddev.length === numericBands.length,
        }))
        .filter((sel) => Array.isArray(sel.spectra)),
    [numericBands.length, selections],
  );

  const handleExport = () => {
    exportSpectraCsv("spectra-selections.csv", numericBands, exportableSelections);
  };

  if (traces.length === 0) return null;
  return (
    <div className="spectra-plot-card card">
      <div className="spectra-plot-card__header">
        <div className="card__title">Spectral signatures</div>
        <div className="spectra-plot-card__actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExport}
            disabled={exportableSelections.length === 0}
          >
            Export CSV
          </button>
          <label className="checkbox-toggle">
            <input
              type="checkbox"
              checked={showStdDev}
              onChange={() => setShowStdDev((prev) => !prev)}
            />
            <span>Show standard deviation</span>
          </label>
        </div>
      </div>
      <Plot
        data={traces}
        layout={{
          autosize: true,
          margin: { t: 20, r: 24, l: 56, b: 56 },
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
          legend: { orientation: "h", x: 0, y: 1.05 },
        }}
        config={{ displaylogo: false, responsive: true }}
        useResizeHandler
        className="spectra-plot"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
