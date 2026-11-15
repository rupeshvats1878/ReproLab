# ReproLab parallel work — reviewed kit

## Start here
This revises the uploaded kit for Rupesh's Windows workflow. It is a handoff, not installed code or verified model performance. Repository facts come from Cursor summaries and must be checked against Git.

1. Extract this kit outside your live repository. Do not blindly overwrite existing AGENTS.md files.
2. Open a repository-enabled Codex coding session with access to your labbench repository. A chat attachment alone does not grant access to your laptop or GitHub.
3. Paste CODEX_KICKOFF_PROMPT.md and supply the extracted kit directory. The agent prepares a separate checkout before implementing Task 001.
4. Keep Cursor on the app and Ryan on training. Send each the short coordination notice in docs/THREE_CUP_ORCHESTRATION.md.

Current reported app checkpoint: origin/demo-ui, abbreviated commit 0dc5919. Resolve its FULL hash and verify ancestry before using it. Do not revert to 8a0f22b. Existing newer app work must be preserved.

Windows app checkout reported by user: C:/Users/rupes/OneDrive/Documents/GitHub/labbench.
Suggested NEW Codex worktree: C:/Users/rupes/Projects/labbench-codex-offline.
Suggested branch: codex/three-cup-offline.
Paths must be verified. In a cloud checkout, use a sibling directory under the allowed workspace instead. No Windows/Mac path is assumed accessible in the cloud.

Contents:
- AGENTS.md: scoped collaboration rules to reconcile with existing instructions.
- docs/THREE_CUP_ORCHESTRATION.md: owners, tasks, integration and handoff.
- docs/PROJECT_CONTEXT.md: current features, limits and ports.
- docs/CODEX_FIRST_TASK.md: immediate offline implementation task.
- docs/THREE_CUP_OBSERVATION_CONTRACT.md: draft proposal, NOT current HTTP API.
- docs/THREE_CUP_DATA_CAPTURE.md: recording guidance; ArUco is optional for new takes.
- resources/three_cup_starter: unverified starter scripts and printable markers.

Do not launch the old broad Cursor pilot prompt alongside this task. No new cloud-model adapter is assigned by this kit. Ryan's training remains active and untouched.
