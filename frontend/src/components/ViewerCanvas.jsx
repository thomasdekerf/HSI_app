import "konva/lib/shapes/Image";
import React, { useRef, useState, useEffect } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";

export default function ViewerCanvas({ imageUrl, onRegion }) {
  const [rect, setRect] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [img, setImg] = useState(null);
  const stageRef = useRef();

  useEffect(() => {
    if (!imageUrl) return;
    const image = new window.Image();
    image.src = imageUrl;
    image.onload = () => setImg(image);
  }, [imageUrl]);

  const handleMouseDown = (e) => {
    const pos = e.target.getStage().getPointerPosition();
    setRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    setDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const pos = e.target.getStage().getPointerPosition();
    setRect((r) => ({ ...r, width: pos.x - r.x, height: pos.y - r.y }));
  };

  const handleMouseUp = () => {
    setDrawing(false);
    if (rect && onRegion) onRegion(rect);
  };

  return (
    <Stage
      width={600}
      height={600}
      ref={stageRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ border: "1px solid #ccc", borderRadius: 10 }}
    >
      <Layer>
        {img && <KonvaImage image={img} />}
        {rect && (
          <Rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            stroke="red"
            dash={[4, 4]}
          />
        )}
      </Layer>
    </Stage>
  );
}
