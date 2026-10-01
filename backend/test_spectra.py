import numpy as np
import json
import cv2
from fastapi.testclient import TestClient


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
    rgb = cv2.imdecode(np.frombuffer(bytes.fromhex(res.json()["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert rgb.size == main.CUBE.shape[0] * main.CUBE.shape[1] * 3
    assert np.count_nonzero(rgb == 0) > 0


def test_save_annotations_writes_labelme_style_sidecar(tmp_path):
    payload = {
        "folder_path": str(tmp_path),
        "data_hdr_name": "scene.hdr",
        "annotations": [
            {
                "id": "region-1",
                "label": "Bottle cap",
                "color": "#ff0000",
                "lineStyle": "dash",
                "shape": {
                    "type": "rectangle",
                    "x0": 0,
                    "y0": 0,
                    "x1": 2,
                    "y1": 2,
                },
            }
        ],
    }
    res = client.post("/annotations", json=payload)
    assert res.status_code == 200
    annotations_path = tmp_path / "scene.annotations.json"
    assert annotations_path.exists()
    saved = json.loads(annotations_path.read_text(encoding="utf-8"))
    assert saved["imagePath"] == "scene.hdr"
    assert saved["shapes"][0]["label"] == "Bottle cap"
    assert saved["shapes"][0]["shape_type"] == "rectangle"


def test_load_saved_annotations_rehydrates_spectra(tmp_path):
    annotations_path = tmp_path / "scene.annotations.json"
    annotations_path.write_text(
        json.dumps(
            {
                "version": "5.0.1",
                "imagePath": "scene.hdr",
                "imageHeight": 4,
                "imageWidth": 4,
                "shapes": [
                    {
                        "label": "Test region",
                        "points": [[0, 0], [2, 2]],
                        "shape_type": "rectangle",
                        "codex_id": "saved-1",
                        "codex_color": "#00ff00",
                        "codex_line_style": "dot",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    loaded = main._load_saved_annotations(str(tmp_path), "scene.hdr", main.CUBE)
    assert len(loaded) == 1
    assert loaded[0]["label"] == "Test region"
    assert loaded[0]["color"] == "#00ff00"
    assert loaded[0]["lineStyle"] == "dot"
    assert loaded[0]["shape"]["type"] == "rectangle"
    assert loaded[0]["bounds"] == {"x0": 0, "x1": 2, "y0": 0, "y1": 2}


def test_save_registration_persists_json_next_to_moving_image(tmp_path):
    payload = {
        "method": "affine",
        "referenceImage": {
            "measurementId": "measurement-a",
            "name": "reference",
            "folderPath": str(tmp_path),
            "dataHdrName": "reference.hdr",
            "width": 16,
            "height": 12,
        },
        "movingImage": {
            "measurementId": "measurement-b",
            "name": "moving",
            "folderPath": str(tmp_path),
            "dataHdrName": "moving.hdr",
            "width": 16,
            "height": 12,
        },
        "pointPairs": [
            {
                "index": 1,
                "reference": {"x": 1, "y": 2},
                "moving": {"x": 3, "y": 4},
            }
        ],
        "registrationParameters": {
            "matrix3x3": [[1, 0, 2], [0, 1, 3], [0, 0, 1]],
            "meanResidualPixels": 0.5,
        },
    }
    res = client.post("/registration", json=payload)
    assert res.status_code == 200
    registration_path = tmp_path / "moving.registration.json"
    assert registration_path.exists()
    saved = json.loads(registration_path.read_text(encoding="utf-8"))
    assert saved["method"] == "affine"
    assert saved["movingImage"]["dataHdrName"] == "moving.hdr"
    assert saved["registrationParameters"]["matrix3x3"][0][2] == 2


def test_raw_rgb_uses_full_dynamic_range_without_changing_spectra():
    cube = np.arange(300., 348., dtype=np.float32).reshape(4, 4, 3)
    original = cube.copy()
    rgb, metadata = main._scale_rgb_for_display(cube, [0, 1, 2], None, {'mode': 'channel'})
    assert main._default_display_mode(cube) == 'channel'
    assert rgb.min() == 0 and rgb.max() == 255
    assert np.unique(rgb).size > 10
    assert metadata['histogram']['range'][1] == 347
    assert metadata['histogram']['channels'][0]['p1'] > 300
    np.testing.assert_array_equal(cube, original)
    assert main._default_display_mode(cube / 400) == 'clip'
