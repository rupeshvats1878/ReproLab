"""Synthetic saved-provider capture tests, no network or footage."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import test_offline_result_import as fixtures

COMMIT='9002039a5a28cd305ffd5500ba62c42ba3e5c7cc'


class CaptureImportTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.ResultImportTests(); self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        f=self.fixture; f.provenance.update(adapterCommit=COMMIT,sourceOffsetMs=1000)
        f.bundle['reviews']=[]; f.bundle['coverageComplete']=False; f.bundle['observationScope']='partial_clip'
        self.metadata=dict(model=f.provenance['modelId'],sessionId=f.provenance['sessionId'],videoId=f.provenance['videoId'],sourceOffsetMs=1000,clipDurationMs=1000,filename=f.provenance['clipFilename'],sha256=f.provenance['clipSha256'],latencyMs=12,remoteCallMade=False,rawResponseSaved=True,httpStatus=200)
        self.payload=dict(transfers=[dict(sourceCupId='GREEN',destinationCupId='RED',eventStartMs=100,eventEndMs=200,evidenceTimestampsMs=[150])],appearances=[])
        self.metadata_path=f.root/'meta.json'

    def package(self, provider=None):
        from offline.result_import import import_result
        f=self.fixture
        raw=(json.dumps(provider or dict(status='completed',steps=[dict(content=[dict(type='text',text=json.dumps(self.payload))])]),indent=2)+'\n').encode()
        meta=(json.dumps(self.metadata,indent=4)+'\r\n').encode()
        f.source.write_bytes(raw); self.metadata_path.write_bytes(meta)
        manifest=import_result(f.source,f.bundle,f.provenance,f.output,capture_metadata=self.metadata_path)
        report=json.loads((f.output/'evaluation.json').read_text())
        return manifest, report, raw, meta

    def test_exact_capture_bytes_offset_once_and_partial_scope(self):
        manifest,report,raw,meta=self.package(); f=self.fixture
        self.assertEqual((f.output/'raw-response.json').read_bytes(),raw)
        self.assertEqual((f.output/'capture-metadata.json').read_bytes(),meta)
        self.assertEqual(manifest['captureMetadataSha256'],hashlib.sha256(meta).hexdigest())
        self.assertEqual(report['events'][0]['eventStartMs'],1100)
        self.assertEqual(report['events'][0]['evidenceTimestampsMs'],[1150])
        self.assertEqual(report['observationScope'],'partial_clip')
        self.assertEqual(report['status'],'NOT_EVALUATED'); self.assertIsNone(report['metrics'])
        self.assertEqual(len(report['protocolDecisions']),1)
        decision=report['protocolDecisions'][0]
        self.assertEqual(decision['decision'],'NEEDS_HUMAN_REVIEW'); self.assertIsNone(decision['approvedStepIndex']); self.assertIsNone(decision['expected'])
        self.assertEqual(decision['matchingApprovedStepIndices'],[2])

    def test_output_text_fallback_and_zero_duration_review(self):
        self.payload['transfers'][0]['eventEndMs']=100
        _,report,_,_=self.package(dict(status='completed',output_text=json.dumps(self.payload)))
        self.assertIsNone(report['events'][0]['eventStartMs'])
        self.assertTrue(report['events'][0]['reviewReasons'])

    def test_capture_metadata_binding_and_error_rejected(self):
        original=dict(self.metadata)
        for field,value in (('sha256','c'*64),('sourceOffsetMs',1),('httpStatus',500),('rawResponseSaved',False),('error',{'category':'unknown'})):
            with self.subTest(field=field):
                self.metadata={**original,field:value}
                with self.assertRaises(ValueError): self.package()
                self.assertFalse(self.fixture.output.exists())

    def test_incomplete_provider_and_unknown_commit_rejected(self):
        with self.assertRaises(ValueError): self.package(dict(status='failed',steps=[]))
        self.fixture.provenance['adapterCommit']='a'*40
        with self.assertRaises(ValueError): self.package()

    def test_partial_rejects_complete_coverage_even_when_reviewed(self):
        self.fixture.bundle['coverageComplete']=True
        with self.assertRaises(ValueError): self.package()

    def test_envelope_explicit_partial_scope_no_global_decision(self):
        f=self.fixture; f.provenance['sourceOffsetMs']=0; f.bundle['observationScope']='partial_clip'; f.bundle['coverageComplete']=False
        f.package(); report=json.loads((f.output/'evaluation.json').read_text()); self.assertTrue(all(d['approvedStepIndex'] is None for d in report['protocolDecisions']))

    def test_partial_capture_cannot_override_full_run_scope(self):
        self.fixture.bundle['observationScope']='full_run'
        with self.assertRaises(ValueError): self.package()

    def test_malformed_provenance_rejected(self):
        self.fixture.provenance=None
        with self.assertRaises(ValueError): self.package()

    def test_unknown_identity_and_bad_evidence_remain_unclear(self):
        self.payload['transfers'][0].update(sourceCupId='ambiguous',evidenceTimestampsMs=[True,-1,150,1001])
        _,report,_,_=self.package()
        self.assertEqual(report['events'][0]['sourceCupId'],'unknown')
        self.assertEqual(report['adapterObservation']['observationStatus'],'unclear')
        self.assertEqual(report['events'][0]['evidenceTimestampsMs'],[1150])

    def test_contradictory_no_transfer_and_fenced_split_text(self):
        self.payload['noVisibleTransfer']=True
        text='```json\n'+json.dumps(self.payload)+'\n```'
        _,report,_,_=self.package(dict(status='completed',steps=[dict(content=[dict(type='text',text=text[:30]),dict(type='text',text=text[30:])])]))
        self.assertIn('contradictory_no_transfer',report['adapterObservation']['warnings'])
        self.assertEqual(report['adapterObservation']['observationStatus'],'unclear')

    def test_duplicate_model_text_keys_rejected(self):
        with self.assertRaises(ValueError): self.package(dict(status='completed',output_text='{"transfers":[],"transfers":[]}'))

    def test_exported_envelope_cannot_escape_clip_scope(self):
        f=self.fixture; f.envelope['sourceOffsetMs']=1000; f.bundle['observationScope']='full_run'; f.bundle['coverageComplete']=False
        with self.assertRaises(ValueError): f.package()
        f.provenance['sourceOffsetMs']=0; f.envelope['sourceOffsetMs']=0; f.provenance['originalVideoSha256']='c'*64
        with self.assertRaises(ValueError): f.package()

    def test_envelope_unspecified_scope_defaults_partial(self):
        f=self.fixture; f.provenance['sourceOffsetMs']=0; f.bundle.pop('observationScope',None); f.bundle['coverageComplete']=False
        f.package(); report=json.loads((f.output/'evaluation.json').read_text()); self.assertEqual(report['observationScope'],'partial_clip'); self.assertTrue(all(d['approvedStepIndex'] is None for d in report['protocolDecisions']))

    def test_provider_error_with_completed_status_rejected(self):
        with self.assertRaises(ValueError): self.package(dict(status='completed',error={'message':'failed'},output_text=json.dumps(self.payload)))
