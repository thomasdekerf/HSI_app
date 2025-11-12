from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hsi_loader import load_hsi, extract_rgb
import cv2, os
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
        return {"error": "No cube loaded"}
    data = await req.json()
    rect = data.get("rect")  # {x,y,width,height}
    if rect is None:
        return {"error": "No region"}
    x0, y0 = int(rect["x"]), int(rect["y"])
    w, h = int(rect["width"]), int(rect["height"])
    roi = CUBE[y0:y0+h, x0:x0+w, :]
    mean_spec = roi.mean(axis=(0,1)).tolist()
    return {"spectra": mean_spec, "bands": BANDS}
