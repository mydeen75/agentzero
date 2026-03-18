## Security Questionnaire Review — Frontend Functional Spec (MVP1)

### Overview
The `Security Questionnaire Review` frontend implements the MVP1 single-flow UI described in `sad.mvp1.md` for the “First draft in under 90 seconds” scenario. It is a React + TypeScript single-route application that lets a user input 3–5 security questions, start a processing run, visualize results (question, draft answer, citations), and review the history of past runs within the browser session.

---

### Inputs
- **Question input**
  - Source: User.
  - Format: Up to 5 plain-text questions, entered via multiline textarea (one question per line) for the MVP1 demo.
  - Validation:
    - Required: At least 1 question.
    - Maximum: 5 questions; if exceeded, show a non-blocking inline error and prevent submission.
    - Trimming: Strip leading/trailing whitespace; ignore empty lines.
  - Normalization (UI-side, prior to API call):
    - Assign client-side IDs (e.g. `q-1`, `q-2`, …) to preserve stable mapping between questions and results.
    - Structure payload as `{ id: string; text: string }[]`.

- **Run control**
  - Primary action: `Generate Answers` button.
  - Preconditions:
    - At least one valid question.
    - No run currently `running` (FSM enforces this).
  - Side effects:
    - Transitions FSM from `idle` → `running`.
    - Calls `startRun` service with normalized question payload.

- **Demo input seeding**
  - UI provides a `Load Demo Questions` control that replaces the textarea content with a pre-seeded example of 3 security questions for the happy-path demo.

- **Optional configuration (deferred / hidden in UI for MVP1)**
  - Backing fields (invisible in UI but modeled in types to align with SAD):
    - `demoScenarioId?: string` (e.g. `"mvp1-default"`).
    - `exportFormat?: "pdf" | "docx"` (default internal value; fronted by a single `Export` button).
  - These may be surfaced in full MVP but are not exposed in the MVP1 UI.

---

### Run
- **Finite state machine (FSM)**
  - States:
    - `idle`: No active run; form is editable.
    - `running`: A run is in progress; form is read-only; progress indicator is visible.
    - `done`: Last run finished (success or failure); results and status are available; form is re-editable.
  - Events:
    - `START`: Triggered when user clicks `Start run` with valid input.
    - `RESOLVE`: Triggered when `getRunStatus` (or `startRun` in simple mode) returns a completed result.
    - `FAIL`: Triggered when services throw or return an error.
    - `RESET`: Triggered when user edits input after a completed run or clicks an explicit “New run” action (optional for MVP1).
  - Transitions:
    - `idle --(START)--> running`
    - `running --(RESOLVE)--> done`
    - `running --(FAIL)--> done`
    - `done --(RESET)--> idle`
  - Invariants:
    - Only one `running` run at a time.
    - `Start run` is disabled in `running`.
    - Results list always reflects the latest completed run.

- **Service integration**
  - `startRun(questions)`:
    - Input: `{ questions: { id: string; text: string }[] }`.
    - Output (MVP1 stub): `{ runId: string }` plus an initial snapshot of results or empty placeholder.
    - Behaviour:
      - For MVP1, may synchronously return a mock `runId` and simulated results without network I/O.
      - In full integration, posts to backend `/api/process` (or equivalent) and returns backend `runId`.
  - `getRunStatus(runId)`:
    - Input: `runId: string`.
    - Output:
      - `status: "running" | "completed" | "failed"`.
      - `results?`: List of `{ questionId, questionText, answer, citations[] }` when `completed`.
      - `error?`: Error description when `failed`.
    - Behaviour:
      - MVP1 stub: Simulate a short delay and then return `completed` with deterministic mock data based on input questions.
      - Full integration: Poll or fetch backend-run status and map to this type.

- **UI behaviour during run**
  - While in `running`:
    - Disable textarea and `Start run` button.
    - Show step-based progress text aligned with SAD:
      - “Parsing questions…”
      - “Finding evidence…”
      - “Drafting answers…”
      - “Attaching citations…”
    - On completion or failure, hide progress indicator and show results or an error banner.

---

### Results
- **Result payload (aligned with `sad.mvp1.md` §3–4)**
  - Each result item:
    - `questionId: string`
    - `questionText: string`
    - `answer: string`
    - `citations: { document: string; section: string; snippet: string }[]`
    - `status: "draft" | "approved" | "edited" | "flagged"`
    - `review_notes?: string`
    - `reviewed_by?: string`
    - `reviewed_at?: string`
  - The React app uses a shared TypeScript type for this structure to keep the UI in sync with backend contracts.

- **Results UI**
  - Layout:
    - Left or top: Original question text.
    - Below: Draft answer, rendered as readable paragraphs.
    - Below answer: Citations list, each showing:
      - Document name.
      - Section.
      - Short snippet.
    - Review metadata per answer:
      - Status selector: `draft | approved | edited | flagged`.
      - Optional `review_notes` field.
      - Optional `reviewed_by` field and auto-populated `reviewed_at` timestamp when status is set to `approved` / `edited` / `flagged`.
  - Behaviour:
    - Sorted by question input order.
    - If a question has no evidence, show an explicit “No evidence available” message to preserve UX trust.
    - Provide visual distinction between questions, answers, and citations (e.g. cards, borders, typography).

- **Export stub**
  - MVP1 for this task:
    - Provide export controls:
      - `Export JSON` — downloads the current results payload as JSON.
      - `Export PDF` — generates a simple client-side PDF containing questions, answers, review metadata, and citations.
    - Export gating:
      - Export is **disabled** while any answer is `draft`.
      - Export is **enabled** when **all answers** are `approved` or `edited`.
      - Export can optionally be enabled when some answers are `flagged` **only if** user selects “Export with flagged items”.
      - `draft` answers always block export.
    - For now, the stub may:
      - Trigger a simple client-side download of JSON (e.g. `results-[timestamp].json`).
      - Generate a client-side PDF (MVP convenience) until backend `/api/export` is wired.
    - Aligns with `sad.mvp1.md`’s requirement for a single export action, while deferring full PDF/Word implementation to the backend epic.

---

### History
- **Run history model**
  - In-memory list held in React state for the current browser session:
    - `runs: { runId: string; startedAt: string; finishedAt?: string; status: "running" | "completed" | "failed"; questionCount: number; lastError?: string }[]`.
  - On every transition to `running`, append a new run record.
  - On `RESOLVE`/`FAIL`, update the corresponding record with `finishedAt`, `status`, and `lastError` (if any).

- **History UI**
  - Simple sidebar or bottom section titled “Run history”.
  - For MVP1:
    - Show a list of past runs (most recent first) with:
      - Timestamp (e.g. `HH:MM` or ISO date).
      - Question count.
      - Status badge (`Completed`, `Failed`).
    - Clicking a history entry (optional stretch) can:
      - Replace current results view with that run’s results, or
      - Simply highlight which run is currently shown.

- **Persistence**
  - MVP1: No persistence beyond in-memory session state (matches SAD’s stateless demo guidance).
  - Future: Optionally sync with a backend `/api/runs` endpoint to support replay and multi-session history.

---

### Spec Sync Checklist

This checklist must be reviewed and updated after **each frontend commit** that touches the `Security Questionnaire Review` UI, state management, or service integration. For each item, track **status** and a short **note** on what changed to keep spec and implementation in lockstep.

- **Inputs match spec**
  - **Status**: ✅
  - **Note**: Textarea enforces 1–5 questions (with question count display), trims/ignores empty lines, and still emits `{ id: string; text: string }[]` as defined in `Inputs`.

- **FSM implementation matches spec**
  - **Status**: ✅
  - **Note**: FSM remains `idle` → `running` → `done` with `START` / `RESOLVE` / `FAIL` / `RESET` events; UI disables input while `running` and now also drives the crew status banner wording.

- **Services match contracts**
  - **Status**: ✅
  - **Note**: `startRun(questions: QuestionInput[])` returns `{ runId, results? }` aligned with the expanded `ResultItem` contract (including `status` and optional review fields); missing backend review fields default to `status: "draft"` on the frontend mapping.

- **Results rendering matches spec**
  - **Status**: ✅
  - **Note**: Results UI now matches the EvidenceFlow-style demo: “Draft Complete” header, per-answer status actions (Approve/Edited/Flag/Draft), optional notes section, and expandable “Evidence Sources” cards.

- **History behaves as described**
  - **Status**: ✅
  - **Note**: In-memory `runs` array tracks `runId`, `startedAt`, `finishedAt`, `status`, `questionCount`, and optional `lastError`; history panel surfaces status badges and timestamps for each run.

- **Export behaviour is aligned**
  - **Status**: ✅
  - **Note**: Export JSON and Export PDF are both gated: disabled while any answer is `draft`; enabled when all are `approved`/`edited`, or when “Export with flagged items” is selected and remaining answers are `flagged`.

- **Crew status banner is in sync**
  - **Status**: ✅
  - **Note**: Header shows a crew status pill and label (`Crew: idle`, `Crew: running`, `Crew: done`, `Crew: error`) plus “last updated” timestamp; wording is consistent with FSM states and button text.

- **Cross-doc alignment**
  - **Status**: ✅
  - **Note**: Types and payload shapes remain consistent with `project-context/2.build/sad.mvp1.md` Sections 2–4, especially the results JSON schema; any future API schema change must be mirrored here and in `src/types.ts`.

