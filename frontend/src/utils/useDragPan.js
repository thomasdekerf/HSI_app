import { useEffect, useRef, useState } from "react";

export function useDragPan(enabled) {
  const containerRef = useRef(null);
  const dragStateRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!enabled && !isDragging) {
      dragStateRef.current = null;
      setIsDragging(false);
    }
  }, [enabled, isDragging]);

  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMouseMove = (event) => {
      const container = containerRef.current;
      const dragState = dragStateRef.current;
      if (!container || !dragState) return;
      container.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX);
      container.scrollTop = dragState.scrollTop - (event.clientY - dragState.startY);
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [enabled, isDragging]);

  const handleMouseDown = (event) => {
    const shouldPan = enabled || event.shiftKey;
    if (!shouldPan || event.button !== 0) return false;
    const container = containerRef.current;
    if (!container) return false;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    setIsDragging(true);
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return {
    containerRef,
    isDragging,
    handleMouseDown,
  };
}
