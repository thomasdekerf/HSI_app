import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
import SupervisedPanel from "./components/SupervisedPanel";
import { getRGB, getSpectra, loadDataset, runAnalysis, saveAnnotations, saveRoi } from "./api";
import { getSeriesStyleByIndex, normalizeLineStyleId, normalizeSeriesColor } from "./utils/seriesStyles";
import "./App.css";

const EMPTY_LIST = [];

function normalizeBands(bands) {
  if (!Array.isArray(bands)) return [];
  return bands.map((band, idx) => {
    const num = Number(band);
    return Number.isFinite(num) ? num : idx;
  });
}

function chooseInitialIndices(bands) {
  if (!bands.length) return [0, 0, 0];
  if (bands.length < 3) {
    return Array.from({ length: 3 }, (_, i) => Math.min(i, bands.length - 1));
  }

  const lastIndex = bands.length - 1;
  const pickByPercentile = (fraction) => {
    const rawIndex = Math.round(lastIndex * fraction);
    return Math.max(0, Math.min(lastIndex, rawIndex));
  };

  return [pickByPercentile(0.25), pickByPercentile(0.5), pickByPercentile(0.75)];
}

function updateMeasurementById(measurements, measurementId, updater) {
  return measurements.map((measurement) =>
    measurement.id === measurementId ? updater(measurement) : measurement,
  );
}

function measurementOptionSignature(options) {
  return JSON.stringify({
    cropTop: options?.cropTop ?? null,
    cropBottom: options?.cropBottom ?? null,
    cropLeft: options?.cropLeft ?? null,
    cropRight: options?.cropRight ?? null,
    maxBands: options?.maxBands ?? null,
  });
}

function isQueueableMeasurement(entry) {
  const hdrName = String(entry?.source?.dataHdrName || "").trim();
  const displayName = String(entry?.name || "").trim();
  return Boolean(displayName && hdrName && hdrName.toLowerCase().endsWith(".hdr") && !hdrName.startsWith("."));
}

export default function App() {
  const [measurements, setMeasurements] = useState([]);
  const [importedSelections, setImportedSelections] = useState([]);
  const [activeMeasurementId, setActiveMeasurementId] = useState(null);
  const [backendMeasurementId, setBackendMeasurementId] = useState(null);
  const [activeTab, setActiveTab] = useState("viewer");
  const [warning, setWarning] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [suiteLoading, setSuiteLoading] = useState(false);
  const [suiteError, setSuiteError] = useState("");
  const nextSeriesStyleIndexRef = useRef(0);

  const claimSeriesStyleIndex = useCallback((count = 1) => {
    const start = nextSeriesStyleIndexRef.current;
    nextSeriesStyleIndexRef.current += Math.max(1, count);
    return start;
  }, []);

  const activeMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === activeMeasurementId) || null,
    [measurements, activeMeasurementId],
  );

  const allSelections = useMemo(
    () =>
      [
        ...measurements.flatMap((measurement) =>
          (measurement.selections || []).map((selection) => ({
            ...selection,
            label:
              selection.label ||
              `${measurement.name || "Measurement"} Region ${(measurement.selections || []).findIndex((entry) => entry.id === selection.id) + 1}`,
          })),
        ),
        ...importedSelections,
      ],
    [measurements, importedSelections],
  );

  const currentMeasurementSelections = useMemo(
    () =>
      (activeMeasurement?.selections || []).map((selection) => ({
          ...selection,
          label:
            selection.label ||
            `${activeMeasurement?.name || "Measurement"} Region ${(activeMeasurement?.selections || []).findIndex((entry) => entry.id === selection.id) + 1}`,
        })),
    [activeMeasurement],
  );

  const queueMeasurements = (entries, options) => {
    const prepared = entries.filter(isQueueableMeasurement).map((entry) => ({
      ...entry,
      options: {
        ignoreDarkRef: Boolean(options?.ignoreDarkRef),
        ignoreWhiteRef: Boolean(options?.ignoreWhiteRef),
        cropTop: options?.cropTop ?? null,
        cropBottom: options?.cropBottom ?? null,
        cropLeft: options?.cropLeft ?? null,
        cropRight: options?.cropRight ?? null,
        maxBands: options?.maxBands ?? null,
      },
      isLoaded: false,
      isLoading: false,
      error: "",
      warning: "",
      bands: [],
      idxs: [0, 0, 0],
      rgb: null,
      shape: null,
      selections: [],
      loadedOptionSignature: "",
      analysisVisuals: [],
      roiShape: null,
      roiEnabled: false,
    }));

    setMeasurements((prev) => [...prev, ...prepared]);
    if (!activeMeasurementId && prepared[0]) {
      setActiveMeasurementId(prepared[0].id);
    }
  };

  const handleActivateMeasurement = useCallback(async (measurementId) => {
    const measurement = measurements.find((entry) => entry.id === measurementId);
    if (!measurement || measurement.isLoading) {
      return;
    }

    setActiveMeasurementId(measurementId);
    setWarning("");
    setMeasurements((prev) =>
      updateMeasurementById(prev, measurementId, (entry) => ({
        ...entry,
        isLoading: true,
        error: "",
      })),
    );

    try {
      const data = await loadDataset(measurement.source, measurement.options);
      const parsedBands = normalizeBands(data.bands || []);
      const nextIndices = chooseInitialIndices(parsedBands);

      setMeasurements((prev) =>
        updateMeasurementById(prev, measurementId, (entry) => ({
          ...entry,
          bands: parsedBands,
          idxs: nextIndices,
          shape: Array.isArray(data.shape) ? data.shape : null,
          warning: data.warning || "",
          rgb: null,
          isLoaded: true,
          isLoading: false,
          error: "",
          name: data.data_file || entry.name,
          loadedOptionSignature: measurementOptionSignature(entry.options),
          analysisVisuals: [],
          roiShape: data.roi_shape || null,
          roiEnabled: Boolean(data.roi_shape),
          selections: Array.isArray(data.annotations) && data.annotations.length > 0
            ? data.annotations.map((selection) => ({
                ...selection,
                bands: parsedBands,
              }))
            : entry.selections,
        })),
      );
      setBackendMeasurementId(measurementId);
      setWarning(data.warning || "");
      setActiveTab("viewer");
      setSuiteError("");
    } catch (error) {
      setMeasurements((prev) =>
        updateMeasurementById(prev, measurementId, (entry) => ({
          ...entry,
          isLoading: false,
          error: error.message || "Failed to load dataset.",
        })),
      );
      setWarning("");
    }
  }, [measurements]);

  const handleIdxChange = (nextIdxs) => {
    if (!activeMeasurementId) return;
    setMeasurements((prev) =>
      updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
        ...measurement,
        idxs: nextIdxs,
      })),
    );
  };

  const handleRegion = async (shapeData) => {
    if (!activeMeasurement || activeMeasurement.id !== backendMeasurementId) {
      alert("Double-click the measurement you want to annotate first.");
      return;
    }

    try {
      const data = await getSpectra(shapeData);
      const styleIndex = claimSeriesStyleIndex();
      setMeasurements((prev) =>
        updateMeasurementById(prev, activeMeasurement.id, (measurement) => {
          const selectionCount = (measurement.selections || []).length;
          const selection = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            shape: shapeData.shape,
            bounds: shapeData.bounds,
            ...getSeriesStyleByIndex(styleIndex),
            spectra: data.spectra,
            stddev: data.stddev || null,
            bands: measurement.bands,
            label: `${measurement.name} Region ${selectionCount + 1}`,
          };
          return {
            ...measurement,
            selections: [...(measurement.selections || []), selection],
          };
        }),
      );
    } catch (error) {
      alert(error.message || "Failed to fetch spectra for the selected region.");
    }
  };

  const handleClearSelections = () => {
    if (!activeMeasurementId) return;
    setMeasurements((prev) =>
      updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
        ...measurement,
        selections: [],
      })),
    );
  };

  const handleImportSelections = (entries) => {
    const styleStart = claimSeriesStyleIndex(entries.length);
    setImportedSelections((prev) => [
      ...prev,
      ...entries.map((entry, index) => {
        const fallbackStyle = getSeriesStyleByIndex(styleStart + index);
        return {
          ...entry,
          color: normalizeSeriesColor(entry.color, fallbackStyle.color),
          lineStyle: normalizeLineStyleId(entry.lineStyle || fallbackStyle.lineStyle),
        };
      }),
    ]);
  };

  const handleRenameSelection = (selectionId, label) => {
    setMeasurements((prev) =>
      prev.map((measurement) => ({
        ...measurement,
        selections: (measurement.selections || []).map((selection) =>
          selection.id === selectionId ? { ...selection, label } : selection,
        ),
      })),
    );
    setImportedSelections((prev) =>
      prev.map((selection) => (selection.id === selectionId ? { ...selection, label } : selection)),
    );
  };

  const handleRemoveSelection = (selectionId) => {
    if (!selectionId) return;
    setMeasurements((prev) =>
      prev.map((measurement) => ({
        ...measurement,
        selections: (measurement.selections || []).filter((selection) => selection.id !== selectionId),
      })),
    );
    setImportedSelections((prev) => prev.filter((selection) => selection.id !== selectionId));
  };

  const handleUpdateSelectionStyle = (selectionId, updates) => {
    if (!selectionId || !updates) return;
    const normalizedUpdates = {};
    if (Object.prototype.hasOwnProperty.call(updates, "color")) {
      normalizedUpdates.color = normalizeSeriesColor(updates.color);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "lineStyle")) {
      normalizedUpdates.lineStyle = normalizeLineStyleId(updates.lineStyle);
    }
    if (Object.keys(normalizedUpdates).length === 0) {
      return;
    }

    setMeasurements((prev) =>
      prev.map((measurement) => ({
        ...measurement,
        selections: (measurement.selections || []).map((selection) =>
          selection.id === selectionId ? { ...selection, ...normalizedUpdates } : selection,
        ),
      })),
    );
    setImportedSelections((prev) =>
      prev.map((selection) => (selection.id === selectionId ? { ...selection, ...normalizedUpdates } : selection)),
    );
  };

  const handleRunSuite = async () => {
    if (!activeMeasurement || activeMeasurement.id !== backendMeasurementId || suiteLoading) {
      return;
    }
    setSuiteLoading(true);
    setSuiteError("");
    try {
      const result = await runAnalysis("unsupervised_suite", {
        roi_shape: activeMeasurement.roiEnabled ? activeMeasurement.roiShape || null : null,
      });
      setMeasurements((prev) =>
        updateMeasurementById(prev, activeMeasurement.id, (measurement) => ({
          ...measurement,
          analysisVisuals: Array.isArray(result.visuals) ? result.visuals : [],
        })),
      );
    } catch (error) {
      setSuiteError(error.message || "Failed to compute unsupervised representations.");
    } finally {
      setSuiteLoading(false);
    }
  };

  const handleUpdateMeasurementOptions = (measurementId, nextOptions) => {
    setMeasurements((prev) =>
      updateMeasurementById(prev, measurementId, (measurement) => ({
        ...measurement,
        options: {
          ...measurement.options,
          ...nextOptions,
        },
        selections: [],
        analysisVisuals: [],
        roiShape: null,
        roiEnabled: false,
      })),
    );
  };

  const handleSetRoi = (shape) => {
    if (!activeMeasurementId) return;
    setMeasurements((prev) =>
      updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
        ...measurement,
        roiShape: shape,
        roiEnabled: true,
        analysisVisuals: [],
      })),
    );
    setSuiteError("");
  };

  const handleClearRoi = () => {
    if (!activeMeasurementId) return;
    setMeasurements((prev) =>
      updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
        ...measurement,
        roiShape: null,
        roiEnabled: false,
        analysisVisuals: [],
      })),
    );
    setSuiteError("");
  };

  const handleToggleRoi = () => {
    if (!activeMeasurementId) return;
    setMeasurements((prev) =>
      updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
        ...measurement,
        roiEnabled: measurement.roiShape ? !measurement.roiEnabled : false,
        analysisVisuals: [],
      })),
    );
    setSuiteError("");
  };

  const handleSaveRoi = async () => {
    if (!activeMeasurement?.roiShape) return;
    const source = activeMeasurement.source;
    if (source?.type !== "path" || !source.path || !source.dataHdrName) {
      alert("ROI saving is only available for measurements loaded directly from a folder path.");
      return;
    }
    try {
      await saveRoi({
        folderPath: source.path,
        dataHdrName: source.dataHdrName,
        shape: activeMeasurement.roiShape,
      });
      alert("ROI saved next to the measurement header.");
    } catch (error) {
      alert(error.message || "Failed to save ROI.");
      return;
    }
  };

  const handleSaveAnnotations = async () => {
    if (!activeMeasurement) return;
    const source = activeMeasurement.source;
    if (source?.type !== "path" || !source.path || !source.dataHdrName) {
      alert("Annotation saving is only available for measurements loaded directly from a folder path.");
      return;
    }
    try {
      await saveAnnotations({
        folderPath: source.path,
        dataHdrName: source.dataHdrName,
        annotations: (activeMeasurement.selections || []).map((selection) => ({
          id: selection.id,
          label: selection.label,
          color: selection.color,
          lineStyle: selection.lineStyle,
          shape: selection.shape || null,
          bounds: selection.bounds || null,
        })),
      });
      alert("Annotations saved next to the measurement header.");
    } catch (error) {
      alert(error.message || "Failed to save annotations.");
    }
  };

  const handleRemoveMeasurement = (measurementId) => {
    setMeasurements((prev) => {
      const remaining = prev.filter((measurement) => measurement.id !== measurementId);
      if (activeMeasurementId === measurementId) {
        setActiveMeasurementId(remaining[0]?.id || null);
      }
      if (backendMeasurementId === measurementId) {
        setBackendMeasurementId(null);
        setWarning("");
      }
      return remaining;
    });
  };

  const activeBands = activeMeasurement?.bands ?? EMPTY_LIST;
  const activeIdxs = activeMeasurement?.idxs ?? EMPTY_LIST;
  const activeOptionSignature = measurementOptionSignature(activeMeasurement?.options);

  useEffect(() => {
    if (
      !activeMeasurementId ||
      activeMeasurementId !== backendMeasurementId ||
      activeBands.length === 0
    ) {
      return;
    }

    const idxs = activeIdxs;
    const hasValidIndices = idxs.length === 3 && idxs.every((idx) => idx >= 0 && idx < activeBands.length);
    if (!hasValidIndices) {
      return;
    }

    let cancelled = false;
    getRGB(idxs, {
      roiShape: activeMeasurement?.roiEnabled ? activeMeasurement?.roiShape || null : null,
    })
      .then((image) => {
        if (cancelled) return;
        setMeasurements((prev) =>
          updateMeasurementById(prev, activeMeasurementId, (measurement) => ({
            ...measurement,
            rgb: image,
          })),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setWarning(error.message || "Failed to refresh RGB view.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeBands, activeIdxs, activeMeasurement?.roiEnabled, activeMeasurement?.roiShape, activeMeasurementId, backendMeasurementId]);

  useEffect(() => {
    if (
      !activeMeasurement ||
      !activeMeasurement.isLoaded ||
      activeMeasurement.id !== backendMeasurementId ||
      activeMeasurement.loadedOptionSignature === activeOptionSignature
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      handleActivateMeasurement(activeMeasurement.id);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeMeasurement, activeOptionSignature, backendMeasurementId, handleActivateMeasurement]);

  const tabs = [
    { id: "viewer", label: "Visualization + Unsupervised" },
    { id: "supervised", label: "Supervised Classification" },
  ];

  const activeMeasurementReady =
    activeMeasurement &&
    activeMeasurement.isLoaded &&
    activeMeasurement.id === backendMeasurementId &&
    activeMeasurement.bands.length > 0;

  return (
    <div className="app-root">
      <header className="app-frame__header">
        <div>
          <div className="app-frame__eyebrow">HSI Workstation</div>
          <h1 className="app-frame__title">InViLab Hyperspectral Analysis</h1>
        </div>
        <div className="app-frame__header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
          >
            {sidebarCollapsed ? "Show measurements" : "Hide measurements"}
          </button>
          <div className="app-frame__status">
            {activeMeasurementReady ? `Loaded: ${activeMeasurement.name}` : "No measurement loaded"}
          </div>
        </div>
      </header>

      <main className={`app-workspace${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
        {!sidebarCollapsed && (
          <DropZone
            measurements={measurements}
            activeMeasurement={activeMeasurement}
            onSelectMeasurement={setActiveMeasurementId}
            onActivateMeasurement={handleActivateMeasurement}
            onQueueMeasurements={queueMeasurements}
            onUpdateMeasurementOptions={handleUpdateMeasurementOptions}
            onRemoveMeasurement={handleRemoveMeasurement}
          />
        )}

        <section className="app-main">
          {warning && <div className="warning-banner">{warning}</div>}
          {activeMeasurement?.error && <div className="warning-banner warning-banner--error">{activeMeasurement.error}</div>}

          {!activeMeasurementReady ? (
            <section className="empty-state card">
              <h2 className="card__title">Load a measurement from the explorer</h2>
              <p className="card__subtitle">
                Queue folders or dropped datasets on the left, then double-click a measurement to
                make it active. The spectra window retains annotations from previously loaded
                measurements.
              </p>
            </section>
          ) : (
            <section className="interactive-area">
              <nav className="tab-bar" aria-label="Primary views">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="panel-surface">
                {activeTab === "supervised" ? (
                  <SupervisedPanel
                    bands={activeMeasurement.bands}
                    rgb={activeMeasurement.rgb}
                    idxs={activeMeasurement.idxs}
                    onChange={handleIdxChange}
                    cubeShape={activeMeasurement.shape}
                    derivedVisuals={activeMeasurement.analysisVisuals || []}
                    roiShape={activeMeasurement.roiShape || null}
                    onRunSuite={handleRunSuite}
                    suiteLoading={suiteLoading}
                    suiteError={suiteError}
                  />
                ) : (
                  <HSIViewer
                    measurementName={activeMeasurement.name}
                    bands={activeMeasurement.bands}
                    rgb={activeMeasurement.rgb}
                    idxs={activeMeasurement.idxs}
                    onChange={handleIdxChange}
                    selections={activeMeasurement.selections}
                    allSelections={allSelections}
                    currentSelections={currentMeasurementSelections}
                    onRegion={handleRegion}
                    onClearSelections={handleClearSelections}
                    derivedVisuals={activeMeasurement.analysisVisuals || []}
                    onRunSuite={handleRunSuite}
                    suiteLoading={suiteLoading}
                    suiteError={suiteError}
                    onImportSelections={handleImportSelections}
                    onRenameSelection={handleRenameSelection}
                    onUpdateSelectionStyle={handleUpdateSelectionStyle}
                    onRemoveSelection={handleRemoveSelection}
                    roiShape={activeMeasurement.roiShape || null}
                    roiEnabled={Boolean(activeMeasurement.roiEnabled && activeMeasurement.roiShape)}
                    onSetRoi={handleSetRoi}
                    onClearRoi={handleClearRoi}
                    onToggleRoi={handleToggleRoi}
                    onSaveRoi={handleSaveRoi}
                    onSaveAnnotations={handleSaveAnnotations}
                    canSaveRoi={activeMeasurement.source?.type === "path"}
                    canSaveAnnotations={activeMeasurement.source?.type === "path"}
                  />
                )}
              </div>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}
