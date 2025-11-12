import numpy as np
from pathlib import Path
import warnings
from typing import Iterable, List, Optional

import spectral.io.envi as envi

def find_file(folder: Path, keyword: str):
    """Return the first file that contains keyword and ends with .hdr"""
    for f in folder.glob("*.hdr"):
        if keyword.lower() in f.name.lower():
            return f
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

    # find hdr files
    dark_hdr  = find_file(folder, "darkref")
    white_hdr = find_file(folder, "whiteref")
    data_hdr  = None

    # choose data file (first hdr that is not ref)
    hdrs = list(folder.glob("*.hdr"))
    for f in hdrs:
        if "darkref" not in f.name.lower() and "whiteref" not in f.name.lower():
            data_hdr = f
            break
    if not (dark_hdr and white_hdr and data_hdr):
        raise FileNotFoundError("Missing DARKREF, WHITEREF, or data .hdr files")

    # corresponding raw file paths
    def raw_from_hdr(h): return h.with_suffix(".raw")

    dark_ref  = np.array(envi.open(str(dark_hdr),  str(raw_from_hdr(dark_hdr))).load())
    white_ref = np.array(envi.open(str(white_hdr), str(raw_from_hdr(white_hdr))).load())

    data_img = envi.open(str(data_hdr),  str(raw_from_hdr(data_hdr)))
    data_ref = np.array(data_img.load())
    wavelengths = _extract_wavelengths(getattr(data_img, "metadata", None))

    # compute mean dark/white (collapse frames)
    dark_mean  = np.mean(dark_ref, axis=0)
    white_mean = np.mean(white_ref, axis=0)

    # correction: (data - dark) / (white - dark)
    corrected = (data_ref - dark_mean) / (white_mean - dark_mean + 1e-8)
    corrected = np.clip(corrected, 0, 1)

    warning = None
    if wavelengths is None or len(wavelengths) != corrected.shape[2]:
        warning = (
            "Wavelength metadata missing or invalid; falling back to band indices."
        )
        wavelengths = list(range(corrected.shape[2]))
        warnings.warn(warning)

    return corrected, wavelengths, warning

def extract_rgb(cube: np.ndarray, idxs):
    """Extract pseudo-RGB image from cube given band indices."""
    cube_norm = np.clip(cube, 0, 1)
    rgb = np.stack([cube_norm[:, :, i] for i in idxs], axis=-1)
    rgb = (rgb * 255).astype(np.uint8)
    return rgb
