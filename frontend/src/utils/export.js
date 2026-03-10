export function toNumericBands(bands, fallbackLength = 0) {
  if (Array.isArray(bands) && bands.length > 0) {
    return bands.map((band, idx) => {
      const num = Number(band);
      return Number.isFinite(num) ? num : idx;
    });
  }
  if (fallbackLength > 0) {
    return Array.from({ length: fallbackLength }, (_, idx) => idx);
  }
  return [];
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportSpectraCsv(filename, bands, series) {
  const numericBands = Array.isArray(bands) ? bands : [];
  const rows = Array.isArray(series) ? series : [];
  if (numericBands.length === 0 || rows.length === 0) return;

  const hasStdMap = rows.map(
    (entry) =>
      Array.isArray(entry.stddev) &&
      entry.stddev.length === entry.spectra?.length &&
      entry.stddev.length === numericBands.length,
  );

  const headers = ["wavelength_nm"];
  rows.forEach((entry, idx) => {
    const label = entry.label || `Series ${idx + 1}`;
    headers.push(`${label} reflectance`);
    if (hasStdMap[idx]) {
      headers.push(`${label} stddev`);
    }
  });

  const body = [];
  const rowCount = numericBands.length;
  for (let i = 0; i < rowCount; i += 1) {
    const row = [escapeCsv(numericBands[i])];
    rows.forEach((entry, idx) => {
      row.push(escapeCsv(entry.spectra?.[i]));
      if (hasStdMap[idx]) {
        row.push(escapeCsv(entry.stddev?.[i]));
      }
    });
    body.push(row.join(","));
  }

  const csvContent = [headers.map(escapeCsv).join(","), ...body].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

export function importSpectraCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  const bands = rows.map((row) => Number(row[0]));

  const seriesMap = new Map();
  headers.slice(1).forEach((header, columnIndex) => {
    const reflectanceMatch = header.match(/^(.*)\s+reflectance$/i);
    const stdMatch = header.match(/^(.*)\s+stddev$/i);
    if (!reflectanceMatch && !stdMatch) return;
    const label = (reflectanceMatch?.[1] || stdMatch?.[1] || `Series ${columnIndex + 1}`).trim();
    const entry = seriesMap.get(label) || {
      id: `imported-${Date.now()}-${columnIndex}-${Math.random().toString(16).slice(2)}`,
      label,
      bands,
      spectra: [],
      stddev: [],
      color: null,
      source: "imported",
    };
    const values = rows.map((row) => {
      const value = Number(row[columnIndex + 1]);
      return Number.isFinite(value) ? value : 0;
    });
    if (reflectanceMatch) {
      entry.spectra = values;
    } else {
      entry.stddev = values;
    }
    seriesMap.set(label, entry);
  });

  return Array.from(seriesMap.values()).filter((entry) => Array.isArray(entry.spectra) && entry.spectra.length > 0);
}
