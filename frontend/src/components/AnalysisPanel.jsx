import React, { useEffect, useMemo, useState } from "react";
import { runAnalysis } from "../api";
import { hexToBase64 } from "../utils/image";
import AnalysisImageViewer from "./AnalysisImageViewer";

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

  const [selectedView, setSelectedView] = useState(null);

  const datasetReady = Array.isArray(bands) && bands.length > 0;
  const bandCount = useMemo(() => (Array.isArray(bands) ? bands.length : 0), [bands]);

  const availableVisuals = useMemo(() => {
    const visuals = [];
    if (pcaResult?.components?.length) {
      pcaResult.components.forEach((component) => {
        visuals.push({
          id: `pca-${component.index}`,
          label: `PCA Component ${component.index + 1}`,
          image: `data:image/png;base64,${hexToBase64(component.image)}`,
          description: `Explained variance: ${formatPercentage(component.variance * 100)}`,
        });
      });
    }
    if (kmeansResult?.map) {
      visuals.push({
        id: "kmeans-map",
        label: `K-means Cluster Map${
          Array.isArray(kmeansResult.cluster_summaries)
            ? ` (${kmeansResult.cluster_summaries.length} clusters)`
            : ""
        }`,
        image: `data:image/png;base64,${hexToBase64(kmeansResult.map)}`,
        description: "Pixel assignments visualized by cluster color.",
      });
    }
    return visuals;
  }, [pcaResult, kmeansResult]);

  useEffect(() => {
    if (!availableVisuals.length) {
      setSelectedView(null);
      return;
    }
    if (!selectedView || !availableVisuals.some((visual) => visual.id === selectedView)) {
      setSelectedView(availableVisuals[0].id);
    }
  }, [availableVisuals, selectedView]);

  const handleRunPCA = async () => {
    if (!datasetReady) return;
    const components = Math.max(1, Math.min(6, Number(pcaCount) || 3));
    setPcaCount(components);
    setPcaLoading(true);
    setPcaError("");
    try {
      const result = await runAnalysis("pca", { components });
      setPcaResult(result);
      if (result?.components?.length) {
        setSelectedView(`pca-${result.components[0].index}`);
      }
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
      if (result?.map) {
        setSelectedView("kmeans-map");
      }
    } catch (error) {
      setKmeansError(error.message || "Failed to compute k-means clustering.");
      setKmeansResult(null);
    } finally {
      setKmeansLoading(false);
    }
  };

  if (!datasetReady) {
    return (
      <div className="card analysis-empty">
        Load a hyperspectral dataset to enable unsupervised analysis.
      </div>
    );
  }

  return (
    <div className="analysis-layout">
      <div className="analysis-sidebar">
        {cubeShape && cubeShape.length === 3 && (
          <div className="analysis-sidebar__meta">
            <span className="meta-label">Dataset shape</span>
            <span className="meta-value">
              {cubeShape[0]} × {cubeShape[1]} × {cubeShape[2]}
            </span>
            <span className="meta-hint">height × width × bands</span>
          </div>
        )}

        <section className="card analysis-section">
          <h3 className="card__title">Principal Component Analysis</h3>
          <p className="card__subtitle">
            Extract dominant spectral trends and explore their spatial expression across the
            scene.
          </p>
          <div className="field-group inline">
            <label className="field-label" htmlFor="pca-components">
              Components (1 – 6)
            </label>
            <input
              id="pca-components"
              type="number"
              min={1}
              max={Math.max(1, Math.min(10, bandCount))}
              value={pcaCount}
              onChange={(e) => setPcaCount(e.target.value)}
              className="field-input field-input--compact"
              disabled={pcaLoading}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunPCA}
            disabled={pcaLoading}
          >
            {pcaLoading ? "Computing…" : "Run PCA"}
          </button>
          {pcaError && <div className="form-error">{pcaError}</div>}
          {pcaResult?.components?.length > 0 && (
            <div className="thumbnail-grid">
              {pcaResult.components.map((component) => (
                <article key={component.index} className="thumbnail-card">
                  <header className="thumbnail-card__header">
                    <span className="thumbnail-card__title">PC {component.index + 1}</span>
                    <span className="thumbnail-card__meta">
                      {formatPercentage(component.variance * 100)} variance
                    </span>
                  </header>
                  <img
                    src={`data:image/png;base64,${hexToBase64(component.image)}`}
                    alt={`Principal Component ${component.index + 1}`}
                    className="thumbnail-card__image"
                  />
                  <button
                    type="button"
                    className={`btn btn-ghost${
                      selectedView === `pca-${component.index}` ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedView(`pca-${component.index}`)}
                  >
                    {selectedView === `pca-${component.index}` ? "Viewing" : "View large"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card analysis-section">
          <h3 className="card__title">K-means spectral clustering</h3>
          <p className="card__subtitle">
            Segment the scene into materials with comparable reflectance signatures for rapid
            interpretation.
          </p>
          <div className="field-group inline">
            <label className="field-label" htmlFor="kmeans-clusters">
              Clusters (2 – 15)
            </label>
            <input
              id="kmeans-clusters"
              type="number"
              min={2}
              max={15}
              value={clusterCount}
              onChange={(e) => setClusterCount(e.target.value)}
              className="field-input field-input--compact"
              disabled={kmeansLoading}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunKMeans}
            disabled={kmeansLoading}
          >
            {kmeansLoading ? "Clustering…" : "Run clustering"}
          </button>
          {kmeansError && <div className="form-error">{kmeansError}</div>}
          {kmeansResult?.map && (
            <div className="cluster-results">
              <div className="thumbnail-card">
                <header className="thumbnail-card__header">
                  <span className="thumbnail-card__title">Cluster map</span>
                  {Array.isArray(kmeansResult.cluster_summaries) && (
                    <span className="thumbnail-card__meta">
                      {kmeansResult.cluster_summaries.length} clusters
                    </span>
                  )}
                </header>
                <img
                  src={`data:image/png;base64,${hexToBase64(kmeansResult.map)}`}
                  alt="K-means cluster map"
                  className="thumbnail-card__image"
                />
                <button
                  type="button"
                  className={`btn btn-ghost${selectedView === "kmeans-map" ? " is-active" : ""}`}
                  onClick={() => setSelectedView("kmeans-map")}
                >
                  {selectedView === "kmeans-map" ? "Viewing" : "View large"}
                </button>
              </div>
              {Array.isArray(kmeansResult.cluster_summaries) && (
                <div className="cluster-summary">
                  <div className="cluster-summary__title">Cluster summary</div>
                  <table className="cluster-summary__table">
                    <thead>
                      <tr>
                        <th>Cluster</th>
                        <th>Pixels</th>
                        <th>Share</th>
                        <th>Mean reflectance</th>
                        <th>Peak band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kmeansResult.cluster_summaries.map((summary) => (
                        <tr key={summary.cluster}>
                          <td>{summary.cluster}</td>
                          <td>{summary.count}</td>
                          <td>{formatPercentage(summary.percentage)}</td>
                          <td>{formatNumber(summary.mean)}</td>
                          <td>
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
        </section>
      </div>
      <div className="analysis-viewer card">
        <AnalysisImageViewer
          visuals={availableVisuals}
          selectedId={selectedView}
          onSelect={setSelectedView}
        />
      </div>
    </div>
  );
}
