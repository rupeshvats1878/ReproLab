"""Verified Gemini video settings for this adapter.

Model page checked 14 Nov 2026:
https://ai.google.dev/gemini-api/docs/models/gemini-4-hydrogen
Video request shape checked the same day:
https://ai.google.dev/gemini-api/docs/video-understanding
"""

DEFAULT_MODEL = "gemini-4-hydrogen"
INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"

# Inline requests must stay under the documented 20 MB total. Base64 expands
# the file by 4/3, so the raw clip cap leaves room for the JSON envelope.
MAX_INLINE_VIDEO_BYTES = 14 * 1024 * 1024
MAX_DURATION_MS = 60_000
DEFAULT_TIMEOUT_S = 45
MAX_STATIC_FPS = 24

ENABLE_ENV = "THREE_CUP_GEMINI_VIDEO_ENABLED"
API_KEY_ENV = "GEMINI_API_KEY"
