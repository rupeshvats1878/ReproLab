"""Neutral single-clip observation adapter, vendored for the live camera bridge."""
from gemini_adapter.analyze import analyze_video
__all__ = ['analyze_video']

from gemini_adapter.live_observe import observe_window
from gemini_adapter.live_session import stitch_live_session
__all__ += ['observe_window', 'stitch_live_session']
