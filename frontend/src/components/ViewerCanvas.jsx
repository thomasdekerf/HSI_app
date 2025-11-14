import "konva/lib/shapes/Image";
import React, { useState, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Circle, Line } from "react-konva";
import { getShapeBounds } from "../utils/shapes";

function computeStageSize(image, constraints = {}) {
  if (!image) {
    return {
      width: 600,
      height: 600,
      scale: 1,
    };
  }

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const widthLimit =
    typeof constraints.maxWidth === "number" && constraints.maxWidth > 0
      ? constraints.maxWidth
      : viewportWidth - 80;
  const heightLimit =
    typeof constraints.maxHeight === "number" && constraints.maxHeight > 0
      ? constraints.maxHeight
      : viewportHeight - 220;
  const maxWidth = Math.max(320, widthLimit);
  const maxHeight = Math.max(320, heightLimit);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return {
    width: image.width * scale,
    height: image.height * scale,
    scale,
  };
}

const clampValue = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

function sanitizeShape(shape, imageWidth, imageHeight) {
  if (!shape) return null;
  const type = String(shape.type || "rectangle").toLowerCase();
  if (type === "rectangle") {
    const x0 = clampValue(Math.min(shape.x0, shape.x1), 0, imageWidth);
    const x1 = clampValue(Math.max(shape.x0, shape.x1), 0, imageWidth);
    const y0 = clampValue(Math.min(shape.y0, shape.y1), 0, imageHeight);
    const y1 = clampValue(Math.max(shape.y0, shape.y1), 0, imageHeight);
    if (x0 === x1 || y0 === y1) return null;
    return { type: "rectangle", x0, x1, y0, y1 };
  }
  if (type === "circle") {
    const cx = clampValue(shape.cx, 0, imageWidth);
    const cy = clampValue(shape.cy, 0, imageHeight);
    const maxRadius = Math.min(cx, cy, imageWidth - cx, imageHeight - cy);
    const radius = clampValue(shape.radius, 0, maxRadius);
    if (radius < 1) return null;
    return { type: "circle", cx, cy, radius };
  }
  if (type === "point") {
    const x = clampValue(shape.x ?? shape.cx ?? shape.x0, 0, imageWidth - 1);
    const y = clampValue(shape.y ?? shape.cy ?? shape.y0, 0, imageHeight - 1);
    return { type: "point", x, y };
  }
  if (type === "polygon") {
    const points = Array.isArray(shape.points)
      ? shape.points
          .map((point) => ({
            x: clampValue(Number(point.x ?? point[0]), 0, imageWidth),
            y: clampValue(Number(point.y ?? point[1]), 0, imageHeight),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    if (points.length < 3) return null;
    return { type: "polygon", points };
  }
  return null;
}

export default function ViewerCanvas({
  imageUrl,
  regions = [],
  onRegion,
  maxWidth,
  drawMode = "rectangle",
}) {
  const [dragState, setDragState] = useState(null);
  const [img, setImg] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 600 });
  const [displayScale, setDisplayScale] = useState(1);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [pointerPosition, setPointerPosition] = useState(null);

  useEffect(() => {
    if (!imageUrl) {
      setImg(null);
      return;
    }
    const image = new window.Image();
    image.src = imageUrl;
    image.onload = () => {
      setImg(image);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!img) return undefined;
    const updateSize = () => {
      const { width, height, scale } = computeStageSize(img, { maxWidth });
      setStageSize({ width, height });
      setDisplayScale(scale);
    };
    updateSize();
    const handleResize = () => {
      updateSize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [img, maxWidth]);

  useEffect(() => {
    if (drawMode !== "polygon") {
      setPolygonPoints([]);
    }
    setDragState(null);
  }, [drawMode]);

  const toImageCoordinates = (pos) => {
    if (!pos || !displayScale) return { x: 0, y: 0 };
    const invScale = 1 / displayScale;
    return {
      x: Math.round(pos.x * invScale),
      y: Math.round(pos.y * invScale),
    };
  };

  const finalizeShape = (shape) => {
    if (!img || typeof onRegion !== "function") return;
    const sanitized = sanitizeShape(shape, img.width, img.height);
    if (!sanitized) return;
    const bounds = getShapeBounds(sanitized);
    if (!bounds) return;
    onRegion({ shape: sanitized, bounds });
  };

  const handleMouseDown = (event) => {
    if (!img) return;
    const stage = event.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (drawMode === "point") {
      finalizeShape({ type: "point", ...toImageCoordinates(pos) });
      return;
    }

    if (drawMode === "polygon") {
      setPolygonPoints((prev) => [...prev, pos]);
      return;
    }

    setDragState({
      start: pos,
      current: pos,
    });
  };

  const handleMouseMove = (event) => {
    const stage = event.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (pos) {
      setPointerPosition(pos);
    }
    if (!dragState) return;
    setDragState((state) => ({ ...state, current: pos || state.current }));
  };

  const handleMouseUp = () => {
    if (!dragState || !img) return;
    const { start, current } = dragState;
    if (!start || !current) {
      setDragState(null);
      return;
    }

    if (drawMode === "rectangle") {
      const startImage = toImageCoordinates(start);
      const endImage = toImageCoordinates(current);
      const shape = {
        type: "rectangle",
        x0: Math.min(startImage.x, endImage.x),
        y0: Math.min(startImage.y, endImage.y),
        x1: Math.max(startImage.x, endImage.x),
        y1: Math.max(startImage.y, endImage.y),
      };
      finalizeShape(shape);
    } else if (drawMode === "circle") {
      const center = toImageCoordinates(start);
      const currentImage = toImageCoordinates(current);
      const dx = currentImage.x - center.x;
      const dy = currentImage.y - center.y;
      const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
      finalizeShape({ type: "circle", cx: center.x, cy: center.y, radius });
    }

    setDragState(null);
  };

  const handleDoubleClick = (event) => {
    if (drawMode !== "polygon" || polygonPoints.length < 3 || !img) {
      return;
    }
    event.evt.preventDefault();
    const imagePoints = polygonPoints.map((point) => toImageCoordinates(point));
    finalizeShape({ type: "polygon", points: imagePoints });
    setPolygonPoints([]);
  };

  const drawnRegions = useMemo(() => {
    if (!Array.isArray(regions)) return [];
    return regions
      .map((region) => {
        const baseShape =
          region.shape ||
          (region.bounds
            ? { type: "rectangle", ...region.bounds }
            : region.rect || null);
        if (!baseShape) return null;
        return {
          id: region.id || region.key || Math.random().toString(16),
          color: region.color || "#ff3b30",
          shape: baseShape,
        };
      })
      .filter(Boolean);
  }, [regions]);

  const renderRegionShape = (region) => {
    const { shape, color, id } = region;
    if (!shape) return null;
    const type = String(shape.type || "rectangle").toLowerCase();
    if (type === "rectangle") {
      const bounds = getShapeBounds(shape);
      if (!bounds) return null;
      const x = Math.min(bounds.x0, bounds.x1) * displayScale;
      const y = Math.min(bounds.y0, bounds.y1) * displayScale;
      const width = Math.abs(bounds.x1 - bounds.x0) * displayScale;
      const height = Math.abs(bounds.y1 - bounds.y0) * displayScale;
      if (width <= 0 || height <= 0) return null;
      return <Rect key={id} x={x} y={y} width={width} height={height} stroke={color} strokeWidth={2} />;
    }
    if (type === "circle") {
      const cx = Number(shape.cx);
      const cy = Number(shape.cy);
      const radius = Number(shape.radius);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius)) {
        return null;
      }
      return (
        <Circle
          key={id}
          x={cx * displayScale}
          y={cy * displayScale}
          radius={Math.max(0, radius) * displayScale}
          stroke={color}
          strokeWidth={2}
        />
      );
    }
    if (type === "point") {
      const x = Number(shape.x ?? shape.cx ?? shape.x0);
      const y = Number(shape.y ?? shape.cy ?? shape.y0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return (
        <Circle key={id} x={x * displayScale} y={y * displayScale} radius={4} fill={color} stroke={color} />
      );
    }
    if (type === "polygon") {
      const points = Array.isArray(shape.points)
        ? shape.points
            .map((point) => [Number(point.x ?? point[0]), Number(point.y ?? point[1])])
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        : [];
      if (points.length < 3) return null;
      const flatPoints = points.flatMap(([x, y]) => [x * displayScale, y * displayScale]);
      return <Line key={id} points={flatPoints} stroke={color} strokeWidth={2} closed />;
    }
    return null;
  };

  const renderDraftShape = () => {
    if (!dragState || !dragState.start || !dragState.current) return null;
    if (drawMode === "rectangle") {
      const start = dragState.start;
      const current = dragState.current;
      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      return (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          stroke="red"
          dash={[4, 4]}
        />
      );
    }
    if (drawMode === "circle") {
      const start = dragState.start;
      const current = dragState.current;
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return <Circle x={start.x} y={start.y} radius={radius} stroke="red" dash={[4, 4]} />;
    }
    return null;
  };

  const renderPolygonDraft = () => {
    if (drawMode !== "polygon" || polygonPoints.length === 0) return null;
    const dynamicPoints = [...polygonPoints];
    if (pointerPosition) {
      dynamicPoints.push(pointerPosition);
    }
    const flat = dynamicPoints.flatMap((point) => [point.x, point.y]);
    return <Line points={flat} stroke="red" dash={[6, 4]} closed={false} />;
  };

  return (
    <Stage
      width={stageSize.width}
      height={stageSize.height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDblClick={handleDoubleClick}
      className="viewer-stage"
    >
      <Layer>
        {img && (
          <KonvaImage image={img} width={stageSize.width} height={stageSize.height} />
        )}
        {drawnRegions.map((region) => renderRegionShape(region))}
        {renderDraftShape()}
        {renderPolygonDraft()}
      </Layer>
    </Stage>
  );
}
