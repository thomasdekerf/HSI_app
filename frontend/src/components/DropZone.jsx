import React, { useRef, useState } from "react";

export default function DropZone({ onLoaded }) {
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);

  async function handleLoad() {
    const trimmedPath = path.trim();
    if (!trimmedPath && files.length === 0) {
      alert("Please provide a folder path or upload a dataset.");
      return;
    }
    setLoading(true);
    const body = new FormData();
    if (files.length > 0) {
      files.forEach((file) => {
        const relPath = file.webkitRelativePath || file.name;
        body.append("files", file, relPath);
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
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    if (selected.length > 0) {
      setPath("");
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
      <div className="field-group">
        <label className="field-label" htmlFor="dataset-path">
          Dataset folder or .hdr path
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
      <div className="divider" role="presentation" />
      <div className="field-group">
        <label className="field-label" htmlFor="dataset-upload">
          Or upload a dataset folder
        </label>
        <input
          id="dataset-upload"
          className="field-input field-input--file"
          type="file"
          multiple
          directory="true"
          webkitdirectory="true"
          onChange={handleFiles}
          ref={fileInputRef}
        />
        {files.length > 0 && (
          <div className="field-hint">
            {files.length} file{files.length === 1 ? "" : "s"} selected
          </div>
        )}
      </div>
      <div className="dropzone__actions">
        <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
          {loading ? "Loading…" : "Load dataset"}
        </button>
      </div>
    </section>
  );
}
