import React, { useEffect, useMemo, useRef, useState } from "react";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";
import { hexToBase64 } from "../utils/image";

const STATUS_STEPS = [
  "Running PCA",
  "Finding endmembers and SAM maps",
  "Computing ratios, entropy, depth, and variance",
  "Packaging thumbnails and views",
];

function formatBandLabel(band) {
  if (band === undefined || band === null) return "-";
  if (typeof band === "number" && Number.isFinite(band)) {
    return `${band.toFixed(1)} nm`;
  }
  const numeric = Number(band);
  if (Number.isFinite(numeric)) {
    return `${numeric.toFixed(1)} nm`;
  }
  return String(band);
}

export default function HSIViewer({
  measurementName,
  bands,
  rgb,
  idxs,
  onChange,
  selections = [],
  allSelections = [],
  currentSelections = [],
  onRegion,
  onClearSelections,
  derivedVisuals = [],
  onRunSuite,
  suiteLoading,
  suiteError,
  onImportSelections,
  onRenameSelection,
  onRemoveSelection,
  roiShape = null,
  roiEnabled = false,
  onSetRoi,
  onClearRoi,
  onToggleRoi,
  onSaveRoi,
  canSaveRoi = false,
}) {
  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [drawMode, setDrawMode] = useState("rectangle");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [selectedViewId, setSelectedViewId] = useState("frgb");
  const [statusIndex, setStatusIndex] = useState(0);
  const [interactionMode, setInteractionMode] = useState("annotate");

  useEffect(() => {
    setDrawMode("rectangle");
    setBrightness(100);
    setContrast(100);
    setSelectedViewId("frgb");
    setInteractionMode("annotate");
  }, [measurementName]);

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
    if (!suiteLoading) return undefined;
    const timer = window.setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_STEPS.length);
    }, 850);
    return () => window.clearInterval(timer);
  }, [suiteLoading]);

  const handleBandChange = (index, value) => {
    const numericVal = Number(value);
    const clamped = Math.max(0, Math.min(bands.length - 1, numericVal));
    const next = [...idxs];
    next[index] = clamped;
    onChange(next);
  };

  const frgbImageUrl = rgb ? `data:image/jpeg;base64,${hexToBase64(rgb)}` : null;
  const viewEntries = useMemo(
    () => [
      {
        id: "frgb",
        label: "False RGB",
        description: "Band-selected false-RGB view with brightness and contrast tuning.",
        imageUrl: frgbImageUrl,
      },
      ...derivedVisuals.map((visual) => ({
        ...visual,
        imageUrl: `data:image/png;base64,${hexToBase64(visual.image)}`,
      })),
    ],
    [derivedVisuals, frgbImageUrl],
  );

  const selectedView = useMemo(
    () => viewEntries.find((entry) => entry.id === selectedViewId) || viewEntries[0] || null,
    [selectedViewId, viewEntries],
  );

  useEffect(() => {
    if (!selectedView || viewEntries.some((entry) => entry.id === selectedView.id)) {
      return;
    }
    setSelectedViewId("frgb");
  }, [selectedView, viewEntries]);

  const regions = [
    ...(roiShape
      ? [
          {
            id: "roi-mask",
            shape: roiShape,
            color: roiEnabled ? "#00c7be" : "#7c8a96",
          },
        ]
      : []),
    ...selections.map((selection) => ({
      id: selection.id,
      shape: selection.shape || { type: "rectangle", ...selection.bounds },
      color: selection.color,
    })),
  ];

  const handleCanvasRegion = (shapeData) => {
    if (interactionMode === "roi") {
      if (shapeData?.shape && typeof onSetRoi === "function") {
        onSetRoi(shapeData.shape);
      }
      setInteractionMode("annotate");
      return;
    }
    onRegion?.(shapeData);
  };

  return (
    <div className="viewer-workbench viewer-workbench--merged">
      <section className="window-panel viewer-window">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">{selectedView?.label || "Measurement viewer"}</h3>
            <div className="window-panel__meta">{selectedView?.description || measurementName}</div>
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
              imageUrl={selectedView?.imageUrl || null}
              regions={regions}
              onRegion={handleCanvasRegion}
              maxWidth={stageWidth}
              maxHeight={760}
              brightness={brightness}
              contrast={contrast}
              drawMode={interactionMode === "roi" ? "polygon" : drawMode}
            />
          </div>

          <div className="viewer-panel__controls viewer-panel__controls--merged">
            <div className="display-sliders display-sliders--compact">
              <div className="display-sliders__header">
                <span className="annotation-tools__label">ROI preprocessing</span>
              </div>
              <div className="muted-text">
                {roiShape
                  ? roiEnabled
                    ? "ROI is enabled. False-RGB and unsupervised views use only the selected lasso region."
                    : "ROI is saved in memory but currently disabled."
                  : "Optional: draw a lasso ROI to black out the background and rescale using only the ROI."}
              </div>
              <div className="annotation-tools__options">
                <button
                  type="button"
                  className={`annotation-tools__button${interactionMode === "roi" ? " is-active" : ""}`}
                  onClick={() => setInteractionMode((prev) => (prev === "roi" ? "annotate" : "roi"))}
                >
                  {interactionMode === "roi" ? "Drawing ROI" : "Lasso ROI"}
                </button>
                <button
                  type="button"
                  className={`annotation-tools__button${roiEnabled ? " is-active" : ""}`}
                  onClick={onToggleRoi}
                  disabled={!roiShape}
                >
                  {roiEnabled ? "ROI On" : "ROI Off"}
                </button>
                <button
                  type="button"
                  className="annotation-tools__button"
                  onClick={onSaveRoi}
                  disabled={!roiShape || !canSaveRoi}
                >
                  Save ROI
                </button>
                <button type="button" className="annotation-tools__button" onClick={onClearRoi} disabled={!roiShape}>
                  Clear ROI
                </button>
              </div>
              <div className="annotation-tools__hint">
                {interactionMode === "roi"
                  ? "Click to add lasso vertices and double-click to close the ROI."
                  : canSaveRoi
                    ? "ROI drawing is separate from spectral annotations. Save writes a sidecar ROI file next to the measurement header."
                    : "ROI drawing is separate from spectral annotations. Saving is only available for measurements loaded from a folder path."}
              </div>
            </div>

            <div className="display-sliders display-sliders--compact">
              <div className="display-sliders__header">
                <span className="annotation-tools__label">Annotation shape</span>
              </div>
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

            <div className="display-sliders display-sliders--compact">
              <div className="display-sliders__header">
                <span className="annotation-tools__label">False RGB controls</span>
              </div>
              {["R", "G", "B"].map((channel, index) => (
                <div key={channel} className="band-sliders__item">
                  <label className="band-sliders__label">
                    {channel}-band <span>{formatBandLabel(bands[idxs[index]])}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={bands.length - 1}
                    value={idxs[index]}
                    onChange={(event) => handleBandChange(index, event.target.value)}
                    className="band-slider"
                  />
                </div>
              ))}
              <div className="band-sliders__item">
                <label className="band-sliders__label">
                  Brightness <span>{brightness}%</span>
                </label>
                <input
                  type="range"
                  min={50}
                  max={180}
                  value={brightness}
                  onChange={(event) => setBrightness(Number(event.target.value))}
                  className="band-slider"
                />
              </div>
              <div className="band-sliders__item">
                <label className="band-sliders__label">
                  Contrast <span>{contrast}%</span>
                </label>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={contrast}
                  onChange={(event) => setContrast(Number(event.target.value))}
                  className="band-slider"
                />
              </div>
            </div>

            <div className="display-sliders display-sliders--compact">
              <div className="display-sliders__header">
                <span className="annotation-tools__label">Unsupervised views</span>
                <button type="button" className="btn btn-primary btn--compact" onClick={onRunSuite} disabled={suiteLoading}>
                  {suiteLoading ? "Calculating..." : "Calculate suite"}
                </button>
              </div>
              {suiteLoading && (
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
              {suiteError && <div className="form-error">{suiteError}</div>}
              <div className="analysis-thumbnail-grid analysis-thumbnail-grid--viewer">
                {viewEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`analysis-thumb${selectedView?.id === entry.id ? " is-active" : ""}`}
                    onClick={() => setSelectedViewId(entry.id)}
                  >
                    {entry.imageUrl ? (
                      <img src={entry.imageUrl} alt={entry.label} className="analysis-thumb__image" />
                    ) : (
                      <div className="analysis-thumb__placeholder">{entry.label}</div>
                    )}
                    <span className="analysis-thumb__label">{entry.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="window-panel spectra-window">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">Spectra Window</h3>
            <div className="window-panel__meta">
              Annotations from false-RGB and all derived views appear here together.
            </div>
          </div>
        </header>
        <SpectraPlot
          bands={bands}
          selections={allSelections}
          currentSelections={currentSelections}
          onImportSelections={onImportSelections}
          onRenameSelection={onRenameSelection}
          onRemoveSelection={onRemoveSelection}
        />
      </section>
    </div>
  );
}
