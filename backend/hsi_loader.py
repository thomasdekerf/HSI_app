import numpy as np
import os
from pathlib import Path
import spectral.io.envi as envi

def find_file(folder: Path, keyword: str):
    """Return the first file that contains keyword and ends with .hdr"""
    for f in folder.glob("*.hdr"):
        if keyword.lower() in f.name.lower():
            return f
    return None

def load_hsi(input_path: str):
    """
    Auto-load HSI dataset (data + dark + white refs).
    input_path can be:
      - folder containing .hdr/.raw pairs
      - single .hdr or .raw file
    Returns: corrected hyperspectral cube (H, W, Bands)
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
    data_ref  = np.array(envi.open(str(data_hdr),  str(raw_from_hdr(data_hdr))).load())

    # compute mean dark/white (collapse frames)
    dark_mean  = np.mean(dark_ref, axis=0)
    white_mean = np.mean(white_ref, axis=0)

    # correction: (data - dark) / (white - dark)
    corrected = (data_ref - dark_mean) / (white_mean - dark_mean + 1e-8)
    corrected = np.clip(corrected, 0, 1)

    return corrected

def extract_rgb(cube: np.ndarray, idxs):
    """Extract pseudo-RGB image from cube given band indices."""
    cube_norm = np.clip(cube, 0, 1)
    rgb = np.stack([cube_norm[:, :, i] for i in idxs], axis=-1)
    rgb = (rgb * 255).astype(np.uint8)
    return rgb
