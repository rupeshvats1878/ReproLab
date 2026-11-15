"""Synthetic software fixtures only; no video-model performance evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def bundle(pairs=None):
    pairs = pairs if pairs is not None else [('RED','BLUE'),('GREEN','RED')]
    run = dict(sessionId='synthetic-session',videoId='synthetic-take',protocolId='synthetic-protocol')
    predictions = [dict(eventId=f'p{i}',eventType='liquid_transfer',sessionId=run['sessionId'],videoId=run['videoId'],sourceCupId=s,destinationCupId=d,eventStartMs=100+i*100,eventEndMs=150+i*100,evidenceTimestampsMs=[120+i*100],observationStatus='observed',needsHumanVerification=True,modelId='synthetic-fixture',latencyMs=None) for i,(s,d) in enumerate(pairs)]
    return dict(schemaVersion='three-cup-evaluation/v0.2',dataKind='synthetic',run=run,protocol={**run,'steps':[dict(sourceCupId='RED',destinationCupId='BLUE'),dict(sourceCupId='GREEN',destinationCupId='RED')]},predictions=predictions,reviews=[dict(eventId=p['eventId'],verified=True,identityVerified=True,occluded=False) for p in predictions],coverageComplete=True)


class EvaluationTests(unittest.TestCase):
    def evaluate(self, data):
        self.assertIsNotNone(importlib.util.find_spec('offline.evaluation'), 'evaluation module required')
        from offline.evaluation import evaluate
        return evaluate(data)

    def decisions(self, data):
        return [d['decision'] for d in self.evaluate(data)['protocolDecisions']]

    def test_correct_sequences_per_run(self):
        b=bundle(); self.assertEqual(self.decisions(b),['MATCH','MATCH'])
        b=bundle([('BLUE','RED'),('GREEN','BLUE')]); b['protocol']['steps']=[dict(sourceCupId=p['sourceCupId'],destinationCupId=p['destinationCupId']) for p in b['predictions']]
        self.assertEqual(self.decisions(b),['MATCH','MATCH'])

    def test_reverse_order_priority(self):
        b=bundle([('GREEN','BLUE'),('BLUE','RED')]); b['protocol']['steps']=[dict(sourceCupId='BLUE',destinationCupId='RED'),dict(sourceCupId='GREEN',destinationCupId='BLUE')]
        self.assertEqual(self.decisions(b),['POSSIBLE_WRONG_ORDER']*2)

    def test_wrong_source_and_destination(self):
        self.assertEqual(self.decisions(bundle([('GREEN','BLUE'),('GREEN','BLUE')])),['POSSIBLE_WRONG_SOURCE','POSSIBLE_WRONG_DESTINATION'])

    def test_missing_extra_duplicate(self):
        self.assertEqual(self.decisions(bundle([('RED','BLUE')]))[-1],'POSSIBLE_MISSING_TRANSFER')
        report=self.evaluate(bundle([('RED','BLUE'),('GREEN','RED'),('GREEN','RED')]))
        self.assertEqual(report['protocolDecisions'][-1]['decision'],'POSSIBLE_EXTRA_TRANSFER')
        self.assertEqual(report['protocolDecisions'][-1]['reason'],'duplicate_pair')

    def test_uncertainty_gates(self):
        for mutation in ('unknown','occluded','evidence','timestamps','review'):
            with self.subTest(mutation=mutation):
                b=bundle()
                if mutation=='unknown': b['predictions'][0]['sourceCupId']='unknown'
                if mutation=='occluded': b['reviews'][0]['occluded']=True
                if mutation=='evidence': b['predictions'][0]['evidenceTimestampsMs']=[]
                if mutation=='timestamps': b['predictions'][1]['eventStartMs']=125
                if mutation=='review': b['reviews']=[]
                self.assertEqual(self.decisions(b)[0],'NEEDS_HUMAN_REVIEW')

    def test_marker_conflict(self):
        b=bundle(); b['markerObservations']=[dict(eventId='p0',role='source',markerId=20,cupId='GREEN',timeMs=120,visible=True)]
        r=self.evaluate(b); self.assertEqual(r['protocolDecisions'][0]['decision'],'NEEDS_HUMAN_REVIEW'); self.assertIn('marker_disagreement',r['events'][0]['reviewReasons'])

    def test_invalid_and_wrong_protocol_binding(self):
        for key in ('videoId','sessionId','protocolId'):
            b=bundle(); b['protocol'][key]='other'
            with self.assertRaises(ValueError): self.evaluate(b)
        b=bundle(); b['predictions'][0]['eventEndMs']=-1
        with self.assertRaises(ValueError): self.evaluate(b)

    def test_no_truth_or_predictions_not_evaluated(self):
        for b in (bundle(),bundle([])):
            r=self.evaluate(b); self.assertEqual(r['status'],'NOT_EVALUATED'); self.assertIsNone(r['metrics'])

    def truth_bundle(self):
        b=bundle(); b['groundTruth']=dict(sessionId=b['run']['sessionId'],videoId=b['run']['videoId'],verified=True,annotator='synthetic-fixture',split='test',events=[dict(eventId='g'+str(i),sourceCupId=p['sourceCupId'],destinationCupId=p['destinationCupId'],eventStartMs=p['eventStartMs'],eventEndMs=p['eventEndMs'],stepIndex=i+1) for i,p in enumerate(b['predictions'])]); b['alignments']=[dict(predictionEventId='p'+str(i),groundTruthEventId='g'+str(i)) for i in range(2)]; return b

    def test_scoring_explicit_alignment_and_synthetic_label(self):
        r=self.evaluate(self.truth_bundle()); self.assertEqual(r['status'],'SYNTHETIC_EVALUATION'); self.assertEqual(r['metrics']['correctPairs'],2); self.assertEqual(r['metrics']['timestampErrors'],0)

    def test_misses_false_positive_abstention_and_timing(self):
        b=self.truth_bundle(); b['alignments']=b['alignments'][:1]; b['predictions'][0]['sourceCupId']='unknown'; r=self.evaluate(b); self.assertEqual(r['metrics']['missedEvents'],1); self.assertEqual(r['metrics']['falsePositiveEvents'],1); self.assertEqual(r['metrics']['unknownOrAbstainedEvents'],1)
        b=self.truth_bundle(); b['groundTruth']['events'][0]['eventStartMs']=110; self.assertEqual(self.evaluate(b)['metrics']['timestampErrors'],1)

    def test_alignment_and_session_leakage(self):
        b=self.truth_bundle(); b['alignments'].append(b['alignments'][0]);
        with self.assertRaises(ValueError): self.evaluate(b)
        b=self.truth_bundle(); b['datasetAssignments']=[dict(sessionId=b['run']['sessionId'],videoId='other',split='train')]
        with self.assertRaises(ValueError): self.evaluate(b)
        b=self.truth_bundle(); del b['alignments']; self.assertEqual(self.evaluate(b)['status'],'NOT_EVALUATED')

    def test_cli_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'input.json'; source.write_text(json.dumps(self.truth_bundle())); result=subprocess.run([sys.executable,'-m','offline.evaluation',str(source),'--json-output',str(root/'report.json'),'--markdown-output',str(root/'report.md')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr); self.assertEqual(json.loads((root/'report.json').read_text())['status'],'SYNTHETIC_EVALUATION'); self.assertIn('synthetic',(root/'report.md').read_text().lower())

    def test_adapter_mapping_preserves_times_and_raw(self):
        b=self.truth_bundle(); original=b['predictions']; raw=[{k:v for k,v in p.items() if k not in ('eventId','sessionId','videoId','modelId','latencyMs')} for p in original]
        b['predictions']=dict(schemaVersion='three-cup-gemini-observation/v0.1',sessionId=b['run']['sessionId'],videoId=b['run']['videoId'],events=raw,sourceOffsetMs=100,modelId='synthetic-fixture',latencyMs=12,observationStatus='observed',error=None)
        for i in range(2):
            b['reviews'][i]['eventId']=f'adapter-event-{i+1}'; b['alignments'][i]['predictionEventId']=f'adapter-event-{i+1}'
        before=copy.deepcopy(b); r=self.evaluate(b)
        self.assertEqual(r['events'][0]['eventStartMs'],100); self.assertEqual(r['events'][0]['rawObservation'],raw[0]); self.assertEqual(before,b)
        b['predictions']['observationStatus']='unavailable'; self.assertEqual(self.evaluate(b)['status'],'NOT_EVALUATED')

    def test_missing_optional_values_stay_uncertain(self):
        b=bundle(); del b['predictions'][0]['eventStartMs']; del b['predictions'][0]['evidenceTimestampsMs']
        r=self.evaluate(b); self.assertEqual(r['protocolDecisions'][0]['decision'],'NEEDS_HUMAN_REVIEW'); self.assertIsNone(r['metrics'])

    def test_no_missing_without_complete_coverage(self):
        b=bundle([('RED','BLUE')]); b['coverageComplete']=False
        self.assertEqual(self.decisions(b)[-1],'NEEDS_HUMAN_REVIEW')
        b=bundle([('RED','BLUE')]); b['predictions'][0]['sourceCupId']=None
        self.assertEqual(self.decisions(b)[-1],'NEEDS_HUMAN_REVIEW')

    def test_handling_events_do_not_become_transfers(self):
        b=bundle(); b['predictions'][0]['eventType']='spill_observed'
        r=self.evaluate(b); self.assertEqual(r['modelPredictedEventCount'],1); self.assertEqual(r['nonTransferObservationCount'],1)

    def test_truth_event_cross_recording_rejected(self):
        b=self.truth_bundle(); b['groundTruth']['events'][0]['sessionId']='other'; b['groundTruth']['events'][0]['videoId']='other'
        with self.assertRaises(ValueError): self.evaluate(b)

    def test_strict_booleans_and_missing_model_abstain(self):
        b=bundle(); b['predictions'][0]['needsHumanVerification']=1
        with self.assertRaises(ValueError): self.evaluate(b)
        b=bundle(); del b['predictions'][0]['modelId']; self.assertEqual(self.decisions(b)[0],'NEEDS_HUMAN_REVIEW')

    def test_duplicate_in_middle_does_not_shift_remaining_step(self):
        self.assertEqual(self.decisions(bundle([('RED','BLUE'),('RED','BLUE'),('GREEN','RED')])),['MATCH','POSSIBLE_EXTRA_TRANSFER','MATCH'])

    def test_unavailable_envelope_cannot_match_protocol(self):
        b=bundle(); b['predictions']=dict(schemaVersion='three-cup-gemini-observation/v0.1',sessionId=b['run']['sessionId'],videoId=b['run']['videoId'],events=b['predictions'],observationStatus='unavailable')
        self.assertEqual(self.decisions(b),['NEEDS_HUMAN_REVIEW']*2)

    def test_missing_first_identifies_actual_missing_step(self):
        r=self.evaluate(bundle([('GREEN','RED')]))
        self.assertEqual(r['protocolDecisions'][-1]['approvedStepIndex'],1)
        self.assertEqual(r['protocolDecisions'][-1]['expected']['sourceCupId'],'RED')

    def test_string_uncertainty_flags_rejected(self):
        for key in ('uncertain','occluded'):
            b=bundle(); b['predictions'][0][key]='true'
            with self.assertRaises(ValueError): self.evaluate(b)

    def test_ground_truth_unassigned_extra_event(self):
        b=self.truth_bundle(); b['groundTruth']['events'][0]['stepIndex']=None
        r=self.evaluate(b); self.assertEqual(r['metrics']['correctPairs'],2); self.assertEqual(r['metrics']['correctStepAssignments'],1); self.assertIsNone(r['perEventEvidence'][0]['stepCorrect'])
