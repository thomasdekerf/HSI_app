import React from "react";
import Plot from "react-plotly.js";

export default function SpectraPlot({ bands, spectra }) {
  if (!spectra) return null;
  return (
    <Plot
      data={[{ x: bands, y: spectra, mode: "lines", line: { color: "blue" } }]}
      layout={{ width: 400, height: 300, title: "Mean spectrum", xaxis:{title:"Wavelength (nm)"}, yaxis:{title:"Reflectance"} }}
    />
  );
}
