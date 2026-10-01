"""Real ENVI fixtures exercise the same queue/load/analysis API as the browser."""
import cv2
import numpy as np
import pytest
import spectral.io.envi as envi
from fastapi.testclient import TestClient

import hsi_loader
import main


def write_cube(path, data, metadata=None, interleave="bil", ext=".raw", byteorder=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    envi.save_image(str(path), data, dtype=data.dtype, interleave=interleave,
                    ext=ext, byteorder=byteorder, metadata=metadata or {}, force=True)
    return path


@pytest.fixture
def specim(tmp_path):
    capture = tmp_path / "Specim" / "capture"
    shape = (12, 10, 12)
    rng = np.random.default_rng(27)
    signal = rng.integers(30, 200, size=shape, dtype=np.uint16)
    metadata = {"sensor type": "FX17e , Lumo - Scanner v2020-586",
                "wavelength": np.linspace(935.61, 1720.23, shape[2]).tolist(),
                "tint": 7, "default bands": [10, 6, 2]}
    hdr = write_cube(capture / "scene.hdr", signal, metadata)
    # Different line counts verify that references are averaged only across lines.
    dark = np.broadcast_to(np.arange(10, 22, dtype=np.uint16), (3, 10, 12)).copy()
    white = np.broadcast_to(np.arange(210, 222, dtype=np.uint16), (5, 10, 12)).copy()
    write_cube(capture / "DARKREF_scene.hdr", dark, metadata)
    write_cube(capture / "WHITEREF_scene.hdr", white, metadata)
    expected = (signal.astype(np.float32) - dark.mean(axis=0)) / (white.mean(axis=0) - dark.mean(axis=0))
    return hdr, signal, expected, metadata


@pytest.mark.parametrize("interleave", ["bil", "bip", "bsq"])
@pytest.mark.parametrize("byteorder", [0, 1])
def test_real_envi_layouts_and_direct_binary_selection(tmp_path, interleave, byteorder):
    data = np.arange(60, dtype=np.uint16).reshape(3, 4, 5)
    hdr = write_cube(tmp_path / "sample.HDR", data, {"wavelength": [1, 2, 3, 4, 5]},
                     interleave=interleave, ext=".RAW", byteorder=byteorder)
    cube, bands, warning, _ = hsi_loader.load_hsi(str(hdr.with_suffix(".RAW")))
    np.testing.assert_array_equal(cube, data)
    assert bands == [1, 2, 3, 4, 5]
    assert "raw uncorrected" in warning


def test_specim_calibration_crop_and_default_bands(specim):
    hdr, _, expected, metadata = specim
    cube, bands, warning, _, info = hsi_loader.load_hsi(
        str(hdr.parent.parent), crop_top=2, crop_bottom=1, crop_left=1, crop_right=2,
        max_bands=8, return_metadata=True)
    np.testing.assert_allclose(cube, expected[2:-1, 1:-2, 2:10], atol=1e-7)
    assert bands == metadata["wavelength"][2:10]
    assert info["default_rgb_indices"] == [7, 3, 0]
    assert info["sensor"] == "Specim"
    assert info["calibration"]["status"] == "white-dark"
    assert "9x7x8" in warning


def test_references_match_scene_and_never_neighbor(specim):
    hdr, _, expected, metadata = specim
    other = write_cube(hdr.parent / "other.hdr", np.full((2, 10, 12), 80, dtype=np.uint16), metadata)
    write_cube(hdr.parent / "DARKREF_other.hdr", np.full((2, 10, 12), 40, dtype=np.uint16), metadata)
    write_cube(hdr.parent / "WHITEREF_other.hdr", np.full((2, 10, 12), 120, dtype=np.uint16), metadata)
    cube, *_ = hsi_loader.load_hsi(str(hdr))
    np.testing.assert_allclose(cube, expected, atol=1e-7)
    cube, *_ = hsi_loader.load_hsi(str(other))
    np.testing.assert_allclose(cube, 0.5)
    with pytest.raises(ValueError, match="Multiple measurements"):
        hsi_loader.load_hsi(str(hdr.parent))
    lone = write_cube(hdr.parent.parent.parent / "Separate" / "scene.hdr", np.ones((2, 10, 12), dtype=np.uint16), metadata)
    _, _, warning, _, info = hsi_loader.load_hsi(str(lone), return_metadata=True)
    assert info["calibration"]["status"] == "raw"
    assert "missing (DARKREF, WHITEREF)" in warning


def test_manifest_resolves_arbitrary_calibration_names(specim):
    hdr, _, expected, _ = specim
    for old, new in (("DARKREF_scene", "black"), ("WHITEREF_scene", "panel")):
        for ext in (".hdr", ".raw"):
            (hdr.parent / (old + ext)).rename(hdr.parent / (new + ext))
    (hdr.parent.parent / "manifest.xml").write_text(
        '<manifest><file type="capture">capture/scene.hdr</file>'
        '<file type="darkref">capture/black.hdr</file>'
        '<file type="whiteref">capture/panel.hdr</file></manifest>')
    assert hsi_loader.measurement_headers(hdr.parent.parent) == [hdr]
    assert hsi_loader.measurement_headers(hdr.parent) == [hdr]
    cube, *_ = hsi_loader.load_hsi(str(hdr.parent))
    np.testing.assert_allclose(cube, expected, atol=1e-7)


def test_wr_dr_in_sibling_calibrations_folder(specim):
    hdr, _, expected, _ = specim
    refs = hdr.parent.parent / "calibrations"
    refs.mkdir()
    for old, new in (("DARKREF_scene", "DR_scene"), ("WHITEREF_scene", "WR_scene")):
        for ext in (".hdr", ".raw"):
            (hdr.parent / (old + ext)).rename(refs / (new + ext))
    assert hsi_loader.measurement_headers(hdr.parent.parent) == [hdr]
    cube, *_ = hsi_loader.load_hsi(str(hdr))
    np.testing.assert_allclose(cube, expected, atol=1e-7)


@pytest.mark.parametrize("ignored", ["ignore_dark_ref", "ignore_white_ref"])
def test_ignored_or_missing_reference_returns_raw(specim, ignored):
    hdr, raw, _, _ = specim
    cube, _, warning, _, info = hsi_loader.load_hsi(str(hdr), **{ignored: True}, return_metadata=True)
    np.testing.assert_array_equal(cube, raw)
    assert info["calibration"]["status"] == "raw"
    assert "ignored by request" in warning
    (hdr.parent / "WHITEREF_scene.hdr").unlink()
    cube, _, warning, _ = hsi_loader.load_hsi(str(hdr))
    np.testing.assert_array_equal(cube, raw)
    assert "missing (WHITEREF)" in warning


@pytest.mark.parametrize("bad", ["shape", "wavelength", "tint"])
def test_incompatible_references_rejected(specim, bad):
    hdr, _, _, metadata = specim
    shape = (2, 9 if bad == "shape" else 10, 12)
    if bad == "wavelength":
        metadata["wavelength"] = (np.asarray(metadata["wavelength"]) + 20).tolist()
    elif bad == "tint":
        metadata["tint"] = 3
    write_cube(hdr.parent / "WHITEREF_scene.hdr", np.full(shape, 220, dtype=np.uint16), metadata)
    with pytest.raises(ValueError, match="match"):
        hsi_loader.load_hsi(str(hdr))


def test_invalid_denominator_is_finite_and_warns(specim):
    hdr, _, _, metadata = specim
    white = np.full((2, 10, 12), 220, dtype=np.uint16)
    white[:, 3, 4] = 0
    write_cube(hdr.parent / "WHITEREF_scene.hdr", white, metadata)
    cube, _, warning, _ = hsi_loader.load_hsi(str(hdr))
    assert np.isfinite(cube).all()
    assert (cube[:, 3, 4] == 0).all()
    assert "1 invalid white/dark" in warning


def test_imec_and_scaled_reflectance_skip_recalibration(tmp_path):
    data = np.broadcast_to([8000, 7000, 2000, 9000], (2, 3, 4)).astype(np.uint16)
    hdr = write_cube(tmp_path / "mouse_object_corrected.hdr", data,
                     {"sensor type": "CMV2K", "data source": "HSI Snapscan 2.4.13.0", "reflectance data": 1,
                      "reflectance scale factor": 10000, "wavelength": [0, 0.7, 0.5, 0.9],
                      "wavelength units": "Micrometers"}, interleave="bsq")
    # Bad references must not affect an already calibrated export.
    (tmp_path / "mouse_white reference.hdr").touch()
    cube, bands, warning, _, info = hsi_loader.load_hsi(str(hdr), return_metadata=True)
    np.testing.assert_allclose(cube[0, 0], [0.2, 0.7, 0.9])
    assert bands == [500, 700, 900]
    assert info["sensor"] == "IMEC"
    assert info["calibration"]["status"] == "reflectance"
    assert "Excluded 1" in warning


def test_mixed_queue_and_all_analysis_endpoints(specim, monkeypatch):
    hdr, _, expected, _ = specim
    monkeypatch.setattr(main, "CUBE", None)
    monkeypatch.setattr(main, "BANDS", None)
    imec = write_cube(hdr.parents[2] / "IMEC" / "mouse.hdr", expected.astype(np.float32),
                      {"sensor type": "CMV2K", "data source": "HSI Snapscan 2.4.13.0", "reflectance data": 1,
                       "wavelength": np.linspace(450, 850, 12).tolist()}, interleave="bsq")
    client = TestClient(main.app)
    queued = client.get("/measurements", params={"folder_path": str(hdr.parents[2])}).json()["measurements"]
    assert len(queued) == 2
    assert {entry["sensor"] for entry in queued} == {"IMEC", "Specim"}
    for entry in queued:
        loaded = client.post("/load", data={"folder_path": entry["folder_path"], "data_hdr_name": entry["data_hdr_name"]})
        assert loaded.status_code == 200, loaded.text
        assert loaded.json()["sensor"] == entry["sensor"]
        np.testing.assert_allclose(main.CUBE, expected, atol=1e-7)
        rgb = client.post("/rgb", json={"indices": [9, 5, 1], "display": {"mode": "channel"}})
        assert rgb.status_code == 200, rgb.text
        decoded = cv2.imdecode(np.frombuffer(bytes.fromhex(rgb.json()["image"]), np.uint8), cv2.IMREAD_COLOR)
        assert decoded.shape == (12, 10, 3)
        annotations = []
        for index, shape in enumerate([
            {"type": "point", "x": 4, "y": 4},
            {"type": "rectangle", "x0": 2, "y0": 2, "x1": 5, "y1": 5},
            {"type": "circle", "cx": 6, "cy": 6, "radius": 2},
            {"type": "polygon", "points": [[2, 2], [5, 2], [5, 5], [2, 5]]},
        ]):
            spectra = client.post("/spectra", json={"shape": shape})
            assert spectra.status_code == 200, spectra.text
            assert len(spectra.json()["spectra"]) == 12
            assert spectra.json()["bands"] == loaded.json()["bands"]
            annotations.append({"label": f"Class {index}", "shape": shape})
        for method in ("pca", "kmeans", "unsupervised_suite"):
            result = client.post("/analysis", json={"method": method, "clusters": 3})
            assert result.status_code == 200, result.text
            if method == "unsupervised_suite":
                assert len(result.json()["visuals"]) == 12
        result = client.post("/supervised", json={"method": "sam", "annotations": annotations})
        assert result.status_code == 200, result.text
        assert result.json()["total_pixels"] == 120
        assert len(result.json()["classes"]) == 4
        persistence = {"folder_path": entry["folder_path"], "data_hdr_name": entry["data_hdr_name"]}
        assert client.post("/annotations", json={**persistence, "annotations": annotations}).status_code == 200
        assert client.post("/roi", json={**persistence, "shape": annotations[1]["shape"]}).status_code == 200
        registration = client.post("/registration", json={"method": "affine",
            "movingImage": {"folderPath": entry["folder_path"], "dataHdrName": entry["data_hdr_name"]},
            "pointPairs": [], "registrationParameters": {"matrix3x3": np.eye(3).tolist()}})
        assert registration.status_code == 200, registration.text
        # Reload via the top-level acquisition folder to verify sidecar resolution.
        root = hdr.parent.parent if entry["sensor"] == "Specim" else imec.parent
        reloaded = client.post("/load", data={"folder_path": str(root)}).json()
        assert len(reloaded["annotations"]) == 4
        assert reloaded["roi_shape"] == annotations[1]["shape"]


def test_single_scan_legacy_reference_names_and_ignore_ambiguous_references(specim):
    hdr, raw, expected, _ = specim
    for old, new in (("DARKREF_scene", "DARKREF_session"), ("WHITEREF_scene", "WHITEREF_session")):
        for ext in (".hdr", ".raw"):
            (hdr.parent / (old + ext)).rename(hdr.parent / (new + ext))
    cube, *_ = hsi_loader.load_hsi(str(hdr))
    np.testing.assert_allclose(cube, expected, atol=1e-7)
    (hdr.parent / 'DARKREF_another.hdr').touch()
    with pytest.raises(ValueError, match='Ambiguous DARKREF'):
        hsi_loader.load_hsi(str(hdr))
    cube, *_ = hsi_loader.load_hsi(str(hdr), ignore_dark_ref=True)
    np.testing.assert_array_equal(cube, raw)


def test_duplicate_scan_names_in_separate_folders_load_independently(specim):
    hdr, _, _, metadata = specim
    second = write_cube(hdr.parents[2] / 'Second' / 'capture' / 'scene.hdr',
                        np.full((2, 10, 12), 123, dtype=np.uint16), metadata)
    client = TestClient(main.app)
    queued = client.get('/measurements', params={'folder_path': str(hdr.parents[2])}).json()['measurements']
    assert len(queued) == 2
    assert len({item['folder_path'] for item in queued}) == 2
    for entry in queued:
        result = client.post('/load', data={'folder_path': entry['folder_path'], 'data_hdr_name': entry['data_hdr_name']})
        assert result.status_code == 200, result.text
        if entry['folder_path'] == str(second.parent):
            np.testing.assert_array_equal(main.CUBE, 123)
            assert result.json()['calibration']['status'] == 'raw'
