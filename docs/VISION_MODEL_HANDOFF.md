# Laya visual assessment

This is a separate local experiment. It looks at one well crop and returns a visible-appearance label. The existing six-well color analyzer and the protocol rules still decide the live Monitor workflow.

Laya does not complete a step, clear an alert, or replace a camera observation or a human report. If its label disagrees with the analyzer, a person should check the frame.

## Which Laya this is

Two different projects use the name Laya.

- [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) is the text decision package published as `laya` on PyPI. Its model card points at `convaiinnovations/laya`. That package was not installed. Installing it would collide with the import name `laya`.
- [r33drichards/laya-vision](https://github.com/r33drichards/laya-vision) is an independent image fork. Its docs say it is not affiliated with Convai Innovations. This service uses that fork.

Code repository: `https://github.com/r33drichards/laya-vision` at commit `9e1e2419d855ad3e1a2af4d4bd1ef6be5418842c`. The code license is Apache 2.0.

Checkpoint: `thaitea/laya-vision`, revision `f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc`. The question-answering head on this checkpoint is trained. The published action head was not trained with `train_act=True`, so this service does not read `action.act_probability` and does not use it to authorize anything.

Weight license: CC BY-NC-SA 4.0, because the training data includes ScienceQA and CrisisMMD. That license does not allow commercial use. The HackPrinceton demo should stay noncommercial unless the team confirms otherwise.

The API used is the documented one: `laya.load_vlm("thaitea/laya-vision", revision=...)` and `agent.predict(state, questions)`. The question is a `choice` whose option names are the four labels below.

## This Mac

- Apple M4 Pro, arm64, 14 CPU cores, 24 GB memory, macOS 26.3.1
- Python 3.10.11
- PyTorch 2.14.1. `torch.cuda.is_available()` is false. CUDA is not present.
- Apple MPS is built in this PyTorch wheel. A one-element addition on `mps` returned 2.0, and the checkpoint then ran on `mps`.
- The service asks for MPS only after that addition works. Set `LAYA_DEVICE=cpu` to force CPU. CPU inference was not timed.

The model is loaded once per process. A cached load took 3896 ms. The first load, including the Hugging Face download, took 34728 ms.

## Setup

From the repository root:

```bash
cd server/vision-model
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

`.venv/` and `.cache/` stay untracked. Do not commit weights or tokens.

## Start

```bash
cd server/vision-model
HF_HOME="$PWD/.cache" HF_HUB_DISABLE_TELEMETRY=1 .venv/bin/python server.py
```

The process listens on `http://127.0.0.1:8790`. It refuses any other bind. It is not deployed publicly. TLS checks stay at their defaults.

`GET /health` while the weights are still loading:

```json
{"status": "loading", "checkpoint": "thaitea/laya-vision", "revision": "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc", "device": "mps", "loadMs": null, "error": null}
```

After the load on this Mac:

```json
{"status": "ready", "checkpoint": "thaitea/laya-vision", "revision": "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc", "device": "mps", "loadMs": 3895.8, "error": null}
```

`status` is `loading`, `ready`, or `unavailable`. A failed load stays `unavailable` and names the exception class. It never invents a label.

## Assess

`POST /assess` with `content-type: application/json`. The image is the well crop, including a little surrounding context. This service does not crop a full plate itself.

```json
{
  "sessionId": "session_22222222-2222-4222-8222-222222222222",
  "frameId": "frame_empty",
  "sourceVideoTimeMs": 1500,
  "wellId": "A1",
  "expectedAction": "The well should be empty before colored water is added.",
  "imageKind": "synthetic",
  "imageJpegBase64": "<base64 JPEG>"
}
```

`imageKind` is `synthetic` or `real`. `wellId` is `A1`, `A2`, `A3`, `B1`, `B2`, or `B3`. `sourceVideoTimeMs` is an integer from 0 through 86400000. Identifiers are 1 to 80 characters from `A-Z`, `a-z`, `0-9`, `_`, and `-`. Extra fields are rejected.

Limits:

- JSON body at most 400000 bytes.
- JPEG at most 256 KiB after base64 decoding. The bytes must start with `FF D8 FF` and end with `FF D9`.
- Decoded image at most 2,000,000 pixels.
- One inference at a time. A second request receives `503` `overloaded`. There is no waiting queue.
- An inference that exceeds 45 seconds receives `504` `inference_timeout`. The forward pass may still be running, and further requests stay `overloaded` until it finishes. The service does not start a second copy.
- `503` `model_unavailable` before the model is ready, and `503` `inference_failed` when the model throws. Neither response contains a label.

A real response from the empty synthetic drawing:

```json
{
  "sessionId": "session_22222222-2222-4222-8222-222222222222",
  "frameId": "frame_empty",
  "sourceVideoTimeMs": 1500,
  "wellId": "A1",
  "imageKind": "synthetic",
  "assessment": "visibly_empty",
  "model": "laya-vlm",
  "checkpoint": "thaitea/laya-vision",
  "revision": "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc",
  "device": "mps",
  "latencyMs": 234.3,
  "uncertainty": {
    "probabilities": {
      "visibly_empty": 0.6837,
      "visibly_filled": 0.05,
      "obstructed": 0.1079,
      "unclear": 0.1584
    },
    "confidence": 0.3206
  },
  "effect": "This assessment does not complete a protocol step, clear an omission alert, or replace a camera observation or a human report. If it disagrees with the existing analyzer, a person should check the frame."
}
```

`confidence` is one minus the normalized entropy of the four probabilities. 1 would mean the probability sat on one option. 0 means the four options were uniform. These are the checkpoint's scores for that picture. They are not a measured accuracy for colored-water wells.

The four labels are a question we asked the model. They are not a guaranteed pretrained class list. If the model returns some other choice, the service reports `unclear` and includes `uncertainty.unmappedChoice`.

## Tests

Contract tests do not download the model:

```bash
cd server/vision-model
python3 -m unittest test_service.py
```

Result: 6 passed, 0 failed. They cover malformed fields, a non-JPEG, an oversized JPEG, a public bind refusal, `overloaded`, `model_unavailable`, `inference_timeout`, `inference_failed`, and an unknown model choice staying `unclear`.

Real checkpoint run, after the server is ready:

```bash
cd server/vision-model
.venv/bin/python run_samples.py
```

That command called the running service. The weights were the downloaded `thaitea/laya-vision` checkpoint, on device `mps`. No real lab photographs or webcam frames were in the repository, so all three images were drawings made in that script and labeled `synthetic`.

| Drawing | Assessment | visibly_empty | visibly_filled | obstructed | unclear | confidence | latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Empty white circle | visibly_empty | 0.6837 | 0.0500 | 0.1079 | 0.1584 | 0.3206 | 234.3 ms |
| Blue filled circle | visibly_empty | 0.7153 | 0.0605 | 0.0901 | 0.1341 | 0.3539 | 85.5 ms |
| Blue circle with a bar across it | visibly_empty | 0.3283 | 0.0547 | 0.3070 | 0.3099 | 0.0982 | 85.0 ms |

An earlier direct call on a fresh process took 1174.5 ms for the first picture and about 85 ms after that. The first call pays for device warmup.

These three drawings do not show that the checkpoint can tell a filled well from an empty one. The blue circle was still called empty. The blocked drawing was also called empty, with empty, obstructed, and unclear almost tied. Do not describe this as validated well detection or as real-camera performance.

## Compatibility note

`transformers` 5.20.2 can load this checkpoint. Its image encoder returns a list of one tensor, shaped `[64, 576]`. The published `predict` path expects one batch tensor and calls `.repeat` on it. This service stacks that list into `[1, 64, 576]` before `predict`. The features still come from the checkpoint.

`transformers` 4.57.6 could not load this checkpoint's tokenizer (`extra_special_tokens` is a list, and the fallback then asked for protobuf). That downgrade was not kept.

Transformers also warns that passing the stacked tensor as `image_hidden_states` is deprecated. Prediction still returned, and the three pictures did not all receive the same probabilities, so the image is reaching the model.

## What Rupesh should do later

Do not add this call inside the video loop yet. When the frontend connects:

- Proxy one request at a time from the Vite app to `http://127.0.0.1:8790`. The browser should not depend on a public host.
- Send the current well crop as a JPEG. Include `sessionId`, `frameId`, `sourceVideoTimeMs`, `wellId`, the expected visible condition, and `imageKind`.
- Keep decoding and the existing analyzer moving while this request is in flight.
- If the response is `overloaded` or `inference_timeout`, drop it.
- If `frameId` is no longer the frame on screen, drop the response.
- Show a disagreement as a request for a person to look. Do not overwrite the stable camera reading, clear an omission, or mark a step complete.
- Do not treat `confidence` as accuracy.

## Files

- `server/vision-model/contract.py`
- `server/vision-model/laya_backend.py`
- `server/vision-model/server.py`
- `server/vision-model/test_service.py`
- `server/vision-model/run_samples.py`
- `server/vision-model/requirements.txt`
- `server/vision-model/.gitignore`
- `docs/VISION_MODEL_HANDOFF.md`

## Still in the way of a demo

The service runs the real checkpoint on this Mac. It is not ready to be shown as a well detector. The filled and blocked drawings were both labeled empty. No real camera image has been tried. The Monitor screen is intentionally not wired to this service.
