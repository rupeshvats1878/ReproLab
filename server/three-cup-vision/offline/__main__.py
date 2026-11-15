"""Local offline CLI. JSON output never supplies an inferred transfer."""
import argparse
import json
from pathlib import Path
import cv2
from .appearance import Calibration, assess_appearance
from .data import validate_labels
from .markers import detect_markers, MarkerTracker, overlay
from .rules import compare_step
from .video import frames


def envelope(markers, time_ms, session_id, video_id, appearance=None):
    return dict(schemaVersion='three-cup-observation/v0.1',sessionId=session_id,videoId=video_id,
                videoSource='recorded_file',clipStartMs=time_ms,clipEndMs=time_ms,
                cupIdentityMethod='aruco_on_cup',cupMarkers=markers,cupAppearance=appearance or [],
                observedTransfers=[],modelId='offline-opencv-baseline',modelOutputVersion='0.1',
                warnings=['No transfer detector; empty observedTransfers is not a no-transfer verdict'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    frame=commands.add_parser('frame')
    frame.add_argument('image',type=Path)
    frame.add_argument('--time-ms',type=float,required=True)
    frame.add_argument('--session-id',default='unassigned')
    frame.add_argument('--video-id',default='unassigned')
    frame.add_argument('--overlay',type=Path)
    frame.add_argument('--appearance-config',type=Path,help='Manual ROI and quality review JSON; see README')
    video=commands.add_parser('video')
    video.add_argument('video',type=Path)
    video.add_argument('--session-id',required=True)
    video.add_argument('--video-id',required=True)
    labels=commands.add_parser('validate-labels')
    labels.add_argument('csv',type=Path)
    labels.add_argument('--media-root',type=Path,required=True)
    compare=commands.add_parser('compare')
    compare.add_argument('event',type=Path)
    compare.add_argument('--step',type=int,required=True)
    args=parser.parse_args()
    try:
        if args.command=='frame':
            image=cv2.imread(str(args.image))
            markers=detect_markers(image,args.time_ms)
            appearance=[]
            if args.appearance_config:
                config=json.loads(args.appearance_config.read_text())
                cal=config.pop('calibration',None)
                if cal is not None: cal=Calibration(**cal)
                # Identity is verified in this frame, not guessed from the chosen ROI's color.
                if config.get('cup_id') not in [m['cupId'] for m in markers if not m['uncertain']]:
                    raise ValueError('Appearance cup identity is not visible in this frame')
                appearance=[assess_appearance(image,time_ms=args.time_ms,calibration=cal,**config)]
            if args.overlay:
                args.overlay.parent.mkdir(parents=True,exist_ok=True)
                if args.overlay.exists(): raise FileExistsError('Overlay already exists')
                if not cv2.imwrite(str(args.overlay),overlay(image,markers)): raise IOError('Cannot write overlay')
            print(json.dumps(envelope(markers,args.time_ms,args.session_id,args.video_id,appearance),allow_nan=False))
        elif args.command=='video':
            tracker=MarkerTracker()
            for _,time_ms,image in frames(args.video):
                print(json.dumps(envelope(tracker.update(image,time_ms),time_ms,args.session_id,args.video_id),allow_nan=False))
        elif args.command=='validate-labels':
            print(json.dumps(validate_labels(args.csv,args.media_root),indent=2))
        elif args.command=='compare':
            print(json.dumps(compare_step(json.loads(args.event.read_text()),args.step),indent=2))
    except (ValueError,OSError,TypeError,KeyError) as error:
        parser.exit(2,f'Offline input error: {error}\n')


if __name__=='__main__': main()
