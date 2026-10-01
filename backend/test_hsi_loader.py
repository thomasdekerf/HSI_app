import numpy as np

import hsi_loader


class _DummyEnviImage:
    def __init__(self, array, metadata=None):
        self._array = np.asarray(array)
        self.metadata = metadata or {}

    def load(self):
        return self._array


def test_returns_raw_data_when_calibration_missing(monkeypatch, tmp_path):
    data = np.array(
        [
            [[10.0, 20.0, 30.0], [40.0, 50.0, 60.0]],
            [[70.0, 80.0, 90.0], [100.0, 110.0, 120.0]],
        ]
    )

    data_hdr = tmp_path / "sample.hdr"
    data_hdr.touch()

    monkeypatch.setattr(hsi_loader, "find_file", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(hsi_loader, "_iter_hdr_files", lambda _folder: iter([data_hdr]))
    monkeypatch.setattr(
        hsi_loader.envi,
        "open",
        lambda *_args, **_kwargs: _DummyEnviImage(data, metadata={"wavelength": [1, 2, 3]}),
    )

    corrected, wavelengths, warning, data_file = hsi_loader.load_hsi(str(tmp_path))

    assert corrected.shape == data.shape
    assert np.allclose(corrected, data)
    assert warning and "raw uncorrected data" in warning
    assert wavelengths == [1.0, 2.0, 3.0]
    assert data_file == "sample"


def test_preserves_calibrated_path(monkeypatch, tmp_path):
    data = np.full((2, 2, 2), 10.0, dtype=np.float32)
    dark = np.zeros_like(data)
    white = np.full_like(data, 20.0)

    data_hdr = tmp_path / "scene.hdr"
    dark_hdr = tmp_path / "darkref.hdr"
    white_hdr = tmp_path / "whiteref.hdr"
    for hdr in (data_hdr, dark_hdr, white_hdr):
        hdr.touch()

    hdr_sequence = [data_hdr, dark_hdr, white_hdr]
    monkeypatch.setattr(hsi_loader, "_iter_hdr_files", lambda _folder: iter(hdr_sequence))
    monkeypatch.setattr(hsi_loader, "find_file", lambda _folder, keyword: dark_hdr if keyword.lower() == "darkref" else white_hdr)

    def _open_stub(hdr_path, _raw_path):
        if "darkref" in hdr_path:
            return _DummyEnviImage(dark)
        if "whiteref" in hdr_path:
            return _DummyEnviImage(white)
        return _DummyEnviImage(data, metadata={"wavelength": [10, 20]})

    monkeypatch.setattr(hsi_loader.envi, "open", _open_stub)

    corrected, wavelengths, warning, data_file = hsi_loader.load_hsi(str(tmp_path))

    expected = np.clip((data - dark.mean(axis=0)) / (white.mean(axis=0) - dark.mean(axis=0) + 1e-8), 0, 1)
    assert np.allclose(corrected, expected)
    assert wavelengths == [10.0, 20.0]
    assert warning is None
    assert data_file == "scene"


def test_can_ignore_calibration_refs(monkeypatch, tmp_path):
    data = np.array(
        [
            [[1.0, 2.0], [3.0, 4.0]],
            [[5.0, 6.0], [7.0, 8.0]],
        ]
    )
    dark = np.zeros_like(data)
    white = np.ones_like(data) * 2

    data_hdr = tmp_path / "scene.hdr"
    dark_hdr = tmp_path / "darkref.hdr"
    white_hdr = tmp_path / "whiteref.hdr"
    for hdr in (data_hdr, dark_hdr, white_hdr):
        hdr.touch()

    hdr_sequence = [data_hdr, dark_hdr, white_hdr]
    monkeypatch.setattr(hsi_loader, "_iter_hdr_files", lambda _folder: iter(hdr_sequence))
    monkeypatch.setattr(hsi_loader, "find_file", lambda _folder, keyword: dark_hdr if keyword.lower() == "darkref" else white_hdr)

    def _open_stub(hdr_path, _raw_path):
        if "darkref" in hdr_path:
            return _DummyEnviImage(dark)
        if "whiteref" in hdr_path:
            return _DummyEnviImage(white)
        return _DummyEnviImage(data, metadata={"wavelength": [10, 20]})

    monkeypatch.setattr(hsi_loader.envi, "open", _open_stub)

    corrected, wavelengths, warning, data_file = hsi_loader.load_hsi(
        str(tmp_path), ignore_dark_ref=True, ignore_white_ref=True
    )

    assert np.allclose(corrected, data)
    assert wavelengths == [10.0, 20.0]
    assert warning and "ignored by request" in warning
    assert warning and "raw uncorrected data" in warning
    assert data_file == "scene"


def test_reflectance_metadata_skips_missing_calibration_warning(monkeypatch, tmp_path):
    data = np.array(
        [
            [[0.1, 0.2], [0.3, 0.4]],
            [[0.5, 0.6], [0.7, 0.8]],
        ],
        dtype=np.float32,
    )

    data_hdr = tmp_path / "scene_object_corrected.hdr"
    data_hdr.touch()

    monkeypatch.setattr(hsi_loader, "_iter_hdr_files", lambda _folder: iter([data_hdr]))
    monkeypatch.setattr(hsi_loader.envi, "open", lambda *_args, **_kwargs: _DummyEnviImage(
        data,
        metadata={
            "wavelength": [500, 600],
            "corrected data": "1",
            "reflectance data": "1",
        },
    ))

    corrected, wavelengths, warning, data_file = hsi_loader.load_hsi(str(tmp_path))

    assert np.allclose(corrected, data)
    assert wavelengths == [500.0, 600.0]
    assert warning is None
    assert data_file == "scene_object_corrected"


def test_white_reference_name_is_not_selected_as_data(monkeypatch, tmp_path):
    white_hdr = tmp_path / "Muis1_white reference.hdr"
    data_hdr = tmp_path / "Muis1_object_corrected.hdr"
    white_hdr.touch()
    data_hdr.touch()

    monkeypatch.setattr(hsi_loader, "_iter_hdr_files", lambda _folder: iter([white_hdr, data_hdr]))

    selected = hsi_loader._select_data_hdr(tmp_path)

    assert selected == data_hdr


def test_loads_measurement_from_nested_capture_folder(monkeypatch, tmp_path):
    capture_folder = tmp_path / "PE_PS" / "capture"
    capture_folder.mkdir(parents=True)

    data = np.full((2, 2, 2), 12.0, dtype=np.float32)
    dark = np.full((2, 2, 2), 2.0, dtype=np.float32)
    white = np.full((2, 2, 2), 22.0, dtype=np.float32)

    data_hdr = capture_folder / "PE_PS.hdr"
    dark_hdr = capture_folder / "DARKREF_PE_PS.hdr"
    white_hdr = capture_folder / "WHITEREF_PE_PS.hdr"
    for hdr in (data_hdr, dark_hdr, white_hdr):
        hdr.touch()

    def _open_stub(hdr_path, _raw_path):
        if hdr_path.endswith("DARKREF_PE_PS.hdr"):
            return _DummyEnviImage(dark)
        if hdr_path.endswith("WHITEREF_PE_PS.hdr"):
            return _DummyEnviImage(white)
        return _DummyEnviImage(data, metadata={"wavelength": [1000, 1100]})

    monkeypatch.setattr(hsi_loader.envi, "open", _open_stub)

    corrected, wavelengths, warning, data_file = hsi_loader.load_hsi(
        str(tmp_path),
        data_hdr_name="PE_PS.hdr",
    )

    expected = np.clip((data - dark.mean(axis=0)) / (white.mean(axis=0) - dark.mean(axis=0) + 1e-8), 0, 1)
    assert np.allclose(corrected, expected)
    assert wavelengths == [1000.0, 1100.0]
    assert warning is None
    assert data_file == "PE_PS"


def test_filters_and_sorts_wavelengths_with_matching_cube_planes(monkeypatch, tmp_path):
    hdr = tmp_path / 'scene.hdr'
    hdr.touch()
    data = np.broadcast_to([90., 60., 20., 50., 80.], (3, 4, 5)).copy()
    monkeypatch.setattr(hsi_loader.envi, 'open', lambda *_args: _DummyEnviImage(
        data, metadata={'wavelength': [0, 600, 0, 500, 800], 'reflectance data': '1'},
    ))
    cube, bands, warning, _ = hsi_loader.load_hsi(str(tmp_path), crop_top=1, max_bands=2)
    assert bands == [500., 600.]
    assert cube.shape == (2, 4, 2)
    np.testing.assert_array_equal(cube[0, 0], [50., 60.])
    assert 'Excluded 2 bands' in warning


def test_recognizes_sensor_dark_frame_without_applying_it_as_a_cube(monkeypatch, tmp_path):
    (tmp_path / 'scene.hdr').touch()
    (tmp_path / 'scene_dark reference.raw').write_bytes(b'raw sensor data')
    (tmp_path / 'scene_dark reference.raw.xml').write_text(
        '<array kind="ROI_FRAME"><data_format nr_rows="960" nr_cols="2048"/></array>'
    )
    data = np.full((2, 3, 2), 300., dtype=np.float32)
    monkeypatch.setattr(hsi_loader.envi, 'open', lambda *_args: _DummyEnviImage(
        data, metadata={'wavelength': [500, 600]},
    ))
    cube, _, warning, _ = hsi_loader.load_hsi(str(tmp_path))
    np.testing.assert_array_equal(cube, data)
    assert '960x2048 sensor frame' in warning
    assert 'not reflectance' in warning
    assert 'missing (DARKREF' not in warning


def test_missing_wavelength_metadata_keeps_band_index_zero(monkeypatch, tmp_path):
    (tmp_path / 'scene.hdr').touch()
    data = np.ones((2, 3, 2), dtype=np.float32)
    monkeypatch.setattr(hsi_loader.envi, 'open', lambda *_args: _DummyEnviImage(
        data, metadata={'reflectance data': '1'},
    ))
    cube, bands, _, _ = hsi_loader.load_hsi(str(tmp_path))
    assert bands == [0, 1]
    np.testing.assert_array_equal(cube, data)
