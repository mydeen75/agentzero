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
  - Primary action: `Start run` button.
  - Preconditions:
    - At least one valid question.
    - No run currently `running` (FSM enforces this).
  - Side effects:
    - Transitions FSM from `idle` → `running`.
    - Calls `startRun` service with normalized question payload.

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
  - The React app uses a shared TypeScript type for this structure to keep the UI in sync with backend contracts.

- **Results UI**
  - Layout:
    - Left or top: Original question text.
    - Below: Draft answer, rendered as readable paragraphs.
    - Below answer: Citations list, each showing:
      - Document name.
      - Section.
      - Short snippet.
  - Behaviour:
    - Sorted by question input order.
    - If a question has no evidence, show an explicit “No evidence available” message to preserve UX trust.
    - Provide visual distinction between questions, answers, and citations (e.g. cards, borders, typography).

- **Export stub**
  - MVP1 for this task:
    - Provide an `Export` button that calls a stub `exportResults(results)` function.
    - For now, the stub may:
      - Log the payload to the console, or
      - Trigger a simple client-side download of JSON (e.g. `results-[timestamp].json`).
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

This checklist must be reviewed and updated after **each frontend commit** that touches the `Security Questionnaire Review` UI, state management, or service integration. Do not mark a checkbox as complete without verifying the item.

- [ ] **Inputs match spec**
  - [ ] Textarea enforces 1–5 questions and trims/ignores empty lines.
  - [ ] Client-side question IDs and payload shape still match the `Inputs` section.

- [ ] **FSM implementation matches spec**
  - [ ] States are limited to `idle`, `running`, and `done`.
  - [ ] Events and transitions are implemented as defined.
  - [ ] UI-disable logic during `running` is still correct.

- [ ] **Services match contracts**
  - [ ] `startRun` input/output types match this spec and `sad.mvp1.md`.
  - [ ] `getRunStatus` input/output types match this spec and `sad.mvp1.md`.
  - [ ] Any backend API path or schema changes are reflected here.

- [ ] **Results rendering matches spec**
  - [ ] Results UI shows question, answer, and citations per item.
  - [ ] “No evidence available” behaviour is implemented and still works.

- [ ] **History behaves as described**
  - [ ] In-memory run history is updated on every run start/finish.
  - [ ] History UI accurately reflects run count and status.

- [ ] **Export behaviour is aligned**
  - [ ] `Export` button still calls a stub or real export function that uses the latest result payload shape.
  - [ ] Any change to export format or behaviour is documented here.

- [ ] **Cross-doc alignment**
  - [ ] This spec remains consistent with `project-context/2.build/sad.mvp1.md` Sections 2–4 (especially response schema and demo flow).
  - [ ] Any deviations from the SAD are clearly called out and justified in comments or a follow-up section.

