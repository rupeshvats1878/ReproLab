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

if __name__=='__main__': unittest.main()
