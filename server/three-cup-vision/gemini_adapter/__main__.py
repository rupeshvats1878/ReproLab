"""Analyze one local clip after the operator explicitly authorizes a remote call."""

import argparse
import json
import sys

from gemini_adapter.analyze import analyze_video
from gemini_adapter.constants import DEFAULT_TIMEOUT_S, MAX_DURATION_MS, MAX_INLINE_VIDEO_BYTES


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Observe visible liquid transfers in one local MP4 or MOV clip."
    )
    parser.add_argument("--video", required=True, help="Path to a local MP4 or MOV file.")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument(
        "--authorize",
        action="store_true",
        help="Allow this process to send the clip. Also requires THREE_CUP_GEMINI_VIDEO_ENABLED=1.",
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=None,
        help="Optional static sampling rate. Omit to use the API default of 1 FPS.",
    )
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    parser.add_argument("--max-bytes", type=int, default=MAX_INLINE_VIDEO_BYTES)
    parser.add_argument("--max-duration-ms", type=int, default=MAX_DURATION_MS)
    parser.add_argument(
        "--source-offset-ms",
        type=int,
        default=0,
        help="Milliseconds to add so clip-relative model times map back onto the original recording.",
    )
    args = parser.parse_args(argv)
    result = analyze_video(
        args.video,
        session_id=args.session_id,
        video_id=args.video_id,
        authorize_remote=args.authorize,
        video_fps=args.fps,
        timeout_s=args.timeout,
        max_bytes=args.max_bytes,
        max_duration_ms=args.max_duration_ms,
        source_offset_ms=args.source_offset_ms,
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if result["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
