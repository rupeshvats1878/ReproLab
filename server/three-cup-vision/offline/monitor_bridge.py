"""Read-only Monitor projection for Cursor70a7 recording analyses; no app writes.

The upstream merged timeline is a hypothesis. Embedded humanConfirmed flags and
protocolReport are preserved as claims, never imported as local human reviews.
"""
import argparse
import copy
import json
from pathlib import Path
from .evaluation import binding, normalize_predictions, assess_events, pair, require, text_id
from .result_import import read_json
from .rules import CUPS, _time


def _coverage(analysis, review):
    segments = analysis.get('segments')
    require(isinstance(segments, list), 'segments must be an array')
    recording = analysis.get('recording')
    require(recording is None or isinstance(recording,dict), 'Invalid recording metadata')
    duration = (recording or {}).get('durationMs')
    reasons = []
    spans = []
    if not _time(duration) or duration == 0: reasons.append('missing_recording_duration')
    for segment in segments:
        require(isinstance(segment, dict), 'Invalid segment')
        start, end, length = segment.get('sourceOffsetMs'), segment.get('endMs'), segment.get('durationMs')
        capture = segment.get('capture') or {}
        require(isinstance(capture,dict), 'Invalid capture metadata')
        if (not _time(start) or not _time(end) or not _time(length) or length <= 0 or start + length != end or duration is None or end > duration):
            reasons.append('invalid_segment_coverage'); continue
        if segment.get('error') is not None or segment.get('observationStatus') not in ('observed', 'no_transfer'):
            reasons.append('failed_unclear_or_unprocessed_segment')
        if capture.get('rawResponseSaved') is not True or capture.get('metadataSaved') is not True:
            reasons.append('missing_saved_segment_evidence')
        spans.append((start, end))
    cursor = 0
    for start, end in sorted(spans):
        if start > cursor: reasons.append('coverage_gap')
        cursor = max(cursor, end)
    if not spans or cursor != duration: reasons.append('incomplete_recording_coverage')
    if analysis.get('error') is not None: reasons.append('recording_analysis_error')
    if analysis.get('coverageComplete') is not True: reasons.append('upstream_coverage_incomplete')
    if review is not None:
        require(isinstance(review, dict), 'Coverage review must be object')
    review = review or {}
    candidate_review = review.get('originalCandidateReview') or {}
    require(isinstance(candidate_review,dict), 'Invalid original candidate review')
    if not (candidate_review.get('reviewed') is True and text_id(candidate_review.get('reviewer')) and candidate_review.get('scope') == 'all_segment_candidates_and_multiplicity'):
        reasons.append('original_candidate_multiplicity_review_required')
    if not (review.get('reviewed') is True and text_id(review.get('reviewer')) and review.get('scope') == 'full_recording'):
        reasons.append('full_recording_human_coverage_review_required')
    return dict(upstreamClaim=analysis.get('coverageComplete'), reviewedComplete=not reasons, reasons=sorted(set(reasons)), review=copy.deepcopy(review))


def project_monitor(analysis, config, reviews=None, coverage_review=None):
    require(isinstance(analysis, dict) and analysis.get('schemaVersion') == 'three-cup-recording-analysis/v0.1', 'Unsupported recording-analysis schema')
    require(isinstance(config, dict), 'Monitor config required')
    run = config.get('run')
    require(isinstance(run, dict) and all(text_id(run.get(k)) for k in ('sessionId','videoId','protocolId')), 'Explicit run binding required')
    binding(analysis, run)
    protocol = config.get('protocol'); binding(protocol, run, True)
    steps = protocol.get('steps')
    require(isinstance(steps, list) and steps and all(isinstance(s,dict) and all(c in CUPS for c in pair(s)) and pair(s)[0]!=pair(s)[1] for s in steps), 'Valid per-recording protocol required')
    require(config.get('dataKind') in ('real','synthetic') and text_id(config.get('modelId')), 'Explicit data kind and model provenance required')
    timeline = analysis.get('timeline')
    require(isinstance(timeline, dict) and isinstance(timeline.get('events'), list), 'Timeline events required')
    provenance_records = [analysis, *timeline['events'], *analysis.get('segments', [])]
    for record in provenance_records:
        require(isinstance(record,dict), 'Invalid observation record')
        if config['dataKind']=='real':
            require(record.get('dataKind') not in ('synthetic','mock','mocked','mocked_fixture'), 'Synthetic observations cannot be promoted to real')
        for model_field in ('modelId','model'):
            if model_field in record:
                require(record[model_field] == config['modelId'], 'Model provenance mismatch')
    if coverage_review is not None:
        binding(coverage_review,run,True)
        if coverage_review.get('originalCandidateReview') is not None:
            binding(coverage_review['originalCandidateReview'],run,True)
    reviews = [] if reviews is None else reviews
    require(isinstance(reviews,list), 'Reviews must be array')
    review_map, evidence_reviews = {}, []
    for review in reviews:
        require(isinstance(review,dict) and text_id(review.get('eventId')) and text_id(review.get('reviewer')) and review.get('action') in ('confirm','reject'), 'Invalid human review')
        binding(review,run,True)
        require(review['eventId'] not in review_map, 'Conflicting/duplicate reviews require explicit resolution')
        review_map[review['eventId']] = review
        evidence_reviews.append(dict(eventId=review['eventId'],verified=review['action']=='confirm',identityVerified=review.get('identityVerified') is True,occluded=review.get('occluded')))
    recording = analysis.get('recording')
    require(recording is None or isinstance(recording,dict), 'Invalid recording metadata')
    duration = (recording or {}).get('durationMs')
    # Already original-recording times: sourceOffsetMs is deliberately zero here.
    envelope = dict(schemaVersion='three-cup-gemini-observation/v0.1',sessionId=run['sessionId'],videoId=run['videoId'],modelId=config['modelId'],latencyMs=None,sourceOffsetMs=0,videoDurationMs=duration,observationStatus='observed',events=timeline['events'])
    events, _ = normalize_predictions(envelope,run)
    assess_events(events,evidence_reviews,[])
    coverage = _coverage(analysis,coverage_review)
    segments = analysis['segments']
    for event in events:
        raw = event['rawObservation']
        indexes = raw.get('segmentIndexes', [raw['segmentIndex']] if 'segmentIndex' in raw else [])
        require(isinstance(indexes,list) and all(type(i) is int and i >= 0 for i in indexes), 'Invalid segment attribution')
        reasons = event['reviewReasons']
        if len(set(indexes)) > 1: reasons.append('merged_candidates_require_original_evidence_review')
        if not indexes or any(i>=len(segments) for i in indexes): reasons.append('missing_segment_attribution')
        start, end = event.get('eventStartMs'), event.get('eventEndMs')
        if start is not None and end is not None:
            for i in indexes:
                if i < len(segments) and not (_time(segments[i].get('sourceOffsetMs')) and _time(segments[i].get('endMs')) and segments[i]['sourceOffsetMs'] <= start <= end <= segments[i]['endMs']): reasons.append('event_outside_attributed_segment')
        if raw.get('truncated') is not False: reasons.append('truncated_or_unverified_event_boundary')
        if review_map.get(event['eventId'],{}).get('action')=='reject': reasons.append('human_rejected_observation_retained')
        event['reviewReasons'] = sorted(set(reasons))
    ordered = sorted(events,key=lambda e:(e.get('eventStartMs') is None,e.get('eventStartMs') or 0,e['eventId']))
    transfers = [e for e in ordered if e['eventType']=='liquid_transfer']
    safe_sequence = coverage['reviewedComplete'] and all(not e['reviewReasons'] for e in transfers)
    decisions, used, assigned = [], set(), []
    for event in transfers:
        candidates = [i for i,s in enumerate(steps) if pair(s)==pair(event)]
        available = [i for i in candidates if i not in used]
        expected, assigned_index = None, None
        if not safe_sequence:
            decision, reason = 'NEEDS_HUMAN_REVIEW','uncertain_event_or_incomplete_reviewed_recording'
        elif available:
            assigned_index=available[0]; used.add(assigned_index); expected=steps[assigned_index]
            decision,reason='MATCH','reviewed_pair_matches_candidate_step'
        elif candidates:
            decision,reason='POSSIBLE_EXTRA_TRANSFER','duplicate_approved_pair_retained'
        else:
            open_steps=[i for i in range(len(steps)) if i not in used]
            comparison=next((i for i in open_steps if steps[i]['sourceCupId']==event['sourceCupId']),None)
            if comparison is not None:
                decision,reason='POSSIBLE_WRONG_DESTINATION','unmatched_transfer_retained'; expected=steps[comparison]
            else:
                comparison=next((i for i in open_steps if steps[i]['destinationCupId']==event['destinationCupId']),None)
                if comparison is not None: decision,reason='POSSIBLE_WRONG_SOURCE','unmatched_transfer_retained'; expected=steps[comparison]
                else: decision,reason='POSSIBLE_EXTRA_TRANSFER','unmatched_transfer_retained'
        row=dict(eventId=event['eventId'],decision=decision,reason=reason,approvedStepIndex=assigned_index+1 if assigned_index is not None else None,expected=copy.deepcopy(expected),observed=dict(sourceCupId=event['sourceCupId'],destinationCupId=event['destinationCupId']),candidateStepIndices=[i+1 for i in candidates],requiresHumanReview=True,automaticAlertEligible=False)
        decisions.append(row)
        if assigned_index is not None: assigned.append((assigned_index,row))
    if any(right[0]<left[0] for left,right in zip(assigned,assigned[1:])):
        for _,row in assigned: row.update(decision='POSSIBLE_WRONG_ORDER',reason='reviewed_matching_pairs_in_reverse_protocol_order')
    if safe_sequence:
        for i,step in enumerate(steps):
            if i not in used: decisions.append(dict(eventId=None,decision='POSSIBLE_MISSING_TRANSFER',reason='not_found_in_reviewed_complete_timeline',approvedStepIndex=i+1,expected=copy.deepcopy(step),observed=None,candidateStepIndices=[],requiresHumanReview=True,automaticAlertEligible=False))
    status='POSSIBLE_DEVIATION' if any(row['decision'].startswith('POSSIBLE_') for row in decisions) else 'NEEDS_HUMAN_REVIEW'
    return dict(schemaVersion='three-cup-monitor-projection/v0.1',run=copy.deepcopy(run),dataKind=config['dataKind'],status=status,coverage=coverage,events=[dict(eventId=e['eventId'],observation=copy.deepcopy(e['rawObservation']),review=copy.deepcopy(review_map.get(e['eventId'])),reviewReasons=e['reviewReasons']) for e in ordered],decisions=decisions,protocol=copy.deepcopy(protocol),rawAnalysis=copy.deepcopy(analysis),humanReviews=copy.deepcopy(reviews),requiresHumanReview=True,automaticAlertEligible=False,automaticStepCompletion=False,warnings=['Preview only: never an authoritative compliance verdict.','Upstream protocolReport and humanConfirmed are retained as claims, not trusted decisions.','Merged timeline may omit original duplicate candidates; obtain segment evidence before resolving conflicts.','Synthetic fixture results are not real-world performance.' if config['dataKind']=='synthetic' else 'No benchmark accuracy is calculated.'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('analysis',type=Path)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--reviews',type=Path)
    parser.add_argument('--coverage-review',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:
        result=project_monitor(read_json(args.analysis.read_bytes()),read_json(args.config.read_bytes()),read_json(args.reviews.read_bytes()) if args.reviews else None,read_json(args.coverage_review.read_bytes()) if args.coverage_review else None)
        with args.output.open('x') as output: output.write(json.dumps(result,indent=2,allow_nan=False)+'\n')
    except (ValueError,TypeError,KeyError,OSError) as error: parser.exit(2,f'Monitor bridge input error: {error}\n')


if __name__=='__main__': main()
