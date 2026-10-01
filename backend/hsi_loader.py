import numpy as np
from pathlib import Path
import warnings
import re
import xml.etree.ElementTree as ET
from typing import Iterable, List, Optional

import spectral.io.envi as envi

def _iter_hdr_files(folder: Path):
    """Yield header files in ``folder`` ignoring the case of the extension."""

    for file_path in sorted(folder.rglob("*")):
        if (file_path.is_file() and file_path.suffix.lower() == ".hdr"
                and not any(part.startswith(".") for part in file_path.relative_to(folder).parts)):
            yield file_path


def _is_reference_hdr(file_path: Path) -> bool:
    return _reference_kind(file_path) is not None


def _reference_kind(file_path: Path):
    name = file_path.stem.lower()
    for kind, short in (("darkref", "dr"), ("whiteref", "wr")):
        color = "dark" if kind == "darkref" else "white"
        if re.search(rf"{color}[ _-]*ref(?:erence)?", name) or re.search(
            rf"(^|[ _-]){short}($|[ _-])", name
        ):
            return kind
    return None


def _manifest_entries(folder: Path):
    """Read the local Lumo manifest, restricting entries to this acquisition."""
    manifest = folder / "manifest.xml"
    if not manifest.is_file():
        return []
    try:
        root = ET.parse(manifest).getroot()
    except (ET.ParseError, OSError):
        return []
    entries = []
    for entry in root.findall("file"):
        path = (folder / (entry.text or "").strip().replace("\\", "/")).resolve()
        if path.is_relative_to(folder.resolve()) and path.suffix.lower() == ".hdr":
            entries.append((str(entry.get("type", "")).lower(), path))
    return entries


def measurement_headers(folder: Path):
    """Discover scans recursively, excluding reference and calibration headers."""
    manifests = list(folder.rglob("manifest.xml"))
    if folder.name.lower() == "capture":
        manifests.append(folder.parent / "manifest.xml")
    references = {
        path for manifest in manifests
        for kind, path in _manifest_entries(manifest.parent)
        if kind in {"darkref", "whiteref"}
    }
    return [
        hdr for hdr in _iter_hdr_files(folder)
        if not _is_reference_hdr(hdr) and hdr.resolve() not in references
        and not any(part.lower() in {"calibrations", "calibration"}
                    for part in hdr.relative_to(folder).parts[:-1])
    ]


def detect_sensor(metadata: dict) -> str:
    description = " ".join(str(metadata.get(key, "")) for key in
                           ("sensor type", "data source", "camera", "description", "calibration pack")).lower()
    if any(token in description for token in ("specim", "lumo", "fx10", "fx17", "fx50")):
        return "Specim"
    if any(token in description for token in ("imec", "snapscan")):
        return "IMEC"
    return "ENVI"


def measurement_info(data_hdr: Path, metadata: Optional[dict] = None) -> dict:
    if metadata is None:
        metadata = envi.read_envi_header(str(data_hdr))
    return {
        "sensor": detect_sensor(metadata),
        "sensor_type": str(metadata.get("sensor type", "")),
        "folder_path": str(data_hdr.parent),
        "data_hdr_name": data_hdr.name,
    }


def _reference_key(path: Path) -> str:
    name = re.sub(r"(dark|white)[ _-]*ref(?:erence)?", "", path.stem.lower())
    name = re.sub(r"(^|[ _-])(dr|wr)($|[ _-])", "", name)
    name = re.sub(r"[ _-]object(?:[ _-](?:corrected|irradiance|reflectance))?$", "", name)
    return re.sub(r"[^a-z0-9]", "", name)


def calibration_references(data_hdr: Path, ignore_dark_ref=False, ignore_white_ref=False):
    folder = data_hdr.parent
    root = folder.parent if folder.name.lower() == "capture" else folder
    entries = _manifest_entries(root)
    ignored = {kind for kind, flag in (("darkref", ignore_dark_ref), ("whiteref", ignore_white_ref)) if flag}
    if any(kind == "capture" and path == data_hdr.resolve() for kind, path in entries):
        refs = {}
        for kind in ("darkref", "whiteref"):
            if kind in ignored:
                refs[kind] = None
                continue
            matches = [path for role, path in entries if role == kind]
            if len(matches) > 1:
                raise ValueError(f"Multiple {kind.upper()} files in {root / 'manifest.xml'}")
            refs[kind] = matches[0] if matches else None
        return refs

    # Never recurse into neighboring measurements looking for their references.
    dirs = {folder, folder / "calibrations", folder / "calibration",
            root, root / "calibrations", root / "calibration"}
    candidates = sorted({p for directory in dirs if directory.is_dir()
                         for p in directory.iterdir()
                         if p.is_file() and p.suffix.lower() == ".hdr" and _is_reference_hdr(p)})
    scans = {p for directory in {folder, root} for p in directory.iterdir()
             if p.is_file() and p.suffix.lower() == ".hdr" and not _is_reference_hdr(p)
             and not p.name.startswith(".")}
    refs = {}
    for kind in ("darkref", "whiteref"):
        if kind in ignored:
            refs[kind] = None
            continue
        choices = [p for p in candidates if _reference_kind(p) == kind]
        matched = [p for p in choices if _reference_key(p) == _reference_key(data_hdr)]
        generic = [p for p in choices if not _reference_key(p)]
        # Preserve single-scan exports whose reference names use another prefix.
        choices = matched or generic or (choices if len(scans) == 1 else [])
        if len(choices) > 1:
            raise ValueError(f"Ambiguous {kind.upper()} for {data_hdr.name}: "
                             + ", ".join(str(p) for p in choices))
        refs[kind] = choices[0] if choices else None
    return refs


def _open_envi(data_hdr: Path):
    # Respect explicit filenames and ENVI extensions, including uppercase exports.
    candidates = {p.name.lower(): p for p in data_hdr.parent.iterdir() if p.is_file()}
    try:
        metadata = envi.read_envi_header(str(data_hdr))
    except (OSError, envi.EnviException):
        metadata = {}
    declared = metadata.get("data file")
    if declared:
        name = str(declared).strip().strip("{}\"'").replace("\\", "/").split("/")[-1]
        binary = candidates.get(name.lower(), data_hdr.parent / name)
    else:
        names = [data_hdr.stem, *(data_hdr.stem + ext for ext in (".raw", ".img", ".dat", ".bil", ".bip", ".bsq"))]
        binary = next((candidates[name.lower()] for name in names if name.lower() in candidates),
                      data_hdr.with_suffix(".raw"))
    return envi.open(str(data_hdr), str(binary))


def _image_array(image):
    return image.open_memmap() if hasattr(image, "open_memmap") else image.load()


def find_file(folder: Path, keyword: str):
    """Return the first calibration file that matches a keyword and ends with .hdr."""

    keyword_lower = keyword.lower()
    aliases = {
        "darkref": ("darkref", "dark reference", "dark_reference"),
        "whiteref": ("whiteref", "white reference", "white_reference"),
    }.get(keyword_lower, (keyword_lower,))
    for file_path in _iter_hdr_files(folder):
        lower_name = file_path.name.lower()
        if any(alias in lower_name for alias in aliases):
            return file_path
    return None


def _select_data_hdr(root: Path, data_hdr_name: Optional[str] = None) -> Path:
    root = root.expanduser()
    if root.is_file():
        target = root.name if root.suffix.lower() == ".hdr" else root.stem + ".hdr"
        return _select_data_hdr(root.parent, data_hdr_name or target)
    hdrs = measurement_headers(root)
    normalized_target = None
    if data_hdr_name:
        normalized_target = data_hdr_name.lower()
        if not normalized_target.endswith(".hdr"):
            normalized_target = f"{normalized_target}.hdr"

    matches = [p for p in hdrs if normalized_target is None or p.name.lower() == normalized_target
               or p.relative_to(root).as_posix().lower() == normalized_target]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError("Multiple measurements found. Select a measurement from the queue "
                         "or provide its relative header path.")

    if data_hdr_name:
        raise FileNotFoundError(f'Missing data .hdr file "{data_hdr_name}"')
    raise FileNotFoundError("Missing data .hdr file")


def _sensor_dark_references(folder: Path) -> List[str]:
    """Identify sensor-frame references without pretending they are ENVI cubes."""
    found = []
    for sidecar in sorted(folder.glob("*.raw.xml")):
        if not any(token in sidecar.name.lower() for token in ("darkref", "dark reference", "dark_reference")):
            continue
        if not sidecar.with_suffix("").is_file():
            continue
        try:
            root = ET.parse(sidecar).getroot()
            data_format = root.find("data_format")
            if root.get("kind") == "ROI_FRAME" and data_format is not None:
                found.append(
                    f"{sidecar.with_suffix('').name} "
                    f"({data_format.get('nr_rows')}x{data_format.get('nr_cols')} sensor frame)"
                )
        except (ET.ParseError, OSError):
            continue
    return found

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


def _metadata_truthy(metadata: Optional[dict], key: str) -> bool:
    if not metadata or key not in metadata:
        return False
    value = metadata[key]
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    return normalized in {"1", "true", "yes", "y"}


def _crop_axis_by_edges(
    length: int,
    trim_start: Optional[int] = None,
    trim_end: Optional[int] = None,
) -> slice:
    start = int(trim_start or 0)
    end_trim = int(trim_end or 0)
    if start < 0 or end_trim < 0:
        raise ValueError("Crop edge values must be non-negative integers")
    end = length - end_trim
    if start >= end:
        raise ValueError("Crop settings remove the full dataset extent")
    return slice(start, end)


def _crop_axis_to_size(length: int, max_length: Optional[int]) -> slice:
    if max_length is None:
        return slice(0, length)
    max_length = int(max_length)
    if max_length <= 0:
        raise ValueError("Crop sizes must be positive integers")
    if max_length >= length:
        return slice(0, length)
    start = (length - max_length) // 2
    end = start + max_length
    return slice(start, end)


def _apply_crop_limits(
    cube: np.ndarray,
    wavelengths: Optional[List[float]],
    crop_top: Optional[int] = None,
    crop_bottom: Optional[int] = None,
    crop_left: Optional[int] = None,
    crop_right: Optional[int] = None,
    max_bands: Optional[int] = None,
):
    height_slice = _crop_axis_by_edges(cube.shape[0], crop_top, crop_bottom)
    width_slice = _crop_axis_by_edges(cube.shape[1], crop_left, crop_right)
    band_slice = _crop_axis_to_size(cube.shape[2], max_bands)

    cropped_cube = cube[height_slice, width_slice, band_slice]
    cropped_wavelengths = wavelengths[band_slice] if wavelengths is not None else None

    crop_applied = (
        cropped_cube.shape[0] != cube.shape[0]
        or cropped_cube.shape[1] != cube.shape[1]
        or cropped_cube.shape[2] != cube.shape[2]
    )
    return cropped_cube, cropped_wavelengths, crop_applied


def _wavelength_axis(metadata: dict, bands: int):
    wavelengths = _extract_wavelengths(metadata)
    valid = (wavelengths is not None and len(wavelengths) == bands
             and any(key in metadata for key in ("wavelength", "wavelengths")))
    if wavelengths is not None and str(metadata.get("wavelength units", "")).lower() in {
        "micrometers", "micrometer", "microns", "um", "µm",
    }:
        wavelengths = [value * 1000 for value in wavelengths]
    return wavelengths, valid


def _reference_mean(hdr: Path, data_shape, data_metadata: dict, sensor: str):
    image = _open_envi(hdr)
    reference = _image_array(image)
    if reference.ndim != 3 or reference.shape[1:] != data_shape[1:]:
        raise ValueError(f"Calibration {hdr.name} has shape {reference.shape}; samples and bands "
                         f"must match the measurement {data_shape}.")
    metadata = getattr(image, "metadata", {}) or {}
    axis, valid = _wavelength_axis(data_metadata, data_shape[2])
    ref_axis, ref_valid = _wavelength_axis(metadata, reference.shape[2])
    if valid and ref_valid and not np.allclose(axis, ref_axis, atol=0.05, rtol=0, equal_nan=True):
        raise ValueError(f"Calibration {hdr.name} wavelengths do not match the measurement.")
    if sensor == "Specim" and "tint" in metadata and "tint" in data_metadata:
        if not np.isclose(float(metadata["tint"]), float(data_metadata["tint"])):
            raise ValueError(f"Calibration {hdr.name} integration time does not match the measurement.")
    # Keep the scan's per-column/per-band response; only average scan lines.
    return np.mean(reference, axis=0, dtype=np.float32)


def load_hsi(
    input_path: str,
    ignore_dark_ref: bool = False,
    ignore_white_ref: bool = False,
    crop_top: Optional[int] = None,
    crop_bottom: Optional[int] = None,
    crop_left: Optional[int] = None,
    crop_right: Optional[int] = None,
    max_bands: Optional[int] = None,
    data_hdr_name: Optional[str] = None,
    return_metadata: bool = False,
):
    """Load an IMEC, Specim or generic ENVI scan into a shared (H, W, bands) cube.

    Returns cube, wavelengths, warning, name; optionally appends measurement metadata.
    Both references are required for (signal - dark) / (white - dark) calibration.
    Already exported reflectance is not calibrated a second time.
    """
    data_hdr = _select_data_hdr(Path(input_path), data_hdr_name=data_hdr_name)
    image = _open_envi(data_hdr)
    source = _image_array(image)
    metadata = getattr(image, "metadata", {}) or {}
    info = measurement_info(data_hdr, metadata)
    warnings_list = []
    already_reflectance = _metadata_truthy(metadata, "reflectance data")
    scale = float(metadata.get("reflectance scale factor", 1))
    if "reflectance scale factor" in metadata:
        if not np.isfinite(scale) or scale <= 0:
            raise ValueError("Reflectance scale factor must be a positive finite number.")
        already_reflectance = True

    refs = ({"darkref": None, "whiteref": None} if already_reflectance
            else calibration_references(data_hdr, ignore_dark_ref, ignore_white_ref))
    dark_hdr = None if ignore_dark_ref else refs["darkref"]
    white_hdr = None if ignore_white_ref else refs["whiteref"]
    info["calibration"] = {
        "status": "reflectance" if already_reflectance else "raw",
        "dark_reference": str(dark_hdr) if dark_hdr else None,
        "white_reference": str(white_hdr) if white_hdr else None,
    }

    wavelengths, has_wavelength_axis = _wavelength_axis(metadata, source.shape[2])
    if wavelengths is None or len(wavelengths) != source.shape[2]:
        message = "Wavelength metadata missing or invalid; falling back to band indices."
        warnings_list.append(message)
        warnings.warn(message)
        wavelengths = list(range(source.shape[2]))
    order = np.arange(source.shape[2])
    if has_wavelength_axis:
        values = np.asarray(wavelengths, dtype=float)
        valid = np.flatnonzero(np.isfinite(values) & (values > 0))
        if not valid.size:
            raise ValueError("No valid positive wavelengths in the measurement header.")
        order = valid[np.argsort(values[valid], kind="stable")]
        removed = len(values) - len(valid)
        if removed:
            warnings_list.append(f"Excluded {removed} bands with invalid or zero wavelengths.")

    band_slice = _crop_axis_to_size(len(order), max_bands)
    band_crop_applied = len(order[band_slice]) != len(order)
    order = order[band_slice]
    wavelengths = [wavelengths[index] for index in order]
    height_slice = _crop_axis_by_edges(source.shape[0], crop_top, crop_bottom)
    width_slice = _crop_axis_by_edges(source.shape[1], crop_left, crop_right)
    view = source[height_slice, width_slice, :]
    # Allocate just the final cube. Chunked copying bounds temporary memory for BIL scans.
    corrected = np.empty((*view.shape[:2], len(order)), dtype=np.float32)
    for start in range(0, view.shape[0], 64):
        corrected[start:start + 64] = np.take(view[start:start + 64], order, axis=2)

    if already_reflectance:
        corrected /= scale
    elif dark_hdr and white_hdr:
        dark = _reference_mean(dark_hdr, source.shape, metadata, info["sensor"])[width_slice][:, order]
        white = _reference_mean(white_hdr, source.shape, metadata, info["sensor"])[width_slice][:, order]
        denominator = white - dark
        valid = np.isfinite(denominator) & np.isfinite(dark) & (denominator > 1e-8)
        corrected -= dark
        np.divide(corrected, denominator, out=corrected, where=valid)
        corrected[:, ~valid] = 0
        np.nan_to_num(corrected, copy=False, nan=0.0, posinf=0.0, neginf=0.0)
        np.clip(corrected, 0, 1, out=corrected)
        info["calibration"]["status"] = "white-dark"
        if not np.all(valid):
            warnings_list.append(f"Set {np.count_nonzero(~valid)} invalid white/dark reference "
                                 "sample-band positions to zero (white must exceed dark).")
    else:
        ignored = [name for flag, name in ((ignore_dark_ref, "DARKREF"),
                                          (ignore_white_ref, "WHITEREF")) if flag]
        missing = []
        sensor_dark = (_sensor_dark_references(data_hdr.parent)
                       if not dark_hdr and not ignore_dark_ref else [])
        if not dark_hdr and not ignore_dark_ref:
            if sensor_dark:
                warnings_list.append(
                    "Dark reference present in sensor-frame format: " + ", ".join(sensor_dark) + ". "
                    "This loader requires an ENVI dark-reference cube aligned with the measurement; "
                    "the sensor-frame-to-cube mapping is unavailable. Export calibrated reflectance "
                    "from imec Snapscan, or provide compatible ENVI calibration cubes. "
                    "Returning uncalibrated data, not reflectance."
                )
            else:
                missing.append("DARKREF")
        if not white_hdr and not ignore_white_ref:
            missing.append("WHITEREF")
        details = []
        if missing:
            details.append(f"missing ({', '.join(missing)})")
        if ignored:
            details.append(f"ignored by request ({', '.join(ignored)})")
        if details:
            message = f"Calibration reference files {'; '.join(details)}; returning raw uncorrected data."
            warnings_list.append(message)
            warnings.warn(message)

    if view.shape[:2] != source.shape[:2] or band_crop_applied:
        warnings_list.append(f"Dataset cropped to {corrected.shape[0]}x{corrected.shape[1]}x{corrected.shape[2]}")

    # ENVI default bands are one-based; map through filtering, sorting and cropping.
    defaults = _parse_wavelengths(metadata.get("default bands"))
    if info["sensor"] == "Specim" and defaults and len(defaults) == 3:
        if all(np.isfinite(value) and value.is_integer() and 1 <= value <= source.shape[2] for value in defaults):
            info["default_rgb_indices"] = [int(np.argmin(np.abs(order - (int(value) - 1)))) for value in defaults]
    warning_text = "; ".join(warnings_list) if warnings_list else None
    result = (corrected, wavelengths, warning_text, data_hdr.stem)
    return (*result, info) if return_metadata else result

def extract_rgb(cube: np.ndarray, idxs):
    """Extract pseudo-RGB image from cube given band indices."""
    cube_norm = np.clip(cube, 0, 1)
    rgb = np.stack([cube_norm[:, :, i] for i in idxs], axis=-1)
    rgb = (rgb * 255).astype(np.uint8)
    return rgb
