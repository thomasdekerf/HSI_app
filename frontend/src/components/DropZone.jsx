import { useState } from "react";

export default function DropZone({ onLoaded }) {
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLoad(customPath) {
    const trimmedPath = typeof customPath === "string" ? customPath.trim() : path.trim();
    if (!trimmedPath) {
      alert("Please provide a dataset folder path.");
      return;
    }

    setLoading(true);
    const body = new FormData();
    body.append("folder_path", trimmedPath);

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
      }
    } catch (error) {
      alert("Failed to load dataset. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card dropzone">
      <header className="dropzone__header">
        <h2 className="card__title">Load your hyperspectral dataset</h2>
        <p className="card__subtitle">
          Provide the path to an ENVI dataset folder and we&apos;ll take care of the rest.
        </p>
      </header>
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
