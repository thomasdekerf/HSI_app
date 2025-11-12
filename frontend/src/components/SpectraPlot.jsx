import React from "react";
import Plot from "react-plotly.js";

function toNumericBands(bands) {
  return bands.map((band, idx) => {
    const num = Number(band);
    return Number.isFinite(num) ? num : idx;
  });
}

export default function SpectraPlot({ bands, regions = [] }) {
  const numericBands = toNumericBands(bands);
  const traces = regions
    .filter((region) => Array.isArray(region.spectra))
    .map((region) => ({
      x: numericBands,
      y: region.spectra,
      mode: "lines",
      line: { color: region.color, width: 2 },
      name: region.label,
    }));

  if (!traces.length) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 320,
          border: "1px dashed #ccc",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          padding: 20,
        }}
      >
        Select one or more regions to view spectra.
      </div>
    );
  }

  return (
    <Plot
      data={traces}
      layout={{
        width: undefined,
        height: 360,
        title: "Region spectra",
        margin: { l: 60, r: 20, t: 50, b: 50 },
        xaxis: { title: "Wavelength (nm)" },
        yaxis: { title: "Reflectance" },
        legend: { orientation: "h" },
      }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
      config={{ displayModeBar: false }}
    />
  );
}
