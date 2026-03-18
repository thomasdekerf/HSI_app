from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

import cv2
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, Polygon, Rectangle

from hsi_loader import _select_data_hdr, load_hsi


PALETTE = [
    "#d13438",
    "#c17c00",
    "#107c10",
    "#005a9e",
    "#5c2d91",
    "#8e562e",
    "#c239b3",
    "#0f6cbd",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Minimal example that loads a Specim measurement folder, shows a false RGB "
            "image with saved annotations, and plots the average spectrum per annotation."
        )
    )
    parser.add_argument(
        "measurement_path",
        help="Folder or header file for a Specim measurement. Nested capture/ folders are supported.",
    )
    parser.add_argument(
        "--data-hdr-name",
        help="Optional measurement header name when a folder contains multiple scenes.",
    )
    return parser.parse_args()


def annotations_file_path(data_hdr: Path) -> Path:
    return data_hdr.parent / f"{data_hdr.stem}.annotations.json"


def load_annotations(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    shapes = payload.get("shapes")
    if not isinstance(shapes, list):
        return []
    return [shape for shape in shapes if isinstance(shape, dict)]


def shape_from_labelme(shape_payload: dict) -> dict:
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
        return {"type": "point", "x": float(points[0][0]), "y": float(points[0][1])}
    if shape_type == "circle" and len(points) >= 2:
        cx = float(points[0][0])
        cy = float(points[0][1])
        px = float(points[1][0])
        py = float(points[1][1])
        return {"type": "circle", "cx": cx, "cy": cy, "radius": math.hypot(px - cx, py - cy)}
    if shape_type == "polygon" and len(points) >= 3:
        return {
            "type": "polygon",
            "points": [{"x": float(x), "y": float(y)} for x, y in points],
        }
    raise ValueError(f"Unsupported or invalid saved shape type: {shape_type}")


def percentile_stretch(channel: np.ndarray, low: float = 1.0, high: float = 99.0) -> np.ndarray:
    channel = np.asarray(channel, dtype=np.float32)
    finite = np.isfinite(channel)
    if not np.any(finite):
        return np.zeros_like(channel, dtype=np.float32)
    lo = float(np.percentile(channel[finite], low))
    hi = float(np.percentile(channel[finite], high))
    if hi - lo < 1e-9:
        return np.zeros_like(channel, dtype=np.float32)
    stretched = (channel - lo) / (hi - lo)
    stretched[~finite] = 0.0
    return np.clip(stretched, 0.0, 1.0)


def build_frgb(cube: np.ndarray) -> np.ndarray:
    band_count = cube.shape[2]
    band_indices = np.linspace(0, band_count - 1, 3)
    band_indices = np.round(band_indices).astype(int)
    red = percentile_stretch(cube[:, :, band_indices[2]])
    green = percentile_stretch(cube[:, :, band_indices[1]])
    blue = percentile_stretch(cube[:, :, band_indices[0]])
    return np.stack([red, green, blue], axis=-1)


def shape_to_mask(shape: dict, width: int, height: int) -> np.ndarray:
    shape_type = str(shape.get("type", "rectangle")).lower()
    mask = np.zeros((height, width), dtype=bool)

    if shape_type == "rectangle":
        x0 = int(np.clip(round(min(float(shape["x0"]), float(shape["x1"]))), 0, width - 1))
        x1 = int(np.clip(round(max(float(shape["x0"]), float(shape["x1"]))), 0, width))
        y0 = int(np.clip(round(min(float(shape["y0"]), float(shape["y1"]))), 0, height - 1))
        y1 = int(np.clip(round(max(float(shape["y0"]), float(shape["y1"]))), 0, height))
        mask[y0:y1, x0:x1] = True
        return mask

    if shape_type == "point":
        x = int(np.clip(round(float(shape["x"])), 0, width - 1))
        y = int(np.clip(round(float(shape["y"])), 0, height - 1))
        mask[y, x] = True
        return mask

    if shape_type == "circle":
        cx = float(shape["cx"])
        cy = float(shape["cy"])
        radius = float(shape["radius"])
        yy, xx = np.ogrid[:height, :width]
        return (xx - cx) ** 2 + (yy - cy) ** 2 <= radius ** 2

    if shape_type == "polygon":
        points = shape.get("points") or []
        polygon = np.array(
            [[float(point["x"]), float(point["y"])] for point in points],
            dtype=np.float32,
        )
        raster = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(raster, [np.round(polygon).astype(np.int32)], 1)
        return raster.astype(bool)

    raise ValueError(f"Unsupported shape type: {shape_type}")


def shape_center(shape: dict) -> tuple[float, float]:
    shape_type = str(shape.get("type", "rectangle")).lower()
    if shape_type == "rectangle":
        return (
            (float(shape["x0"]) + float(shape["x1"])) / 2.0,
            (float(shape["y0"]) + float(shape["y1"])) / 2.0,
        )
    if shape_type == "point":
        return float(shape["x"]), float(shape["y"])
    if shape_type == "circle":
        return float(shape["cx"]), float(shape["cy"])
    if shape_type == "polygon":
        points = shape.get("points") or []
        xs = [float(point["x"]) for point in points]
        ys = [float(point["y"]) for point in points]
        return float(np.mean(xs)), float(np.mean(ys))
    raise ValueError(f"Unsupported shape type: {shape_type}")


def mean_spectrum(cube: np.ndarray, shape: dict) -> np.ndarray:
    mask = shape_to_mask(shape, width=cube.shape[1], height=cube.shape[0])
    pixels = cube[mask]
    if pixels.size == 0:
        raise ValueError("Annotation does not cover any pixels.")
    return np.asarray(np.nanmean(pixels, axis=0), dtype=np.float32)


def add_shape_patch(ax: plt.Axes, shape: dict, color: str) -> None:
    shape_type = str(shape.get("type", "rectangle")).lower()
    if shape_type == "rectangle":
        x0 = float(min(shape["x0"], shape["x1"]))
        y0 = float(min(shape["y0"], shape["y1"]))
        width = abs(float(shape["x1"]) - float(shape["x0"]))
        height = abs(float(shape["y1"]) - float(shape["y0"]))
        patch = Rectangle((x0, y0), width, height, facecolor=color, edgecolor=color, alpha=0.22, linewidth=2)
    elif shape_type == "point":
        patch = Circle((float(shape["x"]), float(shape["y"])), radius=4, facecolor=color, edgecolor=color, alpha=0.7, linewidth=1.5)
    elif shape_type == "circle":
        patch = Circle(
            (float(shape["cx"]), float(shape["cy"])),
            radius=float(shape["radius"]),
            facecolor=color,
            edgecolor=color,
            alpha=0.22,
            linewidth=2,
        )
    elif shape_type == "polygon":
        coords = [(float(point["x"]), float(point["y"])) for point in shape.get("points") or []]
        patch = Polygon(coords, closed=True, facecolor=color, edgecolor=color, alpha=0.22, linewidth=2)
    else:
        raise ValueError(f"Unsupported shape type: {shape_type}")
    ax.add_patch(patch)


def create_image_figure(rgb: np.ndarray, annotations: list[dict], title: str) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(8, 7), constrained_layout=True)
    ax.imshow(rgb)
    ax.set_title(f"FRGB view: {title}")
    ax.set_axis_off()

    for annotation in annotations:
        add_shape_patch(ax, annotation["shape"], annotation["color"])
        center_x, center_y = shape_center(annotation["shape"])
        ax.text(
            center_x,
            center_y,
            str(annotation["index"]),
            color=annotation["color"],
            fontsize=11,
            fontweight="bold",
            ha="center",
            va="center",
            bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.8, "pad": 1.8},
        )

    return fig


def create_spectra_figure(
    wavelengths: list[float],
    band_count: int,
    annotations: list[dict],
    title: str,
) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(8, 5))
    x_values = wavelengths if len(wavelengths) == band_count else list(range(band_count))
    x_label = "Wavelength (nm)" if len(wavelengths) == band_count and wavelengths[:1] != [0] else "Band index"

    for annotation in annotations:
        ax.plot(
            x_values,
            annotation["spectrum"],
            color=annotation["color"],
            linewidth=2,
            label=f'{annotation["index"]}: {annotation["label"]}',
        )

    ax.set_title(f"Average spectra: {title}")
    ax.set_xlabel(x_label)
    ax.set_ylabel("Reflectance")
    ax.grid(alpha=0.25)
    if annotations:
        ax.legend(loc="best", fontsize=9)
    else:
        ax.text(0.5, 0.5, "No saved annotations found.", ha="center", va="center", transform=ax.transAxes)

    return fig


def iter_annotations(shape_payloads: Iterable[dict], cube: np.ndarray) -> list[dict]:
    annotations = []
    for index, payload in enumerate(shape_payloads, start=1):
        try:
            shape = shape_from_labelme(payload)
            annotations.append(
                {
                    "index": index,
                    "label": str(payload.get("label", "")).strip() or f"Region {index}",
                    "shape": shape,
                    "spectrum": mean_spectrum(cube, shape),
                    "color": PALETTE[(index - 1) % len(PALETTE)],
                }
            )
        except Exception as exc:
            print(f"Skipping annotation {index}: {exc}")
    return annotations


def save_figure(fig: plt.Figure, path: Path) -> None:
    fig.savefig(path, dpi=200, bbox_inches="tight")


def plot_measurement(
    rgb: np.ndarray,
    wavelengths: list[float],
    band_count: int,
    annotations: list[dict],
    title: str,
    output_stem: Path,
) -> None:
    image_figure = create_image_figure(rgb, annotations, title)
    spectra_figure = create_spectra_figure(wavelengths, band_count, annotations, title)

    image_path = output_stem.with_name(f"{output_stem.name}_frgb_annotations.png")
    spectra_path = output_stem.with_name(f"{output_stem.name}_average_spectra.png")
    save_figure(image_figure, image_path)
    save_figure(spectra_figure, spectra_path)

    print(f"Saved image figure: {image_path}")
    print(f"Saved spectra figure: {spectra_path}")

    plt.show()


def main() -> None:
    args = parse_args()
    measurement_path = Path(args.measurement_path).expanduser().resolve()
    data_hdr = _select_data_hdr(measurement_path, data_hdr_name=args.data_hdr_name)

    cube, wavelengths, warning_text, measurement_name = load_hsi(
        str(measurement_path),
        data_hdr_name=args.data_hdr_name,
    )
    annotation_path = annotations_file_path(data_hdr)
    saved_shapes = load_annotations(annotation_path)
    annotations = iter_annotations(saved_shapes, cube)
    rgb = build_frgb(cube)
    output_stem = annotation_path.with_suffix("")

    print(f"Loaded measurement: {measurement_name}")
    print(f"Header file: {data_hdr}")
    print(f"Annotation file: {annotation_path}")
    print(f"Annotations plotted: {len(annotations)}")
    if warning_text:
        print(f"Loader note: {warning_text}")

    # The figure output is deliberately simple: one image figure and one spectra figure.
    plot_measurement(rgb, wavelengths, cube.shape[2], annotations, measurement_name, output_stem)


if __name__ == "__main__":
    main()
