## Loading IMEC and Specim measurements

Paste a main folder into **Dataset folder path**, click **Queue path**, then double-click a measurement. The scan includes subfolders (including Specim `capture/` folders), so one queue can contain both IMEC and Specim scans. Reference files are excluded. The camera is detected from the ENVI header; other ENVI exports remain supported.

Specim scans use their matching `DARKREF`/`WHITEREF` (or `DR`/`WR`) cubes automatically. Lumo manifests are supported, along with references beside the scan or in its acquisition's `calibrations/` folder. References are averaged across scan lines, then reflectance is computed as `(signal - dark) / (white - dark)` and clipped to `[0, 1]`. Samples, wavelengths and Specim integration times are checked before calibration. Invalid reference positions are set to zero with a warning.

Both references are needed: missing or deliberately ignored references leave the data raw and show a warning. Exported reflectance is not calibrated again. The queue reports **WR/DR calibrated**, **Reflectance**, or **Raw** after loading. IMEC sensor-frame dark references still require a compatible cube or an already calibrated Snapscan export.

RGB controls, spectra, annotation/ROI saving, CSV export, unsupervised analysis, supervised classification and image registration use the same workflow for both cameras. Specim's suggested RGB bands are selected initially. Sidecars are saved beside the measurement header, including inside `capture/`.

For example, queue `/Users/thomas/Desktop/PE_PS`, or its parent folder to include other measurements.

Validation:

```sh
python -m pytest backend
cd frontend
CI=true npm test -- --watchAll=false --runInBand
npm run build
```

```
cd .\HSI_app\backend\
uvicorn main:app --reload
```


```
cd .\HSI_app\frontend\
npm install
npm start
```


```
cd .\HSI_app\frontend\
npm start
```