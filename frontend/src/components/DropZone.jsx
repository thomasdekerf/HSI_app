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
    <div style={{ border: "2px dashed gray", padding: 20, borderRadius: 10 }}>
      <label>Enter folder or .hdr path:</label>
      <input
        type="text"
        style={{ width: "100%", marginTop: 5 }}
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <div style={{ marginTop: 15 }}>
        <label>Or upload HSI dataset (select a folder or multiple files):</label>
        <input
          type="file"
          multiple
          directory="true"
          webkitdirectory="true"
          onChange={handleFiles}
          ref={fileInputRef}
          style={{ display: "block", marginTop: 6 }}
        />
        {files.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {files.length} file{files.length === 1 ? "" : "s"} selected
          </div>
        )}
      </div>
      <button onClick={handleLoad} disabled={loading} style={{ marginTop: 10 }}>
        {loading ? "Loading..." : "Load HSI"}
      </button>
    </div>
  );
}
