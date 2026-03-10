import { useMemo, useRef, useState } from "react";

function createMeasurementId() {
  return `measurement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function groupFilesIntoMeasurements(files) {
  const groups = new Map();

  files.forEach((file) => {
    const relativePath = file.webkitRelativePath || file.name;
    const topLevel = relativePath.includes("/") ? relativePath.split("/")[0] : null;
    const key = topLevel || "__dropped_files__";
    const existing = groups.get(key) || {
      id: createMeasurementId(),
      name: topLevel || `Dropped files ${groups.size + 1}`,
      source: { type: "files", files: [] },
    };
    existing.source.files.push(file);
    groups.set(key, existing);
  });

  return Array.from(groups.values());
}

export default function DropZone({
  measurements = [],
  activeMeasurementId,
  onSelectMeasurement,
  onActivateMeasurement,
  onQueueMeasurements,
}) {
  const [path, setPath] = useState("");
  const [ignoreDarkRef, setIgnoreDarkRef] = useState(false);
  const [ignoreWhiteRef, setIgnoreWhiteRef] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const measurementCountLabel = useMemo(() => {
    if (measurements.length === 1) return "1 measurement queued";
    return `${measurements.length} measurements queued`;
  }, [measurements.length]);

  const queuePathMeasurement = () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      alert("Provide a dataset folder path first.");
      return;
    }

    const name =
      trimmedPath.split("/").filter(Boolean).at(-1) || `Measurement ${measurements.length + 1}`;

    onQueueMeasurements([
      {
        id: createMeasurementId(),
        name,
        source: { type: "path", path: trimmedPath },
      },
    ], {
      ignoreDarkRef,
      ignoreWhiteRef,
    });
    setPath("");
  };

  const queueFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      return;
    }
    onQueueMeasurements(groupFilesIntoMeasurements(files), {
      ignoreDarkRef,
      ignoreWhiteRef,
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    queueFiles(event.dataTransfer.files);
  };

  return (
    <aside className="measurement-sidebar card">
      <header className="measurement-sidebar__header">
        <div>
          <h2 className="card__title">Measurement Explorer</h2>
          <p className="card__subtitle">
            Queue datasets first, then double-click a measurement to load it into the app.
          </p>
        </div>
        <div className="measurement-sidebar__count">{measurementCountLabel}</div>
      </header>

      <div
        className={`measurement-dropzone${isDragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className="measurement-dropzone__title">Drop dataset folders or files here</div>
        <div className="measurement-dropzone__subtitle">
          You can queue multiple measurements without loading them immediately.
        </div>
        <div className="measurement-dropzone__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            Add folder(s)
          </button>
          <span className="muted-text">or drag from Finder/Explorer</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => queueFiles(event.target.files)}
          webkitdirectory="true"
          directory=""
        />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="dataset-path">
          Queue by dataset folder path
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
          Queue path
        </button>
      </div>

      <div className="measurement-listbox">
        <div className="measurement-listbox__header">
          <span>Measurements</span>
          <span className="muted-text">Double-click to load</span>
        </div>
        <div className="measurement-listbox__body" role="listbox" aria-label="Measurements">
          {measurements.length === 0 && (
            <div className="measurement-listbox__empty">
              No measurements queued yet.
            </div>
          )}
          {measurements.map((measurement) => {
            const isActive = measurement.id === activeMeasurementId;
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
                  {measurement.shape ? `${measurement.shape[0]}x${measurement.shape[1]}x${measurement.shape[2]}` : status}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
