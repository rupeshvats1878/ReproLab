"""Pure local conversion of Cursor 9002039 Interactions capture exports.

No SDK, client, video, environment, credentials, or transport imports. Timestamp
and identity semantics follow that commit's parse_observation.py; raw capture
bytes remain a separate artifact. Unsupported/error provider formats reject.
"""
import math
from .evaluation import CUPS, require

CAPTURE_COMMIT = '9002039a5a28cd305ffd5500ba62c42ba3e5c7cc'


def convert_capture(provider, metadata, provenance, decode_json):
    require(isinstance(provenance, dict), 'Capture provenance object required')
    require(isinstance(metadata, dict) and isinstance(provider, dict), 'Capture JSON objects required')
    require(provenance.get('adapterCommit') == CAPTURE_COMMIT, 'Unsupported capture adapter commit')
    require(metadata.get('httpStatus') == 200 and type(metadata.get('httpStatus')) is int and metadata.get('rawResponseSaved') is True and not metadata.get('error'), 'Only successful saved captures supported')
    mapping = {'model':'modelId', 'sessionId':'sessionId', 'videoId':'videoId', 'sourceOffsetMs':'sourceOffsetMs', 'clipDurationMs':'videoDurationMs', 'filename':'clipFilename', 'sha256':'clipSha256'}
    for actual, claimed in mapping.items():
        require(actual in metadata and claimed in provenance and metadata[actual] == provenance[claimed], f'Capture metadata {actual} mismatch')
    offset, duration = metadata['sourceOffsetMs'], metadata['clipDurationMs']
    require(type(offset) is int and offset >= 0 and type(duration) is int and duration > 0, 'Capture offset/duration must be valid integer milliseconds')
    require(provider.get('error') is None, 'Provider error responses cannot be converted')
    require(provider.get('status') == 'completed', 'Provider interaction did not complete')
    if 'model' in provider:
        require(provider['model'] == metadata['model'], 'Provider/metadata model mismatch')
    chunks = []
    for step in provider.get('steps', []) if isinstance(provider.get('steps', []), list) else []:
        content = step.get('content') if isinstance(step, dict) else None
        if isinstance(content, list):
            chunks.extend(block['text'] for block in content if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str))
    text = ''.join(chunks).strip()
    if not text and isinstance(provider.get('output_text'), str): text = provider['output_text'].strip()
    require(bool(text), 'Provider interaction has no supported text')
    if text.startswith('```'):
        lines = text.splitlines()[1:]
        if lines and lines[-1].startswith('```'): lines = lines[:-1]
        text = '\n'.join(lines).strip()
    payload = decode_json(text)
    require(isinstance(payload, dict) and isinstance(payload.get('transfers'), list), 'Model text must contain transfers array')
    require(type(payload.get('noVisibleTransfer', False)) is bool, 'Invalid noVisibleTransfer')
    require(isinstance(payload.get('appearances', []), list), 'Invalid appearances array')
    warnings = []
    def warn(code):
        if code not in warnings: warnings.append(code)
    def integer(value):
        return int(value) if type(value) in (int, float) and math.isfinite(value) and (type(value) is int or value.is_integer()) else None
    def cup(value):
        token = value.strip().upper() if isinstance(value, str) else None
        if token in CUPS: return token
        if token not in ('UNKNOWN','UNCLEAR','AMBIGUOUS','UNDETERMINED','UNDETERMINED.',''): warn('unrecognized_cup_id')
        return 'unknown'
    def evidence(value):
        if value is None: return [], False
        if not isinstance(value, list): warn('timestamp_not_integer'); return [], True
        stamps, bad = [], False
        for value in value:
            stamp = integer(value)
            if stamp is None: warn('timestamp_not_integer'); bad=True; continue
            if stamp < 0: warn('timestamp_negative'); bad=True
            if stamp > duration: warn('timestamp_outside_video'); bad=True
            stamps.append(stamp)
        return stamps, bad
    events = []
    for item in payload['transfers']:
        require(isinstance(item, dict), 'Invalid transfer entry')
        source, destination = cup(item.get('sourceCupId')), cup(item.get('destinationCupId'))
        start, end = integer(item.get('eventStartMs')), integer(item.get('eventEndMs'))
        stamps, bad = evidence(item.get('evidenceTimestampsMs'))
        if start is None or end is None: warn('timestamp_not_integer'); bad=True
        else:
            if min(start,end) < 0: warn('timestamp_negative'); bad=True
            if end < start: warn('timestamp_not_ordered'); bad=True
            elif end == start: warn('timestamp_zero_duration'); bad=True
            elif any(t < start or t > end for t in stamps): warn('evidence_outside_event'); bad=True
            if max(start,end) > duration: warn('timestamp_outside_video'); bad=True
        status = 'observed' if source in CUPS and destination in CUPS and source != destination and not bad else 'unclear'
        events.append(dict(sourceCupId=source,destinationCupId=destination,eventStartMs=start+offset if start is not None else None,eventEndMs=end+offset if end is not None else None,evidenceTimestampsMs=[t+offset for t in stamps],observationStatus=status,needsHumanVerification=True))
    appearances = []
    for item in payload.get('appearances', []):
        if not isinstance(item, dict): warn('appearance_entry_ignored'); continue
        label = item.get('label'); label = label.strip().lower() if isinstance(label,str) else 'unclear'
        if label not in ('visually_uniform','visibly_streaked','unclear'): label='unclear'
        stamps, _ = evidence(item.get('evidenceTimestampsMs'))
        if any(t < 0 or t > duration for t in stamps): warn('appearance_evidence_outside_video'); continue
        appearances.append(dict(cupId=cup(item.get('cupId')),label=label,evidenceTimestampsMs=[t+offset for t in stamps],needsHumanVerification=True))
    if appearances: warn('appearance_is_visual_only')
    if events: warn('timestamps_are_model_estimates')
    if payload.get('noVisibleTransfer') and events:
        warn('contradictory_no_transfer')
        for event in events: event['observationStatus']='unclear'
    if not events:
        status = 'no_transfer' if payload.get('noVisibleTransfer') else 'unclear'
        if status == 'unclear': warn('empty_transfer_list')
    else: status = 'observed' if all(e['observationStatus']=='observed' for e in events) else 'unclear'
    return dict(schemaVersion='three-cup-gemini-observation/v0.1',sessionId=metadata['sessionId'],videoId=metadata['videoId'],modelId=metadata['model'],sourceOffsetMs=offset,videoDurationMs=duration,latencyMs=metadata.get('latencyMs'),remoteCallMade=metadata.get('remoteCallMade'),needsHumanVerification=True,events=events,appearances=appearances,observationStatus=status,warnings=warnings,error=None,samplingFps=None)
