import React, { useEffect, useMemo, useRef, useState } from "react";
import ViewerCanvas from "./ViewerCanvas";
import SpectraPlot from "./SpectraPlot";
import { hexToBase64 } from "../utils/image";
import { useDragPan } from "../utils/useDragPan";

const STATUS_STEPS = [
  "Running PCA",
  "Finding endmembers and SAM maps",
  "Computing ratios, entropy, depth, and variance",
  "Packaging thumbnails and views",
];

function ViewerControlIcon({ id }) {
  if (id === "frgb") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6h14M5 12h14M5 18h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="9" cy="6" r="2" fill="currentColor" />
        <circle cx="15" cy="12" r="2" fill="currentColor" />
        <circle cx="11" cy="18" r="2" fill="currentColor" />
      </svg>
    );
  }
  if (id === "roi") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 7h4M6 7v4M18 7h-4M18 7v4M6 17h4M6 17v-4M18 17h-4M18 17v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "annotate") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M14 17l3-5 3 5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17l4-5 4 3 4-7 4 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 19h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

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

function clampZoomPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(400, Math.max(50, numeric));
}

function clampDisplayPercentile(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function HistogramChannel({ channel, range = [0, 1] }) {
  const counts = Array.isArray(channel?.counts) ? channel.counts : [];
  const maxCount = Math.max(1, ...counts);
  const barWidth = counts.length > 0 ? 100 / counts.length : 100;
  const channelClass = `histogram-channel histogram-channel--${channel?.id || "red"}`;
  const p1 = Number(channel?.p1);
  const p99 = Number(channel?.p99);
  const markerPosition = (value) => Math.min(100, Math.max(0,
    ((Number(value) - range[0]) / (range[1] - range[0] || 1)) * 100,
  ));
  const blackPoint = markerPosition(channel?.blackPoint ?? channel?.p1 ?? range[0]);
  const whitePoint = markerPosition(channel?.whitePoint ?? channel?.p99 ?? range[1]);

  return (
    <div className={channelClass}>
      <div className="histogram-channel__header">
        <span>{channel?.id || "channel"}</span>
        <span>
          p1 {Number.isFinite(p1) ? p1.toFixed(3) : "-"} | p99 {Number.isFinite(p99) ? p99.toFixed(3) : "-"}
        </span>
      </div>
      <svg className="histogram-channel__plot" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
        {counts.map((count, index) => {
          const height = Math.max(1, (count / maxCount) * 40);
          return (
            <rect
              key={`${channel?.id || "channel"}-${index}`}
              x={index * barWidth}
              y={42 - height}
              width={Math.max(0.4, barWidth - 0.15)}
              height={height}
            />
          );
        })}
        <line x1={blackPoint} x2={blackPoint} y1="2" y2="42" className="histogram-marker histogram-marker--low" />
        <line x1={whitePoint} x2={whitePoint} y1="2" y2="42" className="histogram-marker histogram-marker--high" />
      </svg>
    </div>
  );
}

function DisplayScalingWindow({ settings, stats, onChange, onClose }) {
  const current = {
    mode: settings?.mode || "clip",
    lowPercentile: Number(settings?.lowPercentile ?? 1),
    highPercentile: Number(settings?.highPercentile ?? 99),
    gamma: Number(settings?.gamma ?? 1),
  };
  const lowPercentile = clampDisplayPercentile(current.lowPercentile, 0, 50, 1);
  const highPercentile = clampDisplayPercentile(current.highPercentile, 50, 100, 99);
  const gamma = Math.min(3, Math.max(0.2, current.gamma || 1));
  const channels = Array.isArray(stats?.histogram?.channels) ? stats.histogram.channels : [];

  const updateSetting = (patch) => {
    const next = { ...current, ...patch };
    if (next.highPercentile - next.lowPercentile < 0.5) {
      if (Object.prototype.hasOwnProperty.call(patch, "lowPercentile")) {
        next.highPercentile = Math.min(100, next.lowPercentile + 0.5);
      } else {
        next.lowPercentile = Math.max(0, next.highPercentile - 0.5);
      }
    }
    onChange?.(next);
  };

  return (
    <div className="display-window-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="display-window window-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Display scaling"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">Display scaling</h3>
            <div className="window-panel__meta">Histogram stretch for the current false-RGB bands</div>
          </div>
          <button type="button" className="btn btn-ghost btn--compact" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="display-window__body">
          <div className="display-mode-grid" role="group" aria-label="Scaling mode">
            {[
              { id: "clip", label: "Raw clip" },
              { id: "channel", label: "Channel stretch" },
              { id: "luminance", label: "Luminance stretch" },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`display-mode-button${current.mode === mode.id ? " is-active" : ""}`}
                onClick={() => updateSetting({ mode: mode.id })}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="histogram-stack">
            {channels.length > 0 ? (
              channels.map((channel) => (
                <HistogramChannel key={channel.id} channel={channel} range={stats.histogram.range} />
              ))
            ) : (
              <div className="notice">Load a false-RGB image to show histogram data.</div>
            )}
          </div>

          <div className="display-scaling-controls">
            <label className="band-sliders__item">
              <span className="band-sliders__label">
                Black percentile <span>{lowPercentile.toFixed(1)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={lowPercentile}
                disabled={current.mode === "clip"}
                onChange={(event) => updateSetting({ lowPercentile: Number(event.target.value) })}
                className="band-slider"
              />
            </label>

            <label className="band-sliders__item">
              <span className="band-sliders__label">
                White percentile <span>{highPercentile.toFixed(1)}%</span>
              </span>
              <input
                type="range"
                min={80}
                max={100}
                step={0.5}
                value={highPercentile}
                disabled={current.mode === "clip"}
                onChange={(event) => updateSetting({ highPercentile: Number(event.target.value) })}
                className="band-slider"
              />
            </label>

            <label className="band-sliders__item">
              <span className="band-sliders__label">
                Gamma <span>{gamma.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0.4}
                max={2.5}
                step={0.05}
                value={gamma}
                onChange={(event) => updateSetting({ gamma: Number(event.target.value) })}
                className="band-slider"
              />
            </label>
          </div>

          <div className="display-window__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => updateSetting({ mode: "luminance", lowPercentile: 1, highPercentile: 99, gamma: 1 })}
            >
              Auto luminance
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => updateSetting({ mode: "channel", lowPercentile: 1, highPercentile: 99, gamma: 1 })}
            >
              Auto channels
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => updateSetting({ mode: "clip", lowPercentile: 1, highPercentile: 99, gamma: 1 })}
            >
              Reset
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function HSIViewer({
  measurementName,
  bands,
  rgb,
  displaySettings,
  displayStats,
  idxs,
  onChange,
  onDisplaySettingsChange,
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
  onUpdateSelectionStyle,
  onRemoveSelection,
  roiShape = null,
  roiEnabled = false,
  onSetRoi,
  onClearRoi,
  onToggleRoi,
  onSaveRoi,
  onSaveAnnotations,
  canSaveRoi = false,
  canSaveAnnotations = false,
}) {
  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 900,
  );
  const [drawMode, setDrawMode] = useState("rectangle");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [selectedViewId, setSelectedViewId] = useState("frgb");
  const [statusIndex, setStatusIndex] = useState(0);
  const [interactionMode, setInteractionMode] = useState("annotate");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [toolMode, setToolMode] = useState("draw");
  const [activeControlPanel, setActiveControlPanel] = useState("frgb");
  const [displayWindowOpen, setDisplayWindowOpen] = useState(false);
  const { containerRef: panContainerRef, isDragging: isPanning, handleMouseDown: handlePanMouseDown } = useDragPan(toolMode === "pan");

  useEffect(() => {
    setDrawMode("rectangle");
    setBrightness(100);
    setContrast(100);
    setSelectedViewId("frgb");
    setInteractionMode("annotate");
    setZoomPercent(100);
    setToolMode("draw");
    setActiveControlPanel("frgb");
    setDisplayWindowOpen(false);
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
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
      lineStyle: selection.lineStyle,
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

  const handleZoomChange = (value) => {
    setZoomPercent(clampZoomPercent(value));
  };

  const stageMaxHeight = Math.max(220, viewportHeight - 430);

  return (
    <div className="viewer-workbench viewer-workbench--merged">
      <section className="window-panel viewer-window">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">{selectedView?.label || "Measurement viewer"}</h3>
            <div className="window-panel__meta">{selectedView?.description || measurementName}</div>
          </div>
          <div className="window-panel__header-actions">
            {selections.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onSaveAnnotations}
                disabled={!canSaveAnnotations}
              >
                Save labels
              </button>
            )}
            {selections.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={onClearSelections}>
                Clear measurement annotations
              </button>
            )}
          </div>
        </header>

        <div className="viewer-window__body">
          <div
            className={`viewer-panel__stage${toolMode === "pan" ? " is-pan-mode" : ""}${isPanning ? " is-pan-dragging" : ""}`}
            ref={(node) => {
              stageContainerRef.current = node;
              panContainerRef.current = node;
            }}
            onMouseDownCapture={handlePanMouseDown}
          >
            <ViewerCanvas
              imageUrl={selectedView?.imageUrl || null}
              regions={regions}
              onRegion={handleCanvasRegion}
              maxWidth={stageWidth}
              maxHeight={Math.min(760, stageMaxHeight)}
              brightness={brightness}
              contrast={contrast}
              drawMode={interactionMode === "roi" ? "polygon" : drawMode}
              zoomPercent={zoomPercent}
              onZoomChange={handleZoomChange}
              interactionEnabled={toolMode !== "pan" && !isPanning}
            />
          </div>

          <div className="viewer-panel__controls viewer-panel__controls--merged">
            <div className="viewer-control-shell">
              <div className="viewer-control-tabs" aria-label="Viewer controls">
                {[
                  { id: "frgb", label: "FRGB controls" },
                  { id: "roi", label: "ROI preprocessing" },
                  { id: "annotate", label: "Annotation tools" },
                  { id: "views", label: "Unsupervised views" },
                ].map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className={`viewer-control-tab${activeControlPanel === panel.id ? " is-active" : ""}`}
                    onClick={() => setActiveControlPanel(panel.id)}
                    title={panel.label}
                    aria-label={panel.label}
                  >
                    <ViewerControlIcon id={panel.id} />
                  </button>
                ))}
              </div>

              <div className="display-sliders display-sliders--compact viewer-control-panel">
                {activeControlPanel === "frgb" && (
                  <>
                    <div className="display-sliders__header">
                      <span className="annotation-tools__label">False RGB controls</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn--compact"
                        onClick={() => setDisplayWindowOpen(true)}
                      >
                        Adjust
                      </button>
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
                    <div className="annotation-tools__hint">Scroll to zoom. Hold Shift while scrolling for smaller zoom steps.</div>
                  </>
                )}

                {activeControlPanel === "roi" && (
                  <>
                    <div className="display-sliders__header">
                      <span className="annotation-tools__label">ROI preprocessing</span>
                    </div>
                    <div className="muted-text">
                      {roiShape
                        ? roiEnabled
                          ? "ROI is enabled for the current false-RGB and unsupervised views."
                          : "ROI is saved in memory but currently disabled."
                        : "Draw a lasso ROI to mask the background and rescale only the region of interest."}
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
                          ? "ROI is stored next to the measurement header."
                          : "ROI saving is only available for measurements loaded from a folder path."}
                    </div>
                  </>
                )}

                {activeControlPanel === "annotate" && (
                  <>
                    <div className="display-sliders__header">
                      <span className="annotation-tools__label">Annotation tools</span>
                    </div>
                    <div className="annotation-tools__options">
                      <button
                        type="button"
                        className={`annotation-tools__button${toolMode === "pan" ? " is-active" : ""}`}
                        onClick={() => setToolMode((prev) => (prev === "pan" ? "draw" : "pan"))}
                      >
                        {toolMode === "pan" ? "Panning" : "Pan"}
                      </button>
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
                          onClick={() => {
                            setToolMode("draw");
                            setDrawMode(option.id);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="annotation-tools__hint">
                      Use Pan for drag navigation, or hold Shift while dragging for a temporary pan. Saved labels reload automatically for the same measurement.
                    </div>
                  </>
                )}

                {activeControlPanel === "views" && (
                  <>
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
                  </>
                )}
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
            onUpdateSelectionStyle={onUpdateSelectionStyle}
            onRemoveSelection={onRemoveSelection}
          />
      </section>
      {displayWindowOpen && (
        <DisplayScalingWindow
          settings={displaySettings}
          stats={displayStats}
          onChange={onDisplaySettingsChange}
          onClose={() => setDisplayWindowOpen(false)}
        />
      )}
    </div>
  );
}
