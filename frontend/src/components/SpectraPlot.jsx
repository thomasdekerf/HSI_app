import React, { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { hexToRgba } from "../utils/colors";
import { exportSpectraCsv, toNumericBands } from "../utils/export";

function toTraceBands(selection, fallbackBands) {
  const selectionBands = Array.isArray(selection?.bands) ? selection.bands : fallbackBands;
  const fallbackLength = Array.isArray(selection?.spectra) ? selection.spectra.length : 0;
  return toNumericBands(selectionBands, fallbackLength);
}

export default function SpectraPlot({ bands, selections = [], currentSelections = [] }) {
  const [showStdDev, setShowStdDev] = useState(false);

  const traces = useMemo(() => {
    const items = [];

    selections
      .map((selection, index) => ({ selection, index }))
      .filter(({ selection }) => Array.isArray(selection?.spectra))
      .forEach(({ selection, index }) => {
        const xValues = toTraceBands(selection, bands);
        const label = selection.label || `Region ${index + 1}`;
        const hasStd =
          showStdDev &&
          Array.isArray(selection.stddev) &&
          selection.stddev.length === selection.spectra.length &&
          selection.stddev.length === xValues.length;

        if (hasStd) {
          const lower = selection.spectra.map((value, idx) => value - (selection.stddev[idx] || 0));
          const upper = selection.spectra.map((value, idx) => value + (selection.stddev[idx] || 0));
          items.push({
            x: xValues,
            y: lower,
            mode: "lines",
            line: { width: 0 },
            showlegend: false,
            hoverinfo: "skip",
            name: `${label} std lower`,
          });
          items.push({
            x: xValues,
            y: upper,
            mode: "lines",
            line: { width: 0 },
            fill: "tonexty",
            fillcolor: hexToRgba(selection.color, 0.14),
            showlegend: false,
            hoverinfo: "skip",
            name: `${label} std upper`,
          });
        }

        items.push({
          x: xValues,
          y: selection.spectra,
          mode: "lines",
          line: { color: selection.color, width: 2.5 },
          name: label,
        });
      });

    return items;
  }, [bands, selections, showStdDev]);

  const exportableSelections = useMemo(() => {
    const currentNumericBands = toNumericBands(
      bands,
      currentSelections.find((selection) => Array.isArray(selection?.spectra))?.spectra?.length || 0,
    );

    return {
      bands: currentNumericBands,
      selections: currentSelections
        .map((selection, index) => ({
          ...selection,
          label: selection.label || `Region ${index + 1}`,
          hasStd:
            Array.isArray(selection.stddev) &&
            selection.stddev.length === selection.spectra?.length &&
            selection.stddev.length === currentNumericBands.length,
        }))
        .filter((selection) => Array.isArray(selection.spectra)),
    };
  }, [bands, currentSelections]);

  const handleExport = () => {
    exportSpectraCsv(
      "spectra-selections.csv",
      exportableSelections.bands,
      exportableSelections.selections,
    );
  };

  if (traces.length === 0) {
    return (
      <div className="spectra-plot-card spectra-plot-card--empty">
        Draw a region to add its spectral signature to the shared plot window.
      </div>
    );
  }

  return (
    <div className="spectra-plot-card">
      <div className="spectra-plot-card__header">
        <div className="spectra-plot-card__header-copy">
          <div className="card__title">Spectral signatures</div>
          <div className="muted-text">Legend is docked outside the figure for denser comparisons.</div>
        </div>
        <div className="spectra-plot-card__actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExport}
            disabled={exportableSelections.selections.length === 0}
          >
            Export current measurement CSV
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
          margin: { t: 16, r: 210, l: 64, b: 60 },
          paper_bgcolor: "rgba(255,255,255,0)",
          plot_bgcolor: "rgba(255,255,255,0)",
          font: { family: "'Segoe UI', Tahoma, sans-serif", color: "#17202b" },
          xaxis: {
            title: "Wavelength (nm)",
            gridcolor: "rgba(23,32,43,0.1)",
            zeroline: false,
          },
          yaxis: {
            title: "Reflectance",
            gridcolor: "rgba(23,32,43,0.1)",
            zeroline: false,
          },
          legend: {
            orientation: "v",
            x: 1.02,
            xanchor: "left",
            y: 1,
            yanchor: "top",
            bgcolor: "rgba(255,255,255,0.72)",
            bordercolor: "rgba(23,32,43,0.12)",
            borderwidth: 1,
          },
        }}
        config={{ displaylogo: false, responsive: true }}
        useResizeHandler
        className="spectra-plot"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
