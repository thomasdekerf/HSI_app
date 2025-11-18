import numpy as np

import hsi_loader


class _DummyEnviImage:
    def __init__(self, array, metadata=None):
        self._array = np.asarray(array)
        self.metadata = metadata or {}

    def load(self):
        return self._array


def test_normalizes_data_when_calibration_missing(monkeypatch, tmp_path):
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

    corrected, wavelengths, warning = hsi_loader.load_hsi(str(tmp_path))

    assert corrected.shape == data.shape
    assert np.isclose(np.min(corrected), 0.0)
    assert np.isclose(np.max(corrected), 1.0)
    assert warning and "normalized uncorrected data" in warning
    assert wavelengths == [1.0, 2.0, 3.0]


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

    corrected, wavelengths, warning = hsi_loader.load_hsi(str(tmp_path))

    expected = np.clip((data - dark.mean(axis=0)) / (white.mean(axis=0) - dark.mean(axis=0) + 1e-8), 0, 1)
    assert np.allclose(corrected, expected)
    assert wavelengths == [10.0, 20.0]
    assert warning is None
