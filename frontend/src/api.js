const API = "http://127.0.0.1:8000";

export async function getRGB(idxs) {
  const [r, g, b] = idxs;
  const res = await fetch(`${API}/rgb?r=${r}&g=${g}&b=${b}`);
  const data = await res.json();
  return data.image;
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
