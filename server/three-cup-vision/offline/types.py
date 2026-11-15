"""Draft v0.1 offline output types; no shared API or frontend type changes."""
from typing import Literal, TypedDict

CupId = Literal['RED','GREEN','BLUE']
AppearanceLabel = Literal['visually_uniform','visibly_streaked','unclear']


class MarkerObservation(TypedDict):
    markerId: int
    cupId: CupId | None
    visible: bool
    evidenceTimeMs: float
    bbox: list[float] | None
    corners: list[list[float]]
    uncertain: bool
    qualityFlags: list[str]


class AppearanceObservation(TypedDict):
    cupId: CupId
    assessmentTimeMs: float
    label: AppearanceLabel
    metricName: str
    metricValue: float | None
    calibrationVersion: str | None
    roi: list[int]
    qualityFlags: list[str]
    uncertain: bool
    evidenceFrameIds: list[str]


class RuleEvent(TypedDict):
    eventId: str
    eventType: Literal['transfer','no_transfer','unknown']
    sourceCupId: CupId | None
    destinationCupId: CupId | None
    startMs: float
    endMs: float
    uncertain: bool
    occluded: bool
    identityVerified: bool
    abstainReason: str | None
