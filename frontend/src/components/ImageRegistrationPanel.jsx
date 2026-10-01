import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hexToBase64 } from "../utils/image";
import { useDragPan } from "../utils/useDragPan";
import { saveRegistration } from "../api";

const METHOD_OPTIONS = [
  { id: "translation", label: "Translation", minPairs: 1 },
  { id: "similarity", label: "Similarity", minPairs: 2 },
  { id: "affine", label: "Affine", minPairs: 3 },
  { id: "projective", label: "Projective", minPairs: 4 },
  { id: "tps", label: "Thin-plate spline", minPairs: 4 },
];

const OVERLAY_OPTIONS = [
  { id: "blend", label: "Blend" },
  { id: "red-cyan", label: "Red / Cyan" },
  { id: "difference", label: "Difference" },
];

function createEmptyPair() {
  return {
    id: `pair-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    fixed: null,
    moving: null,
  };
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read registration file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

function isPoint(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y))
  );
}

function normalizeLoadedPairs(pointPairs) {
  if (!Array.isArray(pointPairs)) return [];
  return pointPairs
    .filter((pair) => isPoint(pair?.reference) && isPoint(pair?.moving))
    .map((pair) => ({
      id: `pair-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      fixed: {
        x: Number(pair.reference.x),
        y: Number(pair.reference.y),
      },
      moving: {
        x: Number(pair.moving.x),
        y: Number(pair.moving.y),
      },
    }));
}

function squareDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function tpsKernel(distanceSquared) {
  if (distanceSquared <= 1e-12) return 0;
  return distanceSquared * Math.log(distanceSquared + 1e-12);
}

function buildThinPlateSplineModel(sourcePoints, targetPoints) {
  if (sourcePoints.length !== targetPoints.length || sourcePoints.length < 3) {
    throw new Error("Thin-plate spline registration needs at least 3 matched points.");
  }

  const n = sourcePoints.length;
  const size = n + 3;
  const baseMatrix = Array.from({ length: size }, () => Array(size).fill(0));

  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      baseMatrix[row][col] = tpsKernel(squareDistance(sourcePoints[row], sourcePoints[col]));
    }
    baseMatrix[row][n] = 1;
    baseMatrix[row][n + 1] = sourcePoints[row].x;
    baseMatrix[row][n + 2] = sourcePoints[row].y;
  }

  for (let col = 0; col < n; col += 1) {
    baseMatrix[n][col] = 1;
    baseMatrix[n + 1][col] = sourcePoints[col].x;
    baseMatrix[n + 2][col] = sourcePoints[col].y;
  }

  const vectorX = [...targetPoints.map((point) => point.x), 0, 0, 0];
  const vectorY = [...targetPoints.map((point) => point.y), 0, 0, 0];
  const solutionX = solveLinearSystem(baseMatrix, vectorX);
  const solutionY = solveLinearSystem(baseMatrix, vectorY);

  return {
    sourcePoints: sourcePoints.map((point) => ({ x: point.x, y: point.y })),
    weightsX: solutionX.slice(0, n),
    weightsY: solutionY.slice(0, n),
    affineX: solutionX.slice(n),
    affineY: solutionY.slice(n),
  };
}

function evaluateThinPlateSpline(model, point) {
  const radial = model.sourcePoints.reduce(
    (sum, sourcePoint, index) => {
      const basis = tpsKernel(squareDistance(point, sourcePoint));
      sum.x += model.weightsX[index] * basis;
      sum.y += model.weightsY[index] * basis;
      return sum;
    },
    { x: model.affineX[0] + model.affineX[1] * point.x + model.affineX[2] * point.y,
      y: model.affineY[0] + model.affineY[1] * point.x + model.affineY[2] * point.y },
  );
  return radial;
}

function loadImageFromUrl(source) {
  return new Promise((resolve, reject) => {
    if (!source?.url) {
      reject(new Error("Choose a loaded image first."));
      return;
    }
    const image = new Image();
    image.onload = () =>
      resolve({
        id: source.id,
        name: source.name,
        url: source.url,
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    image.onerror = () => reject(new Error("Could not decode the selected image."));
    image.src = source.url;
  });
}

function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][col]) < 1e-10) {
      throw new Error("The selected points do not define a stable transform.");
    }

    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const pivotValue = augmented[col][col];
    for (let k = col; k <= n; k += 1) {
      augmented[col][k] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let k = col; k <= n; k += 1) {
        augmented[row][k] -= factor * augmented[col][k];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function leastSquares(rows, values) {
  const cols = rows[0]?.length || 0;
  const normal = Array.from({ length: cols }, () => Array(cols).fill(0));
  const rhs = Array(cols).fill(0);

  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < cols; i += 1) {
      rhs[i] += row[i] * values[rowIndex];
      for (let j = 0; j < cols; j += 1) {
        normal[i][j] += row[i] * row[j];
      }
    }
  });

  return solveLinearSystem(normal, rhs);
}

function invert3x3(m) {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = m;
  const det =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(det) < 1e-10) {
    throw new Error("The calculated transform cannot be inverted.");
  }

  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function transformPoint(matrix, point) {
  const denominator = matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2];
  return {
    x: (matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2]) / denominator,
    y: (matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2]) / denominator,
  };
}

function calculateRegistration(method, pairs) {
  const completePairs = pairs.filter((pair) => pair.fixed && pair.moving);
  const required = METHOD_OPTIONS.find((option) => option.id === method)?.minPairs || 1;
  if (completePairs.length < required) {
    throw new Error(`${method} registration needs at least ${required} complete point pair${required === 1 ? "" : "s"}.`);
  }

  if (method === "translation") {
    const offset = completePairs.reduce(
      (sum, pair) => ({
        x: sum.x + pair.fixed.x - pair.moving.x,
        y: sum.y + pair.fixed.y - pair.moving.y,
      }),
      { x: 0, y: 0 },
    );
    const dx = offset.x / completePairs.length;
    const dy = offset.y / completePairs.length;
    return {
      type: "matrix",
      matrix: [
        [1, 0, dx],
        [0, 1, dy],
        [0, 0, 1],
      ],
    };
  }

  if (method === "similarity") {
    const fixedCentroid = completePairs.reduce(
      (sum, pair) => ({ x: sum.x + pair.fixed.x, y: sum.y + pair.fixed.y }),
      { x: 0, y: 0 },
    );
    const movingCentroid = completePairs.reduce(
      (sum, pair) => ({ x: sum.x + pair.moving.x, y: sum.y + pair.moving.y }),
      { x: 0, y: 0 },
    );
    fixedCentroid.x /= completePairs.length;
    fixedCentroid.y /= completePairs.length;
    movingCentroid.x /= completePairs.length;
    movingCentroid.y /= completePairs.length;

    let a = 0;
    let b = 0;
    let denom = 0;
    completePairs.forEach((pair) => {
      const mx = pair.moving.x - movingCentroid.x;
      const my = pair.moving.y - movingCentroid.y;
      const fx = pair.fixed.x - fixedCentroid.x;
      const fy = pair.fixed.y - fixedCentroid.y;
      a += mx * fx + my * fy;
      b += mx * fy - my * fx;
      denom += mx * mx + my * my;
    });
    if (denom < 1e-10) {
      throw new Error("Similarity registration needs separated moving-image points.");
    }
    a /= denom;
    b /= denom;
    const tx = fixedCentroid.x - a * movingCentroid.x + b * movingCentroid.y;
    const ty = fixedCentroid.y - b * movingCentroid.x - a * movingCentroid.y;
    return {
      type: "matrix",
      matrix: [
        [a, -b, tx],
        [b, a, ty],
        [0, 0, 1],
      ],
    };
  }

  if (method === "affine") {
    const rows = [];
    const values = [];
    completePairs.forEach((pair) => {
      rows.push([pair.moving.x, pair.moving.y, 1, 0, 0, 0]);
      values.push(pair.fixed.x);
      rows.push([0, 0, 0, pair.moving.x, pair.moving.y, 1]);
      values.push(pair.fixed.y);
    });
    const [a, b, c, d, e, f] = leastSquares(rows, values);
    return {
      type: "matrix",
      matrix: [
        [a, b, c],
        [d, e, f],
        [0, 0, 1],
      ],
    };
  }

  if (method === "tps") {
    const movingPoints = completePairs.map((pair) => pair.moving);
    const fixedPoints = completePairs.map((pair) => pair.fixed);
    return {
      type: "tps",
      forward: buildThinPlateSplineModel(movingPoints, fixedPoints),
      inverse: buildThinPlateSplineModel(fixedPoints, movingPoints),
    };
  }

  const rows = [];
  const values = [];
  completePairs.forEach((pair) => {
    const x = pair.moving.x;
    const y = pair.moving.y;
    const u = pair.fixed.x;
    const v = pair.fixed.y;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  });
  const [h11, h12, h13, h21, h22, h23, h31, h32] = leastSquares(rows, values);
  return {
    type: "matrix",
    matrix: [
      [h11, h12, h13],
      [h21, h22, h23],
      [h31, h32, 1],
    ],
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
}

function samplePixel(data, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    return null;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const wx = x - x0;
  const wy = y - y0;
  const result = [0, 0, 0, 0];
  const add = (px, py, weight) => {
    const index = (py * width + px) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      result[channel] += data[index + channel] * weight;
    }
  };

  add(x0, y0, (1 - wx) * (1 - wy));
  add(x1, y0, wx * (1 - wy));
  add(x0, y1, (1 - wx) * wy);
  add(x1, y1, wx * wy);
  return result;
}

function renderRegistrationOverlay({ fixed, moving, registration, opacity, mode }) {
  const fixedCanvas = document.createElement("canvas");
  fixedCanvas.width = fixed.width;
  fixedCanvas.height = fixed.height;
  const fixedCtx = fixedCanvas.getContext("2d", { willReadFrequently: true });
  fixedCtx.drawImage(fixed.image, 0, 0);
  const fixedData = fixedCtx.getImageData(0, 0, fixed.width, fixed.height);

  const movingCanvas = document.createElement("canvas");
  movingCanvas.width = moving.width;
  movingCanvas.height = moving.height;
  const movingCtx = movingCanvas.getContext("2d", { willReadFrequently: true });
  movingCtx.drawImage(moving.image, 0, 0);
  const movingData = movingCtx.getImageData(0, 0, moving.width, moving.height);

  const inverseMatrix = registration.type === "matrix" ? invert3x3(registration.matrix) : null;
  const output = fixedCtx.createImageData(fixed.width, fixed.height);
  const alpha = Math.max(0, Math.min(1, opacity));

  for (let y = 0; y < fixed.height; y += 1) {
    for (let x = 0; x < fixed.width; x += 1) {
      const outputIndex = (y * fixed.width + x) * 4;
      const fixedIndex = outputIndex;
      const sourcePoint =
        registration.type === "tps"
          ? evaluateThinPlateSpline(registration.inverse, { x, y })
          : transformPoint(inverseMatrix, { x, y });
      const movingPixel = samplePixel(movingData.data, moving.width, moving.height, sourcePoint.x, sourcePoint.y);

      const fr = fixedData.data[fixedIndex];
      const fg = fixedData.data[fixedIndex + 1];
      const fb = fixedData.data[fixedIndex + 2];

      if (!movingPixel) {
        output.data[outputIndex] = fr;
        output.data[outputIndex + 1] = fg;
        output.data[outputIndex + 2] = fb;
        output.data[outputIndex + 3] = 255;
        continue;
      }

      const [mr, mg, mb] = movingPixel;
      if (mode === "red-cyan") {
        const fixedLum = 0.299 * fr + 0.587 * fg + 0.114 * fb;
        const movingLum = 0.299 * mr + 0.587 * mg + 0.114 * mb;
        output.data[outputIndex] = fixedLum;
        output.data[outputIndex + 1] = movingLum;
        output.data[outputIndex + 2] = movingLum;
      } else if (mode === "difference") {
        output.data[outputIndex] = Math.abs(fr - mr);
        output.data[outputIndex + 1] = Math.abs(fg - mg);
        output.data[outputIndex + 2] = Math.abs(fb - mb);
      } else {
        output.data[outputIndex] = fr * (1 - alpha) + mr * alpha;
        output.data[outputIndex + 1] = fg * (1 - alpha) + mg * alpha;
        output.data[outputIndex + 2] = fb * (1 - alpha) + mb * alpha;
      }
      output.data[outputIndex + 3] = 255;
    }
  }

  fixedCtx.putImageData(output, 0, 0);
  return fixedCanvas.toDataURL("image/png");
}

function RegistrationImagePane({
  title,
  image,
  side,
  pairs,
  activeSide,
  pendingPair,
  zoomPercent,
  brightness,
  contrast,
  onZoomStep,
  onPointClick,
  onDropMeasurement,
}) {
  const canvasRef = useRef(null);
  const { containerRef, isDragging, handleMouseDown } = useDragPan(false);
  const zoomFactor = zoomPercent / 100;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.clearRect(0, 0, image.width, image.height);
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    ctx.drawImage(image.image, 0, 0);
    ctx.filter = "none";

    pairs.forEach((pair, index) => {
      const point = pair[side];
      if (!point) return;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = side === "fixed" ? "rgba(255, 80, 80, 0.9)" : "rgba(31, 151, 255, 0.9)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), point.x, point.y);
    });
  }, [brightness, contrast, image, pairs, side]);

  const handleCanvasClick = (event) => {
    if (!image || isDragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * image.width;
    const y = ((event.clientY - rect.top) / rect.height) * image.height;
    onPointClick(side, { x, y });
  };

  const handleWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const step = event.shiftKey ? 5 : 12;
    onZoomStep(direction * step);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const measurementId =
      event.dataTransfer.getData("application/x-hsi-measurement-id") ||
      event.dataTransfer.getData("text/plain");
    if (measurementId) {
      onDropMeasurement(side, measurementId);
    }
  };

  return (
    <section className={`registration-pane window-panel${activeSide === side ? " is-active" : ""}`}>
      <header className="window-panel__header">
        <div>
          <h3 className="window-panel__title">{title}</h3>
          <div className="window-panel__meta">
            {image ? `${image.name} · ${image.width}x${image.height}` : "No image loaded"}
          </div>
        </div>
        <div className="zoom-readout">{Math.round(zoomPercent)}%</div>
      </header>
      <div
        ref={containerRef}
        className={`registration-pane__stage${isDragging ? " is-pan-dragging" : ""}`}
        onMouseDownCapture={handleMouseDown}
        onWheel={handleWheel}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {image ? (
          <div
            className="registration-zoom-frame"
            style={{
              width: `${image.width * zoomFactor}px`,
              height: `${image.height * zoomFactor}px`,
            }}
          >
            <canvas
              ref={canvasRef}
              className="registration-canvas"
              onClick={handleCanvasClick}
              aria-label={`${title} registration point picker`}
            />
          </div>
        ) : (
          <div className="registration-pane__empty">Choose or drop a loaded measurement image.</div>
        )}
      </div>
      <div className="registration-pane__footer">
        {activeSide === side
          ? `Click point ${pendingPair + 1} here`
          : "Two-finger scroll pans. Pinch or Ctrl-scroll zooms. Shift-drag pans."}
      </div>
    </section>
  );
}

function buildMeasurementSources(measurements) {
  return measurements
    .filter((measurement) => measurement.isLoaded && measurement.rgb)
    .map((measurement) => ({
      id: measurement.id,
      name: measurement.name || "Loaded measurement",
      url: `data:image/jpeg;base64,${hexToBase64(measurement.rgb)}`,
      source: measurement.source || null,
      }));
}

function clampZoomPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(500, Math.max(25, numeric));
}

export default function ImageRegistrationPanel({ measurements = [] }) {
  const loadInputRef = useRef(null);
  const { containerRef: resultContainerRef, isDragging: isResultDragging, handleMouseDown: handleResultMouseDown } = useDragPan(false);
  const [fixedImage, setFixedImage] = useState(null);
  const [movingImage, setMovingImage] = useState(null);
  const [fixedSourceId, setFixedSourceId] = useState("");
  const [movingSourceId, setMovingSourceId] = useState("");
  const [pairs, setPairs] = useState([createEmptyPair()]);
  const [activeSide, setActiveSide] = useState("fixed");
  const [method, setMethod] = useState("affine");
  const [overlayMode, setOverlayMode] = useState("blend");
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [fixedZoomPercent, setFixedZoomPercent] = useState(100);
  const [movingZoomPercent, setMovingZoomPercent] = useState(100);
  const [resultZoomPercent, setResultZoomPercent] = useState(100);
  const [fixedBrightness, setFixedBrightness] = useState(100);
  const [fixedContrast, setFixedContrast] = useState(100);
  const [movingBrightness, setMovingBrightness] = useState(100);
  const [movingContrast, setMovingContrast] = useState(100);
  const [resultUrl, setResultUrl] = useState("");
  const [registrationSolution, setRegistrationSolution] = useState(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const imageSources = useMemo(() => buildMeasurementSources(measurements), [measurements]);
  const completePairCount = pairs.filter((pair) => pair.fixed && pair.moving).length;
  const completePairs = useMemo(
    () => pairs.filter((pair) => pair.fixed && pair.moving),
    [pairs],
  );
  const methodConfig = METHOD_OPTIONS.find((option) => option.id === method) || METHOD_OPTIONS[0];
  const canRegister = fixedImage && movingImage && completePairCount >= methodConfig.minPairs;

  const pendingPair = Math.max(0, pairs.findIndex((pair) => !pair.fixed || !pair.moving));

  const residuals = useMemo(() => {
    if (!registrationSolution) return [];
    return completePairs
      .map((pair) => {
        const mapped =
          registrationSolution.type === "tps"
            ? evaluateThinPlateSpline(registrationSolution.forward, pair.moving)
            : transformPoint(registrationSolution.matrix, pair.moving);
        const dx = mapped.x - pair.fixed.x;
        const dy = mapped.y - pair.fixed.y;
        return Math.sqrt(dx * dx + dy * dy);
      });
  }, [completePairs, registrationSolution]);

  const meanResidual = residuals.length
    ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length
    : null;

  const fixedSource = useMemo(
    () => imageSources.find((entry) => entry.id === fixedSourceId) || null,
    [fixedSourceId, imageSources],
  );
  const movingSource = useMemo(
    () => imageSources.find((entry) => entry.id === movingSourceId) || null,
    [imageSources, movingSourceId],
  );

  const selectMeasurementImage = useCallback(async (side, sourceId) => {
    const source = imageSources.find((entry) => entry.id === sourceId);
    if (!source) return;
    try {
      setError("");
      setSaveMessage("");
      const loaded = await loadImageFromUrl(source);
      if (side === "fixed") {
        setFixedSourceId(sourceId);
        setFixedImage(loaded);
        setFixedZoomPercent(100);
        setFixedBrightness(100);
        setFixedContrast(100);
      } else {
        setMovingSourceId(sourceId);
        setMovingImage(loaded);
        setMovingZoomPercent(100);
        setMovingBrightness(100);
        setMovingContrast(100);
      }
      setPairs([createEmptyPair()]);
      setActiveSide("fixed");
      setResultUrl("");
      setRegistrationSolution(null);
    } catch (loadError) {
      setError(loadError.message || "Failed to load image.");
    }
  }, [imageSources]);

  useEffect(() => {
    if (!fixedSourceId && imageSources[0]) {
      selectMeasurementImage("fixed", imageSources[0].id);
    }
    if (!movingSourceId && imageSources[1]) {
      selectMeasurementImage("moving", imageSources[1].id);
    }
  }, [fixedSourceId, imageSources, movingSourceId, selectMeasurementImage]);

  const handlePointClick = (side, point) => {
    setError("");
    setSaveMessage("");
    setResultUrl("");
    setRegistrationSolution(null);
    setPairs((prev) => {
      const next = [...prev];
      const firstIncompleteIndex = next.findIndex((pair) => !pair.fixed || !pair.moving);
      const targetIndex = firstIncompleteIndex === -1 ? next.length : firstIncompleteIndex;
      const targetPair = next[targetIndex] || createEmptyPair();
      next[targetIndex] = { ...targetPair, [side]: point };

      if (side === "fixed" && !next[targetIndex].moving) {
        setActiveSide("moving");
      } else if (side === "moving") {
        if (next[targetIndex].fixed) {
          next.push(createEmptyPair());
        }
        setActiveSide("fixed");
      }

      return next;
    });
  };

  const handleRemovePair = (pairId) => {
    setPairs((prev) => {
      const next = prev.filter((pair) => pair.id !== pairId);
      return next.length ? next : [createEmptyPair()];
    });
    setResultUrl("");
    setRegistrationSolution(null);
    setSaveMessage("");
  };

  const handleClearPoints = () => {
    setPairs([createEmptyPair()]);
    setActiveSide("fixed");
    setResultUrl("");
    setRegistrationSolution(null);
    setError("");
    setSaveMessage("");
  };

  const handleRegister = () => {
    if (!fixedImage || !movingImage) {
      setError("Load both images before calculating a registration.");
      return;
    }
    try {
      setError("");
      const solution = calculateRegistration(method, pairs);
      const rendered = renderRegistrationOverlay({
        fixed: fixedImage,
        moving: movingImage,
        registration: solution,
        opacity: overlayOpacity / 100,
        mode: overlayMode,
      });
      setRegistrationSolution(solution);
      setResultUrl(rendered);
    } catch (registrationError) {
      setError(registrationError.message || "Registration failed.");
    }
  };

  const handleFixedZoomStep = (delta) => {
    setFixedZoomPercent((prev) => clampZoomPercent(prev + delta));
  };

  const handleMovingZoomStep = (delta) => {
    setMovingZoomPercent((prev) => clampZoomPercent(prev + delta));
  };

  const handleResultWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const step = event.shiftKey ? 5 : 12;
    setResultZoomPercent((prev) => clampZoomPercent(prev + direction * step));
  };

  const handleSaveRegistration = async () => {
    if (!registrationSolution || !fixedImage || !movingImage || !fixedSource || !movingSource) {
      setError("Calculate a registration before saving its parameters.");
      return;
    }

    const payload = {
      type: "manual-image-registration",
      version: 1,
      savedAt: new Date().toISOString(),
      method,
      overlay: {
        mode: overlayMode,
        opacityPercent: overlayOpacity,
      },
      referenceImage: {
        measurementId: fixedSource.id,
        name: fixedSource.name,
        folderPath: fixedSource.source?.path || null,
        dataHdrName: fixedSource.source?.dataHdrName || null,
        width: fixedImage.width,
        height: fixedImage.height,
      },
      movingImage: {
        measurementId: movingSource.id,
        name: movingSource.name,
        folderPath: movingSource.source?.path || null,
        dataHdrName: movingSource.source?.dataHdrName || null,
        width: movingImage.width,
        height: movingImage.height,
      },
      pointPairs: completePairs.map((pair, index) => ({
        index: index + 1,
        reference: {
          x: pair.fixed.x,
          y: pair.fixed.y,
        },
        moving: {
          x: pair.moving.x,
          y: pair.moving.y,
        },
      })),
      registrationParameters: {
        modelType: registrationSolution.type,
        matrix3x3: registrationSolution.type === "matrix" ? registrationSolution.matrix : null,
        thinPlateSpline:
          registrationSolution.type === "tps"
            ? {
                forward: registrationSolution.forward,
                inverse: registrationSolution.inverse,
              }
            : null,
        meanResidualPixels: meanResidual,
      },
    };

    try {
      setError("");
      const result = await saveRegistration(payload);
      setSaveMessage(`Saved registration to ${result.path}`);
    } catch (saveError) {
      setSaveMessage("");
      setError(saveError.message || "Failed to save registration.");
    }
  };

  const handleLoadRegistrationFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await readTextFile(file);
      const payload = JSON.parse(text);
      const nextMethod = String(payload?.method || "").trim();
      const nextPairs = normalizeLoadedPairs(payload?.pointPairs);

      if (!METHOD_OPTIONS.some((option) => option.id === nextMethod)) {
        throw new Error("Registration file has an unsupported method.");
      }
      if (nextPairs.length === 0) {
        throw new Error("Registration file does not contain any valid point pairs.");
      }
      const nextSolution = calculateRegistration(nextMethod, nextPairs);

      setError("");
      setMethod(nextMethod);
      setOverlayMode(
        OVERLAY_OPTIONS.some((option) => option.id === payload?.overlay?.mode)
          ? payload.overlay.mode
          : "blend",
      );
      setOverlayOpacity(
        Number.isFinite(Number(payload?.overlay?.opacityPercent))
          ? Math.min(100, Math.max(0, Number(payload.overlay.opacityPercent)))
          : 50,
      );
      setPairs([...nextPairs, createEmptyPair()]);
      setActiveSide("fixed");
      setRegistrationSolution(nextSolution);
      setSaveMessage(`Loaded registration from ${file.name}`);
    } catch (loadError) {
      setSaveMessage("");
      setError(loadError.message || "Failed to load registration file.");
    }
  };

  useEffect(() => {
    if (!registrationSolution || !fixedImage || !movingImage) return;
    try {
      setResultUrl(
        renderRegistrationOverlay({
          fixed: fixedImage,
          moving: movingImage,
          registration: registrationSolution,
          opacity: overlayOpacity / 100,
          mode: overlayMode,
        }),
      );
    } catch (renderError) {
      setError(renderError.message || "Failed to render overlay.");
    }
  }, [fixedImage, movingImage, overlayMode, overlayOpacity, registrationSolution]);

  return (
    <div className={`registration-workbench${controlsCollapsed ? " is-controls-collapsed" : ""}`}>
      <section className={`registration-controls window-panel${controlsCollapsed ? " is-collapsed" : ""}`}>
        <header className="window-panel__header registration-controls__header">
          <div>
            <h2 className="window-panel__title">Manual Co-Registration</h2>
            <div className="window-panel__meta">
              Place matching landmarks in the reference image, then in the moving image.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn--compact"
            onClick={() => setControlsCollapsed((prev) => !prev)}
          >
            {controlsCollapsed ? "Show controls" : "Hide controls"}
          </button>
        </header>

        {!controlsCollapsed && (
        <div className="registration-controls__body">
          <div className="registration-control-grid">
            <label className="field-group">
              <span className="field-label">Reference image</span>
              <select
                className="field-input field-input--select"
                value={fixedSourceId}
                onChange={(event) => selectMeasurementImage("fixed", event.target.value)}
              >
                <option value="">Choose loaded measurement</option>
                {imageSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group">
              <span className="field-label">Moving image</span>
              <select
                className="field-input field-input--select"
                value={movingSourceId}
                onChange={(event) => selectMeasurementImage("moving", event.target.value)}
              >
                <option value="">Choose loaded measurement</option>
                {imageSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group">
              <span className="field-label">Method</span>
              <select
                className="field-input field-input--select"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value);
                  setResultUrl("");
                  setRegistrationSolution(null);
                  setSaveMessage("");
                }}
              >
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {option.minPairs}+ pairs
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group">
              <span className="field-label">Overlay</span>
              <select
                className="field-input field-input--select"
                value={overlayMode}
                onChange={(event) => setOverlayMode(event.target.value)}
              >
                {OVERLAY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-group">
              <span className="field-label">Moving opacity {overlayOpacity}%</span>
              <input
                className="zoom-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={overlayOpacity}
                onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                disabled={overlayMode !== "blend"}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Reference brightness {fixedBrightness}%</span>
              <input
                className="zoom-slider"
                type="range"
                min={50}
                max={300}
                step={5}
                value={fixedBrightness}
                onChange={(event) => setFixedBrightness(Number(event.target.value))}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Reference contrast {fixedContrast}%</span>
              <input
                className="zoom-slider"
                type="range"
                min={50}
                max={200}
                step={5}
                value={fixedContrast}
                onChange={(event) => setFixedContrast(Number(event.target.value))}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Moving brightness {movingBrightness}%</span>
              <input
                className="zoom-slider"
                type="range"
                min={50}
                max={300}
                step={5}
                value={movingBrightness}
                onChange={(event) => setMovingBrightness(Number(event.target.value))}
              />
            </label>

            <label className="field-group">
              <span className="field-label">Moving contrast {movingContrast}%</span>
              <input
                className="zoom-slider"
                type="range"
                min={50}
                max={200}
                step={5}
                value={movingContrast}
                onChange={(event) => setMovingContrast(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="registration-actions">
            <button type="button" className="btn btn-primary" onClick={handleRegister} disabled={!canRegister}>
              Calculate registration
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => loadInputRef.current?.click()}
            >
              Load registration
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSaveRegistration}
              disabled={!registrationSolution}
            >
              Save registration
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleClearPoints}>
              Clear points
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setActiveSide(activeSide === "fixed" ? "moving" : "fixed")}>
              Next click: {activeSide === "fixed" ? "reference" : "moving"}
            </button>
            <input
              ref={loadInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={handleLoadRegistrationFile}
            />
          </div>

          {error && <div className="notice notice--warning">{error}</div>}
          {saveMessage && <div className="notice">{saveMessage}</div>}
          {imageSources.length === 0 && (
            <div className="notice notice--warning">
              Load a measurement in the explorer first so its false-RGB image is available here.
            </div>
          )}

          <div className="registration-stats">
            <div>
              <span className="meta-label">Complete pairs</span>
              <strong>{completePairCount}</strong>
            </div>
            <div>
              <span className="meta-label">Required</span>
              <strong>{methodConfig.minPairs}</strong>
            </div>
            <div>
              <span className="meta-label">Mean error</span>
              <strong>{meanResidual === null ? "-" : `${meanResidual.toFixed(2)} px`}</strong>
            </div>
          </div>

          <div className="registration-pairs">
            <div className="registration-pairs__header">
              <span>Point pairs</span>
              <span className="muted-text">Reference x/y -> Moving x/y</span>
            </div>
            <div className="registration-pairs__list">
              {pairs.map((pair, index) => (
                <div key={pair.id} className="registration-pair-row">
                  <strong>{index + 1}</strong>
                  <span>{pair.fixed ? `${formatNumber(pair.fixed.x)}, ${formatNumber(pair.fixed.y)}` : "Reference pending"}</span>
                  <span>{pair.moving ? `${formatNumber(pair.moving.x)}, ${formatNumber(pair.moving.y)}` : "Moving pending"}</span>
                  <button type="button" className="btn btn-ghost btn--compact" onClick={() => handleRemovePair(pair.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
      </section>

      <div className="registration-image-grid">
        <RegistrationImagePane
          title="Reference image"
          image={fixedImage}
          side="fixed"
          pairs={pairs}
          activeSide={activeSide}
          pendingPair={pendingPair === -1 ? pairs.length - 1 : pendingPair}
          zoomPercent={fixedZoomPercent}
          brightness={fixedBrightness}
          contrast={fixedContrast}
          onZoomStep={handleFixedZoomStep}
          onPointClick={handlePointClick}
          onDropMeasurement={selectMeasurementImage}
        />
        <RegistrationImagePane
          title="Moving image"
          image={movingImage}
          side="moving"
          pairs={pairs}
          activeSide={activeSide}
          pendingPair={pendingPair === -1 ? pairs.length - 1 : pendingPair}
          zoomPercent={movingZoomPercent}
          brightness={movingBrightness}
          contrast={movingContrast}
          onZoomStep={handleMovingZoomStep}
          onPointClick={handlePointClick}
          onDropMeasurement={selectMeasurementImage}
        />
      </div>

      <section className="registration-result window-panel">
        <header className="window-panel__header">
          <div>
            <h3 className="window-panel__title">Overlay result</h3>
            <div className="window-panel__meta">
              Moving image warped into the reference image coordinate system.
            </div>
          </div>
          <div className="zoom-readout">{Math.round(resultZoomPercent)}%</div>
        </header>
        <div
          ref={resultContainerRef}
          className={`registration-result__stage${isResultDragging ? " is-pan-dragging" : ""}`}
          onMouseDownCapture={handleResultMouseDown}
          onWheel={handleResultWheel}
        >
          {resultUrl ? (
            <div
              className="registration-zoom-frame"
              style={{
                width: fixedImage ? `${fixedImage.width * (resultZoomPercent / 100)}px` : undefined,
                height: fixedImage ? `${fixedImage.height * (resultZoomPercent / 100)}px` : undefined,
              }}
            >
              <img
                src={resultUrl}
                alt="Registered overlay result"
              />
            </div>
          ) : (
            <div className="registration-pane__empty">Calculate registration to preview the overlay.</div>
          )}
        </div>
        {registrationSolution && (
          <div className="registration-matrix">
            {registrationSolution.type === "matrix" ? (
              registrationSolution.matrix.flat().map((value, index) => (
                <span key={`${index}-${value}`}>{formatNumber(value)}</span>
              ))
            ) : (
              <>
                <span>Thin-plate</span>
                <span>spline</span>
                <span>{completePairCount} pts</span>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
