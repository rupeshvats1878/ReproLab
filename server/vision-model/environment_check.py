"""Check the local Laya environment without downloading weights."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from color_task import CHECKPOINT, CODE_REVISION, REVISION

ROOT = Path(__file__).resolve().parent


def snapshot_status(cache_home: Path, revision: str = REVISION) -> dict:
    snapshot = cache_home / "hub" / "models--thaitea--laya-vision" / "snapshots" / revision
    names = ("model.safetensors", "vlm_agent_config.json")
    files = {name: (snapshot / name).is_file() for name in names}
    return {
        "path": str(snapshot),
        "complete": all(files.values()),
        "files": files,
        "downloaded": False,
    }


def probe_runtime(cache_home: Path | None = None) -> dict:
    cache = cache_home or Path(os.environ.get("HF_HOME", ROOT / ".cache"))
    info = {
        "python": sys.version.split()[0],
        "checkpoint": CHECKPOINT,
        "revision": REVISION,
        "code_revision": CODE_REVISION,
        "snapshot": snapshot_status(cache, REVISION),
    }
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = bool(torch.cuda.is_available())
        mps = getattr(torch.backends, "mps", None)
        info["mps_built"] = bool(mps and mps.is_built())
        info["mps_available"] = bool(mps and mps.is_available())
        if info["mps_available"]:
            sample = torch.tensor([1.0], device="mps")
            info["mps_add"] = float((sample + 1).cpu()[0])
    except Exception as exc:
        info["torch_error"] = type(exc).__name__
    try:
        import laya

        info["laya"] = getattr(laya, "__version__", None)
        info["load_vlm"] = callable(getattr(laya, "load_vlm", None))
    except Exception as exc:
        info["laya_error"] = type(exc).__name__
    try:
        import PIL
        import transformers

        info["pillow"] = PIL.__version__
        info["transformers"] = transformers.__version__
    except Exception as exc:
        info["library_error"] = type(exc).__name__
    return info
