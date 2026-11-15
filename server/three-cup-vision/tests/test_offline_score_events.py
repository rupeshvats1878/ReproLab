import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from score_events import evaluate

class TestScores(unittest.TestCase):
    def test_exact_correct(self):
        t=[{'video_id':'v','event_index':'1','source_cup':'GREEN','destination_cup':'RED'}]
        p=[{'video_id':'v','event_index':'1','source_cup':'GREEN','destination_cup':'RED','uncertain':'false'}]
        r=evaluate(t,p)
        self.assertEqual(r['pair_or_no_transfer_accuracy_all'],1.)
    def test_wrong_destination(self):
        t=[{'video_id':'v','event_index':'1','source_cup':'GREEN','destination_cup':'RED'}]
        p=[{'video_id':'v','event_index':'1','source_cup':'GREEN','destination_cup':'BLUE','uncertain':'false'}]
        r=evaluate(t,p)
        self.assertEqual(r['pair_or_no_transfer_accuracy_all'],0.)
        self.assertEqual(r['source_accuracy_on_judged'],1.)
    def test_abstention(self):
        t=[{'video_id':'v','event_index':'1','source_cup':'RED','destination_cup':'BLUE'}]
        p=[{'video_id':'v','event_index':'1','source_cup':'','destination_cup':'','uncertain':'true'}]
        r=evaluate(t,p)
        self.assertEqual(r['coverage'],0.)
        self.assertIsNone(r['transfer_pair_accuracy_on_judged'])
    def test_no_transfer_false_positive(self):
        t=[{'video_id':'v','event_index':'1','event_type':'no_transfer','source_cup':'','destination_cup':''}]
        p=[{'video_id':'v','event_index':'1','event_type':'transfer','source_cup':'RED','destination_cup':'BLUE','uncertain':'false'}]
        r=evaluate(t,p)
        self.assertEqual(r['false_positive_no_transfer'],1)
    def test_empty_rejected(self):
        with self.assertRaises(ValueError): evaluate([],[])

if __name__=='__main__': unittest.main()

class TestConservativeScoring(unittest.TestCase):
    def test_uncertain_negative_is_abstention(self):
        t=[dict(video_id='v',event_index='1',event_type='no_transfer')]
        p=[dict(video_id='v',event_index='1',event_type='unknown',uncertain='true')]
        result=evaluate(t,p)
        self.assertEqual(result['abstained'],1)
        self.assertEqual(result['pair_or_no_transfer_accuracy_all'],0)

    def test_unknown_truth_not_scored(self):
        t=[dict(video_id='v',event_index='1',event_type='unknown')]
        p=[dict(video_id='v',event_index='1',event_type='transfer',source_cup='RED',destination_cup='BLUE',uncertain='false')]
        result=evaluate(t,p)
        self.assertEqual(result['unscorable_truth'],1)
        self.assertIsNone(result['transfer_pair_accuracy_on_judged'])
