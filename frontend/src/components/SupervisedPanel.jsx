import React, { useEffect, useMemo, useRef, useState } from "react";
import ViewerCanvas from "./ViewerCanvas";
import ClassSpectraPlot from "./ClassSpectraPlot";
import { runSupervisedClassification } from "../api";
import { hexToBase64 } from "../utils/image";

const CLASS_COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
  "#5856d6",
  "#5ac8fa",
  "#ff2d55",
  "#bf5af2",
  "#d6a2e8",
  "#00c7be",
];

function createRegionId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function calculatePixelCount(rect) {
  if (!rect) return 0;
  const width = Math.max(0, Math.abs(Math.round(rect.x1) - Math.round(rect.x0)));
  const height = Math.max(0, Math.abs(Math.round(rect.y1) - Math.round(rect.y0)));
  return width * height;
}

function describeBand(bands, index) {
  if (!Array.isArray(bands) || bands.length === 0) {
    return `Band ${index}`;
  }
  const value = bands[index];
  if (value === undefined || value === null) {
    return `Band ${index}`;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `${numeric.toFixed(1)} nm`;
  }
  return String(value);
}

const sectionStyle = {
  border: "1px solid #d0d0d0",
  borderRadius: 10,
  padding: 18,
  backgroundColor: "#fefefe",
  marginBottom: 20,
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.04)",
};

export default function SupervisedPanel({
  bands,
  rgb,
  idxs = [],
  onChange,
  cubeShape,
}) {
  const [classes, setClasses] = useState([]);
  const [regions, setRegions] = useState([]);
  const [activeClassId, setActiveClassId] = useState(null);
  const [newClassName, setNewClassName] = useState("");
  const [classification, setClassification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [annotationMessage, setAnnotationMessage] = useState("");
  const colorIndexRef = useRef(0);

  useEffect(() => {
    setClasses([]);
    setRegions([]);
    setActiveClassId(null);
    setClassification(null);
    setError("");
    setFormError("");
    colorIndexRef.current = 0;
    setAnnotationMessage("");
  }, [bands]);

  const classMap = useMemo(() => {
    const mapping = new Map();
    classes.forEach((cls) => {
      mapping.set(cls.id, cls);
    });
    return mapping;
  }, [classes]);

  const annotatedClasses = useMemo(() => {
    const classIds = new Set(regions.map((region) => region.classId));
    return classes.filter((cls) => classIds.has(cls.id));
  }, [classes, regions]);

  const regionCountByClass = useMemo(() => {
    const counts = new Map();
    regions.forEach((region) => {
      counts.set(region.classId, (counts.get(region.classId) || 0) + 1);
    });
    return counts;
  }, [regions]);

  const handleAddClass = (event) => {
    event.preventDefault();
    const trimmed = newClassName.trim();
    if (!trimmed) {
      setFormError("Enter a class name before adding it.");
      return;
    }
    const exists = classes.some(
      (cls) => cls.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setFormError(`A class named "${trimmed}" already exists.`);
      return;
    }
    const color = CLASS_COLORS[colorIndexRef.current % CLASS_COLORS.length];
    colorIndexRef.current += 1;
    const newClass = { id: createRegionId(), name: trimmed, color };
    setClasses((prev) => [...prev, newClass]);
    setActiveClassId(newClass.id);
    setNewClassName("");
    setFormError("");
  };

  const handleRemoveClass = (classId) => {
    setClasses((prev) => prev.filter((cls) => cls.id !== classId));
    setRegions((prev) => prev.filter((region) => region.classId !== classId));
    if (activeClassId === classId) {
      setActiveClassId(null);
    }
    setClassification(null);
  };

  const handleRegion = (rect) => {
    const selectedClass = classMap.get(activeClassId);
    if (!selectedClass) {
      setAnnotationMessage("Select a class before drawing a region.");
      return;
    }

    const region = {
      id: createRegionId(),
      classId: selectedClass.id,
      rect,
    };

    setRegions((prev) => [...prev, region]);
    setClassification(null);
    setError("");
    setAnnotationMessage("");
  };

  const handleRemoveRegion = (regionId) => {
    setRegions((prev) => prev.filter((region) => region.id !== regionId));
    setClassification(null);
  };

  const handleClearRegions = () => {
    setRegions([]);
    setClassification(null);
  };

  const handleBandChange = (index, value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const clamped = Math.max(0, Math.min(bands.length - 1, Math.round(numeric)));
    const next = [...idxs];
    next[index] = clamped;
    onChange(next);
  };

  const annotations = useMemo(
    () =>
      regions
        .map((region) => {
          const cls = classMap.get(region.classId);
          if (!cls) return null;
          return {
            label: cls.name,
            rect: region.rect,
            color: cls.color,
          };
        })
        .filter(Boolean),
    [regions, classMap],
  );

  const canClassify = annotations.length > 0 && annotatedClasses.length >= 2;

  const handleClassify = async () => {
    if (!canClassify || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await runSupervisedClassification({
        method: "sam",
        annotations,
      });
      setClassification(result);
    } catch (err) {
      setClassification(null);
      setError(err.message || "Failed to classify regions.");
    } finally {
      setLoading(false);
    }
  };

  const imageUrl = useMemo(() => {
    if (!rgb) return null;
    return `data:image/jpeg;base64,${hexToBase64(rgb)}`;
  }, [rgb]);

  const displayRegions = useMemo(
    () =>
      regions.map((region) => {
        const cls = classMap.get(region.classId);
        return {
          id: region.id,
          rect: region.rect,
          color: cls ? cls.color : "#ff3b30",
        };
      }),
    [regions, classMap],
  );

  const classificationImage = useMemo(() => {
    if (!classification?.map) return null;
    return `data:image/png;base64,${hexToBase64(classification.map)}`;
  }, [classification]);

  const trainingSeries = useMemo(() => {
    if (!classification?.classes) return [];
    return classification.classes.map((cls) => ({
      label: cls.label,
      color: cls.color,
      spectra: cls.training?.spectra || null,
    }));
  }, [classification]);

  const classifiedSeries = useMemo(() => {
    if (!classification?.classes) return [];
    return classification.classes.map((cls) => ({
      label: cls.label,
      color: cls.color,
      spectra: cls.classified?.spectra || null,
    }));
  }, [classification]);

  const totalPixels = useMemo(() => {
    if (classification?.total_pixels) return classification.total_pixels;
    if (Array.isArray(cubeShape) && cubeShape.length >= 2) {
      return cubeShape[0] * cubeShape[1];
    }
    return null;
  }, [classification, cubeShape]);

  const totalTrainingPixels = useMemo(() => {
    if (!classification?.classes) return null;
    return classification.classes.reduce(
      (acc, cls) => acc + (cls.training?.pixels || 0),
      0,
    );
  }, [classification]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 420px", minWidth: 360, maxWidth: 460 }}>
        <div style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>Annotate training regions</h3>
          <p style={{ color: "#555", marginBottom: 16 }}>
            Add labeled classes, select one, and drag on the image to capture
            representative spectral signatures. Each class should include at
            least one region before running classification.
          </p>

          <form
            onSubmit={handleAddClass}
            style={{ display: "flex", gap: 8, marginBottom: 12 }}
          >
            <input
              type="text"
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              placeholder="New class name"
              style={{ flex: "1 1 auto", padding: "6px 10px" }}
            />
            <button type="submit">Add class</button>
          </form>
          {formError && (
            <div style={{ color: "#b00020", marginBottom: 10 }}>{formError}</div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {classes.length === 0 && (
              <div style={{ color: "#777" }}>Create classes to begin annotating.</div>
            )}
            {classes.map((cls) => {
              const count = regionCountByClass.get(cls.id) || 0;
              const isActive = cls.id === activeClassId;
              return (
                <div
                  key={cls.id}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveClassId(cls.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: isActive ? "2px solid #005fb8" : "1px solid #ccc",
                      backgroundColor: isActive ? "#e8f4ff" : "#fff",
                      color: "#333",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        backgroundColor: cls.color,
                        display: "inline-block",
                      }}
                    />
                    <span>{cls.name}</span>
                    <span style={{ fontSize: 12, color: "#666" }}>({count})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveClass(cls.id)}
                    title={`Remove ${cls.name}`}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#999",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ marginBottom: 12 }}>
            <ViewerCanvas imageUrl={imageUrl} regions={displayRegions} onRegion={handleRegion} />
            {!imageUrl && (
              <div style={{ marginTop: 8, color: "#777" }}>
                Load a dataset and adjust the bands to annotate regions.
              </div>
            )}
            {annotationMessage && (
              <div style={{ marginTop: 8, color: "#b58900" }}>{annotationMessage}</div>
            )}
          </div>

          {regions.length > 0 && (
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={handleClearRegions}>
                Clear regions
              </button>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {["R", "G", "B"].map((channel, index) => (
              <div key={channel} style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 4 }}>
                  {channel}-band: {describeBand(bands, idxs[index] ?? index)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, bands.length - 1)}
                  value={idxs[index] || 0}
                  onChange={(event) => handleBandChange(index, event.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            ))}
          </div>
        </div>

        {regions.length > 0 && (
          <div style={sectionStyle}>
            <h4 style={{ marginTop: 0 }}>Annotated regions</h4>
            <div style={{ maxHeight: 220, overflow: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f1f1f1" }}>
                    <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                      Class
                    </th>
                    <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                      Width × Height
                    </th>
                    <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                      Pixels
                    </th>
                    <th style={{ padding: 6, border: "1px solid #ddd" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((region) => {
                    const cls = classMap.get(region.classId);
                    const pixels = calculatePixelCount(region.rect);
                    return (
                      <tr key={region.id}>
                        <td style={{ padding: 6, border: "1px solid #eee" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                backgroundColor: cls?.color || "#ff3b30",
                                display: "inline-block",
                              }}
                            />
                            {cls ? cls.name : "Removed class"}
                          </span>
                        </td>
                        <td style={{ padding: 6, border: "1px solid #eee" }}>
                          {Math.abs(Math.round(region.rect.x1 - region.rect.x0))} ×{" "}
                          {Math.abs(Math.round(region.rect.y1 - region.rect.y0))}
                        </td>
                        <td style={{ padding: 6, border: "1px solid #eee" }}>{pixels}</td>
                        <td style={{ padding: 6, border: "1px solid #eee", textAlign: "center" }}>
                          <button type="button" onClick={() => handleRemoveRegion(region.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: "1 1 520px", minWidth: 420 }}>
        <div style={sectionStyle}>
          <h3 style={{ marginTop: 0 }}>Spectral Angle Mapper classification</h3>
          <p style={{ color: "#555" }}>
            Run SAM to assign each pixel to the class with the most similar
            spectral angle. The resulting map and spectra summaries update once
            the classification finishes.
          </p>
          <button type="button" onClick={handleClassify} disabled={!canClassify || loading}>
            {loading ? "Classifying..." : "Run classification"}
          </button>
          {!canClassify && annotations.length > 0 && (
            <div style={{ color: "#b58900", marginTop: 8 }}>
              Annotate at least two classes before running the classifier.
            </div>
          )}
          {error && (
            <div style={{ color: "#b00020", marginTop: 10 }}>{error}</div>
          )}

          {classification && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {classificationImage && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      Classification map
                    </div>
                    <img
                      src={classificationImage}
                      alt="SAM classification map"
                      style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid #ddd",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 10,
                      }}
                    >
                      {classification.classes?.map((cls) => (
                        <div
                          key={cls.label}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 8px",
                            borderRadius: 14,
                            backgroundColor: "#f5f5f5",
                            border: "1px solid #e0e0e0",
                            fontSize: 13,
                          }}
                        >
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              backgroundColor: cls.color,
                              display: "inline-block",
                            }}
                          />
                          {cls.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Summary</div>
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 13,
                      }}
                    >
                      <thead>
                        <tr style={{ backgroundColor: "#f1f1f1" }}>
                          <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                            Class
                          </th>
                          <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                            Training pixels
                          </th>
                          <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                            Classified pixels
                          </th>
                          <th style={{ textAlign: "left", padding: 6, border: "1px solid #ddd" }}>
                            Classified share
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {classification.classes?.map((cls) => {
                          const classifiedPixels = cls.classified?.pixels || 0;
                          const share =
                            totalPixels && totalPixels > 0
                              ? ((classifiedPixels / totalPixels) * 100).toFixed(2)
                              : "-";
                          return (
                            <tr key={cls.label}>
                              <td style={{ padding: 6, border: "1px solid #eee" }}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: "50%",
                                      backgroundColor: cls.color,
                                      display: "inline-block",
                                    }}
                                  />
                                  {cls.label}
                                </span>
                              </td>
                              <td style={{ padding: 6, border: "1px solid #eee" }}>
                                {cls.training?.pixels ?? 0}
                              </td>
                              <td style={{ padding: 6, border: "1px solid #eee" }}>
                                {classifiedPixels}
                              </td>
                              <td style={{ padding: 6, border: "1px solid #eee" }}>
                                {share === "-" ? "-" : `${share}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {totalTrainingPixels !== null && totalTrainingPixels !== undefined && (
                    <div style={{ marginTop: 8, color: "#666" }}>
                      Annotated pixels: {totalTrainingPixels}
                      {totalPixels ? ` • Scene pixels: ${totalPixels}` : ""}
                    </div>
                  )}
                </div>

                <div>
                  <ClassSpectraPlot
                    title="Average spectra of annotated classes"
                    bands={classification.bands || bands}
                    series={trainingSeries}
                  />
                </div>
                <div>
                  <ClassSpectraPlot
                    title="Average spectra of classified pixels"
                    bands={classification.bands || bands}
                    series={classifiedSeries}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
