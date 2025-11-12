import { useState, useEffect } from "react";
import DropZone from "./components/DropZone";
import HSIViewer from "./components/HSIViewer";
import { getRGB } from "./api";

export default function App() {
  const [bands, setBands] = useState([]);
  const [rgb, setRgb] = useState(null);
  const [idxs, setIdxs] = useState([10, 20, 30]);

  const handleLoaded = (data) => {
    setBands(data.bands);
  };

  // when idxs or bands change, re-fetch image
  useEffect(() => {
    if (bands.length > 0) {
      getRGB(idxs).then(setRgb);
    }
  }, [idxs, bands]);

  return (
    <div style={{ padding: 20 }}>
      <h2>HSI Viewer</h2>
      <DropZone onLoaded={handleLoaded} />
      {bands.length > 0 && (
        <HSIViewer bands={bands} rgb={rgb} idxs={idxs} onChange={setIdxs} />
      )}
    </div>
  );
}
