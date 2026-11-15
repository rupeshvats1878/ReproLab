"""Expanded observer with legacy transfer envelope. Called after bridge reservation."""
import hashlib
import json
import os
import sys
from gemini_adapter.live_observe import observe_window
from gemini_adapter.client import default_transport
from gemini_adapter.budget import BudgetError

class BridgeReservation:
    """The bridge owns the persistent, lock-protected reservation before spawning us."""
    def reserve(self, estimate, *, label):
        if os.environ.get('LIVE_CALL_RESERVED') != '1':
            raise BudgetError('budget_required', 'Bridge reservation required.')
        return label
    def settle(self, *args, **kwargs):
        pass  # Usage is returned and persisted in the bridge evidence envelope.

def bounded_transport(request):
    for part in request['body']['input']:
        if part.get('type') == 'video':
            part['resolution'] = 'medium'
    return default_transport(request)

def compatible(result):
    events=[]
    for item in result['observations']:
        if item['category'] != 'liquid_transfer': continue
        source=item['sourceCupId'] or 'unknown'
        destination=item['destinationCupId'] or 'unknown'
        # Same-cup and malformed time hypotheses stay in expanded observations for review.
        start,end=item['eventStartMs'],item['eventEndMs']
        if source == destination and source != 'unknown': continue
        if not isinstance(start,int) or not isinstance(end,int) or end <= start: continue
        if start < result['window']['sourceOffsetMs'] or end > result['window']['sourceOffsetMs']+result['window']['durationMs']: continue
        events.append(dict(sourceCupId=source,destinationCupId=destination,eventStartMs=start,eventEndMs=end,
            evidenceTimestampsMs=item['evidenceTimestampsMs'],observationStatus='observed' if item['observationStatus']=='observed' else 'unclear',needsHumanVerification=True))
    return dict(schemaVersion='three-cup-gemini-observation/v0.1',sessionId=result['sessionId'],videoId=result['videoId'],
        modelId=result['modelId'],sourceOffsetMs=result['window']['sourceOffsetMs'],videoDurationMs=result['window']['durationMs'],
        remoteCallMade=result['remoteCallMade'],latencyMs=result['latencyMs'],error=result['error'],capture=result.get('capture'),
        events=events,appearances=[],observationStatus='unclear' if result['error'] or any(e['observationStatus']=='unclear' for e in events) else 'observed' if events else 'no_transfer',
        expanded=result)

if __name__ == '__main__':
    path,session,window,offset,captures=sys.argv[1:]
    result=observe_window(path, session_id=session,video_id=window,source_offset_ms=int(offset),
        source_sha256=hashlib.sha256(open(path,'rb').read()).hexdigest(),source_filename='normalized.mp4',
        window_index=int(window.split('-')[-1]),authorize_remote=True,video_fps=3,timeout_s=45,
        model_id='gemini-4-hydrogen',capture_dir=captures,budget=BridgeReservation(),transport=bounded_transport)
    print(json.dumps(compatible(result),allow_nan=False))
