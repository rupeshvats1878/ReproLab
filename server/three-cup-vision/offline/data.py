"""Human label schema, session split and local file integrity validation."""
import csv
import hashlib
from pathlib import Path

LABEL_FIELDS = 'video_id,video_path,session_id,split,event_index,event_type,source_cup,destination_cup,start_ms,end_ms,occluded,red_appearance,green_appearance,blue_appearance,annotator,notes'.split(',')
CUPS = {'RED','GREEN','BLUE'}


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_labels(path, media_root):
    root = Path(media_root).resolve()
    with Path(path).open(newline='') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != LABEL_FIELDS:
            raise ValueError('Expected exact ground-truth header')
        rows = list(reader)
    sessions, videos, hashes, keys, files = {}, {}, {}, set(), {}
    for number,row in enumerate(rows,2):
        if None in row or any(v is None for v in row.values()):
            raise ValueError(f'Row {number}: malformed CSV')
        if any(not row[k].strip() for k in ['video_id','video_path','session_id','annotator']):
            raise ValueError(f'Row {number}: missing provenance')
        if row['split'] not in {'train','val','test'} or row['event_type'] not in {'transfer','no_transfer','unknown'} or row['occluded'] not in {'true','false'}:
            raise ValueError(f'Row {number}: invalid enum')
        for key in ['event_index','start_ms','end_ms']:
            if not row[key].isascii() or not row[key].isdigit():
                raise ValueError(f'Row {number}: {key} must be a nonnegative integer')
        if int(row['end_ms']) <= int(row['start_ms']):
            raise ValueError('Event interval must have positive duration')
        pair = row['source_cup'],row['destination_cup']
        if any(cup and cup not in CUPS for cup in pair) or (pair[0] and pair[0]==pair[1]):
            raise ValueError('Invalid cup pair')
        if row['event_type']=='no_transfer' and any(pair):
            raise ValueError('No-transfer label cannot contain cup pair')
        if row['event_type']=='transfer' and row['occluded']=='false' and not all(pair):
            raise ValueError('Unoccluded transfer needs both physical identities')
        for field in ['red_appearance','green_appearance','blue_appearance']:
            if row[field] not in {'','visually_uniform','visibly_streaked','unclear'}:
                raise ValueError('Invalid appearance label')
        key = row['video_id'],int(row['event_index'])
        if key in keys: raise ValueError('Duplicate event key')
        keys.add(key)
        session,split = row['session_id'],row['split']
        if sessions.setdefault(session,split) != split: raise ValueError('Session split leakage')
        relative = Path(row['video_path'])
        local = (root/relative).resolve()
        if relative.is_absolute() or not local.is_relative_to(root) or not local.is_file() or local.stat().st_size==0:
            raise ValueError('Missing, empty or out-of-root video file')
        metadata = (local,session,split)
        if videos.setdefault(row['video_id'],metadata) != metadata: raise ValueError('Inconsistent video provenance')
        if local not in files:
            files[local] = dict(video_path=str(relative),sha256=file_sha256(local),bytes=local.stat().st_size)
        digest = files[local]['sha256']
        if hashes.setdefault(digest,(session,split)) != (session,split):
            raise ValueError('Identical video bytes assigned to different session/split')
    return dict(status='validated' if rows else 'not_evaluated',events=len(rows),sessions=len(sessions),files=list(files.values()),
                warning='Integrity hashes do not establish video decodability or annotation correctness')
