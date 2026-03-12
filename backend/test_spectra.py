import numpy as np
import sys
import types
from fastapi.testclient import TestClient


mock_cv2 = types.ModuleType("cv2")
mock_cv2.COLOR_RGB2BGR = 0
mock_cv2.COLORMAP_TURBO = 1
mock_cv2.COLORMAP_MAGMA = 2
mock_cv2.COLORMAP_VIRIDIS = 3
mock_cv2.COLORMAP_PLASMA = 4
mock_cv2.COLORMAP_INFERNO = 5


def _imencode_stub(*_args, **_kwargs):
    image = _args[1] if len(_args) > 1 else np.array([], dtype=np.uint8)
    return True, np.asarray(image, dtype=np.uint8).reshape(-1)


def _cvt_color_stub(image, _code):
    return image


def _apply_color_map_stub(image, _colormap):
    if image.ndim == 2:
        return np.stack([image, image, image], axis=-1)
    return image


def _fill_poly_stub(image, polygons, color):
    polygon = np.asarray(polygons[0], dtype=np.int32)
    xs = polygon[:, 0]
    ys = polygon[:, 1]
    x0 = max(0, int(xs.min()))
    x1 = min(image.shape[1], int(xs.max()) + 1)
    y0 = max(0, int(ys.min()))
    y1 = min(image.shape[0], int(ys.max()) + 1)
    image[y0:y1, x0:x1] = color
    return image


mock_cv2.imencode = _imencode_stub
mock_cv2.cvtColor = _cvt_color_stub
mock_cv2.applyColorMap = _apply_color_map_stub
mock_cv2.fillPoly = _fill_poly_stub
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


def test_polygon_roi_selection_returns_polygon_mean():
    payload = {
        "shape": {
            "type": "polygon",
            "points": [
                {"x": 0, "y": 0},
                {"x": 2, "y": 0},
                {"x": 2, "y": 2},
                {"x": 0, "y": 2},
            ],
        }
    }
    res = client.post("/spectra", json=payload)
    assert res.status_code == 200
    data = res.json()
    roi = main.CUBE[0:3, 0:3, :]
    expected = roi.mean(axis=(0, 1)).tolist()
    assert data["spectra"] == expected


def test_rgb_endpoint_blacks_out_pixels_outside_roi():
    payload = {
        "indices": [0, 1, 2],
        "roi_shape": {
            "type": "polygon",
            "points": [
                {"x": 0, "y": 0},
                {"x": 1, "y": 0},
                {"x": 1, "y": 1},
                {"x": 0, "y": 1},
            ],
        },
    }
    res = client.post("/rgb", json=payload)
    assert res.status_code == 200
    rgb = np.frombuffer(bytes.fromhex(res.json()["image"]), dtype=np.uint8)
    assert rgb.size == main.CUBE.shape[0] * main.CUBE.shape[1] * 3
    assert np.count_nonzero(rgb == 0) > 0
