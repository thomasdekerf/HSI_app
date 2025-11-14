const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

function asRectangleBounds(rect) {
  if (!rect) return null;
  const x0 = Number(rect.x0 ?? rect.x ?? rect.left);
  const y0 = Number(rect.y0 ?? rect.y ?? rect.top);
  const x1 = Number(rect.x1 ?? rect.x ?? rect.right ?? rect.x0);
  const y1 = Number(rect.y1 ?? rect.y ?? rect.bottom ?? rect.y0);
  if ([x0, y0, x1, y1].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return {
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
  };
}

export function getShapeBounds(shape) {
  if (!shape || typeof shape !== "object") {
    return null;
  }
  const type = String(shape.type || "rectangle").toLowerCase();
  if (type === "rectangle") {
    return asRectangleBounds(shape);
  }
  if (type === "circle") {
    const cx = Number(shape.cx);
    const cy = Number(shape.cy);
    const radius = Number(shape.radius);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) {
      return null;
    }
    return {
      x0: cx - radius,
      x1: cx + radius,
      y0: cy - radius,
      y1: cy + radius,
    };
  }
  if (type === "point") {
    const x = Number(shape.x ?? shape.cx ?? shape.x0);
    const y = Number(shape.y ?? shape.cy ?? shape.y0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      x0: x - 0.5,
      x1: x + 0.5,
      y0: y - 0.5,
      y1: y + 0.5,
    };
  }
  if (type === "polygon") {
    const points = Array.isArray(shape.points) ? shape.points : [];
    if (points.length === 0) {
      return null;
    }
    const xs = points
      .map((point) => Number(point.x ?? point[0]))
      .filter((value) => Number.isFinite(value));
    const ys = points
      .map((point) => Number(point.y ?? point[1]))
      .filter((value) => Number.isFinite(value));
    if (!xs.length || !ys.length) {
      return null;
    }
    return {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  }
  return asRectangleBounds(shape);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const x0 = Number(current.x ?? current[0]);
    const y0 = Number(current.y ?? current[1]);
    const x1 = Number(next.x ?? next[0]);
    const y1 = Number(next.y ?? next[1]);
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      continue;
    }
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

export function estimateShapePixels(shape) {
  if (!shape) return 0;
  const type = String(shape.type || "rectangle").toLowerCase();
  if (type === "rectangle") {
    const bounds = asRectangleBounds(shape);
    if (!bounds) return 0;
    return Math.max(0, (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0));
  }
  if (type === "circle") {
    const radius = Number(shape.radius);
    if (!Number.isFinite(radius)) return 0;
    return Math.PI * radius * radius;
  }
  if (type === "point") {
    return 1;
  }
  if (type === "polygon") {
    return polygonArea(shape.points);
  }
  const bounds = asRectangleBounds(shape);
  if (!bounds) return 0;
  return Math.max(0, (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0));
}

export function describeShape(shape) {
  if (!shape) return "-";
  const type = String(shape.type || "rectangle").toLowerCase();
  if (type === "rectangle") {
    const bounds = asRectangleBounds(shape);
    if (!bounds) return "Rectangle";
    const width = Math.round(Math.abs(bounds.x1 - bounds.x0));
    const height = Math.round(Math.abs(bounds.y1 - bounds.y0));
    return `${width}px × ${height}px rectangle`;
  }
  if (type === "circle") {
    const radius = Number(shape.radius);
    if (!Number.isFinite(radius)) return "Circle";
    return `${Math.round(radius)}px radius circle`;
  }
  if (type === "point") {
    const x = Number(shape.x ?? shape.cx ?? shape.x0);
    const y = Number(shape.y ?? shape.cy ?? shape.y0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "Point";
    return `Point at (${Math.round(x)}, ${Math.round(y)})`;
  }
  if (type === "polygon") {
    const points = Array.isArray(shape.points) ? shape.points : [];
    return `${points.length} vertex polygon`;
  }
  return "Custom region";
}

export function clampBounds(bounds, width, height) {
  if (!bounds) return null;
  return {
    x0: clamp(bounds.x0, 0, width),
    x1: clamp(bounds.x1, 0, width),
    y0: clamp(bounds.y0, 0, height),
    y1: clamp(bounds.y1, 0, height),
  };
}
