"""Sequential decoder using source presentation timestamps, never FPS-invented times."""
from pathlib import Path
import cv2
from .markers import valid_time


def frames(path):
    if not Path(path).is_file():
        raise ValueError('Video file does not exist')
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened(): raise ValueError('Cannot open video')
        last = None
        index = 0
        while True:
            ok, frame = capture.read()
            if not ok: break
            time_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
            if not valid_time(time_ms) or (last is not None and time_ms <= last):
                raise ValueError('Decoder did not supply increasing presentation timestamps')
            yield index,time_ms,frame
            last = time_ms
            index += 1
        if not index: raise ValueError('No decodable video frames')
    finally:
        capture.release()
