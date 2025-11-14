export function hexToRgba(hex, alpha = 1) {
  if (typeof hex !== "string") {
    return `rgba(0,0,0,${alpha})`;
  }
  let value = hex.trim();
  if (value.startsWith("#")) {
    value = value.slice(1);
  }
  if (value.length === 3) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (!/[0-9a-fA-F]{6}/.test(value)) {
    return `rgba(0,0,0,${alpha})`;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
