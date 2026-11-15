"""Dependency-free comparison, isolated from visual observation generation."""
import math

CUPS = ('RED','GREEN','BLUE')
APPROVED_STEPS = (('RED','BLUE'), ('GREEN','RED'))


def _time(value):
    return type(value) in (int,float) and math.isfinite(value) and value >= 0


def compare_step(event, step_index):
    """Compare a supplied event; never infer a transfer or complete a step."""
    expected = APPROVED_STEPS[step_index-1] if type(step_index) is int and 1 <= step_index <= 2 else None
    result = dict(decision='NEEDS_HUMAN_REVIEW', reason='missing_or_invalid_evidence',
                  approvedStepIndex=step_index, expected=expected,
                  observedEventId=event.get('eventId') if isinstance(event,dict) else None,
                  requiresHumanReview=True)
    if not isinstance(event,dict) or expected is None:
        return result
    source, destination = event.get('sourceCupId'),event.get('destinationCupId')
    start,end = event.get('startMs'),event.get('endMs')
    credible = (isinstance(event.get('eventId'),str) and bool(event['eventId'].strip())
                and event.get('eventType') == 'transfer'
                and source in CUPS and destination in CUPS and source != destination
                and event.get('uncertain') is False and event.get('occluded') is False
                and event.get('identityVerified') is True and not event.get('abstainReason')
                and _time(start) and _time(end) and end > start)
    if credible and 'identityEvidence' in event:
        evidence = event['identityEvidence']
        marker_map = {'RED':10,'GREEN':20,'BLUE':30}
        seen = set()
        if not isinstance(evidence,list) or not evidence:
            credible = False
        else:
            for item in evidence:
                if (not isinstance(item,dict) or item.get('cupId') not in (source,destination)
                    or type(item.get('markerId')) is not int
                    or item['markerId'] != marker_map[item['cupId']]
                    or not isinstance(item.get('frameId'),str) or not item['frameId'].strip()
                    or not _time(item.get('timeMs')) or not start <= item['timeMs'] <= end):
                    credible = False
                    break
                seen.add(item['cupId'])
            credible = credible and seen == {source,destination}
    if credible:
        result.update(decision='MATCH' if (source,destination)==expected else 'POSSIBLE_MISMATCH',
                      reason='observed_pair_matches' if (source,destination)==expected else 'observed_pair_differs')
    return result
