"""Offline, dependency-free evaluation. No detection, hosted calls or step completion."""
import argparse
import copy
import json
from pathlib import Path
from .rules import CUPS, _time

SCHEMA = 'three-cup-evaluation/v0.2'
EVENT_TYPES = ('no_transfer', 'liquid_transfer', 'tool_cleaning_observed', 'possible_tool_cleaning_omission', 'spill_observed', 'unclear_activity')
MARKERS = {10: 'RED', 20: 'GREEN', 30: 'BLUE'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text_id(value):
    return isinstance(value, str) and bool(value.strip())


def binding(record, run, protocol=False):
    require(isinstance(record, dict), 'Expected object')
    for key in ('sessionId', 'videoId') + (('protocolId',) if protocol else ()):
        require(text_id(record.get(key)) and record[key] == run[key], f'{key} binding mismatch')


def pair(event):
    return (event.get('sourceCupId'), event.get('destinationCupId'))


def normalize_predictions(value, run):
    """Accept explicit events or Cursor v0.1 envelope; preserve raw inputs."""
    envelope = value if isinstance(value, dict) else None
    if envelope is not None:
        binding(envelope, run)
        require(envelope.get('schemaVersion') == 'three-cup-gemini-observation/v0.1', 'Unknown adapter schema')
        require(envelope.get('observationStatus') in ('observed', 'unclear', 'no_transfer', 'unavailable'), 'Invalid adapter observationStatus')
        require(envelope.get('sourceOffsetMs') is None or _time(envelope['sourceOffsetMs']), 'Invalid sourceOffsetMs')
        require(envelope.get('videoDurationMs') is None or _time(envelope['videoDurationMs']), 'Invalid videoDurationMs')
        value = envelope.get('events')
    require(isinstance(value, list), 'predictions must be a list or supported adapter envelope')
    result = []
    for index, raw in enumerate(value):
        require(isinstance(raw, dict), 'Prediction must be object')
        event = copy.deepcopy(raw)
        if envelope is not None:
            for key in ('sessionId', 'videoId', 'modelId', 'latencyMs'):
                event.setdefault(key, envelope.get(key))
            event.setdefault('eventId', f'adapter-event-{index + 1}')
        binding(event, run)
        require(text_id(event.get('eventId')), 'eventId required')
        if event.get('observationStatus') == 'no_transfer':
            require(event.get('eventType') in (None, 'no_transfer') and all(c in (None, 'unknown') for c in pair(event)), 'Contradictory no-transfer observation')
            event['eventType'] = 'no_transfer'
        event.setdefault('eventType', 'liquid_transfer')
        require(event['eventType'] in EVENT_TYPES, 'Invalid eventType')
        if event['eventType'] == 'no_transfer':
            require(event.get('observationStatus') == 'no_transfer' and all(c in (None, 'unknown') for c in pair(event)), 'Contradictory no-transfer type')
        for key in ('sourceCupId', 'destinationCupId'):
            require(event.get(key) in (*CUPS, 'unknown', None), 'Invalid cup identity')
            event.setdefault(key, None)
        event['normalizationIssues'] = []
        if envelope is not None:
            # Adapter retains invalid model estimates as unclear; never make them usable evidence.
            start, end = event.get('eventStartMs'), event.get('eventEndMs')
            offset = envelope.get('sourceOffsetMs') or 0
            duration = envelope.get('videoDurationMs')
            def valid_stamp(value):
                return _time(value) and value >= offset and (duration is None or value <= offset + duration)
            if not valid_stamp(start) or not valid_stamp(end) or start >= end:
                event['normalizationIssues'].append('invalid_adapter_event_interval')
                event['eventStartMs'] = event['eventEndMs'] = None
            evidence = event.get('evidenceTimestampsMs', [])
            require(isinstance(evidence, list), 'Adapter evidence must be array')
            valid_evidence = [t for t in evidence if valid_stamp(t) and event['eventStartMs'] is not None and start <= t <= end]
            if len(valid_evidence) != len(evidence):
                event['normalizationIssues'].append('invalid_adapter_evidence_timestamps')
            event['evidenceTimestampsMs'] = valid_evidence
        start, end = event.get('eventStartMs'), event.get('eventEndMs')
        require((start is None or _time(start)) and (end is None or _time(end)), 'Invalid event timestamps')
        require(start is None or end is None or start < end, 'Event interval must increase')
        evidence = event.get('evidenceTimestampsMs', [])
        require(isinstance(evidence, list) and all(_time(t) for t in evidence), 'Invalid evidence timestamps')
        require(start is None or end is None or all(start <= t <= end for t in evidence), 'Evidence outside event interval')
        for flag in ('uncertain', 'occluded'):
            require(flag not in event or type(event[flag]) is bool, f'Invalid {flag} flag')
        event['evidenceTimestampsMs'] = evidence
        require(event.get('latencyMs') is None or _time(event['latencyMs']), 'Invalid latencyMs')
        require(event.get('needsHumanVerification') is None or type(event['needsHumanVerification']) is bool, 'Invalid verification flag')
        require(event.get('observationStatus') in ('observed', 'unclear', 'no_transfer', 'unavailable', None), 'Invalid observationStatus')
        event['adapterUnavailable'] = bool(envelope and (envelope.get('error') or envelope.get('observationStatus') != 'observed'))
        event['rawObservation'] = copy.deepcopy(raw)
        result.append(event)
    require(len({e['eventId'] for e in result}) == len(result), 'Duplicate eventId')
    return result, envelope


def assess_events(events, reviews, markers):
    require(isinstance(reviews, list) and isinstance(markers, list), 'Reviews/markers must be arrays')
    ids = {e['eventId'] for e in events}
    review_map = {}
    for review in reviews:
        require(isinstance(review, dict) and review.get('eventId') in ids, 'Review references unknown event')
        require(review['eventId'] not in review_map, 'Duplicate review')
        review_map[review['eventId']] = review
    for marker in markers:
        require(isinstance(marker, dict) and marker.get('eventId') in ids, 'Marker references unknown event')
        require(marker.get('role') in ('source', 'destination'), 'Marker role required; visibility alone is not a pour')
        require(type(marker.get('visible')) is bool and _time(marker.get('timeMs')), 'Invalid marker observation')
        require(type(marker.get('markerId')) is int, 'Invalid markerId')
    for event in events:
        reasons = list(event.get('normalizationIssues', []))
        if event.get('adapterUnavailable'):
            reasons.append('adapter_unavailable_or_unclear')
        if not text_id(event.get('modelId')):
            reasons.append('missing_model_provenance')
        if event.get('needsHumanVerification') is None:
            reasons.append('missing_verification_status')
        review = review_map.get(event['eventId'], {})
        if review.get('verified') is not True or review.get('identityVerified') is not True:
            reasons.append('unverified_observation_or_identity')
        if review.get('occluded') is not False:
            reasons.append('occluded_or_unknown_visibility')
        if any(c not in CUPS for c in pair(event)) or pair(event)[0] == pair(event)[1]:
            reasons.append('unknown_or_invalid_physical_identity')
        start, end = event.get('eventStartMs'), event.get('eventEndMs')
        if start is None or end is None:
            reasons.append('missing_timestamps')
        if not event['evidenceTimestampsMs']:
            reasons.append('missing_evidence')
        if event.get('observationStatus') != 'observed' or event.get('uncertain') is True or event.get('occluded') is True or event.get('abstainReason'):
            reasons.append('unclear_observation')
        for marker in markers:
            if marker['eventId'] != event['eventId']:
                continue
            expected = event['sourceCupId' if marker['role'] == 'source' else 'destinationCupId']
            if not marker['visible'] or start is None or end is None or not start <= marker['timeMs'] <= end:
                reasons.append('marker_evidence_unavailable')
            elif MARKERS.get(marker['markerId']) != marker.get('cupId') or marker.get('cupId') != expected:
                reasons.append('marker_disagreement')
        event['reviewReasons'] = sorted(set(reasons))
    transfers = [e for e in events if e['eventType'] == 'liquid_transfer']
    for i, left in enumerate(transfers):
        for right in transfers[i + 1:]:
            times = [left.get('eventStartMs'), left.get('eventEndMs'), right.get('eventStartMs'), right.get('eventEndMs')]
            if None not in times and max(times[0], times[2]) < min(times[1], times[3]):
                for event in (left, right):
                    event['reviewReasons'] = sorted(set(event['reviewReasons'] + ['ambiguous_overlapping_timestamps']))
    return transfers


def compare_sequence(transfers, steps, coverage_complete):
    ordered = sorted(transfers, key=lambda e: (e.get('eventStartMs') is None, e.get('eventStartMs') or 0, e['eventId']))
    expected_pairs = [pair(s) for s in steps]
    decisions = []
    sequence_uncertain = any(e['reviewReasons'] for e in ordered)
    used_steps = set()
    position = 0
    for event in ordered:
        i = position
        expected = steps[i] if i < len(steps) else None
        observed = pair(event)
        matching = [j + 1 for j, p in enumerate(expected_pairs) if p == observed]
        if event['reviewReasons'] or sequence_uncertain:
            decision, reason = 'NEEDS_HUMAN_REVIEW', 'uncertain_sequence_or_event'
        elif matching and all(j - 1 in used_steps for j in matching):
            decision, reason = 'POSSIBLE_EXTRA_TRANSFER', 'duplicate_pair'
        elif expected is None:
            decision = 'POSSIBLE_EXTRA_TRANSFER'
            reason = 'duplicate_pair' if any(pair(e) == observed for e in ordered[:i]) else 'extra_observed_transfer'
        elif observed == pair(expected):
            decision, reason = 'MATCH', 'observed_pair_matches'
        elif matching:
            decision, reason = 'POSSIBLE_WRONG_ORDER', 'pair_matches_other_approved_step'
        elif observed[0] == pair(expected)[0]:
            decision, reason = 'POSSIBLE_WRONG_DESTINATION', 'destination_differs'
        elif observed[1] == pair(expected)[1]:
            decision, reason = 'POSSIBLE_WRONG_SOURCE', 'source_differs'
        else:
            decision, reason = 'NEEDS_HUMAN_REVIEW', 'both_identities_differ'
        if decision != 'POSSIBLE_EXTRA_TRANSFER':
            position += 1
            available = [j - 1 for j in matching if j - 1 not in used_steps]
            if available:
                used_steps.add(i if i in available else available[0])
            elif i < len(steps):
                used_steps.add(i)
        decisions.append(dict(decision=decision, reason=reason, approvedStepIndex=i + 1 if expected else None, expected=expected, observed=dict(sourceCupId=observed[0], destinationCupId=observed[1]), observedEventId=event['eventId'], matchingApprovedStepIndices=matching, requiresHumanReview=True, automaticAlertEligible=False))
    for i in range(len(steps)):
        if i in used_steps:
            continue
        supported = coverage_complete and not sequence_uncertain
        decisions.append(dict(decision='POSSIBLE_MISSING_TRANSFER' if supported else 'NEEDS_HUMAN_REVIEW', reason='complete_reviewed_coverage' if supported else 'incomplete_or_uncertain_coverage', approvedStepIndex=i + 1, expected=steps[i], observed=None, observedEventId=None, requiresHumanReview=True, automaticAlertEligible=False))
    return decisions


def validate_truth(truth, run, assignments, steps):
    require(isinstance(assignments, list), 'datasetAssignments must be array')
    rows = list(assignments)
    if truth is not None:
        binding(truth, run)
        require(isinstance(truth.get('events'), list), 'Ground truth events required')
        rows.append(truth)
        require(text_id(truth.get('annotator')), 'Ground truth annotator required')
        ids = set()
        for event in truth['events']:
            require(isinstance(event, dict) and text_id(event.get('eventId')) and event['eventId'] not in ids, 'Invalid/duplicate truth eventId')
            ids.add(event['eventId'])
            if 'sessionId' in event or 'videoId' in event:
                binding(event, run)
            require(all(c in (*CUPS, 'unknown', None) for c in pair(event)), 'Invalid truth cups')
            require(_time(event.get('eventStartMs')) and _time(event.get('eventEndMs')) and event['eventStartMs'] < event['eventEndMs'], 'Invalid truth window')
            require(event.get('stepIndex') is None or (type(event['stepIndex']) is int and 1 <= event['stepIndex'] <= len(steps)), 'Invalid truth stepIndex')
    sessions, videos = {}, {}
    for row in rows:
        require(isinstance(row, dict) and text_id(row.get('sessionId')) and text_id(row.get('videoId')) and row.get('split') in ('train', 'val', 'test'), 'Invalid dataset assignment')
        session, video, split = row['sessionId'], row['videoId'], row['split']
        require(session not in sessions or sessions[session] == split, 'Ground-truth session leakage')
        require(video not in videos or videos[video] == (session, split), 'Video session/split leakage')
        sessions[session], videos[video] = split, (session, split)


def score(transfers, truth, alignments):
    predictions = {e['eventId']: e for e in transfers}
    actual = {e['eventId']: e for e in truth['events']}
    require(isinstance(alignments, list), 'alignments must be array')
    used_pred, used_truth, evidence = set(), set(), []
    counts = dict(correctPairs=0, wrongPairs=0, correctSources=0, wrongSources=0, correctDestinations=0, wrongDestinations=0, correctStepAssignments=0, wrongStepAssignments=0, unknownTruthEvents=0, timestampErrors=0)
    chronological = sorted(transfers, key=lambda e: (e.get('eventStartMs') is None, e.get('eventStartMs') or 0, e['eventId']))
    for alignment in alignments:
        require(isinstance(alignment, dict), 'Alignment must be object')
        pid, gid = alignment.get('predictionEventId'), alignment.get('groundTruthEventId')
        require(pid in predictions and gid in actual and pid not in used_pred and gid not in used_truth, 'Invalid/non-one-to-one alignment')
        used_pred.add(pid); used_truth.add(gid)
        prediction, target = predictions[pid], actual[gid]
        known = all(c in CUPS for c in pair(target)) and pair(target)[0] != pair(target)[1]
        abstained = bool(prediction['reviewReasons'])
        row = dict(predictionEventId=pid, groundTruthEventId=gid, predicted=pair(prediction), groundTruth=pair(target), reviewReasons=prediction['reviewReasons'], evidenceTimestampsMs=prediction['evidenceTimestampsMs'], sourceCorrect=None, destinationCorrect=None, stepCorrect=None, timestampWithinWindow=None)
        if not known:
            counts['unknownTruthEvents'] += 1
        if known and not abstained:
            source, dest = [a == b for a, b in zip(pair(prediction), pair(target))]
            row.update(sourceCorrect=source, destinationCorrect=dest)
            counts['correctSources' if source else 'wrongSources'] += 1
            counts['correctDestinations' if dest else 'wrongDestinations'] += 1
            counts['correctPairs' if source and dest else 'wrongPairs'] += 1
            if target.get('stepIndex') is not None:
                step_correct = chronological.index(prediction) + 1 == target['stepIndex']
                row['stepCorrect'] = step_correct
                counts['correctStepAssignments' if step_correct else 'wrongStepAssignments'] += 1
        start, end = prediction.get('eventStartMs'), prediction.get('eventEndMs')
        if start is not None and end is not None:
            row['timestampWithinWindow'] = target['eventStartMs'] <= start <= end <= target['eventEndMs']
            counts['timestampErrors'] += int(not row['timestampWithinWindow'])
        evidence.append(row)
    counts.update(missedEvents=len(actual) - len(used_truth), falsePositiveEvents=len(predictions) - len(used_pred), unknownOrAbstainedEvents=sum(bool(e['reviewReasons']) for e in transfers), alignedEvents=len(evidence))
    denominator = counts['correctPairs'] + counts['wrongPairs']
    counts['pairAccuracyOnScorableAlignedEvents'] = counts['correctPairs'] / denominator if denominator else None
    counts['scorableAlignedEvents'] = denominator
    return counts, evidence


def evaluate(data):
    require(isinstance(data, dict) and data.get('schemaVersion') == SCHEMA, 'Unsupported evaluation schema')
    require(data.get('dataKind') in ('synthetic', 'real'), 'dataKind must be explicit')
    run = data.get('run')
    require(isinstance(run, dict) and all(text_id(run.get(k)) for k in ('sessionId', 'videoId', 'protocolId')), 'Run binding required')
    protocol = data.get('protocol'); binding(protocol, run, True)
    steps = protocol.get('steps')
    require(isinstance(steps, list) and bool(steps), 'Protocol steps required')
    require(all(isinstance(s, dict) and all(c in CUPS for c in pair(s)) and pair(s)[0] != pair(s)[1] for s in steps), 'Invalid protocol pair')
    require(type(data.get('coverageComplete', False)) is bool, 'coverageComplete must be boolean')
    events, envelope = normalize_predictions(data.get('predictions', []), run)
    transfers = assess_events(events, data.get('reviews', []), data.get('markerObservations', []))
    truth = data.get('groundTruth'); validate_truth(truth, run, data.get('datasetAssignments', []), steps)
    reasons = []
    if not transfers: reasons.append('no_model_transfer_observations')
    if truth is None or truth.get('verified') is not True: reasons.append('no_verified_ground_truth')
    if 'alignments' not in data: reasons.append('explicit_alignment_required')
    if not any(not e['reviewReasons'] for e in transfers): reasons.append('no_verified_scorable_model_observations')
    if envelope and (envelope.get('error') or envelope.get('observationStatus') == 'unavailable'): reasons.append('adapter_unavailable_or_error')
    metrics, alignment_evidence = None, []
    # Validate supplied alignments even for NOT_EVALUATED reports, so errors cannot hide.
    if truth is not None and 'alignments' in data:
        candidate_metrics, alignment_evidence = score(transfers, truth, data['alignments'])
        if not reasons: metrics = candidate_metrics
    status = 'NOT_EVALUATED' if reasons else ('SYNTHETIC_EVALUATION' if data['dataKind'] == 'synthetic' else 'EVALUATED')
    return dict(schemaVersion=SCHEMA, status=status, dataKind=data['dataKind'], recordingId=run['videoId'], sessionId=run['sessionId'], protocolId=run['protocolId'], groundTruthEventCount=len(truth['events']) if truth else 0, modelPredictedEventCount=len(transfers), nonTransferObservationCount=len(events) - len(transfers), metrics=metrics, notEvaluatedReasons=reasons, events=events, perEventEvidence=alignment_evidence, protocolDecisions=compare_sequence(transfers, steps, data.get('coverageComplete', False)), adapterObservation=copy.deepcopy(envelope), compatibility='cursor_v0.1_119e048_mocked_envelope_verified_no_live_inference', warnings=['Synthetic results are software tests, not real-world accuracy.' if data['dataKind'] == 'synthetic' else 'Review attestations and ground-truth provenance are caller supplied.', 'No authoritative step completion or automated alerts.', 'Explicit alignment is human supplied; no automatic event matching.'])


def markdown_report(report):
    lines = ['# Three-cup evaluation', '', f"Status: **{report['status']}**", f"Data: {report['dataKind']}", f"Recording: {report['recordingId']}", f"Protocol: {report['protocolId']}", f"Ground truth events: {report['groundTruthEventCount']}", f"Predicted transfers: {report['modelPredictedEventCount']}", '', *report['warnings'], '']
    if report['notEvaluatedReasons']:
        lines.append('Not evaluated: ' + ', '.join(report['notEvaluatedReasons']))
    lines.extend(['', '## Metrics', '', '```json', json.dumps(report['metrics'], indent=2, allow_nan=False), '```', '', '## Protocol comparisons', ''])
    for decision in report['protocolDecisions']:
        lines.append(f"- {decision['observedEventId'] or '(missing)'}: {decision['decision']} — expected {decision['expected']}; observed {decision['observed']}; {decision['reason']}")
    lines.extend(['', '## Per-event evidence', '', '```json', json.dumps(report['perEventEvidence'], indent=2, allow_nan=False), '```', ''])
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--json-output', type=Path, required=True)
    parser.add_argument('--markdown-output', type=Path, required=True)
    args = parser.parse_args()
    try:
        require(args.json_output.resolve() != args.markdown_output.resolve(), 'Output paths must differ')
        require(not args.json_output.exists() and not args.markdown_output.exists(), 'Refusing to overwrite existing output')
        report = evaluate(json.loads(args.input.read_text()))
        json_text = json.dumps(report, indent=2, allow_nan=False) + '\n'
        markdown = markdown_report(report)
        for path, content in ((args.json_output, json_text), (args.markdown_output, markdown)):
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x') as output: output.write(content)
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.exit(2, f'Evaluation input error: {error}\n')


if __name__ == '__main__':
    main()
