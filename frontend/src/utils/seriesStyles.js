const SERIES_COLOR_PALETTE = [
  "#d13438",
  "#c17c00",
  "#107c10",
  "#005a9e",
  "#5c2d91",
  "#8e562e",
  "#c239b3",
  "#0f6cbd",
];

export const SERIES_LINE_STYLES = [
  { id: "solid", label: "Solid", plotlyDash: "solid", canvasDash: [] },
  { id: "dash", label: "Dashed", plotlyDash: "dash", canvasDash: [10, 6] },
  { id: "dot", label: "Dotted", plotlyDash: "dot", canvasDash: [2, 6] },
  { id: "dashdot", label: "Dash-dot", plotlyDash: "dashdot", canvasDash: [10, 4, 2, 4] },
];

const FALLBACK_LINE_STYLE = SERIES_LINE_STYLES[0];
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeSeriesColor(value, fallback = SERIES_COLOR_PALETTE[0]) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function normalizeLineStyleId(value) {
  return SERIES_LINE_STYLES.some((style) => style.id === value) ? value : FALLBACK_LINE_STYLE.id;
}

export function getLineStyleDefinition(lineStyleId) {
  return SERIES_LINE_STYLES.find((style) => style.id === lineStyleId) || FALLBACK_LINE_STYLE;
}

export function getSeriesStyleByIndex(index) {
  const safeIndex = Math.max(0, Number(index) || 0);
  const color = SERIES_COLOR_PALETTE[safeIndex % SERIES_COLOR_PALETTE.length];
  const lineStyle = SERIES_LINE_STYLES[Math.floor(safeIndex / SERIES_COLOR_PALETTE.length) % SERIES_LINE_STYLES.length];
  return {
    color,
    lineStyle: lineStyle.id,
  };
}
