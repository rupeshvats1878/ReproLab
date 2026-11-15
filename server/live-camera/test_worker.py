"""Offline request-shape tests: no webcam, credentials, or network."""
import unittest
from unittest.mock import patch
from worker import bounded_transport
from gemini_adapter.client import build_request

class WorkerTest(unittest.TestCase):
    def test_bounded_neutral_request(self):
        request=build_request(model_id='gemini-4-hydrogen',mime_type='video/mp4',video_bytes=b'synthetic-video',video_fps=3,api_key='synthetic-key',timeout_s=45,generation_config={'max_output_tokens':6144,'thinking_level':'low'})
        with patch('worker.default_transport',return_value={'status':200}) as send:
            bounded_transport(request)
        body=send.call_args.args[0]['body']
        self.assertFalse(body['store'])
        self.assertEqual(body['generation_config'],{'max_output_tokens':6144,'thinking_level':'low'})
        self.assertEqual(body['input'][0]['resolution'],'medium')
        self.assertEqual(body['input'][0]['processing'],{'type':'static','fps':3})
        self.assertNotIn('tools',body)
        self.assertNotIn('BLUE → RED',body['input'][1]['text'])
        self.assertNotIn('GREEN → BLUE',body['input'][1]['text'])

class ColorObservationTest(unittest.TestCase):
    def test_colors_do_not_promote_unknown_cup_identity(self):
        import json
        from gemini_adapter.parse_observation import parse_observation_text
        result=parse_observation_text(json.dumps({'transfers':[{'sourceCupId':'unknown','destinationCupId':'unknown','sourceLiquidColor':'Green','destinationLiquidColor':'RED','eventStartMs':100,'eventEndMs':900,'evidenceTimestampsMs':[500]}],'noVisibleTransfer':False,'appearances':[]}),1000)
        event=result['events'][0]
        self.assertEqual(event['sourceLiquidColor'],'green')
        self.assertEqual(event['destinationLiquidColor'],'red')
        self.assertEqual(event['sourceCupId'],'unknown')
        self.assertEqual(event['observationStatus'],'unclear')

if __name__=='__main__': unittest.main()

class ExpandedCompatibilityTest(unittest.TestCase):
    def test_unknown_identity_remains_unclear_and_offset_is_not_reapplied(self):
        from worker import compatible
        result={'sessionId':'mock','videoId':'window-0','modelId':'mock-model','window':{'sourceOffsetMs':52000,'durationMs':12000},'remoteCallMade':True,'latencyMs':10,'error':None,'observations':[{'category':'liquid_transfer','sourceCupId':None,'destinationCupId':None,'eventStartMs':53000,'eventEndMs':54000,'evidenceTimestampsMs':[53500],'observationStatus':'unclear'}]}
        mapped=compatible(result)
        self.assertEqual(mapped['events'][0]['sourceCupId'],'unknown')
        self.assertEqual(mapped['events'][0]['eventStartMs'],53000)
        self.assertEqual(mapped['expanded'],result)
        self.assertEqual(mapped['observationStatus'],'unclear')
    def test_unreserved_worker_is_fail_closed(self):
        from worker import BridgeReservation
        from gemini_adapter.budget import BudgetError
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaises(BudgetError): BridgeReservation().reserve(.1,label='mock')

class ExpandedColorTest(unittest.TestCase):
    def test_visible_colors_are_preserved_without_promoting_identity(self):
        from gemini_adapter.parse_live import normalize_live_observation
        item={'category':'liquid_transfer','summary':'Mock pour','eventStartMs':100,'eventEndMs':900,'evidenceTimestampsMs':[500],'cupIds':[],'sourceCupId':'unknown','destinationCupId':'unknown','sourceLiquidColor':'RED','destinationLiquidColor':'blue','liquidColor':'imaginary','utensil':'none','observationStatus':'observed'}
        event=normalize_live_observation({'observations':[item]},1000)['observations'][0]
        self.assertEqual(event['sourceLiquidColor'],'red')
        self.assertEqual(event['destinationLiquidColor'],'blue')
        self.assertEqual(event['liquidColor'],'unknown')
        self.assertEqual(event['sourceCupId'],'unknown')
        self.assertEqual(event['observationStatus'],'unclear')
