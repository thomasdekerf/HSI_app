import numpy as np
import sys
import types
from fastapi.testclient import TestClient


mock_cv2 = types.ModuleType("cv2")


def _imencode_stub(*_args, **_kwargs):
    return True, np.array([], dtype=np.uint8)


mock_cv2.imencode = _imencode_stub
sys.modules.setdefault("cv2", mock_cv2)


from main import app
import main


def setup_module(_module):
    # Prepare a simple deterministic cube for testing
    cube = np.arange(4 * 4 * 3, dtype=float).reshape((4, 4, 3))
    main.CUBE = cube
    main.BANDS = [500, 600, 700]


def teardown_module(_module):
    main.CUBE = None
    main.BANDS = None


client = TestClient(app)


def test_pixel_region_selection_returns_mean_spectrum():
    payload = {"rect": {"x0": 0, "y0": 0, "x1": 2, "y1": 2}}
    res = client.post("/spectra", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "spectra" in data
    roi = main.CUBE[0:2, 0:2, :]
    expected = roi.mean(axis=(0, 1)).tolist()
    assert data["spectra"] == expected


def test_normalized_region_selection_supported():
    payload = {"rect": {"x0": 0.0, "y0": 0.0, "x1": 0.5, "y1": 0.5, "normalized": True}}
    res = client.post("/spectra", json=payload)
    assert res.status_code == 200
    data = res.json()
    roi = main.CUBE[0:2, 0:2, :]
    expected = roi.mean(axis=(0, 1)).tolist()
    assert data["spectra"] == expected


def test_empty_selection_rejected():
    payload = {"rect": {"x0": 1, "y0": 1, "x1": 1, "y1": 2}}
    res = client.post("/spectra", json=payload)
    assert res.status_code == 400
    assert res.json()["error"] == "Empty selection"
