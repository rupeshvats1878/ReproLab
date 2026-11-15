"""Offline request-shape tests: no webcam, credentials, or network."""
import unittest
from unittest.mock import patch
from worker import bounded_transport
from gemini_adapter.client import build_request

class WorkerTest(unittest.TestCase):
    def test_bounded_neutral_request(self):
        request=build_request(model_id='gemini-4-hydrogen',mime_type='video/mp4',video_bytes=b'synthetic-video',video_fps=2,api_key='synthetic-key',timeout_s=30)
        with patch('worker.default_transport',return_value={'status':200}) as send:
            bounded_transport(request)
        body=send.call_args.args[0]['body']
        self.assertFalse(body['store'])
        self.assertEqual(body['generation_config'],{'max_output_tokens':4096,'thinking_level':'low'})
        self.assertEqual(body['input'][0]['resolution'],'medium')
        self.assertEqual(body['input'][0]['processing'],{'type':'static','fps':2})
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
