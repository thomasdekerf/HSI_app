from fastapi import FastAPI, Form, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hsi_loader import load_hsi, extract_rgb
import numpy as np, cv2, tempfile, os
import math
import shutil
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re
from scipy.signal import savgol_filter
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

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


def _roi_file_path(folder_path: str, data_hdr_name: Optional[str]) -> Path:
    if not folder_path:
        raise ValueError("Missing measurement folder path.")
    if not data_hdr_name:
        raise ValueError("Missing measurement header name.")
    hdr_name = Path(data_hdr_name).name
    stem = Path(hdr_name).stem
    return Path(folder_path) / f"{stem}.roi.json"


def _annotations_file_path(folder_path: str, data_hdr_name: Optional[str]) -> Path:
    if not folder_path:
        raise ValueError("Missing measurement folder path.")
    if not data_hdr_name:
        raise ValueError("Missing measurement header name.")
    hdr_name = Path(data_hdr_name).name
    stem = Path(hdr_name).stem
    return Path(folder_path) / f"{stem}.annotations.json"


def _load_saved_roi(folder_path: Optional[str], data_hdr_name: Optional[str]) -> Optional[dict]:
    if not folder_path or not data_hdr_name:
        return None
    roi_path = _roi_file_path(folder_path, data_hdr_name)
    if not roi_path.exists():
        return None
    try:
        with open(roi_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return None
    roi_shape = payload.get("shape")
    return roi_shape if isinstance(roi_shape, dict) else None


def _shape_to_labelme_points(shape: dict) -> List[List[float]]:
    shape_type = str(shape.get("type", "rectangle")).lower()
    if shape_type == "rectangle":
        return [
            [float(shape.get("x0", 0)), float(shape.get("y0", 0))],
            [float(shape.get("x1", 0)), float(shape.get("y1", 0))],
        ]
    if shape_type == "point":
        return [[float(shape.get("x", shape.get("cx", 0))), float(shape.get("y", shape.get("cy", 0)))]]
    if shape_type == "circle":
        cx = float(shape.get("cx", 0))
        cy = float(shape.get("cy", 0))
        radius = float(shape.get("radius", 0))
        return [[cx, cy], [cx + radius, cy]]
    if shape_type == "polygon":
        points = shape.get("points") or []
        normalized = []
        for point in points:
            if isinstance(point, dict):
                normalized.append([float(point.get("x", 0)), float(point.get("y", 0))])
            else:
                normalized.append([float(point[0]), float(point[1])])
        return normalized
    raise ValueError(f"Unsupported shape type: {shape_type}")


def _shape_from_labelme(shape_payload: dict) -> dict:
    shape_type = str(shape_payload.get("shape_type", "polygon")).lower()
    points = shape_payload.get("points") or []
    if shape_type == "rectangle" and len(points) >= 2:
        return {
            "type": "rectangle",
            "x0": float(points[0][0]),
            "y0": float(points[0][1]),
            "x1": float(points[1][0]),
            "y1": float(points[1][1]),
        }
    if shape_type == "point" and points:
        return {
            "type": "point",
            "x": float(points[0][0]),
            "y": float(points[0][1]),
        }
    if shape_type == "circle" and len(points) >= 2:
        cx = float(points[0][0])
        cy = float(points[0][1])
        px = float(points[1][0])
        py = float(points[1][1])
        radius = math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
        return {"type": "circle", "cx": cx, "cy": cy, "radius": radius}
    if shape_type == "polygon" and len(points) >= 3:
        return {
            "type": "polygon",
            "points": [{"x": float(point[0]), "y": float(point[1])} for point in points],
        }
    raise ValueError(f"Unsupported or invalid saved shape type: {shape_type}")


def _selection_to_label_shape(selection: dict) -> dict:
    shape = selection.get("shape") or selection.get("rect")
    if not isinstance(shape, dict):
        raise ValueError("Each annotation must include a shape.")
    shape_type = str(shape.get("type", "rectangle")).lower()
    return {
        "label": str(selection.get("label", "")).strip() or "Region",
        "points": _shape_to_labelme_points(shape),
        "group_id": None,
        "shape_type": shape_type,
        "flags": {},
        "codex_id": selection.get("id"),
        "codex_color": selection.get("color"),
        "codex_line_style": selection.get("lineStyle"),
    }


def _compute_selection_summary(cube: np.ndarray, selection: dict) -> dict:
    pixels, bounds = _extract_region_pixels(cube, selection)
    if pixels.size == 0:
        raise ValueError("Empty selection")
    pixels = np.nan_to_num(pixels, nan=0.0, posinf=0.0, neginf=0.0)
    x_start, x_end, y_start, y_end = bounds
    return {
        "bounds": {"x0": x_start, "x1": x_end, "y0": y_start, "y1": y_end},
        "spectra": pixels.mean(axis=0).tolist(),
        "stddev": np.nan_to_num(pixels.std(axis=0), nan=0.0, posinf=0.0, neginf=0.0).tolist(),
    }


def _load_saved_annotations(folder_path: Optional[str], data_hdr_name: Optional[str], cube: Optional[np.ndarray]) -> List[dict]:
    if not folder_path or not data_hdr_name or cube is None:
        return []
    annotations_path = _annotations_file_path(folder_path, data_hdr_name)
    if not annotations_path.exists():
        return []
    try:
        with open(annotations_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return []

    shapes = payload.get("shapes")
    if not isinstance(shapes, list):
        return []

    loaded = []
    for index, shape_payload in enumerate(shapes):
        try:
            shape = _shape_from_labelme(shape_payload)
            selection = {
                "id": shape_payload.get("codex_id") or f"saved-{index}",
                "label": str(shape_payload.get("label", "")).strip() or f"Region {index + 1}",
                "color": shape_payload.get("codex_color"),
                "lineStyle": shape_payload.get("codex_line_style"),
                "shape": shape,
            }
            summary = _compute_selection_summary(cube, selection)
            loaded.append({**selection, **summary})
        except Exception:
            continue
    return loaded


def _iter_measurement_hdrs(folder: Path) -> List[Path]:
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"Path not found: {folder}")
    hdrs = []
    for file_path in folder.rglob("*"):
        if not file_path.is_file() or file_path.suffix.lower() != ".hdr":
            continue
        lower_name = file_path.name.lower()
        stem = file_path.stem.strip()
        if not stem or file_path.name.startswith("."):
            continue
        if "darkref" in lower_name or "whiteref" in lower_name:
            continue
        hdrs.append(file_path)
    return sorted(hdrs, key=lambda item: item.name.lower())


def _normalize_to_uint8(image: np.ndarray) -> np.ndarray:
    array = np.asarray(image, dtype=np.float32)
    if array.size == 0:
        return np.zeros_like(array, dtype=np.uint8)
    finite_mask = np.isfinite(array)
    if not np.any(finite_mask):
        return np.zeros_like(array, dtype=np.uint8)
    min_val = np.nanmin(array[finite_mask])
    max_val = np.nanmax(array[finite_mask])
    if not np.isfinite(min_val) or not np.isfinite(max_val) or max_val - min_val < 1e-9:
        return np.zeros_like(array, dtype=np.uint8)
    scaled = (array - min_val) / (max_val - min_val)
    scaled[~finite_mask] = 0.0
    scaled = np.clip(scaled * 255.0, 0, 255)
    return scaled.astype(np.uint8)


def _encode_grayscale_image(image: np.ndarray, valid_mask: Optional[np.ndarray] = None) -> str:
    array = np.asarray(image, dtype=np.float32)
    if valid_mask is not None:
        array = np.where(valid_mask, array, np.nan)
    scaled = _normalize_to_uint8(array)
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


def _normalize_scalar_map(
    image: np.ndarray, valid_mask: Optional[np.ndarray] = None
) -> np.ndarray:
    array = np.asarray(image, dtype=np.float32)
    if array.size == 0:
        return np.zeros_like(array, dtype=np.float32)
    finite_mask = np.isfinite(array)
    if valid_mask is not None:
        finite_mask &= valid_mask.astype(bool)
    if not np.any(finite_mask):
        return np.zeros_like(array, dtype=np.float32)
    finite_values = array[finite_mask]
    min_val = float(np.min(finite_values))
    max_val = float(np.max(finite_values))
    if max_val - min_val < 1e-9:
        return np.zeros_like(array, dtype=np.float32)
    normalized = (array - min_val) / (max_val - min_val)
    normalized[~finite_mask] = 0.0
    if valid_mask is not None:
        normalized[~valid_mask.astype(bool)] = 0.0
    return np.clip(normalized, 0.0, 1.0)


def _encode_colormap_image(
    image: np.ndarray, colormap: int, valid_mask: Optional[np.ndarray] = None
) -> str:
    normalized = (_normalize_scalar_map(image, valid_mask=valid_mask) * 255.0).astype(np.uint8)
    colored = cv2.applyColorMap(normalized, colormap)
    rgb = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
    if valid_mask is not None:
        rgb[~valid_mask.astype(bool)] = 0
    return _encode_rgb_image(rgb)


def _robust_limits(image: np.ndarray, percentiles=(1, 99)):
    values = image[np.isfinite(image)]
    if values.size == 0:
        return 0.0, 1.0
    return np.percentile(values, percentiles)


def _percentile_stretch(
    image: np.ndarray,
    p_lo=1,
    p_hi=99,
    eps=1e-8,
    valid_mask: Optional[np.ndarray] = None,
):
    finite_mask = np.isfinite(image)
    if valid_mask is not None:
        finite_mask &= valid_mask.astype(bool)
    values = image[finite_mask]
    if values.size == 0:
        return np.zeros_like(image, dtype=np.float32)
    lo, hi = np.percentile(values, [p_lo, p_hi])
    stretched = (image - lo) / (hi - lo + eps)
    stretched = np.clip(stretched, 0.0, 1.0).astype(np.float32)
    stretched[~finite_mask] = 0.0
    if valid_mask is not None:
        stretched[~valid_mask.astype(bool)] = 0.0
    return stretched


def _normalize_global(cube: np.ndarray):
    cube = cube.astype(np.float32)
    mn = np.nanmin(cube)
    mx = np.nanmax(cube)
    return (cube - mn) / (mx - mn + 1e-8)


def _l2norm_rows(array: np.ndarray, eps=1e-12):
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    return array / (norms + eps)


def _run_pca(
    cube: np.ndarray,
    n_components=3,
    standardize=False,
    roi_mask: Optional[np.ndarray] = None,
):
    height, width, bands = cube.shape
    pixels = cube.reshape(-1, bands)
    finite = np.all(np.isfinite(pixels), axis=1)
    if roi_mask is not None:
        finite &= roi_mask.reshape(-1).astype(bool)
    x_fit = pixels[finite]
    if x_fit.size == 0:
        raise ValueError("ROI does not contain any valid pixels.")
    mean = x_fit.mean(axis=0)
    centered = x_fit - mean
    scale = None
    if standardize:
        scale = centered.std(axis=0, ddof=1)
        scale[scale == 0] = 1
        centered = centered / scale
    pca = PCA(n_components=n_components, svd_solver="randomized", random_state=0)
    pca.fit(centered)
    x_all = pixels - mean
    if standardize and scale is not None:
        x_all = x_all / scale
    scores = np.full((height * width, n_components), np.nan, dtype=np.float32)
    scores[finite] = pca.transform(x_all[finite]).astype(np.float32)
    return scores.reshape(height, width, n_components), pca


def _pca_to_frgb(
    scores_img: np.ndarray,
    p_lo=1,
    p_hi=99,
    gamma=1.2,
    roi_mask: Optional[np.ndarray] = None,
):
    rgb = np.stack(
        [
            _percentile_stretch(scores_img[..., 0], p_lo, p_hi, valid_mask=roi_mask),
            _percentile_stretch(scores_img[..., 1], p_lo, p_hi, valid_mask=roi_mask),
            _percentile_stretch(scores_img[..., 2], p_lo, p_hi, valid_mask=roi_mask),
        ],
        axis=-1,
    )
    return np.clip(rgb, 0.0, 1.0) ** (1.0 / gamma)


def _find_endmembers_kmeans(
    cube: np.ndarray,
    k=6,
    sample_px=20000,
    random_state=0,
    roi_mask: Optional[np.ndarray] = None,
):
    _, _, bands = cube.shape
    pixels = cube.reshape(-1, bands)
    finite = np.all(np.isfinite(pixels), axis=1)
    if roi_mask is not None:
        finite &= roi_mask.reshape(-1).astype(bool)
    pixels = pixels[finite]
    if pixels.size == 0:
        raise ValueError("ROI does not contain any valid pixels.")
    if pixels.shape[0] > sample_px:
        rng = np.random.default_rng(random_state)
        indices = rng.choice(pixels.shape[0], sample_px, replace=False)
        sample = pixels[indices]
    else:
        sample = pixels
    sample = _l2norm_rows(sample)
    km = KMeans(n_clusters=k, n_init=10, random_state=random_state)
    km.fit(sample)
    return km.cluster_centers_


def _sam_distance_cube(
    cube: np.ndarray, endmembers: np.ndarray, roi_mask: Optional[np.ndarray] = None
):
    height, width, bands = cube.shape
    pixels = cube.reshape(-1, bands)
    if roi_mask is not None:
        roi_flat = roi_mask.reshape(-1).astype(bool)
        pixels = np.where(roi_flat[:, None], pixels, np.nan)
    x_norm = _l2norm_rows(pixels)
    e_norm = _l2norm_rows(np.asarray(endmembers))
    dots = np.clip(x_norm @ e_norm.T, -1.0, 1.0)
    sam = np.arccos(dots)
    return sam.reshape(height, width, e_norm.shape[0])


def _sam_rgb_from_maps(
    sam_maps: np.ndarray,
    rgb_indices=(0, 1, 2),
    p_lo=1,
    p_hi=99,
    roi_mask: Optional[np.ndarray] = None,
):
    r, g, b = rgb_indices
    return np.stack(
        [
            _percentile_stretch(sam_maps[..., r], p_lo, p_hi, valid_mask=roi_mask),
            _percentile_stretch(sam_maps[..., g], p_lo, p_hi, valid_mask=roi_mask),
            _percentile_stretch(sam_maps[..., b], p_lo, p_hi, valid_mask=roi_mask),
        ],
        axis=-1,
    )


def _hard_class_from_sam(sam_maps: np.ndarray):
    return np.nanargmin(sam_maps, axis=2)


def _soft_abundance_from_sam(sam_maps: np.ndarray, tau=0.08, eps=1e-12):
    logits = -sam_maps / max(tau, eps)
    logits = logits - np.nanmax(logits, axis=2, keepdims=True)
    expv = np.exp(logits)
    return expv / (np.nansum(expv, axis=2, keepdims=True) + eps)


def _abundance_rgb_from_abund(abundance: np.ndarray, em_indices=(0, 1, 2)):
    r, g, b = em_indices
    rgb = np.stack([abundance[..., r], abundance[..., g], abundance[..., b]], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def _ambiguity_margin_from_sam(sam_maps: np.ndarray):
    sorted_maps = np.sort(sam_maps, axis=2)
    return sorted_maps[..., 1] - sorted_maps[..., 0]


def _compute_ratio_rgb(cube: np.ndarray, roi_mask: Optional[np.ndarray] = None):
    bands = cube.shape[2]
    idx_triplets = (
        (max(0, min(bands - 1, 50)), max(0, min(bands - 1, 30))),
        (max(0, min(bands - 1, 80)), max(0, min(bands - 1, 50))),
        (max(0, min(bands - 1, bands - 1)), max(0, min(bands - 1, 80))),
    )
    (a1, b1), (a2, b2), (a3, b3) = idx_triplets
    r1 = cube[..., a1] / (cube[..., b1] + 1e-8)
    r2 = cube[..., a2] / (cube[..., b2] + 1e-8)
    r3 = cube[..., a3] / (cube[..., b3] + 1e-8)
    return np.stack(
        [
            _percentile_stretch(r1, valid_mask=roi_mask),
            _percentile_stretch(r2, valid_mask=roi_mask),
            _percentile_stretch(r3, valid_mask=roi_mask),
        ],
        axis=-1,
    )


def _compute_entropy(cube: np.ndarray):
    spec = cube / (np.sum(cube, axis=2, keepdims=True) + 1e-8)
    return -np.sum(spec * np.log(spec + 1e-8), axis=2)


def _compute_absorption_depth(cube: np.ndarray, window=11, poly=2):
    bands = cube.shape[2]
    window = max(3, min(window, bands if bands % 2 == 1 else bands - 1))
    if window % 2 == 0:
        window -= 1
    poly = min(poly, window - 1)
    smooth = savgol_filter(cube, window_length=window, polyorder=poly, axis=2)
    return (smooth - cube).max(axis=2)


def _compute_spectral_variance(cube: np.ndarray):
    return np.var(cube, axis=2)


def _kmeans_fit(pixels: np.ndarray, n_clusters: int, random_state: int = 0):
    total_pixels = pixels.shape[0]
    clusters = max(2, min(int(n_clusters), total_pixels))
    km = KMeans(n_clusters=clusters, n_init=10, random_state=random_state)
    labels = km.fit_predict(pixels)
    return labels, km.cluster_centers_


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
    labels, centers = _kmeans_fit(pixels, n_clusters)
    clusters = centers.shape[0]
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


def _build_unsupervised_visuals(cube: np.ndarray, roi_mask: Optional[np.ndarray] = None):
    cube = np.asarray(cube, dtype=np.float32)
    cube = np.nan_to_num(cube, nan=0.0, posinf=0.0, neginf=0.0)
    if roi_mask is not None and not np.any(roi_mask):
        raise ValueError("ROI does not contain any pixels.")

    scores_img, pca = _run_pca(cube, n_components=3, standardize=False, roi_mask=roi_mask)
    rgb_pca = _pca_to_frgb(scores_img, p_lo=1, p_hi=99, gamma=1.2, roi_mask=roi_mask)

    endmembers = _find_endmembers_kmeans(cube, k=6, sample_px=20000, random_state=0, roi_mask=roi_mask)
    sam_maps = _sam_distance_cube(cube, endmembers, roi_mask=roi_mask)
    sam_rgb = _sam_rgb_from_maps(sam_maps, p_lo=1, p_hi=99, rgb_indices=(0, 1, 2), roi_mask=roi_mask)
    safe_sam_maps = np.where(np.isfinite(sam_maps), sam_maps, np.inf)
    hard_class = np.argmin(safe_sam_maps, axis=2)
    abundance = _soft_abundance_from_sam(sam_maps, tau=0.08)
    abundance_rgb = _abundance_rgb_from_abund(abundance, em_indices=(0, 1, 2))
    ambiguity = _ambiguity_margin_from_sam(sam_maps)
    if roi_mask is not None:
        abundance_rgb[~roi_mask] = 0.0

    ratio_rgb = _compute_ratio_rgb(cube, roi_mask=roi_mask)
    entropy = _compute_entropy(cube)
    depth = _compute_absorption_depth(cube, window=11, poly=2)
    var_map = _compute_spectral_variance(cube)
    if roi_mask is not None:
        entropy = np.where(roi_mask, entropy, np.nan)
        depth = np.where(roi_mask, depth, np.nan)
        var_map = np.where(roi_mask, var_map, np.nan)
        ambiguity = np.where(roi_mask, ambiguity, np.nan)

    vibrant_scalar_maps = [
        ("spectral-entropy", "Spectral Entropy", entropy, cv2.COLORMAP_MAGMA,
         "Entropy of the normalized spectrum at each pixel."),
        ("sam-ambiguity", "Ambiguity (2nd best - best SAM)", ambiguity, cv2.COLORMAP_VIRIDIS,
         "Margin between the second-best and best SAM match."),
        ("spectral-variance", "Spectral Variance", var_map, cv2.COLORMAP_PLASMA,
         "Variance across the spectrum at each pixel."),
        ("max-absorption-depth", "Max Absorption Depth", depth, cv2.COLORMAP_INFERNO,
         "Maximum Savitzky-Golay absorption depth estimate."),
    ]

    visuals = [
        {
            "id": "pca-rgb",
            "label": "PCA fRGB (PC1/2/3)",
            "image": _encode_rgb_image((np.clip(rgb_pca, 0.0, 1.0) * 255.0).astype(np.uint8)),
            "description": "False RGB composite from PCA scores 1 to 3 with percentile stretch and gamma.",
        },
        {
            "id": "sam-rgb",
            "label": "SAM Distance RGB",
            "image": _encode_rgb_image((np.clip(sam_rgb, 0.0, 1.0) * 255.0).astype(np.uint8)),
            "description": "RGB composite of SAM distance maps for endmembers 0, 1, and 2.",
        },
        {
            "id": "band-ratio-rgb",
            "label": "Band Ratio Composite",
            "image": _encode_rgb_image((np.clip(ratio_rgb, 0.0, 1.0) * 255.0).astype(np.uint8)),
            "description": "Three-band ratio composite with percentile stretch for contrast.",
        },
        {
            "id": "sam-hard-class",
            "label": "Hard Class (argmin SAM)",
            "image": _encode_rgb_image(
                np.where(
                    roi_mask[..., None] if roi_mask is not None else True,
                    _generate_palette(endmembers.shape[0])[hard_class],
                    0,
                ).astype(np.uint8)
            ),
            "description": "Categorical endmember assignment from the minimum SAM value.",
        },
        {
            "id": "sam-soft-rgb",
            "label": "Soft Abundance RGB (EM0/1/2)",
            "image": _encode_rgb_image((np.clip(abundance_rgb, 0.0, 1.0) * 255.0).astype(np.uint8)),
            "description": "Soft abundance RGB built from the first three SAM-based endmember memberships.",
        },
    ]

    for idx in range(min(3, scores_img.shape[2])):
        visuals.append(
            {
                "id": f"pca-component-{idx}",
                "label": f"PCA Component {idx + 1}",
                "image": _encode_colormap_image(scores_img[..., idx], cv2.COLORMAP_TURBO, valid_mask=roi_mask),
                "description": f"Explained variance: {pca.explained_variance_ratio_[idx] * 100:.2f}%",
            }
        )

    visuals.extend(
        {
            "id": visual_id,
            "label": label,
            "image": _encode_colormap_image(data, cmap, valid_mask=roi_mask),
            "description": description,
        }
        for visual_id, label, data, cmap, description in vibrant_scalar_maps
    )

    return visuals


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


def _shape_to_mask(shape: dict, width: int, height: int) -> np.ndarray:
    if not isinstance(shape, dict):
        raise ValueError("Invalid shape data")
    shape_type = str(shape.get("type", "rectangle")).lower()
    mask = np.zeros((height, width), dtype=bool)

    if shape_type == "rectangle":
        rect = {
            "x0": shape.get("x0"),
            "x1": shape.get("x1"),
            "y0": shape.get("y0"),
            "y1": shape.get("y1"),
            "normalized": shape.get("normalized"),
        }
        x_start, x_end, y_start, y_end = _normalize_rect(rect, width, height)
        mask[y_start:y_end, x_start:x_end] = True
        return mask

    if shape_type == "point":
        x = shape.get("x", shape.get("cx"))
        y = shape.get("y", shape.get("cy"))
        if x is None or y is None:
            raise ValueError("Invalid point coordinates")
        x_idx = max(0, min(width - 1, int(round(float(x)))))
        y_idx = max(0, min(height - 1, int(round(float(y)))))
        mask[y_idx, x_idx] = True
        return mask

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
        yy, xx = np.ogrid[:height, :width]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius ** 2
        if not np.any(mask):
            raise ValueError("Empty selection")
        return mask

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
        polygon = np.round(np.array(coords, dtype=np.float32)).astype(np.int32)
        raster = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(raster, [polygon], 1)
        mask = raster.astype(bool)
        if not np.any(mask):
            raise ValueError("Empty selection")
        return mask

    raise ValueError(f"Unsupported shape type: {shape_type}")


def _extract_pixels_from_shape(
    cube: np.ndarray, shape: dict
) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
    if not isinstance(shape, dict):
        raise ValueError("Invalid shape data")
    shape_type = str(shape.get("type", "rectangle")).lower()
    height, width = cube.shape[:2]
    if shape_type in {"rectangle", "point", "circle", "polygon"}:
        mask = _shape_to_mask(shape, width, height)
        if not np.any(mask):
            raise ValueError("Empty selection")
        ys, xs = np.where(mask)
        pixels = cube[mask]
        if pixels.size == 0:
            raise ValueError("Empty selection")
        return (
            pixels.reshape(-1, cube.shape[2]).astype(np.float32),
            (int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1),
        )
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


def _extract_roi_mask(cube: np.ndarray, payload: Optional[dict]) -> Optional[np.ndarray]:
    if not isinstance(payload, dict):
        return None
    shape = payload.get("shape") or payload.get("roi_shape")
    rect = payload.get("rect") or payload.get("roi_rect")
    height, width = cube.shape[:2]
    if shape:
        return _shape_to_mask(shape, width, height)
    if rect:
        x_start, x_end, y_start, y_end = _normalize_rect(rect, width, height)
        mask = np.zeros((height, width), dtype=bool)
        mask[y_start:y_end, x_start:x_end] = True
        return mask
    return None


def _scale_rgb_with_roi(cube: np.ndarray, idxs: List[int], roi_mask: Optional[np.ndarray]) -> np.ndarray:
    rgb = np.stack([cube[:, :, i] for i in idxs], axis=-1).astype(np.float32)
    if roi_mask is None:
        return np.clip(rgb, 0.0, 1.0)

    scaled = np.zeros_like(rgb, dtype=np.float32)
    for channel_idx in range(rgb.shape[2]):
        channel = rgb[..., channel_idx]
        finite_mask = np.isfinite(channel) & roi_mask
        if not np.any(finite_mask):
            continue
        values = channel[finite_mask]
        min_val = float(np.min(values))
        max_val = float(np.max(values))
        if max_val - min_val < 1e-9:
            continue
        scaled[..., channel_idx] = np.clip((channel - min_val) / (max_val - min_val), 0.0, 1.0)

    scaled[~roi_mask] = 0.0
    return scaled


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
    data_hdr_name: Optional[str] = Form(None),
    ignore_dark_ref: bool = Form(False),
    ignore_white_ref: bool = Form(False),
    crop_top: Optional[int] = Form(None),
    crop_bottom: Optional[int] = Form(None),
    crop_left: Optional[int] = Form(None),
    crop_right: Optional[int] = Form(None),
    max_bands: Optional[int] = Form(None),
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

        CUBE, BANDS, warning_text, data_file = load_hsi(
            load_target,
            ignore_dark_ref=bool(ignore_dark_ref),
            ignore_white_ref=bool(ignore_white_ref),
            crop_top=crop_top,
            crop_bottom=crop_bottom,
            crop_left=crop_left,
            crop_right=crop_right,
            max_bands=max_bands,
            data_hdr_name=data_hdr_name,
        )
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to load dataset: {exc}"}, status_code=500)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

    response = {"bands": BANDS, "shape": CUBE.shape, "data_file": data_file}
    if folder_path:
        roi_shape = _load_saved_roi(folder_path, data_hdr_name or f"{data_file}.hdr")
        if roi_shape is not None:
            response["roi_shape"] = roi_shape
        annotations = _load_saved_annotations(folder_path, data_hdr_name or f"{data_file}.hdr", CUBE)
        if annotations:
            response["annotations"] = annotations
    if warning_text:
        response["warning"] = warning_text
    return response


@app.post("/roi")
async def save_roi(req: Request):
    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    folder_path = payload.get("folder_path")
    data_hdr_name = payload.get("data_hdr_name")
    shape = payload.get("shape")

    if not isinstance(shape, dict):
        return JSONResponse({"error": "ROI shape is required."}, status_code=400)

    if not folder_path or not data_hdr_name:
        return JSONResponse(
            {"error": "ROI saving is only available for measurements loaded from a folder path."},
            status_code=400,
        )

    try:
        roi_path = _roi_file_path(folder_path, data_hdr_name)
        with open(roi_path, "w", encoding="utf-8") as handle:
            json.dump({"shape": shape}, handle, indent=2)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to save ROI: {exc}"}, status_code=500)

    return {"saved": True, "path": str(roi_path)}


@app.post("/annotations")
async def save_annotations(req: Request):
    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    folder_path = payload.get("folder_path")
    data_hdr_name = payload.get("data_hdr_name")
    annotations = payload.get("annotations")

    if not folder_path or not data_hdr_name:
        return JSONResponse(
            {"error": "Annotation saving is only available for measurements loaded from a folder path."},
            status_code=400,
        )
    if not isinstance(annotations, list):
        return JSONResponse({"error": "Annotations must be a list."}, status_code=400)

    try:
        annotations_path = _annotations_file_path(folder_path, data_hdr_name)
        serialized_shapes = [_selection_to_label_shape(annotation) for annotation in annotations]
        image_height = int(CUBE.shape[0]) if isinstance(CUBE, np.ndarray) and CUBE.ndim >= 2 else None
        image_width = int(CUBE.shape[1]) if isinstance(CUBE, np.ndarray) and CUBE.ndim >= 2 else None
        payload = {
            "version": "5.0.1",
            "flags": {},
            "imagePath": data_hdr_name,
            "imageHeight": image_height,
            "imageWidth": image_width,
            "shapes": serialized_shapes,
        }
        with open(annotations_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to save annotations: {exc}"}, status_code=500)

    return {"saved": True, "path": str(annotations_path), "count": len(annotations)}


@app.get("/measurements")
def list_measurements(folder_path: str = Query(...)):
    try:
        folder = Path(folder_path)
        hdrs = _iter_measurement_hdrs(folder)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to scan folder: {exc}"}, status_code=500)

    return {
        "measurements": [
            {
                "name": hdr.stem,
                "data_hdr_name": hdr.name,
                "folder_path": str(hdr.parent),
            }
            for hdr in hdrs
        ]
    }

@app.post("/rgb")
async def get_rgb(req: Request):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)

    try:
        payload = await req.json()
    except Exception:
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    idxs = payload.get("indices")
    if not isinstance(idxs, list) or len(idxs) != 3:
        return JSONResponse({"error": "RGB requires three band indices."}, status_code=400)

    try:
        rgb_indices = [int(value) for value in idxs]
    except (TypeError, ValueError):
        return JSONResponse({"error": "RGB indices must be integers."}, status_code=400)

    bands = CUBE.shape[2]
    if any(index < 0 or index >= bands for index in rgb_indices):
        return JSONResponse({"error": "RGB index is out of range."}, status_code=400)

    try:
        roi_mask = _extract_roi_mask(CUBE, payload)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)

    if roi_mask is None:
        rgb = extract_rgb(CUBE, rgb_indices)
    else:
        rgb = (_scale_rgb_with_roi(CUBE, rgb_indices, roi_mask) * 255.0).astype(np.uint8)

    _, buf = cv2.imencode(".png", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
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

    if method == "unsupervised_suite":
        try:
            roi_mask = _extract_roi_mask(CUBE, payload)
            visuals = _build_unsupervised_visuals(CUBE, roi_mask=roi_mask)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse(
                {"error": f"Failed to compute unsupervised visuals: {exc}"},
                status_code=500,
            )
        return {"method": "unsupervised_suite", "visuals": visuals}

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
