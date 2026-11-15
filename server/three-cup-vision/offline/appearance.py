"""Manual liquid ROI spatial Lab dispersion, not chemistry or calibrated accuracy."""
from dataclasses import dataclass
import math
import cv2
import numpy as np
from .markers import valid_time, MARKERS


@dataclass(frozen=True)
class Calibration:
    version: str
    setup_id: str
    uniform_max: float
    streaked_min: float
    min_focus: float
    max_glare_fraction: float

    def __post_init__(self):
        values = (self.uniform_max,self.streaked_min,self.min_focus,self.max_glare_fraction)
        if (not isinstance(self.version,str) or not self.version.strip() or
            not isinstance(self.setup_id,str) or not self.setup_id.strip() or
            any(type(x) not in (int,float) or not math.isfinite(x) for x in values) or
            not 0 <= self.uniform_max < self.streaked_min or self.min_focus < 0 or
            not 0 <= self.max_glare_fraction < 1):
            raise ValueError('Invalid setup calibration')


def assess_appearance(frame, roi, *, cup_id, time_ms, setup_id,
                      calibration=None, stationary=None, unobstructed=None,
                      pre_transfer=None):
    if cup_id not in MARKERS.values() or not valid_time(time_ms):
        raise ValueError('Known physically verified cup and valid timestamp required')
    result = dict(cupId=cup_id,assessmentTimeMs=time_ms,label='unclear',
                  metricName='lab_spatial_dispersion',metricValue=None,
                  calibrationVersion=calibration.version if calibration else None,
                  roi=list(roi),qualityFlags=[],uncertain=True,evidenceFrameIds=[])
    flags = result['qualityFlags']
    if calibration is None: flags.append('uncalibrated')
    elif calibration.setup_id != setup_id: flags.append('calibration_setup_mismatch')
    for value,name in [(stationary,'stationarity_unverified'),(unobstructed,'occlusion_unverified'),(pre_transfer,'pre_transfer_unverified')]:
        if value is not True: flags.append(name)
    if (not isinstance(frame,np.ndarray) or frame.dtype != np.uint8 or frame.ndim!=3 or frame.shape[2]!=3
        or len(roi)!=4 or any(type(v) is not int for v in roi)):
        flags.append('invalid_crop')
        return result
    x,y,w,h = roi
    if x<0 or y<0 or w<8 or h<8 or x+w>frame.shape[1] or y+h>frame.shape[0]:
        flags.append('invalid_crop')
        return result
    crop = frame[y:y+h,x:x+w]
    hsv = cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
    glare = (hsv[:,:,2]>=245) & (hsv[:,:,1]<=30)
    glare_fraction = float(glare.mean())
    focus = float(cv2.Laplacian(cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var())
    result.update(glareFraction=glare_fraction,focusMeasure=focus)
    if calibration:
        if glare_fraction > calibration.max_glare_fraction: flags.append('glare')
        if focus < calibration.min_focus: flags.append('low_focus')
    # float Lab has L in [0,100] and signed a/b, unlike uint8 encoded Lab.
    lab = cv2.cvtColor(crop.astype(np.float32)/255.0,cv2.COLOR_BGR2LAB)
    means = []
    within_variances = []
    for ys in np.array_split(np.arange(h),4):
        for xs in np.array_split(np.arange(w),4):
            valid = ~glare[np.ix_(ys,xs)]
            if valid.mean() < 0.5:
                flags.append('insufficient_visible_liquid')
                return result
            pixels = lab[np.ix_(ys,xs)][valid]
            mean = pixels.mean(axis=0)
            means.append(mean)
            within_variances.append(float(np.mean(np.sum((pixels-mean)**2,axis=1))))
    cells = np.asarray(means)
    score = float(np.sqrt(np.mean(np.sum((cells-cells.mean(axis=0))**2,axis=1)) + np.mean(within_variances)))
    result['metricValue'] = score
    if not flags:
        if score <= calibration.uniform_max: result['label']='visually_uniform'
        elif score >= calibration.streaked_min: result['label']='visibly_streaked'
        else: flags.append('calibration_gray_zone')
    result['uncertain'] = result['label']=='unclear'
    return result
