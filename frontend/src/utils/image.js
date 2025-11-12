export function hexToBase64(hex) {
  if (!hex || typeof hex !== "string") {
    return "";
  }
  const sanitized = hex.replace(/\s+/g, "");
  if (sanitized.length === 0) {
    return "";
  }
  const pairs = sanitized.match(/.{1,2}/g);
  if (!pairs) {
    return "";
  }
  const bytes = new Uint8Array(pairs.map((pair) => parseInt(pair, 16)));
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary);
}
