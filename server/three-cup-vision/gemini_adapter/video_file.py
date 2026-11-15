"""Local MP4/MOV checks. Nothing here contacts a network."""

import os
from dataclasses import dataclass

CONTAINER_BOXES = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"udta"}
MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/mov",
}


@dataclass(frozen=True)
class VideoFile:
    mime_type: str
    duration_ms: int
    size_bytes: int
    data: bytes


def validate_video(path, *, max_bytes, max_duration_ms):
    """Return (VideoFile, None) or (None, error dict)."""
    if not os.path.exists(path):
        return None, _error("video_missing", "The video file does not exist.")
    if not os.path.isfile(path):
        return None, _error("video_invalid", "The video path is not a file.")

    suffix = os.path.splitext(path)[1].lower()
    mime_type = MIME_TYPES.get(suffix)
    if mime_type is None:
        return None, _error("video_invalid", "The video must be an MP4 or MOV file.")

    try:
        size_bytes = os.path.getsize(path)
    except OSError:
        return None, _error("video_invalid", "The video file could not be read.")
    if size_bytes > max_bytes:
        return None, _error(
            "video_too_large",
            f"The video is {size_bytes} bytes. This adapter sends inline clips only up to {max_bytes} bytes.",
        )
    if size_bytes <= 0:
        return None, _error("video_invalid", "The video file is empty.")

    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return None, _error("video_invalid", "The video file could not be read.")

    duration_ms = movie_duration_ms(data)
    if duration_ms is None:
        return None, _error(
            "video_invalid",
            "The file does not have a readable MP4 or MOV movie header.",
        )
    if duration_ms > max_duration_ms:
        return None, _error(
            "video_too_long",
            f"The video is {duration_ms} ms. The configured limit is {max_duration_ms} ms.",
        )
    return VideoFile(mime_type, duration_ms, size_bytes, data), None


def movie_duration_ms(data):
    """Read the mvhd duration. Return milliseconds, or None when the container is unusable."""
    found_ftyp = False
    duration_ms = None

    def walk(start, end):
        nonlocal found_ftyp, duration_ms
        for box_type, payload_start, payload_end in _iter_boxes(data, start, end):
            if box_type == b"ftyp":
                found_ftyp = payload_end - payload_start >= 8
            elif box_type == b"mvhd" and duration_ms is None:
                duration_ms = _mvhd_duration_ms(data[payload_start:payload_end])
            elif box_type in CONTAINER_BOXES:
                walk(payload_start, payload_end)

    if not isinstance(data, (bytes, bytearray)):
        return None
    walk(0, len(data))
    if not found_ftyp or duration_ms is None:
        return None
    return duration_ms


def _mvhd_duration_ms(payload):
    if len(payload) < 20:
        return None
    version = payload[0]
    if version == 0:
        timescale = int.from_bytes(payload[12:16], "big")
        duration = int.from_bytes(payload[16:20], "big")
    elif version == 1 and len(payload) >= 32:
        timescale = int.from_bytes(payload[20:24], "big")
        duration = int.from_bytes(payload[24:32], "big")
    else:
        return None
    if timescale <= 0:
        return None
    return (duration * 1000) // timescale


def _iter_boxes(data, start, end):
    offset = start
    while offset + 8 <= end:
        size = int.from_bytes(data[offset:offset + 4], "big")
        box_type = data[offset + 4:offset + 8]
        header = 8
        if size == 1:
            if offset + 16 > end:
                return
            size = int.from_bytes(data[offset + 8:offset + 16], "big")
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            return
        yield box_type, offset + header, offset + size
        offset += size


def _error(category, message):
    return {"category": category, "message": message}
