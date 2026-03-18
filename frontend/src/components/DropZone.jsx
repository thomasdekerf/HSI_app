import { useMemo, useState } from "react";
import { listMeasurements } from "../api";

function createMeasurementId() {
  return `measurement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStem(filename = "") {
  return filename.replace(/\.[^.]+$/, "");
}

function isValidMeasurementHdrName(filename = "") {
  const trimmed = String(filename || "").trim();
  if (!trimmed || trimmed.startsWith(".")) return false;
  if (!trimmed.toLowerCase().endsWith(".hdr")) return false;
  return getStem(trimmed).trim().length > 0;
}

export default function DropZone({
  measurements = [],
  activeMeasurement,
  onSelectMeasurement,
  onActivateMeasurement,
  onQueueMeasurements,
  onRemoveMeasurement,
}) {
  const [path, setPath] = useState("");
  const [ignoreDarkRef, setIgnoreDarkRef] = useState(false);
  const [ignoreWhiteRef, setIgnoreWhiteRef] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);

  const measurementCountLabel = useMemo(() => {
    if (measurements.length === 1) return "1 measurement queued";
    return `${measurements.length} measurements queued`;
  }, [measurements.length]);

  const buildOptions = () => ({
    ignoreDarkRef,
    ignoreWhiteRef,
    cropTop: null,
    cropBottom: null,
    cropLeft: null,
    cropRight: null,
    maxBands: null,
  });

  const queuePathMeasurement = async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      alert("Provide a dataset folder path first.");
      return;
    }
    setPathLoading(true);
    try {
      const discovered = await listMeasurements(trimmedPath);
      if (discovered.length === 0) {
        alert("No measurement .hdr files found in that folder.");
        return;
      }
      const queuedMeasurements = discovered
        .map((measurement) => ({
          id: createMeasurementId(),
          name: getStem(measurement.name),
          source: {
            type: "path",
            path: measurement.folder_path,
            dataHdrName: measurement.data_hdr_name,
          },
        }))
        .filter(
          (measurement) =>
            isValidMeasurementHdrName(measurement.source?.dataHdrName) && measurement.name.trim(),
        );
      if (queuedMeasurements.length === 0) {
        alert("No valid measurement .hdr files found in that folder.");
        return;
      }
      onQueueMeasurements(queuedMeasurements, buildOptions());
      setPath("");
    } catch (error) {
      alert(error.message || "Failed to scan measurement folder.");
    } finally {
      setPathLoading(false);
    }
  };

  return (
    <aside className="measurement-sidebar card">
      <header className="measurement-sidebar__header">
        <div>
          <h2 className="card__title">Measurement Explorer</h2>
          <p className="card__subtitle">
            Queue a dataset folder path, then double-click a measurement to load it.
          </p>
        </div>
        <div className="measurement-sidebar__count">{measurementCountLabel}</div>
      </header>

      <div className="measurement-sidebar__body">
        <div className="field-group">
          <label className="field-label" htmlFor="dataset-path">
            Dataset folder path
          </label>
          <input
            id="dataset-path"
            type="text"
            className="field-input"
            placeholder="/path/to/measurement"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">Calibration options</label>
          <div className="measurement-sidebar__toggles">
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={ignoreDarkRef}
                onChange={(event) => setIgnoreDarkRef(event.target.checked)}
              />
              Ignore dark reference
            </label>
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={ignoreWhiteRef}
                onChange={(event) => setIgnoreWhiteRef(event.target.checked)}
              />
              Ignore white reference
            </label>
          </div>
        </div>

        <div className="measurement-sidebar__actions">
          <button type="button" className="btn btn-ghost" onClick={queuePathMeasurement}>
            {pathLoading ? "Scanning..." : "Queue path"}
          </button>
        </div>

        <div className="measurement-listbox">
          <div className="measurement-listbox__header">
            <span>Measurements</span>
            <span className="muted-text">Double-click to load</span>
          </div>
          <div
            className="measurement-listbox__body"
            role="listbox"
            aria-label="Measurements"
            tabIndex={0}
            onKeyDown={(event) => {
              if (!activeMeasurement) return;
              if (event.key !== "Delete" && event.key !== "Backspace") return;
              event.preventDefault();
              onRemoveMeasurement(activeMeasurement.id);
            }}
          >
            {measurements.length === 0 && (
              <div className="measurement-listbox__empty">No measurements queued yet.</div>
            )}
            {measurements.map((measurement) => {
              const isActive = measurement.id === activeMeasurement?.id;
              const status = measurement.isLoading
                ? "Loading..."
                : measurement.isLoaded
                  ? "Loaded"
                  : measurement.error
                    ? "Load failed"
                    : "Queued";

              return (
                <button
                  key={measurement.id}
                  type="button"
                  className={`measurement-listbox__item${isActive ? " is-active" : ""}`}
                  onClick={() => onSelectMeasurement(measurement.id)}
                  onDoubleClick={() => onActivateMeasurement(measurement.id)}
                >
                  <span className="measurement-listbox__name">{measurement.name}</span>
                  <span className="measurement-listbox__meta">
                    {measurement.shape
                      ? `${measurement.shape[0]}x${measurement.shape[1]}x${measurement.shape[2]}`
                      : status}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
