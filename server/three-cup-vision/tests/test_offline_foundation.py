"""Synthetic software checks only: not camera/model accuracy evaluation."""
import unittest
from pathlib import Path
import cv2
import numpy as np
from offline.markers import detect_markers, MarkerTracker
from offline.appearance import assess_appearance, Calibration
from offline.rules import compare_step

ROOT = Path(__file__).resolve().parents[1]

class MarkerTests(unittest.TestCase):
    def test_provided_markers(self):
        for cup, mid in [('RED', 10), ('GREEN', 20), ('BLUE', 30)]:
            frame = cv2.imread(str(ROOT / 'markers' / f'{cup.lower()}_id{mid}.png'))
            result = detect_markers(frame, 125)
            visible = [m for m in result if m['visible']]
            self.assertEqual([m['cupId'] for m in visible], [cup])
            self.assertEqual(visible[0]['evidenceTimeMs'], 125)
            self.assertEqual(len(visible[0]['bbox']), 4)

    def test_hidden_not_carried_forward_and_reacquired(self):
        tracker = MarkerTracker()
        frame = cv2.imread(str(ROOT / 'markers/red_id10.png'))
        self.assertTrue(tracker.update(frame, 0)[0]['visible'])
        hidden = tracker.update(np.full_like(frame, 255), 100)
        self.assertTrue(all(m['cupId'] is None for m in hidden))
        self.assertEqual(tracker.update(frame, 200)[0]['cupId'], 'RED')
        with self.assertRaises(ValueError): tracker.update(frame, 100)

    def test_unknown_and_duplicate_ids(self):
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        frame = np.full((250, 650, 3), 255, np.uint8)
        for x, mid in [(20,10), (230,10), (440,40)]:
            tile = cv2.aruco.generateImageMarker(dictionary, mid, 180)
            frame[30:210,x:x+180] = tile[:,:,None]
        result = detect_markers(frame, 0)
        self.assertFalse(any(m['cupId'] == 'RED' for m in result))
        self.assertTrue(any(m['markerId'] == 40 and m['cupId'] is None for m in result))

    def test_invalid_time(self):
        for t in [-1, float('nan'), True]:
            with self.assertRaises(ValueError): detect_markers(np.zeros((20,20,3),np.uint8),t)

class AppearanceTests(unittest.TestCase):
    def setUp(self):
        self.uniform = np.full((80,80,3), (70,100,130), np.uint8)
        self.streaked = self.uniform.copy()
        self.streaked[:,40:] = (130,70,100)
        # Artificial thresholds solely for testing decision branches.
        self.cal = Calibration('synthetic-test', 'fixture', 2, 8, 0, 0.2)
        self.kw = dict(cup_id='GREEN', time_ms=0, setup_id='fixture',
                       stationary=True, unobstructed=True, pre_transfer=True)

    def test_metric_and_labels(self):
        a = assess_appearance(self.uniform,(0,0,80,80),calibration=self.cal,**self.kw)
        b = assess_appearance(self.streaked,(0,0,80,80),calibration=self.cal,**self.kw)
        self.assertEqual(a['label'],'visually_uniform')
        self.assertEqual(b['label'],'visibly_streaked')
        self.assertGreater(b['metricValue'],a['metricValue'])

    def test_uncalibrated_and_unreviewed(self):
        result = assess_appearance(self.uniform,(0,0,80,80),**self.kw)
        self.assertEqual(result['label'],'unclear')
        self.assertIsNotNone(result['metricValue'])
        for key in ['stationary','unobstructed','pre_transfer']:
            kw = {**self.kw,key:False}
            self.assertEqual(assess_appearance(self.uniform,(0,0,80,80),calibration=self.cal,**kw)['label'],'unclear')
        self.assertEqual(assess_appearance(self.uniform,(0,0,80,80),calibration=self.cal,**{**self.kw,'setup_id':'other'})['label'],'unclear')

    def test_invalid_crop_and_glare(self):
        for roi in [(-1,0,20,20),(0,0,0,20),(70,0,20,20),(0,0,3,3)]:
            self.assertEqual(assess_appearance(self.uniform,roi,calibration=self.cal,**self.kw)['label'],'unclear')
        self.assertEqual(assess_appearance(np.full_like(self.uniform,255),(0,0,80,80),calibration=self.cal,**self.kw)['label'],'unclear')

    def test_invalid_calibration(self):
        for uniform, streak in [(9,2),(float('nan'),8),(-1,8)]:
            with self.assertRaises(ValueError): Calibration('v','s',uniform,streak,0,0.2)

class RuleTests(unittest.TestCase):
    def event(self, source='RED', dest='BLUE', **changes):
        return dict(eventId='e',eventType='transfer',sourceCupId=source,destinationCupId=dest,
                    startMs=10,endMs=20,uncertain=False,occluded=False,identityVerified=True,
                    abstainReason=None,**changes)

    def test_approved_and_mismatch(self):
        for step, source,dest,expected in [(1,'RED','BLUE','MATCH'),(2,'GREEN','RED','MATCH'),(2,'GREEN','BLUE','POSSIBLE_MISMATCH')]:
            event = self.event(source,dest)
            before = event.copy()
            self.assertEqual(compare_step(event,step)['decision'],expected)
            self.assertEqual(event,before)

    def test_fail_closed(self):
        for changes in [dict(uncertain=True),dict(occluded=True),dict(identityVerified=False),dict(sourceCupId=None),dict(abstainReason='hidden'),dict(endMs=1),dict(eventType='unknown'),dict(uncertain='false')]:
            event = {**self.event(),**changes}
            self.assertEqual(compare_step(event,1)['decision'],'NEEDS_HUMAN_REVIEW')
        self.assertEqual(compare_step(None,1)['decision'],'NEEDS_HUMAN_REVIEW')
        self.assertEqual(compare_step(self.event(),3)['decision'],'NEEDS_HUMAN_REVIEW')

class ReviewRegressionTests(unittest.TestCase):
    setUp = AppearanceTests.setUp
    def test_repeated_streaks_do_not_average_away(self):
        stripes=self.uniform.copy()
        stripes[:,::2]=(130,70,100)
        result=assess_appearance(stripes,(0,0,80,80),calibration=self.cal,**self.kw)
        self.assertNotEqual(result['label'],'visually_uniform')
        self.assertGreater(result['metricValue'],8)

    def test_contradictory_evidence_needs_review(self):
        event=RuleTests().event()
        for evidence in [
            [dict(cupId='RED',markerId=20,frameId='f',timeMs=15)],
            [dict(cupId='RED',markerId=10,frameId='f',timeMs=100)],
            [],
            'invalid'
        ]:
            self.assertEqual(compare_step({**event,'identityEvidence':evidence},1)['decision'],'NEEDS_HUMAN_REVIEW')
        valid=[dict(cupId=cup,markerId=mid,frameId='f',timeMs=15) for cup,mid in [('RED',10),('BLUE',30)]]
        self.assertEqual(compare_step({**event,'identityEvidence':valid},1)['decision'],'MATCH')
