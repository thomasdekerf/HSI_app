import React from "react";
import Plot from "react-plotly.js";

export default function SpectraPlot({ bands, spectra }) {
  if (!spectra) return null;
  const numericBands = bands.map((band, idx) => {
    const num = Number(band);
    return Number.isFinite(num) ? num : idx;
  });
  return (
    <Plot
      data={[{ x: numericBands, y: spectra, mode: "lines", line: { color: "blue" } }]}
      layout={{ width: 400, height: 300, title: "Mean spectrum", xaxis:{title:"Wavelength (nm)"}, yaxis:{title:"Reflectance"} }}
    />
  );
}
