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
    <div className="supervised-layout">
      <div className="supervised-column">
        <section className="card supervised-section">
          <h3 className="card__title">Annotate training regions</h3>
          <p className="card__subtitle">
            Add labeled classes, select one, and drag on the image to capture representative
            spectral signatures. Each class should include at least one region before running
            classification.
          </p>

          <form onSubmit={handleAddClass} className="class-form">
            <input
              type="text"
              value={newClassName}
              onChange={(event) => setNewClassName(event.target.value)}
              placeholder="New class name"
              className="field-input"
            />
            <button type="submit" className="btn btn-primary">
              Add class
            </button>
          </form>
          {formError && <div className="form-error">{formError}</div>}

          <div className="class-chips">
            {classes.length === 0 && (
              <div className="muted-text">Create classes to begin annotating.</div>
            )}
            {classes.map((cls) => {
              const count = regionCountByClass.get(cls.id) || 0;
              const isActive = cls.id === activeClassId;
              return (
                <div key={cls.id} className="class-chip">
                  <button
                    type="button"
                    className={`class-chip__button${isActive ? " is-active" : ""}`}
                    onClick={() => setActiveClassId(cls.id)}
                  >
                    <span className="class-chip__swatch" style={{ backgroundColor: cls.color }} />
                    <span>{cls.name}</span>
                    <span className="class-chip__count">({count})</span>
                  </button>
                  <button
                    type="button"
                    className="class-chip__remove"
                    onClick={() => handleRemoveClass(cls.id)}
                    title={`Remove ${cls.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div className="viewer-wrapper">
            <ViewerCanvas imageUrl={imageUrl} regions={displayRegions} onRegion={handleRegion} />
            {!imageUrl && (
              <div className="muted-text">
                Load a dataset and adjust the bands to annotate regions.
              </div>
            )}
            {annotationMessage && <div className="notice notice--warning">{annotationMessage}</div>}
          </div>

          {regions.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={handleClearRegions}>
              Clear regions
            </button>
          )}

          <div className="band-sliders">
            {["R", "G", "B"].map((channel, index) => (
              <div key={channel} className="band-sliders__item">
                <label className="band-sliders__label">
                  {channel}-band <span>{describeBand(bands, idxs[index] ?? index)}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, bands.length - 1)}
                  value={idxs[index] || 0}
                  onChange={(event) => handleBandChange(index, event.target.value)}
                  className="band-slider"
                />
              </div>
            ))}
          </div>
        </section>

        {regions.length > 0 && (
          <section className="card supervised-section">
            <h4 className="card__title">Annotated regions</h4>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Width × Height</th>
                    <th>Pixels</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((region) => {
                    const cls = classMap.get(region.classId);
                    const pixels = calculatePixelCount(region.rect);
                    return (
                      <tr key={region.id}>
                        <td>
                          <span className="table-chip">
                            <span
                              className="table-chip__swatch"
                              style={{ backgroundColor: cls?.color || "#ff3b30" }}
                            />
                            {cls ? cls.name : "Removed class"}
                          </span>
                        </td>
                        <td>
                          {Math.abs(Math.round(region.rect.x1 - region.rect.x0))} × {Math.abs(
                            Math.round(region.rect.y1 - region.rect.y0),
                          )}
                        </td>
                        <td>{pixels}</td>
                        <td className="data-table__actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => handleRemoveRegion(region.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <div className="supervised-column">
        <section className="card supervised-section">
          <h3 className="card__title">Spectral Angle Mapper classification</h3>
          <p className="card__subtitle">
            Run SAM to assign each pixel to the class with the most similar spectral angle. The
            resulting map and spectra summaries update once the classification finishes.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleClassify}
            disabled={!canClassify || loading}
          >
            {loading ? "Classifying…" : "Run classification"}
          </button>
          {!canClassify && annotations.length > 0 && (
            <div className="notice notice--warning">
              Annotate at least two classes before running the classifier.
            </div>
          )}
          {error && <div className="form-error">{error}</div>}

          {classification && (
            <div className="classification-results">
              {classificationImage && (
                <div className="classification-map">
                  <div className="classification-map__header">
                    <span>Classification map</span>
                    {classification.classes?.length > 0 && (
                      <div className="legend-chips">
                        {classification.classes.map((cls) => (
                          <span key={cls.label} className="legend-chip">
                            <span
                              className="legend-chip__swatch"
                              style={{ backgroundColor: cls.color }}
                            />
                            {cls.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <img src={classificationImage} alt="SAM classification map" />
                </div>
              )}

              <div className="classification-summary">
                <div className="classification-summary__title">Summary</div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Training pixels</th>
                        <th>Classified pixels</th>
                        <th>Classified share</th>
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
                            <td>
                              <span className="table-chip">
                                <span
                                  className="table-chip__swatch"
                                  style={{ backgroundColor: cls.color }}
                                />
                                {cls.label}
                              </span>
                            </td>
                            <td>{cls.training?.pixels ?? 0}</td>
                            <td>{classifiedPixels}</td>
                            <td>{share === "-" ? "-" : `${share}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalTrainingPixels !== null && totalTrainingPixels !== undefined && (
                  <div className="muted-text">
                    Annotated pixels: {totalTrainingPixels}
                    {totalPixels ? ` • Scene pixels: ${totalPixels}` : ""}
                  </div>
                )}
              </div>

              <ClassSpectraPlot
                title="Average spectra of annotated classes"
                bands={classification.bands || bands}
                series={trainingSeries}
              />
              <ClassSpectraPlot
                title="Average spectra of classified pixels"
                bands={classification.bands || bands}
                series={classifiedSeries}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
