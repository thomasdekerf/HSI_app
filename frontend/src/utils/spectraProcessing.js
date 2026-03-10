function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reflectIndex(index, length) {
  if (length <= 1) return 0;
  let next = index;
  while (next < 0 || next >= length) {
    if (next < 0) {
      next = -next;
    } else {
      next = 2 * length - next - 2;
    }
  }
  return next;
}

function transpose(matrix) {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]));
}

function multiplyMatrices(a, b) {
  return a.map((row) =>
    b[0].map((_, col) => row.reduce((sum, value, idx) => sum + value * b[idx][col], 0)),
  );
}

function invertMatrix(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map((value) => Number(value)),
    ...Array.from({ length: size }, (_, colIndex) => (rowIndex === colIndex ? 1 : 0)),
  ]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let pivotRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[pivotRow][pivot])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][pivot]) < 1e-12) {
      throw new Error("Matrix is singular");
    }
    if (pivotRow !== pivot) {
      [augmented[pivot], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivot]];
    }
    const pivotValue = augmented[pivot][pivot];
    for (let col = 0; col < 2 * size; col += 1) {
      augmented[pivot][col] /= pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = 0; col < 2 * size; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function computeSavitzkyGolayCoefficients(windowSize, polyOrder, derivative = 0) {
  const halfWindow = Math.floor(windowSize / 2);
  const vandermonde = Array.from({ length: windowSize }, (_, rowIndex) => {
    const x = rowIndex - halfWindow;
    return Array.from({ length: polyOrder + 1 }, (_, power) => x ** power);
  });
  const transposed = transpose(vandermonde);
  const normal = multiplyMatrices(transposed, vandermonde);
  const inverse = invertMatrix(normal);
  const pseudoInverse = multiplyMatrices(inverse, transposed);
  return pseudoInverse[derivative];
}

function applyConvolution(values, coefficients) {
  const halfWindow = Math.floor(coefficients.length / 2);
  return values.map((_, index) =>
    coefficients.reduce((sum, coefficient, coeffIndex) => {
      const sampleIndex = reflectIndex(index + coeffIndex - halfWindow, values.length);
      return sum + coefficient * values[sampleIndex];
    }, 0),
  );
}

function applySnv(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const std = Math.sqrt(variance) || 1;
  return values.map((value) => (value - mean) / std);
}

function applyMaxNormalization(values) {
  const maxValue = Math.max(...values.map((value) => Math.abs(value)), 1e-8);
  return values.map((value) => value / maxValue);
}

export function processSpectrum(values, options = {}) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const mode = options.mode || "raw";
  const numeric = values.map((value) => Number(value) || 0);

  if (mode === "raw") {
    return numeric;
  }

  if (mode === "snv") {
    return applySnv(numeric);
  }

  if (mode === "max_normalized") {
    return applyMaxNormalization(numeric);
  }

  if (mode === "sg_smooth" || mode === "sg_first_derivative") {
    const requestedWindow = clamp(Number(options.windowSize) || 7, 3, numeric.length);
    const windowSize =
      requestedWindow % 2 === 0 ? Math.max(3, requestedWindow - 1) : requestedWindow;
    const maxPoly = Math.max(1, windowSize - 1);
    const polyOrder = clamp(Number(options.polyOrder) || 2, 1, maxPoly);
    const derivative = mode === "sg_first_derivative" ? 1 : 0;
    const coefficients = computeSavitzkyGolayCoefficients(windowSize, polyOrder, derivative);
    return applyConvolution(numeric, coefficients);
  }

  return numeric;
}

export const SPECTRA_PROCESSING_OPTIONS = [
  { id: "raw", label: "Raw" },
  { id: "sg_smooth", label: "Savitzky-Golay" },
  { id: "sg_first_derivative", label: "SG 1st derivative" },
  { id: "snv", label: "SNV" },
  { id: "max_normalized", label: "Max normalized" },
];
