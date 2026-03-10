const API = "http://127.0.0.1:8000";

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

  body.append("ignore_dark_ref", Boolean(options.ignoreDarkRef));
  body.append("ignore_white_ref", Boolean(options.ignoreWhiteRef));

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

export async function getRGB(idxs) {
  const [r, g, b] = idxs;
  const res = await fetch(`${API}/rgb?r=${r}&g=${g}&b=${b}`);
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
