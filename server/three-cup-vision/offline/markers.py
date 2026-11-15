"""Visible physical marker evidence. No inferred positions during occlusion."""
import math
import cv2
import numpy as np

MARKERS = {10: 'RED', 20: 'GREEN', 30: 'BLUE'}


def valid_time(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def detect_markers(frame, time_ms):
    if not valid_time(time_ms):
        raise ValueError('time_ms must be finite, nonnegative original-recording milliseconds')
    if not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3 or min(frame.shape[:2]) < 4:
        raise ValueError('Expected a nonempty uint8 BGR image')
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    detector = cv2.aruco.ArucoDetector(dictionary)
    corners, ids, _ = detector.detectMarkers(frame)
    found = {}
    if ids is not None:
        for box, mid in zip(corners, ids.flatten()):
            found.setdefault(int(mid), []).append(box.reshape(4,2))
    result = []
    for mid in sorted(set(MARKERS) | set(found)):
        boxes = found.get(mid, [])
        unique = len(boxes) == 1
        known = mid in MARKERS
        box = boxes[0] if unique else None
        result.append(dict(markerId=mid, cupId=MARKERS[mid] if known and unique else None,
                           visible=unique, evidenceTimeMs=time_ms,
                           bbox=([float(box[:,0].min()),float(box[:,1].min()),
                                  float(box[:,0].max()),float(box[:,1].max())] if unique else None),
                           corners=box.tolist() if unique else [],
                           uncertain=not (known and unique),
                           qualityFlags=(['duplicate_marker'] if len(boxes)>1 else
                                         ['not_visible'] if not boxes else
                                         ['unrecognized_marker'] if not known else [])))
    return result


class MarkerTracker:
    """Re-identifies visible IDs each frame; retains no hidden position or identity."""
    def __init__(self):
        self.last_time_ms = None

    def update(self, frame, time_ms):
        if not valid_time(time_ms) or (self.last_time_ms is not None and time_ms <= self.last_time_ms):
            raise ValueError('Tracking requires strictly increasing original-recording timestamps')
        result = detect_markers(frame, time_ms)
        self.last_time_ms = time_ms
        return result


def overlay(frame, observations):
    output = frame.copy()
    for item in observations:
        if item['bbox'] is not None:
            x1,y1,x2,y2 = map(round,item['bbox'])
            cv2.rectangle(output,(x1,y1),(x2,y2),(0,180,0),2)
            cv2.putText(output,item['cupId'] or 'UNKNOWN',(x1,max(15,y1-5)),cv2.FONT_HERSHEY_SIMPLEX,0.5,(0,0,255),1)
    return output
