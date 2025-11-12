import "konva/lib/shapes/Image";
import React, { useRef, useState, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";

const MIN_RECT_SIZE = 4;

function normalizeRect(rect) {
  if (!rect) return null;
  const x = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const y = rect.height >= 0 ? rect.y : rect.y + rect.height;
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  return { x, y, width, height };
}

export default function ViewerCanvas({ imageUrl, regions = [], onRegion, disabled, showOverlay }) {
  const containerRef = useRef(null);
  const stageRef = useRef();
  const [rect, setRect] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [img, setImg] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 400 });

  useEffect(() => {
    if (!imageUrl) {
      setImg(null);
      return;
    }
    const image = new window.Image();
    image.src = imageUrl;
    image.onload = () => setImg(image);
  }, [imageUrl]);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      if (width <= 0) return;
      if (img) {
        const aspect = img.height / img.width;
        setStageSize({ width, height: width * aspect });
      } else {
        setStageSize({ width, height: width * 0.75 });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [img]);

  useEffect(() => {
    setRect(null);
    setDrawing(false);
  }, [imageUrl]);

  const handleMouseDown = (e) => {
    if (disabled || !img) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    setDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!drawing || disabled) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    setRect((r) => (r ? { ...r, width: pos.x - r.x, height: pos.y - r.y } : null));
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    setDrawing(false);
    const normalized = normalizeRect(rect);
    if (!normalized || normalized.width < MIN_RECT_SIZE || normalized.height < MIN_RECT_SIZE) {
      setRect(null);
      return;
    }

    if (!img || !onRegion) {
      setRect(null);
      return;
    }

    const scaleX = img.width / stageSize.width;
    const scaleY = img.height / stageSize.height;
    const imageRect = {
      x: Math.round(normalized.x * scaleX),
      y: Math.round(normalized.y * scaleY),
      width: Math.round(normalized.width * scaleX),
      height: Math.round(normalized.height * scaleY),
    };

    setRect(null);
    onRegion(imageRect);
  };

  const scaledRegions = useMemo(() => {
    if (!img) return [];
    const scaleX = stageSize.width / img.width;
    const scaleY = stageSize.height / img.height;
    return regions.map((region) => ({
      ...region,
      stageRect: {
        x: region.rect.x * scaleX,
        y: region.rect.y * scaleY,
        width: region.rect.width * scaleX,
        height: region.rect.height * scaleY,
      },
    }));
  }, [regions, img, stageSize]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <Stage
        width={stageSize.width}
        height={stageSize.height}
        ref={stageRef}
        onMouseDown={!disabled && !showOverlay ? handleMouseDown : undefined}
        onMouseMove={!disabled && !showOverlay ? handleMouseMove : undefined}
        onMouseUp={!disabled && !showOverlay ? handleMouseUp : undefined}
        style={{
          border: "1px solid #ccc",
          borderRadius: 10,
          width: "100%",
          height: stageSize.height,
          cursor: !disabled && img ? "crosshair" : "default",
          background: img ? "#000" : "#f3f3f3",
        }}
      >
        <Layer>
          {img && <KonvaImage image={img} width={stageSize.width} height={stageSize.height} />}
          {scaledRegions.map((region) => (
            <Rect
              key={region.id}
              x={region.stageRect.x}
              y={region.stageRect.y}
              width={region.stageRect.width}
              height={region.stageRect.height}
              stroke={region.color}
              strokeWidth={2}
              listening={false}
            />
          ))}
          {rect && (
            <Rect
              x={normalizeRect(rect).x}
              y={normalizeRect(rect).y}
              width={normalizeRect(rect).width}
              height={normalizeRect(rect).height}
              stroke="#ffffff"
              dash={[6, 4]}
              strokeWidth={1.5}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
