import React, { useMemo, useState } from "react";
import { runAnalysis } from "../api";
import { hexToBase64 } from "../utils/image";

const sectionStyle = {
  border: "1px solid #d0d0d0",
  borderRadius: 8,
  padding: 16,
  marginBottom: 20,
  backgroundColor: "#fafafa",
};

const labelStyle = {
  display: "block",
  fontWeight: 600,
  marginBottom: 6,
};

function formatPercentage(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function formatNumber(value, fractionDigits = 3) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(fractionDigits);
}

export default function AnalysisPanel({ bands, cubeShape }) {
  const [pcaCount, setPcaCount] = useState(3);
  const [pcaLoading, setPcaLoading] = useState(false);
  const [pcaError, setPcaError] = useState("");
  const [pcaResult, setPcaResult] = useState(null);

  const [clusterCount, setClusterCount] = useState(5);
  const [kmeansLoading, setKmeansLoading] = useState(false);
  const [kmeansError, setKmeansError] = useState("");
  const [kmeansResult, setKmeansResult] = useState(null);

  const datasetReady = Array.isArray(bands) && bands.length > 0;
  const bandCount = useMemo(() => (Array.isArray(bands) ? bands.length : 0), [bands]);

  const handleRunPCA = async () => {
    if (!datasetReady) return;
    const components = Math.max(1, Math.min(6, Number(pcaCount) || 3));
    setPcaCount(components);
    setPcaLoading(true);
    setPcaError("");
    try {
      const result = await runAnalysis("pca", { components });
      setPcaResult(result);
    } catch (error) {
      setPcaError(error.message || "Failed to compute PCA components.");
      setPcaResult(null);
    } finally {
      setPcaLoading(false);
    }
  };

  const handleRunKMeans = async () => {
    if (!datasetReady) return;
    const clusters = Math.max(2, Math.min(15, Number(clusterCount) || 5));
    setClusterCount(clusters);
    setKmeansLoading(true);
    setKmeansError("");
    try {
      const result = await runAnalysis("kmeans", { clusters });
      setKmeansResult(result);
    } catch (error) {
      setKmeansError(error.message || "Failed to compute k-means clustering.");
      setKmeansResult(null);
    } finally {
      setKmeansLoading(false);
    }
  };

  if (!datasetReady) {
    return (
      <div style={{ marginTop: 20 }}>
        Load a hyperspectral dataset to enable unsupervised analysis.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      {cubeShape && cubeShape.length === 3 && (
        <div style={{ marginBottom: 16, color: "#555" }}>
          <strong>Dataset shape:</strong> {cubeShape[0]} × {cubeShape[1]} × {cubeShape[2]} (height × width × bands)
        </div>
      )}
      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0 }}>Principal Component Analysis (PCA)</h3>
        <p style={{ color: "#555" }}>
          Compute the leading principal components to inspect the dominant spectral
          patterns in the cube. Each component is normalized independently for
          visualization.
        </p>
        <label htmlFor="pca-components" style={labelStyle}>
          Number of components (1 – 6)
        </label>
        <input
          id="pca-components"
          type="number"
          min={1}
          max={Math.max(1, Math.min(10, bandCount))}
          value={pcaCount}
          onChange={(e) => setPcaCount(e.target.value)}
          style={{ width: 120 }}
          disabled={pcaLoading}
        />
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={handleRunPCA} disabled={pcaLoading}>
            {pcaLoading ? "Computing..." : "Run PCA"}
          </button>
        </div>
        {pcaError && (
          <div style={{ marginTop: 10, color: "#b00020" }}>{pcaError}</div>
        )}
        {pcaResult?.components?.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {pcaResult.components.map((component) => (
                <div
                  key={component.index}
                  style={{
                    width: 220,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    padding: 10,
                    backgroundColor: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    PC {component.index + 1}
                  </div>
                  <img
                    src={`data:image/png;base64,${hexToBase64(component.image)}`}
                    alt={`Principal Component ${component.index + 1}`}
                    style={{ width: "100%", borderRadius: 4 }}
                  />
                  <div style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
                    Explained variance: {formatPercentage(component.variance * 100)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0 }}>K-Means Spectral Clustering</h3>
        <p style={{ color: "#555" }}>
          Partition pixels into clusters based on spectral similarity to highlight
          regions with comparable reflectance signatures.
        </p>
        <label htmlFor="kmeans-clusters" style={labelStyle}>
          Number of clusters (2 – 15)
        </label>
        <input
          id="kmeans-clusters"
          type="number"
          min={2}
          max={15}
          value={clusterCount}
          onChange={(e) => setClusterCount(e.target.value)}
          style={{ width: 120 }}
          disabled={kmeansLoading}
        />
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={handleRunKMeans} disabled={kmeansLoading}>
            {kmeansLoading ? "Clustering..." : "Run K-Means"}
          </button>
        </div>
        {kmeansError && (
          <div style={{ marginTop: 10, color: "#b00020" }}>{kmeansError}</div>
        )}
        {kmeansResult?.map && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: 12,
                backgroundColor: "#fff",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Cluster map</div>
              <img
                src={`data:image/png;base64,${hexToBase64(kmeansResult.map)}`}
                alt="K-means cluster map"
                style={{ width: "100%", borderRadius: 4 }}
              />
            </div>
            {Array.isArray(kmeansResult.cluster_summaries) && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Cluster summary</div>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: "#efefef" }}>
                      <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                        Cluster
                      </th>
                      <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                        Pixels
                      </th>
                      <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                        Share
                      </th>
                      <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                        Mean reflectance
                      </th>
                      <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                        Peak band
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {kmeansResult.cluster_summaries.map((summary) => (
                      <tr key={summary.cluster}>
                        <td style={{ padding: 6, border: "1px solid #ddd" }}>
                          {summary.cluster}
                        </td>
                        <td style={{ padding: 6, border: "1px solid #ddd" }}>
                          {summary.count}
                        </td>
                        <td style={{ padding: 6, border: "1px solid #ddd" }}>
                          {formatPercentage(summary.percentage)}
                        </td>
                        <td style={{ padding: 6, border: "1px solid #ddd" }}>
                          {formatNumber(summary.mean)}
                        </td>
                        <td style={{ padding: 6, border: "1px solid #ddd" }}>
                          {summary.peak_wavelength !== undefined && summary.peak_wavelength !== null
                            ? `${formatNumber(summary.peak_wavelength, 1)} nm`
                            : `Band ${summary.peak_band_index}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
