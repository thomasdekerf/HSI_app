const API = "http://127.0.0.1:8000";

export async function listMeasurements(folderPath) {
  const params = new URLSearchParams({ folder_path: folderPath });
  const res = await fetch(`${API}/measurements?${params.toString()}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data.measurements || [];
}

export async function loadDataset(source, options = {}) {
  const body = new FormData();

  if (source?.type === "files" && Array.isArray(source.files)) {
    source.files.forEach((file) => {
      body.append("files", file, file.webkitRelativePath || file.name);
    });
  } else if (source?.type === "path" && source.path) {
    body.append("folder_path", source.path);
  } else {
    throw new Error("No dataset source provided.");
  }

  if (source?.dataHdrName) {
    body.append("data_hdr_name", source.dataHdrName);
  }

  body.append("ignore_dark_ref", Boolean(options.ignoreDarkRef));
  body.append("ignore_white_ref", Boolean(options.ignoreWhiteRef));
  if (options.cropTop) {
    body.append("crop_top", String(options.cropTop));
  }
  if (options.cropBottom) {
    body.append("crop_bottom", String(options.cropBottom));
  }
  if (options.cropLeft) {
    body.append("crop_left", String(options.cropLeft));
  }
  if (options.cropRight) {
    body.append("crop_right", String(options.cropRight));
  }
  if (options.maxBands) {
    body.append("max_bands", String(options.maxBands));
  }

  const res = await fetch(`${API}/load`, {
    method: "POST",
    body,
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function getRGB(idxs, options = {}) {
  const res = await fetch(`${API}/rgb`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      indices: idxs,
      roi_shape: options?.roiShape ?? null,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data.image;
}

export async function getSpectra(shapeData) {
  const res = await fetch(`${API}/spectra`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rect: shapeData?.bounds, shape: shapeData?.shape }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function runAnalysis(method, params = {}) {
  const payload = { method, ...params };
  const res = await fetch(`${API}/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function saveRoi(payload) {
  const res = await fetch(`${API}/roi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder_path: payload?.folderPath || null,
      data_hdr_name: payload?.dataHdrName || null,
      shape: payload?.shape || null,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

export async function runSupervisedClassification(payload) {
  const body = {
    method: payload?.method || "sam",
    annotations: payload?.annotations || [],
  };
  const res = await fetch(`${API}/supervised`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
