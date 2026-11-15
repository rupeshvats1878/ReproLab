"""Explicitly synthetic recording-analysis and review fixtures."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def mock_recording(pairs=None):
    pairs=pairs if pairs is not None else [('RED','BLUE'),('GREEN','RED')]
    events=[dict(eventId=f'e{i}',sourceCupId=s,destinationCupId=d,eventStartMs=100+i*200,eventEndMs=150+i*200,evidenceTimestampsMs=[125+i*200],observationStatus='observed',needsHumanVerification=True,humanConfirmed=True,dataKind='real',segmentIndexes=[0],truncated=False) for i,(s,d) in enumerate(pairs)]
    analysis=dict(schemaVersion='three-cup-recording-analysis/v0.1',sessionId='s',videoId='v',recording=dict(filename='synthetic.mov',durationMs=1000),segments=[dict(sourceOffsetMs=0,durationMs=1000,endMs=1000,observationStatus='observed',error=None,capture=dict(rawResponseSaved=True,metadataSaved=True))],timeline=dict(events=events,appearances=[]),coverageComplete=True,error=None,protocolReport=dict(verdict='COMPLIANT'))
    run=dict(sessionId='s',videoId='v',protocolId='p')
    config=dict(run=run,protocol={**run,'steps':[dict(sourceCupId='RED',destinationCupId='BLUE'),dict(sourceCupId='GREEN',destinationCupId='RED')]},modelId='synthetic-model',dataKind='synthetic')
    reviews=[dict(**run,eventId=e['eventId'],action='confirm',reviewer='synthetic-reviewer',identityVerified=True,occluded=False) for e in events]
    coverage=dict(**run,reviewed=True,reviewer='synthetic-reviewer',scope='full_recording',originalCandidateReview=dict(**run,reviewed=True,reviewer='synthetic-reviewer',scope='all_segment_candidates_and_multiplicity'))
    return analysis,config,reviews,coverage


class MonitorBridgeTests(unittest.TestCase):
    def project(self, fixture):
        self.assertIsNotNone(importlib.util.find_spec('offline.monitor_bridge'),'monitor bridge required')
        from offline.monitor_bridge import project_monitor
        return project_monitor(*fixture)

    def test_approved_is_reviewable_not_authoritative(self):
        f=mock_recording(); original=copy.deepcopy(f); r=self.project(f)
        self.assertEqual([d['decision'] for d in r['decisions']],['MATCH','MATCH'])
        self.assertNotEqual(r['status'],'COMPLIANT'); self.assertFalse(r['automaticStepCompletion']); self.assertEqual(r['rawAnalysis'],f[0]); self.assertEqual(f,original)

    def test_extra_does_not_disappear_when_later_expected_pair_matches(self):
        r=self.project(mock_recording([('RED','BLUE'),('GREEN','BLUE'),('GREEN','RED')]))
        self.assertEqual([d['decision'] for d in r['decisions']],['MATCH','POSSIBLE_WRONG_DESTINATION','MATCH']); self.assertEqual(len(r['events']),3); self.assertEqual(r['status'],'POSSIBLE_DEVIATION')

    def test_recording2_reverse_separate_protocol(self):
        f=mock_recording([('GREEN','BLUE'),('BLUE','RED')]); f[1]['protocol']['steps']=[dict(sourceCupId='BLUE',destinationCupId='RED'),dict(sourceCupId='GREEN',destinationCupId='BLUE')]
        self.assertEqual([d['decision'] for d in self.project(f)['decisions']],['POSSIBLE_WRONG_ORDER']*2)

    def test_unknown_overlap_merged_duplicate_all_review(self):
        for kind in ('unknown','overlap','merged'):
            f=mock_recording()
            if kind=='unknown': f[0]['timeline']['events'][0]['sourceCupId']='unknown'
            elif kind=='overlap': f[0]['timeline']['events'][1]['eventStartMs']=120; f[0]['timeline']['events'][1]['evidenceTimestampsMs']=[125]
            else: f[0]['timeline']['events'][0]['segmentIndexes']=[0,1]
            r=self.project(f); self.assertTrue(all(d['decision']=='NEEDS_HUMAN_REVIEW' for d in r['decisions'])); self.assertEqual(len(r['events']),2)

    def test_reject_and_embedded_confirmation_never_silently_complete(self):
        f=mock_recording(); f[2][0]['action']='reject'; r=self.project(f); self.assertEqual(r['events'][0]['review']['action'],'reject'); self.assertEqual(r['status'],'NEEDS_HUMAN_REVIEW'); self.assertEqual(len(r['events']),2)
        f=mock_recording(); f[2].clear(); self.assertTrue(all(d['decision']=='NEEDS_HUMAN_REVIEW' for d in self.project(f)['decisions']))

    def test_missing_error_and_subset_never_compliant(self):
        f=mock_recording([('GREEN','RED')]); f=list(f); f[3]=None
        r=self.project(f); self.assertFalse(r['coverage']['reviewedComplete']); self.assertTrue(all(d['decision']=='NEEDS_HUMAN_REVIEW' for d in r['decisions']))
        f=mock_recording(); f[0]['segments'][0]['error']={'category':'failed'}
        r=self.project(f); self.assertFalse(r['coverage']['reviewedComplete']); self.assertEqual(r['status'],'NEEDS_HUMAN_REVIEW')
        f=mock_recording([('GREEN','RED')]); self.assertEqual(self.project(f)['decisions'][-1]['decision'],'POSSIBLE_MISSING_TRANSFER')

    def test_missing_protocol_or_cross_binding_rejected(self):
        f=mock_recording(); f[1]['protocol']['videoId']='wrong'
        with self.assertRaises(ValueError): self.project(f)
        f=mock_recording(); del f[1]['protocol']
        with self.assertRaises(ValueError): self.project(f)

    def test_absolute_times_not_shifted_twice(self):
        f=mock_recording(); f[0]['segments']=[dict(sourceOffsetMs=0,durationMs=600,endMs=600,observationStatus='observed',error=None,capture=dict(rawResponseSaved=True,metadataSaved=True)),dict(sourceOffsetMs=500,durationMs=500,endMs=1000,observationStatus='observed',error=None,capture=dict(rawResponseSaved=True,metadataSaved=True))]; e=f[0]['timeline']['events'][1]; e.update(eventStartMs=700,eventEndMs=750,evidenceTimestampsMs=[725],segmentIndexes=[1])
        self.assertEqual(self.project(f)['events'][1]['observation']['eventStartMs'],700)

    def test_cli_mocked_end_to_end(self):
        f=mock_recording()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,contents in zip(('analysis','config','reviews','coverage'),f): (root/f'{name}.json').write_text(json.dumps(contents))
            result=subprocess.run([sys.executable,'-m','offline.monitor_bridge',str(root/'analysis.json'),'--config',str(root/'config.json'),'--reviews',str(root/'reviews.json'),'--coverage-review',str(root/'coverage.json'),'--output',str(root/'out.json')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr); self.assertEqual(json.loads((root/'out.json').read_text())['schemaVersion'],'three-cup-monitor-projection/v0.1')

    def test_synthetic_cannot_be_promoted_and_model_cannot_be_relabeled(self):
        f=mock_recording(); f[1]['dataKind']='real'; f[0]['timeline']['events'][0]['dataKind']='synthetic'
        with self.assertRaises(ValueError): self.project(f)
        f=mock_recording(); f[0]['modelId']='different-model'
        with self.assertRaises(ValueError): self.project(f)

    def test_negative_observation_is_not_a_pour(self):
        f=mock_recording(); negative=dict(eventId='negative',sourceCupId=None,destinationCupId=None,eventStartMs=800,eventEndMs=850,evidenceTimestampsMs=[825],observationStatus='no_transfer',needsHumanVerification=True,segmentIndexes=[0],truncated=False); f[0]['timeline']['events'].append(negative)
        r=self.project(f); self.assertEqual(len(r['events']),3); self.assertEqual(len(r['decisions']),2); self.assertEqual([d['decision'] for d in r['decisions']],['MATCH','MATCH'])

    def test_duplicate_is_retained_and_does_not_shift_steps(self):
        r=self.project(mock_recording([('RED','BLUE'),('RED','BLUE'),('GREEN','RED')]))
        self.assertEqual([d['decision'] for d in r['decisions']],['MATCH','POSSIBLE_EXTRA_TRANSFER','MATCH'])

    def test_review_explicit_cross_recording_binding_rejected(self):
        f=mock_recording(); f[2][0].update(sessionId='s',videoId='other')
        with self.assertRaises(ValueError): self.project(f)

    def test_same_segment_collapsed_candidates_require_independent_review(self):
        f=mock_recording(); f[3].pop('originalCandidateReview',None)
        # Cursor can collapse near-identical pours within one segment and retain [0].
        f[0]['timeline']['events'][0]['segmentIndexes']=[0]
        self.assertTrue(all(d['decision']=='NEEDS_HUMAN_REVIEW' for d in self.project(f)['decisions']))

    def test_coverage_and_candidate_reviews_bound_to_run(self):
        for target in ('coverage','candidate','event'):
            for field in ('sessionId','videoId','protocolId'):
                f=mock_recording(); record=f[3] if target=='coverage' else f[3]['originalCandidateReview'] if target=='candidate' else f[2][0]
                record[field]='other'
                with self.assertRaises(ValueError): self.project(f)
        f=mock_recording(); del f[2][0]['protocolId']
        with self.assertRaises(ValueError): self.project(f)
