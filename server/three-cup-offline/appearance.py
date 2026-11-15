"""Stationary manual liquid ROI measurement. Labels remain unclear until calibrated."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from offline import CUPS, identifier, number, require


def measure(image, roi, cup_id, frame_id, time_ms):
    require(cup_id is None or cup_id in CUPS, "invalid physical cup_id")
    identifier(frame_id, "frame_id")
    number(time_ms, "original recording time_ms")
    require(isinstance(image, np.ndarray) and image.dtype == np.uint8 and
            image.ndim == 3 and image.shape[2] == 3, "expected uint8 BGR image")
    require(len(roi) == 4 and all(type(v) is int for v in roi), "ROI must be integer x,y,width,height")
    x, y, width, height = roi
    require(x >= 0 and y >= 0 and width >= 8 and height >= 8 and
            x + width <= image.shape[1] and y + height <= image.shape[0],
            "ROI outside image or smaller than 8 pixels")
    crop = image[y:y + height, x:x + width]
    lab = cv2.cvtColor(crop.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    cells = [cell.mean(axis=(0, 1)) for band in np.array_split(lab, 4, axis=0)
             for cell in np.array_split(band, 4, axis=1)]
    cells = np.asarray(cells)
    dispersion = float(np.sqrt(np.mean(np.sum((cells - cells.mean(axis=0)) ** 2, axis=1))))
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return {
        "schemaVersion": "three-cup-appearance/1", "cupId": cup_id,
        "cupIdentityMethod": "unknown" if cup_id is None else "human_selected_physical_label",
        "frameId": frame_id, "timeMs": time_ms, "timeDomain": "original_recording_ms",
        "timestampSource": "operator_supplied",
        "roi": list(roi), "methodVersion": "lab-cell-dispersion/1",
        "metricName": "lab_cell_dispersion", "metricValue": dispersion,
        "label": "unclear", "calibrationVersion": None,
        "qualityFlags": ["uncalibrated", "stationarity_and_occlusion_require_human_review"],
        "qualityMeasurements": {
            "laplacianVariance": float(cv2.Laplacian(gray, cv2.CV_64F).var()),
            "nearWhiteFraction": float(np.mean(np.all(crop >= 250, axis=2))),
            "nearBlackFraction": float(np.mean(np.all(crop <= 5, axis=2))),
            "roiPixelCount": width * height,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--roi", required=True, nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--cup", required=True, choices=sorted(CUPS) + ["unknown"])
    parser.add_argument("--frame-id", required=True)
    parser.add_argument("--time-ms", required=True, type=float)
    args = parser.parse_args()
    try:
        path = Path(args.image).resolve(strict=True)
        image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        require(image is not None, "image decode failed")
        result = measure(image, args.roi, None if args.cup == "unknown" else args.cup, args.frame_id, args.time_ms)
        result["sourceImage"] = str(path)
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, OSError, cv2.error) as error:
        parser.exit(2, str(error) + "\n")


if __name__ == "__main__":
    main()
