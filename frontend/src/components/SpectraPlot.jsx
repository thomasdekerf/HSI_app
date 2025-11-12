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
    <Plot
      data={traces}
      layout={{
        width: 480,
        height: 360,
        title: "Mean spectra",
        xaxis: { title: "Wavelength (nm)" },
        yaxis: { title: "Reflectance" },
        legend: { orientation: "h" },
        margin: { t: 40, r: 20, l: 60, b: 60 },
      }}
    />
  );
}
