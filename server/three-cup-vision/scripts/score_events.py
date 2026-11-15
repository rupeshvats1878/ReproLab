"""Exact event-level source/destination baseline evaluation, never invents predictions."""
import argparse
import csv
from pathlib import Path

CUPS = {'RED', 'GREEN', 'BLUE'}

def load_rows(filename):
    with Path(filename).open(newline='') as f:
        rows = list(csv.DictReader(f))
    return rows

def evaluate(truth, predictions):
    # By default this evaluation requires one predicted/abstained record per ground truth event.
    # It is intentionally conservative; use a fuller event alignment protocol for unscripted videos.
    keys = lambda r: (r['video_id'], r['event_index'])
    truth_lookup = {keys(r):r for r in truth}
    pred_lookup = {keys(r):r for r in predictions}
    if len(truth_lookup) != len(truth) or len(pred_lookup) != len(predictions):
        raise ValueError('Duplicate (video_id,event_index) key')
    if not truth_lookup:
        raise ValueError('No annotated events')
    missing = set(truth_lookup)-set(pred_lookup)
    extra = set(pred_lookup)-set(truth_lookup)
    if missing or extra:
        raise ValueError(f'Unmatched events: missing={len(missing)} extra={len(extra)}')
    total = len(truth)
    abstained = correct_source = correct_destination = correct_pair = 0
    negative_total = false_positive_negatives = judged_transfers = unscorable = 0
    judged = 0
    for key,t in truth_lookup.items():
        p = pred_lookup[key]
        truth_type = t.get('event_type', 'transfer')
        if truth_type == 'unknown' or (truth_type == 'transfer' and
                (t.get('source_cup') not in CUPS or t.get('destination_cup') not in CUPS)):
            unscorable += 1
            continue
        if truth_type not in ('transfer','no_transfer'):
            raise ValueError('Invalid truth event type')
        negative_total += truth_type == 'no_transfer'
        pred_type = p.get('event_type', 'transfer')
        # An explicit false flag is required. Missing/unknown certainty abstains.
        certain = str(p.get('uncertain','')).strip().lower() == 'false'
        valid_pair = (p.get('source_cup') in CUPS and p.get('destination_cup') in CUPS
                      and p['source_cup'] != p['destination_cup'])
        valid_negative = pred_type == 'no_transfer' and not p.get('source_cup') and not p.get('destination_cup')
        # Count claimed pours on negative controls even when they are uncertain.
        if truth_type == 'no_transfer' and (pred_type == 'transfer' or p.get('source_cup') or p.get('destination_cup')):
            false_positive_negatives += 1
        if not certain or not ((pred_type == 'transfer' and valid_pair) or valid_negative):
            abstained += 1
            continue
        judged += 1
        if truth_type == 'no_transfer':
            correct_pair += valid_negative
            continue
        judged_transfers += 1
        sc = pred_type == 'transfer' and p.get('source_cup') == t['source_cup']
        dc = pred_type == 'transfer' and p.get('destination_cup') == t['destination_cup']
        correct_source += sc
        correct_destination += dc
        correct_pair += sc and dc
    # Transfer correctness is recomputed separately to avoid mixing negative controls.
    transfer_correct = sum(
        t.get('event_type','transfer') == 'transfer'
        and t.get('source_cup') in CUPS and t.get('destination_cup') in CUPS
        and str(pred_lookup[k].get('uncertain','')).strip().lower() == 'false'
        and pred_lookup[k].get('event_type','transfer') == 'transfer'
        and pred_lookup[k].get('source_cup') == t.get('source_cup')
        and pred_lookup[k].get('destination_cup') == t.get('destination_cup')
        and t.get('source_cup') != t.get('destination_cup')
        for k,t in truth_lookup.items())
    scorable = total-unscorable
    return dict(total=total,unscorable_truth=unscorable,abstained=abstained,
                coverage=judged/scorable if scorable else None,
                source_accuracy_on_judged=correct_source/judged_transfers if judged_transfers else None,
                destination_accuracy_on_judged=correct_destination/judged_transfers if judged_transfers else None,
                transfer_pair_accuracy_on_judged=transfer_correct/judged_transfers if judged_transfers else None,
                pair_or_no_transfer_accuracy_all=correct_pair/scorable if scorable else None,
                no_transfer_controls=negative_total,false_positive_no_transfer=false_positive_negatives)

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--truth',required=True)
    p.add_argument('--pred',required=True)
    a=p.parse_args()
    import json
    print(json.dumps(evaluate(load_rows(a.truth),load_rows(a.pred)),indent=2))
