import React, { useRef, useState } from "react";

function normalizeFiles(fileList) {
  return Array.from(fileList || []).map((file) => ({
    file,
    relPath: file.webkitRelativePath || file.name,
  }));
}

async function extractFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const traverseEntry = (entry, parentPath = "") => {
    return new Promise((resolve) => {
      if (!entry) {
        resolve([]);
        return;
      }

      if (entry.isFile) {
        entry.file((file) => {
          const fullPath = (entry.fullPath || `${parentPath}${file.name}`).replace(
            /^\/+/, ""
          );
          resolve([{ file, relPath: fullPath || file.name }]);
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = [];
        const readEntries = () => {
          reader.readEntries((batch) => {
            if (!batch.length) {
              Promise.all(
                entries.map((child) =>
                  traverseEntry(child, `${parentPath}${entry.name}/`)
                )
              ).then((nested) => resolve(nested.flat()));
            } else {
              entries.push(...batch);
              readEntries();
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  };

  const items = Array.from(dataTransfer.items || []);
  const itemPromises = items
    .filter((item) => item.kind === "file")
    .map((item) => {
      if (typeof item.webkitGetAsEntry === "function") {
        return traverseEntry(item.webkitGetAsEntry());
      }
      const file = item.getAsFile();
      return Promise.resolve(file ? [{ file, relPath: file.name }] : []);
    });

  if (itemPromises.length > 0) {
    const nested = await Promise.all(itemPromises);
    return nested.flat();
  }

  const files = normalizeFiles(dataTransfer.files || []);
  return files;
}

export default function DropZone({ onLoaded }) {
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);

  async function handleLoad(customFiles, customPath) {
    const incomingFiles = Array.isArray(customFiles) ? customFiles : files;
    const trimmedPath = typeof customPath === "string" ? customPath.trim() : path.trim();
    if (!trimmedPath && incomingFiles.length === 0) {
      alert("Please provide a folder path or drop a dataset.");
      return;
    }
    setLoading(true);
    const body = new FormData();
    if (incomingFiles.length > 0) {
      incomingFiles.forEach(({ file, relPath }) => {
        body.append("files", file, relPath || file.name);
      });
    } else {
      body.append("folder_path", trimmedPath);
    }

    try {
      const res = await fetch("http://127.0.0.1:8000/load", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        onLoaded(data);
        setFiles([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (error) {
      alert("Failed to upload dataset. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const handleFiles = (event) => {
    const selected = normalizeFiles(event.target.files || []);
    setFiles(selected);
    if (selected.length > 0) {
      setPath("");
    }
  };

  const handleBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragActive(false);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setIsDragActive(false);
    const dropped = await extractFilesFromDataTransfer(event.dataTransfer);
    if (dropped.length > 0) {
      setFiles(dropped);
      setPath("");
      handleLoad(dropped, "");
    }
  };

  return (
    <section className="card dropzone">
      <header className="dropzone__header">
        <h2 className="card__title">Load your hyperspectral dataset</h2>
        <p className="card__subtitle">
          Paste the path to an ENVI header file or upload a complete cube from your
          device. We&apos;ll handle the preprocessing automatically.
        </p>
      </header>
      <div
        className={`dropzone__canvas${isDragActive ? " is-active" : ""}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleBrowse();
          }
        }}
      >
        <div className="dropzone__canvas-art" aria-hidden="true">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <defs>
              <linearGradient id="dropzone-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#9ec5ff" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#3f7bff" stopOpacity="0.8" />
              </linearGradient>
            </defs>
            <rect x="10" y="20" width="100" height="80" rx="18" fill="url(#dropzone-gradient)" opacity="0.6" />
            <rect
              x="24"
              y="32"
              width="72"
              height="56"
              rx="14"
              fill="#f7fbff"
              stroke="#94b7ff"
              strokeDasharray="6 8"
              strokeWidth="2"
            />
            <path d="M36 64h48" stroke="#3f7bff" strokeWidth="4" strokeLinecap="round" />
            <path d="M60 40v48" stroke="#3f7bff" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
        <div className="dropzone__canvas-body">
          <p className="dropzone__canvas-title">Drop your folder or HDR file here</p>
          <p className="dropzone__canvas-subtitle">
            Drag an entire cube into the stage to auto-load it, or browse for files manually.
          </p>
          <div className="dropzone__canvas-actions">
            <button type="button" className="btn btn-ghost" onClick={handleBrowse}>
              Browse dataset
            </button>
            {files.length > 0 && (
              <span className="dropzone__file-count">
                {files.length} file{files.length === 1 ? "" : "s"} selected
              </span>
            )}
          </div>
        </div>
        <input
          type="file"
          multiple
          directory="true"
          webkitdirectory="true"
          ref={fileInputRef}
          onChange={handleFiles}
          className="sr-only"
          tabIndex={-1}
        />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="dataset-path">
          Or load by dataset folder path
        </label>
        <input
          id="dataset-path"
          type="text"
          className="field-input"
          placeholder="/path/to/dataset"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div className="dropzone__actions">
        <button className="btn btn-primary" onClick={() => handleLoad()} disabled={loading}>
          {loading ? "Loading…" : "Load dataset"}
        </button>
      </div>
    </section>
  );
}
