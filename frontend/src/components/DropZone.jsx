import { useEffect, useMemo, useRef, useState } from "react";
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

function getParentKey(file) {
  const relativePath = file.webkitRelativePath || "";
  if (relativePath.includes("/")) {
    return relativePath.split("/").slice(0, -1).join("/");
  }
  if (typeof file.path === "string" && file.path.includes("/")) {
    return file.path.split("/").slice(0, -1).join("/");
  }
  return "__root__";
}

function groupMeasurementsFromFiles(files) {
  const folderGroups = new Map();

  files.forEach((file) => {
    const key = getParentKey(file);
    const group = folderGroups.get(key) || [];
    group.push(file);
    folderGroups.set(key, group);
  });

  const measurements = [];

  folderGroups.forEach((groupFiles) => {
    const hdrFiles = groupFiles.filter((file) => {
      const lower = file.name.toLowerCase();
      return (
        isValidMeasurementHdrName(file.name) &&
        !lower.includes("darkref") &&
        !lower.includes("whiteref")
      );
    });

    if (hdrFiles.length === 0) {
      return;
    }

    hdrFiles.forEach((hdrFile) => {
      if (typeof hdrFile.path === "string" && hdrFile.path) {
        const folderPath = hdrFile.path.split("/").slice(0, -1).join("/");
        measurements.push({
          id: createMeasurementId(),
          name: getStem(hdrFile.name),
          source: {
            type: "path",
            path: folderPath,
            dataHdrName: hdrFile.name,
          },
        });
        return;
      }

      measurements.push({
        id: createMeasurementId(),
        name: getStem(hdrFile.name),
        source: {
          type: "files",
          files: groupFiles,
          dataHdrName: hdrFile.name,
        },
      });
    });
  });

  return measurements;
}

function formatCropOptions(options) {
  return {
    cropTop: options?.cropTop ? String(options.cropTop) : "",
    cropBottom: options?.cropBottom ? String(options.cropBottom) : "",
    cropLeft: options?.cropLeft ? String(options.cropLeft) : "",
    cropRight: options?.cropRight ? String(options.cropRight) : "",
    maxBands: options?.maxBands ? String(options.maxBands) : "",
  };
}

export default function DropZone({
  measurements = [],
  activeMeasurement,
  onSelectMeasurement,
  onActivateMeasurement,
  onQueueMeasurements,
  onUpdateMeasurementOptions,
  onRemoveMeasurement,
}) {
  const [path, setPath] = useState("");
  const [ignoreDarkRef, setIgnoreDarkRef] = useState(false);
  const [ignoreWhiteRef, setIgnoreWhiteRef] = useState(false);
  const [cropTop, setCropTop] = useState("");
  const [cropBottom, setCropBottom] = useState("");
  const [cropLeft, setCropLeft] = useState("");
  const [cropRight, setCropRight] = useState("");
  const [maxBands, setMaxBands] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const next = formatCropOptions(activeMeasurement?.options);
    setCropTop(next.cropTop);
    setCropBottom(next.cropBottom);
    setCropLeft(next.cropLeft);
    setCropRight(next.cropRight);
    setMaxBands(next.maxBands);
  }, [activeMeasurement?.id, activeMeasurement?.options]);

  const measurementCountLabel = useMemo(() => {
    if (measurements.length === 1) return "1 measurement queued";
    return `${measurements.length} measurements queued`;
  }, [measurements.length]);

  const buildOptions = () => ({
    ignoreDarkRef,
    ignoreWhiteRef,
    cropTop: cropTop.trim() ? Number(cropTop) : null,
    cropBottom: cropBottom.trim() ? Number(cropBottom) : null,
    cropLeft: cropLeft.trim() ? Number(cropLeft) : null,
    cropRight: cropRight.trim() ? Number(cropRight) : null,
    maxBands: maxBands.trim() ? Number(maxBands) : null,
  });

  const pushOptionUpdate = (nextValues) => {
    if (!activeMeasurement) return;
    onUpdateMeasurementOptions(activeMeasurement.id, {
      cropTop: nextValues.cropTop.trim() ? Number(nextValues.cropTop) : null,
      cropBottom: nextValues.cropBottom.trim() ? Number(nextValues.cropBottom) : null,
      cropLeft: nextValues.cropLeft.trim() ? Number(nextValues.cropLeft) : null,
      cropRight: nextValues.cropRight.trim() ? Number(nextValues.cropRight) : null,
      maxBands: nextValues.maxBands.trim() ? Number(nextValues.maxBands) : null,
    });
  };

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
      const queuedMeasurements = discovered.map((measurement) => ({
          id: createMeasurementId(),
          name: getStem(measurement.name),
          source: {
            type: "path",
            path: measurement.folder_path,
            dataHdrName: measurement.data_hdr_name,
          },
        })).filter((measurement) => isValidMeasurementHdrName(measurement.source?.dataHdrName) && measurement.name.trim());
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

  const queueFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const measurements = groupMeasurementsFromFiles(files);
    if (measurements.length === 0) {
      alert("No measurement .hdr files found in the selected files or folders.");
      return;
    }
    onQueueMeasurements(measurements, buildOptions());
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
          Each `.hdr` measurement in the dropped content is queued separately.
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

      <div className="field-group">
        <label className="field-label">Crop edges</label>
        <div className="crop-grid">
          <label className="field-group">
            <span className="muted-text">Top</span>
            <input
              type="number"
              min={0}
              value={cropTop}
              onChange={(event) => {
                const next = event.target.value;
                setCropTop(next);
                pushOptionUpdate({
                  cropTop: next,
                  cropBottom,
                  cropLeft,
                  cropRight,
                  maxBands,
                });
              }}
              className="field-input field-input--compact"
              placeholder="0"
            />
          </label>
          <label className="field-group">
            <span className="muted-text">Bottom</span>
            <input
              type="number"
              min={0}
              value={cropBottom}
              onChange={(event) => {
                const next = event.target.value;
                setCropBottom(next);
                pushOptionUpdate({
                  cropTop,
                  cropBottom: next,
                  cropLeft,
                  cropRight,
                  maxBands,
                });
              }}
              className="field-input field-input--compact"
              placeholder="0"
            />
          </label>
          <label className="field-group">
            <span className="muted-text">Left</span>
            <input
              type="number"
              min={0}
              value={cropLeft}
              onChange={(event) => {
                const next = event.target.value;
                setCropLeft(next);
                pushOptionUpdate({
                  cropTop,
                  cropBottom,
                  cropLeft: next,
                  cropRight,
                  maxBands,
                });
              }}
              className="field-input field-input--compact"
              placeholder="0"
            />
          </label>
          <label className="field-group">
            <span className="muted-text">Right</span>
            <input
              type="number"
              min={0}
              value={cropRight}
              onChange={(event) => {
                const next = event.target.value;
                setCropRight(next);
                pushOptionUpdate({
                  cropTop,
                  cropBottom,
                  cropLeft,
                  cropRight: next,
                  maxBands,
                });
              }}
              className="field-input field-input--compact"
              placeholder="0"
            />
          </label>
          <label className="field-group">
            <span className="muted-text">Max bands</span>
            <input
              type="number"
              min={1}
              value={maxBands}
              onChange={(event) => {
                const next = event.target.value;
                setMaxBands(next);
                pushOptionUpdate({
                  cropTop,
                  cropBottom,
                  cropLeft,
                  cropRight,
                  maxBands: next,
                });
              }}
              className="field-input field-input--compact"
              placeholder="Full"
            />
          </label>
        </div>
        <div className="muted-text">
          Spatial crop updates reload the active measurement and refresh the live image.
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
    </aside>
  );
}
