import "konva/lib/shapes/Image";
import React, { useRef, useState, useEffect } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";

export default function ViewerCanvas({ imageUrl, onRegion }) {
  const [rect, setRect] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [img, setImg] = useState(null);
  const stageRef = useRef();
  const [stageSize, setStageSize] = useState({ width: 600, height: 600 });
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    if (!imageUrl) return;
    const image = new window.Image();
    image.src = imageUrl;
    image.onload = () => {
      const maxStage = 600;
      const scale = Math.min(
        maxStage / image.width,
        maxStage / image.height,
        1
      );
      setStageSize({ width: image.width * scale, height: image.height * scale });
      setDisplayScale(scale);
      setImg(image);
    };
  }, [imageUrl]);

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
  };

  const displayRect = rect
    ? {
        x: rect.width >= 0 ? rect.x : rect.x + rect.width,
        y: rect.height >= 0 ? rect.y : rect.y + rect.height,
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
      }
    : null;

  return (
    <Stage
      width={stageSize.width}
      height={stageSize.height}
      ref={stageRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ border: "1px solid #ccc", borderRadius: 10 }}
    >
      <Layer>
        {img && (
          <KonvaImage
            image={img}
            width={stageSize.width}
            height={stageSize.height}
          />
        )}
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
