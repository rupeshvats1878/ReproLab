"""Temporary synthetic files test software integrity, not recorded experiment accuracy."""
import csv
import tempfile
import unittest
from pathlib import Path
from offline.data import validate_labels, LABEL_FIELDS

class DataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'take.mp4').write_bytes(b'synthetic-file-integrity-fixture')
        self.row = dict.fromkeys(LABEL_FIELDS,'')
        self.row.update(video_id='v1',video_path='take.mp4',session_id='s1',split='train',event_index='1',event_type='transfer',source_cup='RED',destination_cup='BLUE',start_ms='0',end_ms='100',occluded='false',annotator='tester')

    def validate(self, rows):
        path = self.root/'labels.csv'
        with path.open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=LABEL_FIELDS); w.writeheader(); w.writerows(rows)
        return validate_labels(path,self.root)

    def test_valid_and_empty(self):
        result=self.validate([self.row])
        self.assertEqual(result['events'],1)
        self.assertEqual(len(result['files'][0]['sha256']),64)
        self.assertEqual(self.validate([])['status'],'not_evaluated')

    def test_session_and_file_leakage(self):
        for change in [dict(split='test'),dict(split='test',session_id='s2',video_id='v2')]:
            with self.assertRaises(ValueError): self.validate([self.row,{**self.row,'event_index':'2',**change}])

    def test_bad_labels(self):
        for change in [dict(end_ms='-1'),dict(start_ms='nan'),dict(source_cup='PURPLE'),dict(occluded='maybe'),dict(annotator=''),dict(event_type='no_transfer'),dict(video_path='../other.mp4'),dict(video_path='missing.mp4')]:
            with self.subTest(change=change),self.assertRaises(ValueError): self.validate([{**self.row,**change}])
        with self.assertRaises(ValueError): self.validate([self.row,self.row])
