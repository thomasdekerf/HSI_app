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
