from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hsi_loader import load_hsi, extract_rgb
import numpy as np, cv2, tempfile, os
import math
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re

from fastapi import Request

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
CUBE = None
BANDS = None


def _normalize_to_uint8(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image, dtype=np.float32)
    if array.size == 0:
        return np.zeros_like(array, dtype=np.uint8)
    min_val = np.nanmin(array)
    max_val = np.nanmax(array)
    if not np.isfinite(min_val) or not np.isfinite(max_val) or max_val - min_val < 1e-9:
        return np.zeros_like(array, dtype=np.uint8)
    scaled = (array - min_val) / (max_val - min_val)
    scaled = np.clip(scaled * 255.0, 0, 255)
    return scaled.astype(np.uint8)


def _encode_grayscale_image(image: np.ndarray) -> str:
    scaled = _normalize_to_uint8(image)
    success, buf = cv2.imencode(".png", scaled)
    if not success:
        raise ValueError("Failed to encode grayscale image")
    return buf.tobytes().hex()


def _encode_rgb_image(image: np.ndarray) -> str:
    rgb = np.asarray(image, dtype=np.uint8)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Expected RGB image with 3 channels")
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    success, buf = cv2.imencode(".png", bgr)
    if not success:
        raise ValueError("Failed to encode RGB image")
    return buf.tobytes().hex()


def _compute_pca_components(cube: np.ndarray, n_components: int) -> List[dict]:
    height, width, channels = cube.shape
    pixels = cube.reshape(-1, channels).astype(np.float32)
    pixels -= pixels.mean(axis=0, keepdims=True)
    cov = np.cov(pixels, rowvar=False)
    eigvals, eigvecs = np.linalg.eigh(cov)
    order = np.argsort(eigvals)[::-1]
    eigvals = np.clip(eigvals[order], a_min=0.0, a_max=None)
    eigvecs = eigvecs[:, order]
    total_variance = float(np.sum(eigvals))
    if total_variance <= 0:
        total_variance = 1.0
    results: List[dict] = []
    max_components = min(n_components, eigvecs.shape[1])
    for comp_idx in range(max_components):
        vector = eigvecs[:, comp_idx]
        projection = pixels @ vector
        image = projection.reshape(height, width)
        encoded = _encode_grayscale_image(image)
        variance_ratio = float(eigvals[comp_idx] / total_variance)
        results.append(
            {
                "index": comp_idx,
                "variance": variance_ratio,
                "image": encoded,
            }
        )
    return results


def _generate_palette(n_clusters: int) -> np.ndarray:
    base_colors = np.array(
        [
            [255, 59, 48],
            [255, 149, 0],
            [255, 204, 0],
            [52, 199, 89],
            [0, 122, 255],
            [175, 82, 222],
            [90, 200, 250],
            [88, 86, 214],
            [255, 45, 85],
            [132, 204, 22],
        ],
        dtype=np.uint8,
    )
    if n_clusters <= len(base_colors):
        return base_colors[:n_clusters]
    colors = base_colors.tolist()
    rng = np.random.default_rng(42)
    while len(colors) < n_clusters:
        colors.append(rng.integers(0, 256, size=3).tolist())
    return np.array(colors, dtype=np.uint8)


def _compute_kmeans_segmentation(cube: np.ndarray, n_clusters: int):
    height, width, channels = cube.shape
    pixels = cube.reshape(-1, channels).astype(np.float32)
    total_pixels = pixels.shape[0]
    clusters = max(2, min(int(n_clusters), total_pixels))
    rng = np.random.default_rng(0)
    initial_indices = rng.choice(total_pixels, size=clusters, replace=False)
    centers = pixels[initial_indices]
    pixel_norm = np.sum(pixels * pixels, axis=1, keepdims=True)

    for _ in range(30):
        center_norm = np.sum(centers * centers, axis=1)
        distances = pixel_norm + center_norm - 2.0 * pixels @ centers.T
        labels = np.argmin(distances, axis=1)
        new_centers = np.zeros_like(centers)
        for idx in range(clusters):
            members = pixels[labels == idx]
            if members.size == 0:
                new_centers[idx] = pixels[rng.integers(0, total_pixels)]
            else:
                new_centers[idx] = members.mean(axis=0)
        if np.allclose(new_centers, centers, atol=1e-4):
            centers = new_centers
            break
        centers = new_centers

    center_norm = np.sum(centers * centers, axis=1)
    distances = pixel_norm + center_norm - 2.0 * pixels @ centers.T
    labels = np.argmin(distances, axis=1)
    label_image = labels.reshape(height, width)

    palette = _generate_palette(clusters)
    color_image = palette[label_image]
    encoded_map = _encode_rgb_image(color_image)

    summaries = []
    for idx in range(clusters):
        count = int(np.sum(labels == idx))
        percentage = float(count / total_pixels * 100.0) if total_pixels > 0 else 0.0
        centroid = centers[idx]
        mean_value = float(np.mean(centroid)) if centroid.size else 0.0
        peak_index = int(np.argmax(centroid)) if centroid.size else 0
        summary = {
            "cluster": idx,
            "count": count,
            "percentage": percentage,
            "mean": mean_value,
            "peak_band_index": peak_index,
        }
        if BANDS is not None and len(BANDS) > peak_index:
            try:
                summary["peak_wavelength"] = float(BANDS[peak_index])
            except (TypeError, ValueError):
                summary["peak_wavelength"] = None
        summaries.append(summary)

    return {
        "clusters": clusters,
        "map": encoded_map,
        "cluster_summaries": summaries,
        "colors": palette.tolist(),
    }


def _normalize_rect(
    rect: dict, width: int, height: int
) -> Tuple[int, int, int, int]:
    if rect is None:
        raise ValueError("Invalid region")
    try:
        x0 = float(rect["x0"])
        y0 = float(rect["y0"])
        x1 = float(rect["x1"])
        y1 = float(rect["y1"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Invalid region") from exc

    is_normalized = bool(rect.get("normalized"))
    coords = [x0, x1, y0, y1]
    if not is_normalized and all(0.0 <= c <= 1.0 for c in coords):
        is_normalized = True

    if is_normalized:
        x0 *= width
        x1 *= width
        y0 *= height
        y1 *= height

    x_start = math.floor(min(x0, x1))
    x_end = math.ceil(max(x0, x1))
    y_start = math.floor(min(y0, y1))
    y_end = math.ceil(max(y0, y1))

    x_start = max(0, min(width, x_start))
    x_end = max(0, min(width, x_end))
    y_start = max(0, min(height, y_start))
    y_end = max(0, min(height, y_end))

    if x_end <= x_start or y_end <= y_start:
        raise ValueError("Empty selection")

    return x_start, x_end, y_start, y_end


def _extract_pixels_from_rect(
    cube: np.ndarray, rect: dict
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    height, width = cube.shape[:2]
    x_start, x_end, y_start, y_end = _normalize_rect(rect, width, height)
    roi = cube[y_start:y_end, x_start:x_end, :]
    if roi.size == 0:
        raise ValueError("Empty selection")
    pixels = roi.reshape(-1, cube.shape[2]).astype(np.float32)
    return pixels, (x_start, x_end, y_start, y_end)


def _extract_pixels_from_shape(
    cube: np.ndarray, shape: dict
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    if not isinstance(shape, dict):
        raise ValueError("Invalid shape data")
    shape_type = str(shape.get("type", "rectangle")).lower()
    height, width = cube.shape[:2]
    if shape_type == "rectangle":
        rect = {
            "x0": shape.get("x0"),
            "x1": shape.get("x1"),
            "y0": shape.get("y0"),
            "y1": shape.get("y1"),
            "normalized": shape.get("normalized"),
        }
        return _extract_pixels_from_rect(cube, rect)
    if shape_type == "point":
        x = shape.get("x", shape.get("cx"))
        y = shape.get("y", shape.get("cy"))
        if x is None or y is None:
            raise ValueError("Invalid point coordinates")
        x_idx = int(round(float(x)))
        y_idx = int(round(float(y)))
        x_idx = max(0, min(width - 1, x_idx))
        y_idx = max(0, min(height - 1, y_idx))
        roi = cube[y_idx : y_idx + 1, x_idx : x_idx + 1, :]
        pixels = roi.reshape(-1, cube.shape[2]).astype(np.float32)
        return pixels, (x_idx, x_idx + 1, y_idx, y_idx + 1)
    if shape_type == "circle":
        cx = shape.get("cx")
        cy = shape.get("cy")
        radius = shape.get("radius")
        if None in (cx, cy, radius):
            raise ValueError("Invalid circle definition")
        cx = float(cx)
        cy = float(cy)
        radius = float(radius)
        if radius <= 0:
            raise ValueError("Circle radius must be positive")
        x_start = max(0, math.floor(cx - radius))
        x_end = min(width, math.ceil(cx + radius))
        y_start = max(0, math.floor(cy - radius))
        y_end = min(height, math.ceil(cy + radius))
        if x_end <= x_start or y_end <= y_start:
            raise ValueError("Empty selection")
        yy = np.arange(y_start, y_end)[:, None]
        xx = np.arange(x_start, x_end)[None, :]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius ** 2
        roi = cube[y_start:y_end, x_start:x_end, :]
        pixels = roi[mask]
        if pixels.size == 0:
            raise ValueError("Empty selection")
        return pixels.reshape(-1, cube.shape[2]).astype(np.float32), (x_start, x_end, y_start, y_end)
    if shape_type == "polygon":
        points = shape.get("points")
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError("Polygon requires at least three points")
        coords = []
        for point in points:
            if isinstance(point, dict):
                px = point.get("x")
                py = point.get("y")
            else:
                px, py = point
            if px is None or py is None:
                continue
            coords.append([float(px), float(py)])
        if len(coords) < 3:
            raise ValueError("Polygon requires at least three valid points")
        arr = np.array(coords, dtype=np.float32)
        x_start = max(0, math.floor(float(np.min(arr[:, 0]))))
        x_end = min(width, math.ceil(float(np.max(arr[:, 0]))))
        y_start = max(0, math.floor(float(np.min(arr[:, 1]))))
        y_end = min(height, math.ceil(float(np.max(arr[:, 1]))))
        if x_end <= x_start or y_end <= y_start:
            raise ValueError("Empty selection")
        local = arr.copy()
        local[:, 0] -= x_start
        local[:, 1] -= y_start
        local = np.round(local).astype(np.int32)
        mask = np.zeros((y_end - y_start, x_end - x_start), dtype=np.uint8)
        cv2.fillPoly(mask, [local], 1)
        roi = cube[y_start:y_end, x_start:x_end, :]
        pixels = roi[mask.astype(bool)]
        if pixels.size == 0:
            raise ValueError("Empty selection")
        return pixels.reshape(-1, cube.shape[2]).astype(np.float32), (x_start, x_end, y_start, y_end)
    raise ValueError(f"Unsupported shape type: {shape_type}")


def _extract_region_pixels(
    cube: np.ndarray, region: dict
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    if isinstance(region, dict):
        shape = region.get("shape")
        rect = region.get("rect")
        if shape:
            return _extract_pixels_from_shape(cube, shape)
        if rect:
            return _extract_pixels_from_rect(cube, rect)
    return _extract_pixels_from_rect(cube, region)


def _parse_hex_color(color_value: Optional[str]) -> Optional[Tuple[int, int, int]]:
    if not color_value or not isinstance(color_value, str):
        return None
    text = color_value.strip()
    if text.startswith("#"):
        text = text[1:]
    if not re.fullmatch(r"[0-9a-fA-F]{6}", text):
        return None
    try:
        r = int(text[0:2], 16)
        g = int(text[2:4], 16)
        b = int(text[4:6], 16)
    except ValueError:
        return None
    return int(r), int(g), int(b)


def _rgb_tuple_to_hex(rgb: Tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{r:02x}{g:02x}{b:02x}"


def _classify_with_sam(cube: np.ndarray, annotations: List[dict]):
    if not annotations:
        raise ValueError("Provide at least one annotated region.")

    class_samples: Dict[str, Dict[str, object]] = {}
    class_colors: Dict[str, Tuple[int, int, int]] = {}

    for annotation in annotations:
        label = str(annotation.get("label", "")).strip()
        if not label:
            raise ValueError("Every annotation must include a label.")
        if annotation.get("rect") is None and annotation.get("shape") is None:
            raise ValueError("Annotation is missing region coordinates.")

        color = _parse_hex_color(annotation.get("color"))
        if color and label not in class_colors:
            class_colors[label] = color

        pixels, _ = _extract_region_pixels(cube, annotation)
        if pixels.size == 0:
            continue

        entry = class_samples.setdefault(label, {"pixels": [], "count": 0})
        entry["pixels"].append(pixels)
        entry["count"] = int(entry["count"]) + int(pixels.shape[0])

    if len(class_samples) < 2:
        raise ValueError("Annotate at least two distinct classes to run classification.")

    class_labels = list(class_samples.keys())
    class_vectors = []
    training_means: Dict[str, np.ndarray] = {}
    training_stds: Dict[str, np.ndarray] = {}

    for label in class_labels:
        entry = class_samples[label]
        pixels_list = entry.get("pixels", [])
        if not pixels_list:
            raise ValueError(f"No pixels found for class '{label}'.")
        combined = np.concatenate(pixels_list, axis=0)
        if combined.size == 0:
            raise ValueError(f"Annotation for class '{label}' is empty.")
        combined = np.nan_to_num(combined, nan=0.0, posinf=0.0, neginf=0.0)
        mean_vector = combined.mean(axis=0)
        std_vector = np.nan_to_num(combined.std(axis=0), nan=0.0, posinf=0.0, neginf=0.0)
        norm = np.linalg.norm(mean_vector)
        if not np.isfinite(norm) or norm <= 1e-12:
            raise ValueError(
                f"Training samples for class '{label}' lack spectral variation."
            )
        class_vectors.append(mean_vector)
        training_means[label] = mean_vector
        training_stds[label] = std_vector

    class_matrix = np.vstack(class_vectors).astype(np.float32)
    class_matrix = np.nan_to_num(class_matrix, nan=0.0, posinf=0.0, neginf=0.0)

    height, width, channels = cube.shape
    total_pixels = height * width
    pixel_matrix = cube.reshape(-1, channels).astype(np.float32)
    pixel_matrix = np.nan_to_num(pixel_matrix, nan=0.0, posinf=0.0, neginf=0.0)

    pixel_norm = np.linalg.norm(pixel_matrix, axis=1, keepdims=True)
    class_norm = np.linalg.norm(class_matrix, axis=1, keepdims=True)

    with np.errstate(divide="ignore", invalid="ignore"):
        denom = pixel_norm * class_norm.T
        cos_theta = np.divide(pixel_matrix @ class_matrix.T, denom, where=denom > 0)
    cos_theta = np.clip(cos_theta, -1.0, 1.0, out=np.zeros_like(cos_theta))
    angles = np.arccos(cos_theta)
    labels = np.argmin(angles, axis=1)
    label_image = labels.reshape(height, width)

    palette = _generate_palette(len(class_labels))
    color_list = []
    for idx, label in enumerate(class_labels):
        color = class_colors.get(label)
        if color is None:
            palette_color = palette[idx].tolist()
            color = (int(palette_color[0]), int(palette_color[1]), int(palette_color[2]))
        color_list.append(color)

    color_array = np.array(color_list, dtype=np.uint8)
    color_image = color_array[label_image]
    encoded_map = _encode_rgb_image(color_image)

    summaries = []
    for idx, label in enumerate(class_labels):
        mask = labels == idx
        classified_count = int(mask.sum())
        classified_mean = None
        classified_std = None
        if classified_count > 0:
            classified_pixels = pixel_matrix[mask]
            classified_mean = classified_pixels.mean(axis=0)
            classified_mean = np.nan_to_num(classified_mean, nan=0.0).tolist()
            std_vector = np.nan_to_num(classified_pixels.std(axis=0), nan=0.0)
            classified_std = std_vector.tolist()

        summaries.append(
            {
                "label": label,
                "color": _rgb_tuple_to_hex(tuple(color_list[idx])),
                "training": {
                    "pixels": int(class_samples[label]["count"]),
                    "spectra": training_means[label].tolist(),
                    "std": training_stds[label].tolist(),
                },
                "classified": {
                    "pixels": classified_count,
                    "spectra": classified_mean,
                    "std": classified_std,
                },
            }
        )

    return {
        "method": "sam",
        "map": encoded_map,
        "classes": summaries,
        "bands": BANDS,
        "total_pixels": total_pixels,
    }

@app.post("/load")
async def load_dataset(
    folder_path: Optional[str] = Form(None),
    files: Optional[List[UploadFile]] = File(None),
):
    global CUBE, BANDS

    temp_dir = None
    load_target = None

    try:
        if files:
            temp_dir = tempfile.mkdtemp(prefix="hsi_upload_")
            for upload in files:
                filename = upload.filename or "uploaded_file"
                dest_path = Path(temp_dir) / filename
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                contents = await upload.read()
                with open(dest_path, "wb") as out_file:
                    out_file.write(contents)
                await upload.close()
            load_target = temp_dir
        elif folder_path:
            if not os.path.exists(folder_path):
                return JSONResponse(
                    {"error": f"Path not found: {folder_path}"}, status_code=400
                )
            load_target = folder_path
        else:
            return JSONResponse(
                {"error": "No dataset provided. Select a folder or upload files."},
                status_code=400,
            )

        CUBE, BANDS, metadata_warning = load_hsi(load_target)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to load dataset: {exc}"}, status_code=500)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

    response = {"bands": BANDS, "shape": CUBE.shape}
    if metadata_warning:
        response["warning"] = metadata_warning
    return response

@app.get("/rgb")
def get_rgb(r: int = 10, g: int = 20, b: int = 30):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)
    rgb = extract_rgb(CUBE, [r, g, b])
    _, buf = cv2.imencode(".jpg", rgb)
    return {"image": buf.tobytes().hex()}


@app.post("/spectra")
async def get_spectra(req: Request):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)
    data = await req.json()
    region = {"rect": data.get("rect"), "shape": data.get("shape")}
    if region["rect"] is None and region["shape"] is None:
        return JSONResponse({"error": "No region"}, status_code=400)

    try:
        pixels, _ = _extract_region_pixels(CUBE, region)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    if pixels.size == 0:
        return JSONResponse({"error": "Empty selection"}, status_code=400)

    pixels = np.nan_to_num(pixels, nan=0.0, posinf=0.0, neginf=0.0)
    mean_spec = pixels.mean(axis=0).tolist()
    std_spec = np.nan_to_num(pixels.std(axis=0), nan=0.0, posinf=0.0, neginf=0.0).tolist()
    return {"spectra": mean_spec, "stddev": std_spec, "bands": BANDS}


@app.post("/analysis")
async def run_analysis(req: Request):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)

    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    method = str(payload.get("method", "")).strip().lower()

    if method == "pca":
        components = payload.get("components", 3)
        try:
            components = int(components)
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid number of components"}, status_code=400)
        components = max(1, min(components, 10))
        try:
            result = _compute_pca_components(CUBE, components)
        except Exception as exc:
            return JSONResponse(
                {"error": f"Failed to compute PCA components: {exc}"},
                status_code=500,
            )
        return {"method": "pca", "components": result}

    if method == "kmeans":
        clusters = payload.get("clusters", 5)
        try:
            clusters = int(clusters)
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid cluster count"}, status_code=400)
        clusters = max(2, min(clusters, 20))
        try:
            result = _compute_kmeans_segmentation(CUBE, clusters)
        except Exception as exc:
            return JSONResponse(
                {"error": f"Failed to compute k-means clustering: {exc}"},
                status_code=500,
            )
        return {"method": "kmeans", **result}

    return JSONResponse(
        {"error": f"Unsupported analysis method: {method or 'unknown'}"},
        status_code=400,
    )


@app.post("/supervised")
async def run_supervised(req: Request):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)

    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    method = str(payload.get("method", "sam")).strip().lower() or "sam"
    annotations = payload.get("annotations")
    if not isinstance(annotations, list) or not annotations:
        return JSONResponse(
            {"error": "Provide at least one annotated region."}, status_code=400
        )

    if method not in {"sam", "spectral-angle", "spectral_angle_mapper"}:
        return JSONResponse(
            {"error": f"Unsupported supervised method: {method}"}, status_code=400
        )

    try:
        result = _classify_with_sam(CUBE, annotations)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse(
            {"error": f"Failed to run supervised classification: {exc}"},
            status_code=500,
        )

    return result
