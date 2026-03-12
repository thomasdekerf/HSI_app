import React, { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { hexToRgba } from "../utils/colors";
import { exportSpectraCsv, importSpectraCsv, toNumericBands } from "../utils/export";
import { processSpectrum, SPECTRA_PROCESSING_OPTIONS } from "../utils/spectraProcessing";

function toTraceBands(selection, fallbackBands) {
  const selectionBands = Array.isArray(selection?.bands) ? selection.bands : fallbackBands;
  const fallbackLength = Array.isArray(selection?.spectra) ? selection.spectra.length : 0;
  return toNumericBands(selectionBands, fallbackLength);
}

export default function SpectraPlot({
  bands,
  selections = [],
  currentSelections = [],
  onImportSelections,
  onRenameSelection,
  onRemoveSelection,
}) {
  const [showStdDev, setShowStdDev] = useState(false);
  const [processingMode, setProcessingMode] = useState("raw");
  const [windowSize, setWindowSize] = useState(7);
  const [polyOrder, setPolyOrder] = useState(2);
  const fileInputRef = useRef(null);
  const plotContainerRef = useRef(null);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!plotContainerRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setPlotSize({
        width: Math.max(0, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(plotContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const traces = useMemo(() => {
    const items = [];

    selections
      .map((selection, index) => ({ selection, index }))
      .filter(({ selection }) => Array.isArray(selection?.spectra))
      .forEach(({ selection, index }) => {
        const xValues = toTraceBands(selection, bands);
        const label = selection.label || `Region ${index + 1}`;
        const processedSpectra = processSpectrum(selection.spectra, {
          mode: processingMode,
          windowSize,
          polyOrder,
        });
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
          y: processedSpectra,
          mode: "lines",
          line: { color: selection.color, width: 2.5 },
          name: label,
          showlegend: false,
        });
      });

    return items;
  }, [bands, selections, showStdDev, processingMode, windowSize, polyOrder]);

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

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = importSpectraCsv(text);
    if (imported.length === 0) {
      alert("No spectra could be imported from that CSV.");
    } else if (typeof onImportSelections === "function") {
      onImportSelections(imported);
    }
    event.target.value = "";
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
          <div className="muted-text">Rename spectra inline. Remove appears when you hover a series row.</div>
        </div>
        <div className="spectra-plot-card__actions">
          <select
            value={processingMode}
            onChange={(event) => setProcessingMode(event.target.value)}
            className="field-input field-input--select"
          >
            {SPECTRA_PROCESSING_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {(processingMode === "sg_smooth" || processingMode === "sg_first_derivative") && (
            <>
              <label className="spectra-control">
                <span>Window</span>
                <input
                  type="number"
                  min={3}
                  step={2}
                  value={windowSize}
                  onChange={(event) => setWindowSize(Number(event.target.value) || 7)}
                  className="field-input field-input--compact"
                />
              </label>
              <label className="spectra-control">
                <span>Poly</span>
                <input
                  type="number"
                  min={1}
                  value={polyOrder}
                  onChange={(event) => setPolyOrder(Number(event.target.value) || 2)}
                  className="field-input field-input--compact"
                />
              </label>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExport}
            disabled={exportableSelections.selections.length === 0}
          >
            Export current measurement CSV
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={handleImport}
          />
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
      <div ref={plotContainerRef} className="spectra-plot">
        <Plot
          data={traces}
          layout={{
            autosize: false,
            width: plotSize.width || undefined,
            height: plotSize.height || undefined,
            margin: { t: 16, r: 32, l: 64, b: 64 },
            paper_bgcolor: "rgba(255,255,255,0)",
            plot_bgcolor: "rgba(255,255,255,0)",
            font: { family: "'Segoe UI', Tahoma, sans-serif", color: "#17202b" },
            showlegend: false,
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
          }}
          config={{ displaylogo: false, responsive: true }}
          className="spectra-plot__canvas"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className="spectra-series-list">
        {selections.map((selection, index) => (
          <div key={selection.id || `${selection.label}-${index}`} className="spectra-series-item">
            <span
              className="spectra-series-item__swatch"
              style={{ backgroundColor: selection.color || "#0f6cbd" }}
            />
            <input
              type="text"
              value={selection.label || `Region ${index + 1}`}
              onChange={(event) => onRenameSelection?.(selection.id, event.target.value)}
              className="field-input spectra-series-item__input"
            />
            <button
              type="button"
              className="btn btn-ghost btn--compact spectra-series-item__remove"
              onClick={() => onRemoveSelection?.(selection.id)}
              disabled={!selection.id}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
