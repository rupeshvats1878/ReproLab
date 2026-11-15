"""Extract frames for human annotation; no inferred labels or synthetic timestamps."""
import argparse
import csv
import math
from pathlib import Path
import sys
import cv2
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from offline.video import frames
from offline.data import file_sha256


def extract(path: Path, fps: float, dest: Path):
    if not math.isfinite(fps) or not 0 < fps <= 30:
        raise ValueError('fps must be finite and between 0 and 30')
    if dest.exists(): raise FileExistsError('Use a new output directory to preserve prior frames')
    digest = file_sha256(path)
    dest.mkdir(parents=True)
    count = 0
    next_ms = 0.0
    with (dest/'frame_manifest.csv').open('w',newline='') as handle:
        writer=csv.writer(handle)
        writer.writerow(['filename','original_video','video_time_ms','frame_index','source_sha256','timestamp_method'])
        for index,time_ms,frame in frames(path):
            if time_ms + 1e-6 < next_ms: continue
            filename=f'frame_{index:08d}.png'
            if not cv2.imwrite(str(dest/filename),frame): raise IOError('Cannot write extracted frame')
            writer.writerow([filename,path.name,time_ms,index,digest,'decoder_pos_msec'])
            count+=1
            next_ms=time_ms+1000/fps
    return count


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('video',type=Path)
    parser.add_argument('--fps',type=float,default=4.0)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(f'Wrote {extract(args.video,args.fps,args.output)} frames')
