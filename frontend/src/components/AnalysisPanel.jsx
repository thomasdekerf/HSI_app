import React, { useEffect, useMemo, useRef, useState } from "react";
import { runAnalysis } from "../api";
import { hexToBase64 } from "../utils/image";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";

const STATUS_STEPS = [
  "Running PCA representations",
  "Building SAM distance and class maps",
  "Computing ratio and entropy views",
  "Finishing contrast-enhanced descriptors",
];

export default function AnalysisPanel({
  cubeShape,
  selections = [],
  allSelections = [],
  onRegion,
  onClearSelections,
}) {
  const [visuals, setVisuals] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusIndex, setStatusIndex] = useState(0);
  const [drawMode, setDrawMode] = useState("rectangle");
  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(0);

  useEffect(() => {
    if (!stageContainerRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setStageWidth(entry.contentRect.width);
      }
    });
    observer.observe(stageContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loading) return undefined;
    const timer = window.setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_STEPS.length);
    }, 900);
    return () => window.clearInterval(timer);
  }, [loading]);

  const availableVisuals = useMemo(
    () =>
      visuals.map((visual) => ({
        ...visual,
        imageUrl: `data:image/png;base64,${hexToBase64(visual.image)}`,
      })),
    [visuals],
  );

  const selectedVisual = useMemo(
    () => availableVisuals.find((visual) => visual.id === selectedId) || availableVisuals[0] || null,
    [availableVisuals, selectedId],
  );

  useEffect(() => {
    if (!availableVisuals.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !availableVisuals.some((visual) => visual.id === selectedId)) {
      setSelectedId(availableVisuals[0].id);
    }
  }, [availableVisuals, selectedId]);

  const regions = selections.map((selection) => ({
    id: selection.id,
    shape: selection.shape || { type: "rectangle", ...selection.bounds },
    color: selection.color,
  }));

  const handleRunAll = async () => {
    setLoading(true);
    setError("");
    setStatusIndex(0);
    try {
      const result = await runAnalysis("unsupervised_suite");
      setVisuals(Array.isArray(result.visuals) ? result.visuals : []);
    } catch (runError) {
      setVisuals([]);
      setError(runError.message || "Failed to compute unsupervised representations.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="analysis-workbench">
      <div className="analysis-sidebar">
        {cubeShape && cubeShape.length === 3 && (
          <div className="analysis-sidebar__meta">
            <span className="meta-label">Dataset shape</span>
            <span className="meta-value">
              {cubeShape[0]} × {cubeShape[1]} × {cubeShape[2]}
            </span>
            <span className="meta-hint">All derived views remain aligned to these pixel coordinates.</span>
          </div>
        )}

        <section className="card analysis-section">
          <h3 className="card__title">Unsupervised representations</h3>
          <p className="card__subtitle">
            Generate a vibrant unsupervised view set and annotate any derived image exactly like the
            false-RGB view.
          </p>
          <button type="button" className="btn btn-primary" onClick={handleRunAll} disabled={loading}>
            {loading ? "Calculating..." : "Calculate all representations"}
          </button>
          {loading && (
            <div className="analysis-status">
              <div className="analysis-status__bar">
                <div
                  className="analysis-status__bar-fill"
                  style={{ width: `${((statusIndex + 1) / STATUS_STEPS.length) * 100}%` }}
                />
              </div>
              <div className="analysis-status__label">{STATUS_STEPS[statusIndex]}</div>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
        </section>

        <section className="card analysis-section">
          <div className="analysis-thumbnail-header">
            <h3 className="card__title">Available views</h3>
            <div className="muted-text">{availableVisuals.length} generated</div>
          </div>
          <div className="analysis-thumbnail-grid">
            {availableVisuals.length === 0 && (
              <div className="muted-text">
                Run the suite to populate PCA, SAM, ratio, entropy, ambiguity, abundance, and
                descriptor maps.
              </div>
            )}
            {availableVisuals.map((visual) => (
              <button
                key={visual.id}
                type="button"
                className={`analysis-thumb${selectedVisual?.id === visual.id ? " is-active" : ""}`}
                onClick={() => setSelectedId(visual.id)}
              >
                <img src={visual.imageUrl} alt={visual.label} className="analysis-thumb__image" />
                <span className="analysis-thumb__label">{visual.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="analysis-main">
        <section className="window-panel viewer-window">
          <header className="window-panel__header">
            <div>
              <h3 className="window-panel__title">{selectedVisual?.label || "Derived image viewer"}</h3>
              <div className="window-panel__meta">
                {selectedVisual?.description || "Choose a generated representation to inspect and annotate."}
              </div>
            </div>
            {selections.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={onClearSelections}>
                Clear measurement annotations
              </button>
            )}
          </header>
          <div className="viewer-window__body">
            <div className="viewer-panel__stage" ref={stageContainerRef}>
              <ViewerCanvas
                imageUrl={selectedVisual?.imageUrl || null}
                regions={regions}
                onRegion={onRegion}
                maxWidth={stageWidth}
                maxHeight={760}
                drawMode={drawMode}
              />
            </div>
            <div className="annotation-tools">
              <span className="annotation-tools__label">Annotation shape</span>
              <div className="annotation-tools__options">
                {[
                  { id: "rectangle", label: "Rectangle" },
                  { id: "circle", label: "Circle" },
                  { id: "point", label: "Point" },
                  { id: "polygon", label: "Polygon" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`annotation-tools__button${drawMode === option.id ? " is-active" : ""}`}
                    onClick={() => setDrawMode(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="analysis-annotation-hint">
              These annotations still extract spectra from the underlying hyperspectral cube.
            </div>
          </div>
        </section>

        <section className="window-panel spectra-window">
          <header className="window-panel__header">
            <div>
              <h3 className="window-panel__title">Spectra Window</h3>
              <div className="window-panel__meta">
                Annotations taken on derived representations still sample the original cube spectra.
              </div>
            </div>
          </header>
          <SpectraPlot selections={allSelections} currentSelections={selections} />
        </section>
      </div>
    </div>
  );
}
