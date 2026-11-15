"""Private live clip -> neutral adapter. stdout is a validated envelope, never keys."""
import json
import sys
from gemini_adapter.analyze import analyze_video
from gemini_adapter.client import default_transport


def bounded_transport(request):
    # Retain the adapter's neutral prompt, store:false and static video sampling.
    body = request['body']
    body['generation_config'] = {'max_output_tokens': 4096, 'thinking_level': 'low'}
    for part in body['input']:
        if part.get('type') == 'video':
            part['resolution'] = 'medium'
    return default_transport(request)


if __name__ == '__main__':
    path, session, window, offset, captures = sys.argv[1:]
    result = analyze_video(path, session_id=session, video_id=window,
        authorize_remote=True, source_offset_ms=int(offset), video_fps=2,
        model_id='gemini-4-hydrogen', max_duration_ms=20_500,
        max_bytes=8*1024*1024, timeout_s=30, capture_dir=captures,
        transport=bounded_transport)
    print(json.dumps(result, allow_nan=False))
