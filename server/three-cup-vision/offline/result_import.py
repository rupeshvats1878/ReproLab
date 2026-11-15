"""Package a saved adapter envelope locally. Never read footage or call a model."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

from .evaluation import evaluate, markdown_report, require, text_id
from .rules import _time
from .capture_conversion import convert_capture

SERVICE = Path(__file__).resolve().parents[1]
ORIGINS = ('genuine_model_response', 'mocked_fixture', 'adapter_error', 'human_annotation')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f'Nonfinite JSON constant: {value}')


def read_json(raw):
    return json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_constant)


def validate_provenance(envelope, config, provenance):
    require(isinstance(envelope, dict) and envelope.get('schemaVersion') == 'three-cup-gemini-observation/v0.1', 'Only saved adapter envelopes supported; raw provider JSON is not supported')
    require(isinstance(config, dict) and 'predictions' not in config, 'Config must be an evaluation bundle without predictions')
    require(isinstance(provenance, dict), 'Provenance must be an object')
    origin = provenance.get('origin')
    require(origin in ORIGINS, 'Explicit provenance origin required')
    require(origin != 'human_annotation', 'Human annotations are ground truth, never model predictions; attach separately in config')
    require(provenance.get('attested') is True and text_id(provenance.get('attestedBy')), 'Caller provenance attestation required')
    for key in ('originalVideoSha256', 'clipSha256'):
        require(isinstance(provenance.get(key), str) and re.fullmatch(r'[0-9a-f]{64}', provenance[key]) is not None, f'{key} must be a lowercase SHA-256 digest')
    require(isinstance(provenance.get('adapterCommit'), str) and re.fullmatch(r'[0-9a-f]{40}', provenance['adapterCommit']) is not None, 'Full adapter commit required')
    filename = provenance.get('clipFilename')
    require(text_id(filename) and filename not in ('.', '..') and '/' not in filename and '\\' not in filename and '\x00' not in filename, 'clipFilename must be a basename, not a private path')
    for key in ('sessionId', 'videoId', 'modelId'):
        require(text_id(provenance.get(key)) and provenance[key] == envelope.get(key), f'{key} provenance/envelope mismatch')
    for key in ('sourceOffsetMs', 'videoDurationMs'):
        require(key in provenance and key in envelope and provenance[key] == envelope[key], f'{key} provenance/envelope mismatch')
        require(_time(provenance[key]) or (origin == 'adapter_error' and provenance[key] is None), f'Invalid {key} provenance')
    require(type(envelope.get('remoteCallMade')) is bool, 'Envelope remoteCallMade must be explicit boolean')
    require(envelope.get('needsHumanVerification') is True, 'Adapter verification requirement missing')
    require(isinstance(envelope.get('appearances'), list) and isinstance(envelope.get('warnings'), list), 'Invalid adapter metadata arrays')
    require(envelope.get('error') is None or isinstance(envelope['error'], dict), 'Invalid adapter error')
    has_error = envelope.get('error') is not None or envelope.get('observationStatus') == 'unavailable'
    if origin == 'adapter_error':
        require(has_error, 'adapter_error origin requires an adapter error/unavailable response')
    else:
        require(not has_error, 'Error responses must be classified adapter_error')
    if origin == 'genuine_model_response':
        require(config.get('dataKind') == 'real' and envelope['remoteCallMade'] is True, 'Genuine origin requires real mode and a declared remote call')
    elif origin == 'mocked_fixture':
        require(config.get('dataKind') == 'synthetic', 'Mocked fixtures must remain synthetic')
    for record in (envelope, provenance):
        if 'dataKind' in record:
            require(record['dataKind'] == config.get('dataKind'), 'Contradictory dataKind provenance')
    if 'origin' in envelope:
        require(envelope['origin'] == origin, 'Contradictory envelope origin')


def _destination(path):
    path = Path(path).absolute()
    resolved = path.resolve()
    require(any(root in resolved.parents for root in (SERVICE/'outputs', SERVICE/'data', SERVICE/'work')), 'Package must be inside service ignored outputs/, data/, or work/')
    # Reject symlink traversal even when it resolves back into an allowed folder.
    require(not any(parent.is_symlink() for parent in (path, *path.parents)), 'Symlink package destination not allowed')
    check = subprocess.run(['git', 'check-ignore', '--quiet', '--', str(resolved/'manifest.json')], cwd=SERVICE, capture_output=True)
    require(check.returncode == 0, 'Package destination must be Git ignored')
    require(not path.exists(), 'Refusing to overwrite existing package')
    return path


def _read_saved_json(path):
    path = Path(path)
    require(path.suffix.lower() == ".json" and not path.is_symlink(), "Only regular saved JSON files accepted")
    require(stat.S_ISREG(path.stat().st_mode), "Saved JSON must be a regular file")
    return path.read_bytes()


def import_result(source, config, provenance, output_dir, capture_metadata=None):
    """Return manifest after exclusive publication; COMPLETE is written last."""
    source = Path(source)
    require(source.suffix.lower() == '.json' and not source.is_symlink(), 'Only regular saved .json responses are accepted; no media or symlinks')
    require(stat.S_ISREG(source.stat().st_mode), 'Saved response must be a regular file')
    raw = source.read_bytes()
    metadata_raw = _read_saved_json(capture_metadata) if capture_metadata is not None else None
    envelope = convert_capture(read_json(raw), read_json(metadata_raw), provenance, read_json) if metadata_raw is not None else read_json(raw)
    validate_provenance(envelope, config, provenance)
    scope = config.get('observationScope', 'partial_clip')
    require(scope in ('partial_clip', 'full_run'), 'Invalid observationScope')
    if scope == 'full_run':
        require(provenance['sourceOffsetMs'] == 0 and provenance['clipSha256'] == provenance['originalVideoSha256'], 'Extracted captures cannot claim full-run scope')
    if scope == 'partial_clip':
        require(config.get('coverageComplete', False) is False, 'Partial clips cannot attest complete protocol coverage')
    bundle = copy.deepcopy(config)
    bundle['predictions'] = envelope
    report = evaluate(bundle)
    if provenance['origin'] == 'adapter_error':
        require(report['status'] == 'NOT_EVALUATED', 'Adapter errors cannot produce evaluated results')
    report['observationScope'] = scope
    if scope == 'partial_clip':
        report['status'] = 'NOT_EVALUATED'
        report['metrics'] = None
        report['notEvaluatedReasons'].append('partial_clip_not_full_run_evaluation')
        report['protocolDecisions'] = [dict(decision='NEEDS_HUMAN_REVIEW', reason='partial_clip_without_verified_step_assignment', approvedStepIndex=None, expected=None, observed=dict(sourceCupId=e['sourceCupId'],destinationCupId=e['destinationCupId']), observedEventId=e['eventId'], matchingApprovedStepIndices=[i+1 for i,step in enumerate(config['protocol']['steps']) if (step['sourceCupId'],step['destinationCupId']) == (e['sourceCupId'],e['destinationCupId'])], requiresHumanReview=True, automaticAlertEligible=False) for e in report['events'] if e['eventType']=='liquid_transfer']
        report['warnings'].append('Partial clip: candidate pair matches do not establish step assignment, order, missing actions, or whole-run compliance.')
    report['importOrigin'] = provenance['origin']
    report['warnings'].append('Video hashes and origin are caller attested, not independently authenticated; no footage was read.')
    output = _destination(output_dir)
    manifest = dict(schemaVersion='three-cup-result-package/v0.1', packageStatus='COMPLETE', origin=provenance['origin'], rawResponseSha256=hashlib.sha256(raw).hexdigest(), rawResponseBytes=len(raw), provenance=copy.deepcopy(provenance), evaluationStatus=report['status'], footageRead=False, networkUsed=False, files=['raw-response.json', 'evaluation-config.json', 'manifest.json', 'evaluation.json', 'evaluation.md'])
    if metadata_raw is not None:
        manifest.update(inputFormat='google_interactions_capture', captureMetadataSha256=hashlib.sha256(metadata_raw).hexdigest(), captureMetadataBytes=len(metadata_raw))
        manifest['files'].extend(['capture-metadata.json','normalized-adapter.json'])
    else:
        manifest['inputFormat'] = 'adapter_envelope'
    # Serialize everything before creating staging files. The config is retained for replay.
    contents = {'raw-response.json': raw, 'evaluation-config.json': (json.dumps(config, indent=2, allow_nan=False)+'\n').encode(), 'manifest.json': (json.dumps(manifest, indent=2, allow_nan=False)+'\n').encode(), 'evaluation.json': (json.dumps(report, indent=2, allow_nan=False)+'\n').encode(), 'evaluation.md': markdown_report(report).encode()}
    if metadata_raw is not None:
        contents['capture-metadata.json'] = metadata_raw
        contents['normalized-adapter.json'] = (json.dumps(envelope,indent=2,allow_nan=False)+'\n').encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f'.{output.name}-', dir=output.parent))
    reserved = False
    try:
        for filename, content in contents.items():
            with (staging/filename).open('xb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        # mkdir is the portable atomic no-clobber reservation. Consumers must wait
        # for manifest.json; an interrupted write can leave an incomplete directory.
        output.mkdir()
        reserved = True
        for filename in [name for name in contents if name != 'manifest.json'] + ['manifest.json']:
            os.replace(staging/filename, output/filename)
    except BaseException:
        if reserved:
            shutil.rmtree(output)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('saved_response', type=Path)
    parser.add_argument('--capture-metadata', type=Path)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--provenance', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = import_result(args.saved_response, read_json(args.config.read_bytes()), read_json(args.provenance.read_bytes()), args.output_dir, capture_metadata=args.capture_metadata)
        print(json.dumps(dict(package=str(args.output_dir), origin=manifest['origin'], evaluationStatus=manifest['evaluationStatus'])))
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.exit(2, f'Offline result import error: {error}\n')


if __name__ == '__main__':
    main()
