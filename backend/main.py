from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hsi_loader import load_hsi, extract_rgb
import numpy as np, cv2, tempfile, os
import math
import shutil
from pathlib import Path
from typing import List, Optional

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
    rect = data.get("rect")
    if rect is None:
        return JSONResponse({"error": "No region"}, status_code=400)

    try:
        x0 = float(rect["x0"])
        y0 = float(rect["y0"])
        x1 = float(rect["x1"])
        y1 = float(rect["y1"])
    except (KeyError, TypeError, ValueError):
        return JSONResponse({"error": "Invalid region"}, status_code=400)

    height, width = CUBE.shape[:2]
    is_normalized = bool(rect.get("normalized"))
    if not is_normalized:
        # auto-detect normalized coordinates if values are within [0, 1]
        coords = [x0, x1, y0, y1]
        if all(0 <= c <= 1 for c in coords):
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
        return JSONResponse({"error": "Empty selection"}, status_code=400)

    roi = CUBE[y_start:y_end, x_start:x_end, :]
    if roi.size == 0:
        return JSONResponse({"error": "Empty selection"}, status_code=400)

    mean_spec = roi.mean(axis=(0, 1)).tolist()
    return {"spectra": mean_spec, "bands": BANDS}


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
