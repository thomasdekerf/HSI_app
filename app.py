from flask import Flask, request, send_file, render_template, jsonify
import h5py
import numpy as np
import io
from PIL import Image
app = Flask(__name__)
global hsi_data
hsi_data = None

def generate_rgb_image(hsi_data, bands):
    # Select three random bands for RGB channels
    bands = [int(b) for b in bands]
    rgb_data = hsi_data[:,:,bands]

    # Normalize each band to the range [0, 255]
    rgb_normalized = ((rgb_data - np.min(rgb_data)) / (np.max(rgb_data) - np.min(rgb_data)) * 255).astype(np.uint8)

    # Convert to PIL Image and save to a BytesIO buffer
    img = Image.fromarray(rgb_normalized, 'RGB')
    img_buffer = io.BytesIO()
    img.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    return img_buffer

@app.route('/upload', methods=['POST'])
def upload_file():
    global hsi_data
    file = request.files['file']
    if file:
        # Read the HSI data from the H5 file
        hsi_data = h5py.File(io.BytesIO(file.read()), 'r')['low_res'][:,:,:]  # Replace with your dataset key
        img_buffer = generate_rgb_image(hsi_data, bands=[50, 100, 150])
        return send_file(img_buffer, mimetype='image/png')
    return 'No file uploaded', 400

@app.route('/get_spectrum', methods=['GET'])
def get_spectrum():
    global hsi_data
    if hsi_data is None:
        return jsonify({"error": "HSI data not loaded"}), 404

    x = request.args.get('x', default=0, type=int)
    y = request.args.get('y', default=0, type=int)

    # Extract the spectrum for the pixel (y, x)
    spectrum = hsi_data[y, x, :].tolist()
    return jsonify(spectrum)

@app.route('/get_rgb_image', methods=['GET'])
def get_rgb_image():
    global hsi_data
    if hsi_data is None:
        return "HSI data not loaded", 404
    # Read band values from query parameters
    band1 = request.args.get('band1', default=0, type=int)
    band2 = request.args.get('band2', default=1, type=int)
    band3 = request.args.get('band3', default=2, type=int)

    # Load HSI data (consider storing this in memory or a temporary file after first upload)
    # ... load hsi_data logic ...

    img_buffer = generate_rgb_image(hsi_data, [band1, band2, band3])
    return send_file(img_buffer, mimetype='image/png')

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True)
