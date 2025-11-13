import "konva/lib/shapes/Image";
import React, { useState, useEffect } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";

function computeStageSize(image) {
  if (!image) {
    return {
      width: 600,
      height: 600,
      scale: 1,
    };
  }

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const padding = 420; // leave space for controls/plots
  const maxWidth = Math.max(500, viewportWidth - padding);
  const maxHeight = Math.max(400, viewportHeight - 160);
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return {
    width: image.width * scale,
    height: image.height * scale,
    scale,
  };
}

export default function ViewerCanvas({ imageUrl, regions = [], onRegion }) {
  const [rect, setRect] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [img, setImg] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 600 });
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    if (!imageUrl) return;
    const image = new window.Image();
    image.src = imageUrl;
    image.onload = () => {
      const { width, height, scale } = computeStageSize(image);
      setStageSize({ width, height });
      setDisplayScale(scale);
      setImg(image);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!img) return;
    const handleResize = () => {
      const { width, height, scale } = computeStageSize(img);
      setStageSize({ width, height });
      setDisplayScale(scale);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [img]);

  const handleMouseDown = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    setDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setRect((r) => ({ ...r, width: pos.x - r.x, height: pos.y - r.y }));
  };

  const handleMouseUp = () => {
    setDrawing(false);
    if (!rect || !onRegion || !img) return;

    const xStart = rect.width >= 0 ? rect.x : rect.x + rect.width;
    const yStart = rect.height >= 0 ? rect.y : rect.y + rect.height;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);

    if (width < 1 || height < 1) return;

    const scale = displayScale || 1;
    const invScale = 1 / scale;
    const x0 = Math.round(xStart * invScale);
    const y0 = Math.round(yStart * invScale);
    const x1 = Math.round((xStart + width) * invScale);
    const y1 = Math.round((yStart + height) * invScale);

    const clamped = {
      x0: Math.max(0, Math.min(img.width, Math.min(x0, x1))),
      y0: Math.max(0, Math.min(img.height, Math.min(y0, y1))),
      x1: Math.max(0, Math.min(img.width, Math.max(x0, x1))),
      y1: Math.max(0, Math.min(img.height, Math.max(y0, y1))),
    };

    if (clamped.x0 === clamped.x1 || clamped.y0 === clamped.y1) return;

    onRegion(clamped);
    setRect(null);
  };

  const displayRect = rect
    ? {
        x: rect.width >= 0 ? rect.x : rect.x + rect.width,
        y: rect.height >= 0 ? rect.y : rect.y + rect.height,
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
      }
    : null;

  const drawnRegions = Array.isArray(regions)
    ? regions
        .map((region) => {
          const rectData = region.rect || region;
          if (
            rectData == null ||
            typeof rectData.x0 !== "number" ||
            typeof rectData.y0 !== "number" ||
            typeof rectData.x1 !== "number" ||
            typeof rectData.y1 !== "number"
          ) {
            return null;
          }
          const x = Math.min(rectData.x0, rectData.x1) * displayScale;
          const y = Math.min(rectData.y0, rectData.y1) * displayScale;
          const width = Math.abs(rectData.x1 - rectData.x0) * displayScale;
          const height = Math.abs(rectData.y1 - rectData.y0) * displayScale;
          if (width <= 0 || height <= 0) return null;
          return {
            id: region.id || `${rectData.x0}-${rectData.y0}`,
            x,
            y,
            width,
            height,
            color: region.color || "#ff3b30",
          };
        })
        .filter(Boolean)
    : [];

  return (
    <Stage
      width={stageSize.width}
      height={stageSize.height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="viewer-stage"
    >
      <Layer>
        {img && (
          <KonvaImage
            image={img}
            width={stageSize.width}
            height={stageSize.height}
          />
        )}
        {drawnRegions.map((region) => (
          <Rect
            key={region.id}
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            stroke={region.color}
            strokeWidth={2}
          />
        ))}
        {displayRect && (
          <Rect
            x={displayRect.x}
            y={displayRect.y}
            width={displayRect.width}
            height={displayRect.height}
            stroke="red"
            dash={[4, 4]}
          />
        )}
      </Layer>
    </Stage>
  );
}
