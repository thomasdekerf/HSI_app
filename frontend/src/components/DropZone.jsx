import React, { useState } from "react";

export default function DropZone({ onLoaded }) {
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLoad() {
    setLoading(true);
    const body = new FormData();
    body.append("folder_path", path);
    const res = await fetch("http://127.0.0.1:8000/load", {
      method: "POST",
      body,
    });
    const data = await res.json();
    setLoading(false);
    if (data.error) alert(data.error);
    else onLoaded(data);
  }

  return (
    <div style={{ border: "2px dashed gray", padding: 20, borderRadius: 10 }}>
      <label>Enter folder or .hdr path:</label>
      <input
        type="text"
        style={{ width: "100%", marginTop: 5 }}
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button onClick={handleLoad} disabled={loading} style={{ marginTop: 10 }}>
        {loading ? "Loading..." : "Load HSI"}
      </button>
    </div>
  );
}
