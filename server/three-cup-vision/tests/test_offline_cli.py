import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from extract_frames import extract

class CLITests(unittest.TestCase):
    def test_frame_cli_and_overlay(self):
        with tempfile.TemporaryDirectory() as directory:
            overlay=Path(directory)/'overlay.png'
            run=subprocess.run([sys.executable,'-m','offline','frame','markers/red_id10.png','--time-ms','120','--overlay',str(overlay)],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            result=json.loads(run.stdout)
            self.assertEqual(result['observedTransfers'],[])
            self.assertEqual(result['cupMarkers'][0]['cupId'],'RED')
            self.assertTrue(overlay.is_file())

    def test_video_extraction_and_tracking(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            video=root/'synthetic.avi'
            writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10,(350,350))
            self.assertTrue(writer.isOpened())
            marker=cv2.imread(str(ROOT/'markers/red_id10.png'))
            for frame in [marker,np.full_like(marker,255),marker]: writer.write(frame)
            writer.release()
            run=subprocess.run([sys.executable,'-m','offline','video',str(video),'--session-id','synthetic','--video-id','fixture'],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            results=[json.loads(line) for line in run.stdout.splitlines()]
            self.assertEqual(len(results),3)
            self.assertEqual([r['cupMarkers'][0]['cupId'] for r in results],['RED',None,'RED'])
            self.assertEqual(extract(video,10,root/'frames'),3)
            with self.assertRaises(ValueError): extract(video,float('nan'),root/'bad')
            with self.assertRaises(FileExistsError): extract(video,10,root/'frames')
