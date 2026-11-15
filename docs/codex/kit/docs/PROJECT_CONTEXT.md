# Current project context

## Goal
Prepare → Monitor → Results → Publish performed experiment → Library → repeat with evidence.
Users are coding beginners and want concise controls, large video on the left, current issue/action on the right. Four tabs: Prepare, Monitor, Results, Library. Do not rework navigation during this task.

## Reported state, not independently audited in this kit
Latest app: demo-ui at 0dc5919 (resolve full SHA locally). Earlier checkpoints include recording publication at 064825bcd923bf993d8d0ebf285a3ff089da5036 and old integration at 8a0f22bd92271a47b93f697e61a9c4f032cc98ee. The latter is stale for new app-based work.
- React/TypeScript/Vite frontend in web, normally port 5173.
- Gemini backend in server, normally 8787. Prepare extraction and Review use an Interactions adapter. The reported configured model was gemini-4-hydrogen; inspect actual configuration, do not guess or replace it.
- Atlas library service in server/library, normally 8788; Vite proxies /library. Production static build alone does not provide the proxy.
- node scripts/start-demo.mjs starts app services. Don't start a duplicate against Cursor's ports or stop its processes. Offline Codex task needs none of these services.
- Protocol drafts/approvals use browser storage. Supported exact six-well approved steps can be frozen into monitor sessions.
- Monitor six-well color analyzer + deterministic omission rules; human reports separate. Real-cup performance not established in the supplied reports.
- Shared Atlas session browsing, immutable experiment publications, planned/executed library replications. These are distinct record types.
- Publishing performed runs occurs from Results; old protocol-only publications remain readable.
- Optional camera recording without audio, imported-file attachment, 80 MB reported limit, GridFS experimentMedia storage, shared Range playback, alert-to-video seeking.
- Recorder patches WebM duration. Reported 12.011-second generated-clock test played and sought across tabs/reload. Not a physical-cup accuracy test.
- Unreferenced media deletion guarded against referenced files. Failed publication cleans an unused upload while preserving local file.

## Three-cup capture already exists
procedureId three-cup-capture; six-well default is six-well-colored-water. Capture mode rejects six-well observations/alerts. Six-well sessions reject human_marker. Capture does not have a six-well preparedProtocol. Inspect current code for exact fields.
- Three-cup capture records camera, downloads three-cup-recording.webm and annotation JSON.
- Human buttons mark streaks in GREEN and transfers RED→BLUE, GREEN→RED, GREEN→BLUE.
- Export is schema 1, kind annotation, human provenance, cup identities, expected procedure and recording-relative marker timestamps. Exact shape must be read from source. It is NOT a Laya training set.
- No mixing or transfer detector is connected. No existing capture marker is model output.
- Never feed exported expected procedure/actual-answer annotations to an observation model as evidence.

## Ryan stream
Initial Laya service branch laya-assessment at aae1000 loaded on M4 Pro MPS, took 85–234 ms on three synthetic inputs, but returned visibly_empty for all three. Later training is underway; its current branch/checkpoint/results must come from Ryan. Original kit mentions laya-color-training at 5cf3a92861e8e9ddff0fec5ac650d86fe72139d0; treat that as an older kit claim, not the latest verified state. No need to wait for Ryan to implement the isolated Codex offline task.

## Desired experiment
Before transfer, inspect each cup for visible streaks. Demo expects red/blue uniform-looking and green visibly streaked, but actual output must be inferred from images. Expected transfers RED→BLUE, GREEN→RED; deliberate wrong take GREEN→BLUE. Cup identity comes from physical labels/tracking, not current fluid color. Distinguish appearance evaluation from transfer identification.
