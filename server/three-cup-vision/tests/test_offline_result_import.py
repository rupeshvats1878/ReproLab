"""Synthetic importer fixtures; no real footage, inference, or performance claims."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import test_offline_evaluation as fixtures

SERVICE = Path(__file__).resolve().parents[1]


class ResultImportTests(unittest.TestCase):
    def setUp(self):
        (SERVICE/'work').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=SERVICE/'work')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = fixtures.EvaluationTests().adapter_bundle()
        self.bundle['observationScope']='full_run'
        self.envelope = self.bundle.pop('predictions')
        self.provenance = dict(origin='mocked_fixture',sessionId=self.envelope['sessionId'],videoId=self.envelope['videoId'],clipFilename='synthetic-clip.mov',sourceOffsetMs=0,videoDurationMs=1000,originalVideoSha256='b'*64,clipSha256='b'*64,modelId=self.envelope['modelId'],adapterCommit='d'*40,attestedBy='synthetic-test',attested=True)
        self.source = self.root/'saved.json'
        self.output = self.root/'package'

    def package(self, raw=None):
        self.assertIsNotNone(importlib.util.find_spec('offline.result_import'),'importer module required')
        from offline.result_import import import_result
        self.source.write_bytes(raw if raw is not None else json.dumps(self.envelope).encode())
        return import_result(self.source,self.bundle,self.provenance,self.output)

    def test_exact_bytes_preserved_and_hashed(self):
        raw=(json.dumps(self.envelope,indent=4)+'\r\n').encode()
        manifest=self.package(raw)
        self.assertEqual((self.output/'raw-response.json').read_bytes(),raw)
        self.assertEqual(manifest['rawResponseSha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(manifest['provenance'],self.provenance)
        self.assertEqual(json.loads((self.output/'evaluation.json').read_text())['status'],'NOT_EVALUATED')
        self.assertTrue((self.output/'evaluation.md').is_file())

    def test_both_protocols_and_unknown_identity(self):
        for number,(pairs,steps,expected) in enumerate((([('RED','BLUE'),('GREEN','BLUE')],[('RED','BLUE'),('GREEN','RED')],['MATCH','POSSIBLE_WRONG_DESTINATION']),([('GREEN','BLUE'),('BLUE','RED')],[('BLUE','RED'),('GREEN','BLUE')],['POSSIBLE_WRONG_ORDER']*2))):
            b=fixtures.EvaluationTests().adapter_bundle(pairs); self.envelope=b.pop('predictions'); self.bundle=b; self.bundle['observationScope']='full_run'; self.bundle['protocol']['steps']=[dict(sourceCupId=s,destinationCupId=d) for s,d in steps]; self.output=self.root/f'package-{number}'
            self.package(); report=json.loads((self.output/'evaluation.json').read_text()); self.assertEqual([d['decision'] for d in report['protocolDecisions']],expected)
        self.output=self.root/'unknown'; self.envelope['events'][0]['sourceCupId']='unknown'; self.package(); self.assertEqual(json.loads((self.output/'evaluation.json').read_text())['protocolDecisions'][0]['decision'],'NEEDS_HUMAN_REVIEW')

    def test_provenance_and_mode_conflicts_rejected(self):
        original=copy.deepcopy(self.provenance)
        for field,value in (('sessionId','other'),('clipSha256','invalid'),('adapterCommit','short'),('attested',False),('sourceOffsetMs',20),('origin','human_annotation'),('origin','genuine_model_response'),('clipFilename','../private.mov')):
            with self.subTest(field=field,value=value):
                self.provenance={**original,field:value}
                with self.assertRaises(ValueError): self.package()
                self.assertFalse(self.output.exists())
        self.provenance=original; self.bundle['dataKind']='real'
        with self.assertRaises(ValueError): self.package()

    def test_errors_distinct_and_never_scored(self):
        self.envelope.update(observationStatus='unavailable',error={'category':'remote_disabled'},events=[]); self.bundle['reviews']=[]; self.provenance['origin']='adapter_error'
        self.package(); report=json.loads((self.output/'evaluation.json').read_text()); self.assertEqual(report['status'],'NOT_EVALUATED'); self.assertIsNone(report['metrics'])

    def test_provider_response_and_duplicate_keys_rejected(self):
        for raw in (b'{"outputs":[]}',b'{"schemaVersion":"a","schemaVersion":"b"}'):
            with self.assertRaises(ValueError): self.package(raw)
            self.assertFalse(self.output.exists())

    def test_existing_destination_and_missing_source(self):
        self.package()
        before=(self.output/'raw-response.json').read_bytes()
        with self.assertRaises((ValueError,FileExistsError)): self.package()
        self.assertEqual((self.output/'raw-response.json').read_bytes(),before)
        from offline.result_import import import_result
        with self.assertRaises(OSError): import_result(self.root/'absent.json',self.bundle,self.provenance,self.root/'absent-package')

    def test_failed_write_leaves_no_package(self):
        self.assertIsNotNone(importlib.util.find_spec('offline.result_import'),'importer module required')
        with patch('offline.result_import.os.replace',side_effect=OSError('synthetic write failure')):
            with self.assertRaises(OSError): self.package()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.package-*')),[])

    def test_cli_and_unignored_destination_rejected(self):
        self.source.write_text(json.dumps(self.envelope)); config=self.root/'config.json'; config.write_text(json.dumps(self.bundle)); provenance=self.root/'provenance.json'; provenance.write_text(json.dumps(self.provenance))
        result=subprocess.run([sys.executable,'-m','offline.result_import',str(self.source),'--config',str(config),'--provenance',str(provenance),'--output-dir',str(self.output)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.output=SERVICE/'unignored-package'
        with self.assertRaises(ValueError): self.package()

    def test_media_input_rejected_before_read(self):
        self.assertIsNotNone(importlib.util.find_spec('offline.result_import'),'importer module required')
        from offline.result_import import import_result
        with patch('pathlib.Path.read_bytes',side_effect=AssertionError('must not read media')):
            with self.assertRaises(ValueError): import_result(self.root/'private.mov',self.bundle,self.provenance,self.output)

    def test_invalid_adapter_time_is_packaged_as_review(self):
        self.envelope['events'][0]['eventEndMs']=100; self.envelope['events'][0]['observationStatus']='unclear'; self.envelope['observationStatus']='unclear'
        self.package(); report=json.loads((self.output/'evaluation.json').read_text()); self.assertEqual(report['protocolDecisions'][0]['decision'],'NEEDS_HUMAN_REVIEW')

    def test_config_binding_and_existing_predictions_rejected(self):
        self.bundle['run']['videoId']='different'
        with self.assertRaises(ValueError): self.package()
        self.bundle['run']['videoId']=self.envelope['videoId']; self.bundle['predictions']=[]
        with self.assertRaises(ValueError): self.package()

    def test_declared_genuine_mode_requires_remote_call(self):
        self.provenance['origin']='genuine_model_response'; self.bundle['dataKind']='real'
        with self.assertRaises(ValueError): self.package()
        # Exercise attestation validation only; synthetic test is not genuine inference.
        self.envelope['remoteCallMade']=True
        self.package(); self.assertEqual(json.loads((self.output/'evaluation.json').read_text())['status'],'NOT_EVALUATED')

    def test_fifo_rejected_before_read(self):
        import os
        from offline.result_import import import_result
        fifo=self.root/'pipe.json'; os.mkfifo(fifo)
        with patch('pathlib.Path.read_bytes',side_effect=AssertionError('must not read FIFO')):
            with self.assertRaises(ValueError): import_result(fifo,self.bundle,self.provenance,self.output)

    def test_concurrent_destination_creation_preserved(self):
        from offline import result_import
        original=result_import._destination
        def race(path):
            checked=original(path)
            checked.mkdir()
            return checked
        with patch('offline.result_import._destination',side_effect=race):
            with self.assertRaises((ValueError,FileExistsError)): self.package()
        self.assertTrue(self.output.is_dir()); self.assertEqual(list(self.output.iterdir()),[])

    def test_complete_manifest_is_published_last(self):
        from offline import result_import
        original=result_import.os.replace
        published=[]
        def record(source,destination):
            published.append(Path(destination).name)
            if Path(destination).name=='manifest.json':
                self.assertTrue((self.output/'evaluation.json').exists())
                self.assertTrue((self.output/'raw-response.json').exists())
            return original(source,destination)
        with patch('offline.result_import.os.replace',side_effect=record): self.package()
        self.assertEqual(published[-1],'manifest.json')
