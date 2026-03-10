import { useEffect, useMemo, useState } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
import AnalysisPanel from "./components/AnalysisPanel";
import SupervisedPanel from "./components/SupervisedPanel";
import { getRGB, getSpectra, loadDataset } from "./api";
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

export default function App() {
  const [measurements, setMeasurements] = useState([]);
  const [activeMeasurementId, setActiveMeasurementId] = useState(null);
  const [backendMeasurementId, setBackendMeasurementId] = useState(null);
  const [activeTab, setActiveTab] = useState("viewer");
  const [warning, setWarning] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeMeasurement = useMemo(
    () => measurements.find((measurement) => measurement.id === activeMeasurementId) || null,
    [measurements, activeMeasurementId],
  );

  const allSelections = useMemo(
    () =>
      measurements.flatMap((measurement) =>
        (measurement.selections || []).map((selection) => ({
          ...selection,
          label:
            selection.label ||
            `${measurement.name || "Measurement"} Region ${(measurement.selections || []).findIndex((entry) => entry.id === selection.id) + 1}`,
        })),
      ),
    [measurements],
  );

  const queueMeasurements = (entries, options) => {
    const prepared = entries.map((entry) => ({
      ...entry,
      options: {
        ignoreDarkRef: Boolean(options?.ignoreDarkRef),
        ignoreWhiteRef: Boolean(options?.ignoreWhiteRef),
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
    }));

    setMeasurements((prev) => [...prev, ...prepared]);
    if (!activeMeasurementId && prepared[0]) {
      setActiveMeasurementId(prepared[0].id);
    }
  };

  const handleActivateMeasurement = async (measurementId) => {
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
        })),
      );
      setBackendMeasurementId(measurementId);
      setWarning(data.warning || "");
      setActiveTab("viewer");
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
  };

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
      setMeasurements((prev) =>
        updateMeasurementById(prev, activeMeasurement.id, (measurement) => {
          const selectionCount = (measurement.selections || []).length;
          const selection = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            shape: shapeData.shape,
            bounds: shapeData.bounds,
            color: [
              "#d13438",
              "#c17c00",
              "#107c10",
              "#005a9e",
              "#5c2d91",
              "#8e562e",
              "#c239b3",
              "#0f6cbd",
            ][selectionCount % 8],
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

  const activeBands = activeMeasurement?.bands ?? EMPTY_LIST;
  const activeIdxs = activeMeasurement?.idxs ?? EMPTY_LIST;

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
    getRGB(idxs)
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
  }, [activeBands, activeIdxs, activeMeasurementId, backendMeasurementId]);

  const tabs = [
    { id: "viewer", label: "Visualization" },
    { id: "analysis", label: "Unsupervised Analysis" },
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
            activeMeasurementId={activeMeasurementId}
            onSelectMeasurement={setActiveMeasurementId}
            onActivateMeasurement={handleActivateMeasurement}
            onQueueMeasurements={queueMeasurements}
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
                {activeTab === "analysis" ? (
                  <AnalysisPanel
                    bands={activeMeasurement.bands}
                    cubeShape={activeMeasurement.shape}
                  />
                ) : activeTab === "supervised" ? (
                  <SupervisedPanel
                    bands={activeMeasurement.bands}
                    rgb={activeMeasurement.rgb}
                    idxs={activeMeasurement.idxs}
                    onChange={handleIdxChange}
                    cubeShape={activeMeasurement.shape}
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
                    onRegion={handleRegion}
                    onClearSelections={handleClearSelections}
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
