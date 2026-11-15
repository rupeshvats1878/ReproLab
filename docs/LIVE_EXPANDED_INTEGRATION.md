# Expanded live camera integration

Based on `codex/live-gemini-camera-demo` at f20533f, with selected observer modules
from Cursor 3ae0fc65a969919840dac3b32a53b69a774f5cd1 and saved-replay handling
support from monitor-polish f6da692960bc7133fbb7cd784e92138f5ceb4b8c. No branch merge.

## Start on this computer

```sh
cd /Users/ryanzheng/labbench-live-integration
npm ci --prefix web
LIVE_ENV_FILE=/Users/ryanzheng/labbench-three-cup-vision/server/.env \
LIVE_BUDGET_FILE=/Users/ryanzheng/labbench-live-demo/server/live-camera/private/budget.json \
LIVE_UI_PORT=5186 LIVE_BRIDGE_PORT=8793 \
LIBRARY_URL=http://127.0.0.1:8792 node scripts/start-live-demo.mjs
```

The existing separate Library service is optional for live monitoring; its URL
above is the existing replay service. The launcher refuses occupied ports. Do not
start a duplicate launcher while this one is running. It does not stop other demos.
Never reset the shared budget ledger. The launcher also discovers that existing
ledger in the sibling live-demo worktree when no override is supplied.

Open http://127.0.0.1:5186 → Monitor → Live AI camera. Choose the approved procedure,
leave 12-second windows selected, enable Real Gemini Analysis, and click Start.
The user must initiate camera access; microphone capture is disabled. Automatic
analysis defaults on, but provider use defaults off. Stop closes tracks and cancels
pending capture/queued uploads. An already sent provider call can still be billed.

## What is connected

Finalized camera MP4/WebM → bounded local normalization → Cursor `observe_window`
→ expanded structured observations plus legacy transfer envelope → client validation
→ conservative overlap deduplication → deterministic transfer comparisons and
separate handling risks → compact side-panel cards → confirm/reject decisions.
The provider prompt receives no approved procedure or expected mistakes.

- Default: 12 s windows, 2 s overlap, target 1280×720 at 15 recorded frames/s,
  3 statically sampled frames/s, medium provider resolution, low thinking.
- One provider call in flight; at most two completed windows queued. Overflow is
  explicitly listed by original experiment interval. This is partial monitoring.
- Same-window repeats and disjoint actions are retained. Known transfers merge
  only across overlapping windows. Unknown transfer identities are not conflated.
- Spill, utensil contact, cleaning/rinsing, mixing, appearance, obstruction and
  other visible handling use their own model cards. Derived risks are labeled
  interpretations; a utensil class is not proof of unique tool identity.
- Unclear physical identities cannot become confident protocol decisions.
- Model timestamps are shifted once by the adapter, never again by the client.
- Existing saved Recording 1/2 replay and team annotation separation are retained.
- No camera bounding boxes, positional cup calibration, or color overlays.

The bridge persists private provider responses and provenance, including usage.
It enforces the existing 100-call cumulative ceiling under a file lock, reserves
before network, and never retries. The Python worker requires the bridge reservation
signal; it does not allocate a replacement ledger. Raw captures, recordings, keys
and private regression results remain ignored and uncommitted.

## Verification

```sh
npm test --prefix web
npm run build --prefix web
node --test server/live-camera/bridge.test.mjs
python3 -m unittest discover -s server/live-camera -p 'test_*.py'
npm ci --prefix server/library
node --test server/library/*.test.mjs
```

Offline tests use explicit mocks; they do not establish model accuracy. Tests cover
both protocols, wrong order, extra transfers, uncertainty, old transfer schema,
expanded categories, spills/carryover/cleaning, overlapping versus repeated actions,
source offsets, serial queue bounds, stop/stale results, errors, persistent call
limits, review separation and saved recording Results/Library persistence contracts.
Real database integration tests require configured credentials and may skip.

## Honest limits

The physical webcam loop still needs a user-initiated end-to-end run. The browser
smoke check leaves the camera off. Real recording tests exercise the same backend
normalization/observer and client model/evaluator, but cannot establish live webcam
accuracy. Twelve seconds is a practical context-first default, not an optimized
benchmark result. Feedback also includes recording, queue and processing delay.

Unknown physical identity remains an important limitation, particularly with
transparent unlabeled cups whose liquid colors change. Keep labels/markings visible.
A visible color description alone is not physical identity. No whole-session
COMPLIANT verdict or automatic step completion is produced. A dropped window or
unseen cleaning cannot establish absence of an action or chemical contamination.

Live human reviews remain in the page, separate from unchanged model output; they
are not yet persisted to Results/Library. Saved recording review persistence is
unchanged. Reloading loses live review decisions. The raw provider evidence stays
private on disk. Unknown overlapping pours may remain multiple review candidates.
