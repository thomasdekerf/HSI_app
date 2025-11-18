import numpy as np
from pathlib import Path
import warnings
from typing import Iterable, List, Optional

import spectral.io.envi as envi

def _iter_hdr_files(folder: Path):
    """Yield header files in ``folder`` ignoring the case of the extension."""

    for file_path in folder.iterdir():
        if file_path.is_file() and file_path.suffix.lower() == ".hdr":
            yield file_path


def find_file(folder: Path, keyword: str):
    """Return the first file that contains keyword and ends with .hdr"""

    keyword_lower = keyword.lower()
    for file_path in _iter_hdr_files(folder):
        if keyword_lower in file_path.name.lower():
            return file_path
    return None

def _parse_wavelengths(values: Optional[Iterable]) -> Optional[List[float]]:
    """Normalize wavelength entries from ENVI metadata to a float list."""

    if values is None:
        return None

    # ENVI metadata may provide a list-like object or a single string wrapped in braces
    if isinstance(values, str):
        cleaned = values.strip().strip("{}[]()").split(",")
    else:
        cleaned = list(values)

    wavelengths: List[float] = []
    for item in cleaned:
        if item is None:
            continue
        if isinstance(item, (float, int)):
            wavelengths.append(float(item))
            continue
        try:
            value = float(str(item).strip())
        except (ValueError, TypeError):
            continue
        else:
            wavelengths.append(value)

    return wavelengths or None


def _extract_wavelengths(metadata: Optional[dict]) -> Optional[List[float]]:
    if not metadata:
        return None

    for key in ("wavelength", "wavelengths", "band names", "bands"):
        if key in metadata:
            parsed = _parse_wavelengths(metadata[key])
            if parsed:
                return parsed
    return None


def _normalize_uncalibrated_data(data: np.ndarray) -> np.ndarray:
    """Scale raw data to ``[0, 1]`` when calibration references are missing.

    Without calibration the raw values can be arbitrarily large, which would be
    clipped to white by downstream RGB extraction.  This function rescales the
    cube using the finite global min/max to preserve contrast while keeping the
    output compatible with the rest of the pipeline.
    """

    array = np.asarray(data, dtype=np.float32)

    if array.size == 0:
        return np.zeros_like(array, dtype=np.float32)

    finite_mask = np.isfinite(array)
    if not np.any(finite_mask):
        return np.zeros_like(array, dtype=np.float32)

    finite_values = array[finite_mask]
    min_val = float(np.min(finite_values))
    max_val = float(np.max(finite_values))

    if max_val - min_val < 1e-9:
        return np.zeros_like(array, dtype=np.float32)

    scaled = (array - min_val) / (max_val - min_val)
    return np.clip(scaled, 0.0, 1.0, out=np.empty_like(array))


def load_hsi(input_path: str):
    """
    Auto-load HSI dataset (data + dark + white refs).
    input_path can be:
      - folder containing .hdr/.raw pairs
      - single .hdr or .raw file
    Returns: tuple of (corrected hyperspectral cube (H, W, Bands), wavelengths list, warning)
    """
    path = Path(input_path)
    folder = path.parent if path.is_file() else path

    warnings_list = []

    # find hdr files
    dark_hdr  = find_file(folder, "darkref")
    white_hdr = find_file(folder, "whiteref")
    data_hdr  = None

    # choose data file (first hdr that is not ref)
    hdrs = list(_iter_hdr_files(folder))
    for f in hdrs:
        if "darkref" not in f.name.lower() and "whiteref" not in f.name.lower():
            data_hdr = f
            break

    if data_hdr is None:
        raise FileNotFoundError("Missing data .hdr file")

    # corresponding raw file paths
    def raw_from_hdr(h): return h.with_suffix(".raw")

    data_img = envi.open(str(data_hdr),  str(raw_from_hdr(data_hdr)))
    data_ref = np.array(data_img.load(), dtype=np.float32)
    wavelengths = _extract_wavelengths(getattr(data_img, "metadata", None))

    if dark_hdr and white_hdr:
        dark_ref  = np.array(envi.open(str(dark_hdr),  str(raw_from_hdr(dark_hdr))).load(), dtype=np.float32)
        white_ref = np.array(envi.open(str(white_hdr), str(raw_from_hdr(white_hdr))).load(), dtype=np.float32)

        dark_mean  = np.mean(dark_ref, axis=0)
        white_mean = np.mean(white_ref, axis=0)

        corrected = (data_ref - dark_mean) / (white_mean - dark_mean + 1e-8)
        corrected = np.clip(corrected, 0, 1)
    else:
        missing_parts = []
        if not dark_hdr:
            missing_parts.append("DARKREF")
        if not white_hdr:
            missing_parts.append("WHITEREF")

        calibration_warning = (
            f"Calibration reference files missing ({', '.join(missing_parts)}); returning normalized uncorrected data."
        )
        warnings_list.append(calibration_warning)
        warnings.warn(calibration_warning)
        corrected = _normalize_uncalibrated_data(data_ref)

    if wavelengths is None or len(wavelengths) != corrected.shape[2]:
        metadata_warning = (
            "Wavelength metadata missing or invalid; falling back to band indices."
        )
        warnings_list.append(metadata_warning)
        wavelengths = list(range(corrected.shape[2]))
        warnings.warn(metadata_warning)

    warning_text = "; ".join(warnings_list) if warnings_list else None
    return corrected, wavelengths, warning_text

def extract_rgb(cube: np.ndarray, idxs):
    """Extract pseudo-RGB image from cube given band indices."""
    cube_norm = np.clip(cube, 0, 1)
    rgb = np.stack([cube_norm[:, :, i] for i in idxs], axis=-1)
    rgb = (rgb * 255).astype(np.uint8)
    return rgb
