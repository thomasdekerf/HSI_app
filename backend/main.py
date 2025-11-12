from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hsi_loader import load_hsi, extract_rgb
import numpy as np, cv2, tempfile, os
import math

from fastapi import Request

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
CUBE = None
BANDS = None

@app.post("/load")
async def load_dataset(folder_path: str = Form(...)):
    global CUBE, BANDS
    if not os.path.exists(folder_path):
        return JSONResponse({"error": f"Path not found: {folder_path}"}, status_code=400)
    try:
        CUBE, BANDS, metadata_warning = load_hsi(folder_path)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Failed to load dataset: {exc}"}, status_code=500)

    response = {"bands": BANDS, "shape": CUBE.shape}
    if metadata_warning:
        response["warning"] = metadata_warning
    return response

@app.get("/rgb")
def get_rgb(r: int = 10, g: int = 20, b: int = 30):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)
    rgb = extract_rgb(CUBE, [r, g, b])
    _, buf = cv2.imencode(".jpg", rgb)
    return {"image": buf.tobytes().hex()}


@app.post("/spectra")
async def get_spectra(req: Request):
    if CUBE is None:
        return JSONResponse({"error": "No cube loaded"}, status_code=400)
    data = await req.json()
    rect = data.get("rect")
    if rect is None:
        return JSONResponse({"error": "No region"}, status_code=400)

    try:
        x0 = float(rect["x0"])
        y0 = float(rect["y0"])
        x1 = float(rect["x1"])
        y1 = float(rect["y1"])
    except (KeyError, TypeError, ValueError):
        return JSONResponse({"error": "Invalid region"}, status_code=400)

    height, width = CUBE.shape[:2]
    is_normalized = bool(rect.get("normalized"))
    if not is_normalized:
        # auto-detect normalized coordinates if values are within [0, 1]
        coords = [x0, x1, y0, y1]
        if all(0 <= c <= 1 for c in coords):
            is_normalized = True

    if is_normalized:
        x0 *= width
        x1 *= width
        y0 *= height
        y1 *= height

    x_start = math.floor(min(x0, x1))
    x_end = math.ceil(max(x0, x1))
    y_start = math.floor(min(y0, y1))
    y_end = math.ceil(max(y0, y1))

    x_start = max(0, min(width, x_start))
    x_end = max(0, min(width, x_end))
    y_start = max(0, min(height, y_start))
    y_end = max(0, min(height, y_end))

    if x_end <= x_start or y_end <= y_start:
        return JSONResponse({"error": "Empty selection"}, status_code=400)

    roi = CUBE[y_start:y_end, x_start:x_end, :]
    if roi.size == 0:
        return JSONResponse({"error": "Empty selection"}, status_code=400)

    mean_spec = roi.mean(axis=(0, 1)).tolist()
    return {"spectra": mean_spec, "bands": BANDS}
