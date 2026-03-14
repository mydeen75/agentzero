# System Architecture Document (MVP1): 60–90 Second Demo

## Context & Instructions

This document defines the **MVP1 architecture** for a single end-to-end demo of the B2B Security Questionnaire Automation product. It is scoped for **~15 days build** and **60–90 seconds** of demo time to prove customer value. It follows the AAMAD SAD template structure and defers full production scope to [sad.md](sad.md).

**Parent documents**: [project-context/1.define/prd.md](../1.define/prd.md), [project-context/1.define/mr.md](../1.define/mr.md), [project-context/2.build/sad.md](sad.md)  
**MVP1 scope**: One demo scenario only—upload/paste a short questionnaire → draft answers with citations in 60–90s → view results → export.

---

## Demo Scenario (Single E2E)

### Chosen Scenario: “First draft in under 90 seconds”

**Value proposition demonstrated**: Manual security questionnaires take 15–40 hours; we show a first draft with **evidence-grade, cited answers** in under 90 seconds.

**Script (60–90 seconds)**:

| Step | Action | Time | What the audience sees |
|------|--------|------|------------------------|
| 1 | Present problem | 10s | “Security questionnaires add 2–3 weeks to our sales cycle. We’re going to cut that to under 90 seconds for a first draft.” |
| 2 | Upload or paste | 5–10s | User uploads a **prepared demo file** (3–5 SOC 2-style questions) or pastes 3–5 questions into the UI. |
| 3 | Process | 45–60s | Single “Process” action; progress indicator (e.g. “Parsing…” → “Finding evidence…” → “Drafting answers…”). Pipeline runs: parse → retrieve → draft → cite. |
| 4 | Show results | 15–20s | Results view: each **question + draft answer + citation** (document/section/snippet). Emphasize: “Every claim is tied to a source.” |
| 5 | Export | 5–10s | One-click export: one document (e.g. PDF or Word) with answers and an evidence snippet/citation list. “Ready to send to the buyer.” |

**Out of scope for MVP1 demo**: Full review queue, risk scoring UI, multi-format upload, auth, multi-tenant, full audit log. These remain in [sad.md](sad.md) for post-demo build.

---

## 1. MVP1 Architecture Philosophy & Principles

### MVP1 Design Principles

- **Demo-first**: Every design choice optimizes for the single 60–90s scenario above. No scope beyond what the audience sees.
- **Evidence = differentiator**: The moment that proves value is “answer + citation visible in under 90s.” RAG and citation attachment are mandatory; risk/review can be simulated or omitted.
- **Deterministic demo**: Use a **fixed demo questionnaire** (3–5 questions) and a **small, curated knowledge base** (5–10 evidence chunks) so the pipeline is fast, repeatable, and reliable.
- **15-day build**: Prefer one format (e.g. CSV or pasted text), minimal agents, minimal UI (single flow), and minimal infra (local or single deploy).

### MVP1 vs Full MVP (sad.md)

| Dimension | MVP1 (this doc) | Full MVP (sad.md) |
|-----------|------------------|---------------------|
| Scenario | One: upload → draft with citations → view → export | Full P0: ingestion, review queue, approve/edit/reject, export |
| Agents | 3–4: Ingestion, Retrieval, Drafting, Citation | 6: + Risk, Review Router |
| Input | One format: demo file (e.g. CSV) or paste 3–5 questions | Word (or one primary format) |
| Knowledge base | Small fixed set (5–10 chunks); pre-loaded | Minimal but versioned; path to full KB |
| UI | Single page: input → process → results → export | Dashboard, upload, review queue, export |
| Auth | None (demo only) | RBAC, tenant isolation |
| Time target | 60–90s end-to-end for 3–5 questions | 15 min for ~100 questions |

### Technical Architecture Decisions (MVP1)

- **Reduced agent set**: Ingestion (parse/paste) → Retrieval (RAG over demo KB) → Drafting (evidence-only) → Citation (attach claim-level refs). No Risk or Review Router in the critical path; optional “risk” as a simple badge if time permits.
- **Single intake path**: Accept either (a) upload of one demo questionnaire file (CSV or simple structured format), or (b) paste of 3–5 questions. Avoid heavy Word/PDF parsing in 15 days unless a single library gives quick wins.
- **In-memory or minimal DB**: For demo, pipeline can run in-memory or with SQLite; no multi-tenant or audit persistence required for the demo.
- **Frontend**: Single flow—no dashboard, no review queue. One screen: input → “Process” → results (Q/A/citation) → “Export.”

---

## 2. Multi-Agent System Specification (MVP1)

### Agent Count and Roles

- **Maximum 4 agents** for MVP1: Ingestion, Retrieval, Drafting, Citation.
- **Omitted for demo**: Risk agent, Review Router agent (no review queue in 60–90s).

### Agent Definitions (MVP1)

| Agent | Role | Goal | Tools (MVP1) | Memory | Delegation |
|-------|------|-----|--------------|--------|------------|
| ingestion_agent | Questionnaire intake | Parse or accept 3–5 questions into a structured list with optional domain tag | document_parser or text_parser, question_tagger | false | false |
| retrieval_agent | Evidence retrieval | Return evidence chunks for each question (document id, section, snippet) from demo KB | knowledge_base_search, evidence_retriever | false | false |
| drafting_agent | Answer author (evidence-bound) | Produce draft answers using only retrieved evidence | answer_drafter | false | false |
| citation_agent | Citation attachment | Attach claim-level citations (document, section, snippet); flag if evidence missing | citation_attacher, coverage_validator | false | false |

### Task Orchestration (MVP1)

- **Flow**: Sequential: Ingestion → Retrieval → Drafting → Citation. Context passed via Task.context; memory=false.
- **Output**: Single structured payload: list of `{ question_id, question_text, answer, citations[] }` for the frontend and export.
- **Performance**: Pipeline must complete in **&lt; 60 seconds** for 3–5 questions so that total demo stays in 60–90s. Use small KB, batched retrieval, single LLM pass per question (or batched) and low max_iter.
- **Error handling**: If parsing or retrieval fails for demo file, return a clear error message; no silent failure.

### CrewAI Configuration (MVP1)

- **Crew**: One sequential crew; process type sequential. Agents and tasks in YAML under config/ (align with adapter-crewai).
- **Integration**: Backend (Python) runs crew; single API endpoint (e.g. POST /api/process) accepts questionnaire input and returns the structured result. Optional: streaming progress for “Parsing…” / “Finding evidence…” / “Drafting…” for demo UX.

---

## 3. Frontend Architecture Specification (MVP1)

### Technology Stack (MVP1)

- **Framework**: Next.js 14+ App Router (or equivalent) with TypeScript; Tailwind for styling. Keep to one stack that can grow to full MVP.
- **No assistant-ui requirement for MVP1**: Single custom flow is sufficient—upload/paste area, “Process” button, results list, “Export” button.

### Application Structure (MVP1)

- **Single flow**: One page (or one main view):  
  1. **Input**: File upload for demo questionnaire **or** text area to paste 3–5 questions.  
  2. **Process**: One button to submit; show progress (e.g. steps: Parse → Retrieve → Draft → Cite).  
  3. **Results**: List/cards: question → draft answer → citation(s) (document, section, snippet).  
  4. **Export**: One button to download (e.g. PDF or Word) with answers and citations.
- **No**: Dashboard, review queue, auth, multi-page navigation for MVP1.

### User Interface Requirements (MVP1)

- **Clarity**: Labels like “Upload questionnaire” / “Paste questions,” “Process,” “Results,” “Export.”
- **Results view**: Each answer must show **citation(s)** visibly (document name, section, and snippet or link). This is the core proof of “evidence-grade.”
- **Loading**: Progress indicator during the 45–60s processing so the audience knows the system is working.
- **Export**: One file (e.g. “Security Questionnaire Response – [date].pdf”) containing questions, answers, and evidence/citations.

### Accessibility (MVP1)

- Basic: keyboard operation and clear labels; full WCAG 2.1 AA can be deferred to post-demo.

---

## 4. Backend Architecture Specification (MVP1)

### API (MVP1)

- **Single primary endpoint**: e.g. `POST /api/process`  
  - **Request**: Multipart (file upload) or JSON `{ "questions": [ { "id", "text" } ] }`.  
  - **Response**: JSON `{ "results": [ { "question_id", "question_text", "answer", "citations": [ { "document", "section", "snippet" } ] } ] }`.  
- **Optional**: `GET /api/status` or progress callback for streaming progress (Parsing / Retrieve / Draft / Cite).
- **Export**: `POST /api/export` with same results payload → returns file (PDF/Word) or inline base64 for download.
- **Validation**: Validate input size (e.g. max 5 questions for demo); sanitize inputs.

### Database (MVP1)

- **Option A**: No DB—pipeline and export are stateless; demo questionnaire and results in memory/session.  
- **Option B**: SQLite with one table (e.g. `demo_runs`: id, input_hash, results_json, created_at) for replay or debugging only.
- **Knowledge base**: Stored as files or SQLite/JSON: 5–10 pre-loaded chunks (policy + cert snippets) with document id, section, text. Embeddings can be precomputed for speed.

### CrewAI Integration Layer (MVP1)

- **Service**: Python service loads 4 agents and tasks from YAML; exposes one “run pipeline” function called by the API. Tools: document_parser or text_parser, question_tagger, knowledge_base_search, evidence_retriever, answer_drafter, citation_attacher, coverage_validator.
- **Secrets**: LLM and embedding keys from env; no hardcoded secrets. .env.example with required vars.

### Authentication & Security (MVP1)

- **Auth**: None for demo. If deployed on a shared URL, optional single shared secret or IP allowlist to avoid abuse.
- **Security**: Input validation and size limits; no training on user content; CORS and basic headers.

---

## 5. DevOps & Deployment (MVP1)

### 15-Day Build Target

- **Run locally** for the demo is acceptable: `npm run dev` (Next.js) + Python backend (e.g. FastAPI or Flask) or Next.js API route that shells to Python. Single machine, one terminal or two (frontend + backend).
- **Optional**: Single deploy (e.g. Vercel + serverless function, or one container) for a stable demo URL. No full CI/CD required for MVP1; manual deploy is fine.

### Monitoring (MVP1)

- **Minimal**: Log pipeline start/end and duration; log errors. No alerting or dashboards required for demo.

---

## 6. Data Flow & Integration (MVP1)

### Request/Response Flow (Demo)

1. **User** uploads demo file or pastes 3–5 questions → **Frontend** sends to `POST /api/process`.
2. **Backend** runs: Ingestion (parse to list of questions) → Retrieval (for each question, get top-k chunks from demo KB) → Drafting (one draft per question from evidence) → Citation (attach document/section/snippet per claim).
3. **Backend** returns `results` JSON → **Frontend** renders Q/A/citation and enables “Export.”
4. **User** clicks Export → **Frontend** calls `POST /api/export` with results → **Backend** generates PDF/Word → **Frontend** triggers download.

### External Integration (MVP1)

- **Knowledge base**: Local or in-repo (files or SQLite). No CRM, SSO, or trust-center integrations for MVP1.

### Analytics (MVP1)

- None required. Optional: single “demo completed” event for internal use.

---

## 7. Performance & Scalability (MVP1)

### Performance Requirements

- **End-to-end**: From “Process” click to results on screen in **&lt; 60 seconds** (so total demo 60–90s with intro and export).
- **Input**: 3–5 questions only. No 200+ question run in MVP1.
- **Retrieval**: &lt; 2s for all questions combined (small KB, precomputed embeddings).
- **Drafting + citation**: Optimize with single batch or low max_tokens; target 30–45s for 3–5 answers.

### Scalability (MVP1)

- Not in scope. Single user, single run per demo. Concurrency and scaling are post-MVP1.

---

## 8. Security & Compliance (MVP1)

### Security (MVP1)

- **Secrets**: Env vars only; .env.example provided.
- **Input**: Validate and limit size; sanitize to avoid injection.
- **No training**: Do not use uploaded/pasted content for model training.

### Compliance (MVP1)

- No formal SOC 2/GDPR implementation for demo; design so that no PII is required and no customer data is stored beyond the single run if optional DB is used.

---

## 9. Testing & Quality Assurance (MVP1)

### Testing Strategy (MVP1)

- **Smoke**: Run pipeline once with fixed demo input; assert 3–5 answers and non-empty citations.
- **Demo path**: E2E (e.g. Playwright or Cypress): load page → upload/paste demo input → click Process → wait for results → assert at least one answer with citation → click Export → assert file download.
- **Performance**: One run with 3–5 questions; assert end-to-end &lt; 60s (or 90s with buffer).

### Quality Gates (MVP1)

- Demo script runs without error on the day.
- At least one citation visible per answer in the results view (or explicit “no evidence” flag per PRD).

---

## 10. MVP1 Launch & Feedback (Demo)

### Demo Success Criteria

- **Functional**: Upload/paste → Process → Results (Q + A + citations) → Export in 60–90 seconds.
- **Message**: “First draft with evidence-grade citations in under 90 seconds” is clearly demonstrated.
- **Stability**: No crashes or silent failures during the demo; one rehearsed path that always works.

### Post-Demo

- Feedback from audience (verbal or short form) to prioritize: review queue, risk scoring, more formats, auth, etc. Full MVP per [sad.md](sad.md) follows after MVP1.

---

## Implementation Guidance (15-Day Plan)

### Build Order (MVP1)

1. **Day 1–2**: Repo and env—Next.js app, Python backend (or API route + Python script), config/ for agents and tasks (YAML), .env.example.
2. **Day 3–4**: Demo knowledge base—5–10 evidence chunks (e.g. one SOC 2 policy snippet, one cert snippet); schema (document id, section, text); embeddings precomputed; retrieval tool that reads from this KB.
3. **Day 5–6**: Ingestion—accept pasted text or one CSV/file with 3–5 questions; output structured list; ingestion agent + task.
4. **Day 7–9**: Retrieval + Drafting + Citation—retrieval agent/task; drafting agent (evidence-only); citation agent/task; wire to single sequential crew; one API endpoint that returns results JSON.
5. **Day 10–11**: Frontend—single page: input (paste or file), Process button, progress, results (Q/A/citation), Export button; call /api/process and /api/export.
6. **Day 12**: Export—generate one PDF (or Word) from results (questions, answers, citations); /api/export.
7. **Day 13**: E2E test and 60–90s rehearsal—fix timing and UX (progress text, error states).
8. **Day 14–15**: Buffer and polish—rehearse full script; harden one path; document how to run demo locally (and optionally deploy).

### Critical Decisions (MVP1)

- **Demo file**: Use one fixed “demo_questionnaire.csv” (or .txt) with 3–5 questions that match the demo KB so retrieval always finds evidence. Ship it in the repo.
- **Citation format**: Each citation has at least: document name, section, snippet (or “see document X, section Y”). No code fences in machine-readable output per AAMAD; plain text or structured JSON for UI.
- **No Risk/Review Router**: Omit for MVP1; add in full MVP so pipeline and YAML stay simple for 15 days.

### MVP1 Scope Boundaries

- **In**: One intake (paste or one file format), 4 agents (Ingestion, Retrieval, Drafting, Citation), small demo KB, single-page UI, one export format, &lt; 60s pipeline for 3–5 questions.
- **Out**: Auth, review queue, risk UI, multiple formats, 200+ questions, full audit log, production CI/CD, multi-tenant.

---

## Architecture Validation Checklist (MVP1)

- [ ] Single demo scenario (upload/paste → process → results → export) implementable in 15 days.
- [ ] Pipeline (Ingestion → Retrieval → Drafting → Citation) completes in &lt; 60s for 3–5 questions.
- [ ] Results view shows answer + citation(s) per question.
- [ ] Export produces one file with answers and citations.
- [ ] Demo questionnaire and demo KB are fixed and versioned for repeatability.
- [ ] No scope creep into Risk, Review Router, or full MVP features for the demo.

---

## Sources

- **PRD**: [project-context/1.define/prd.md](../1.define/prd.md) — Product Requirements Document: B2B Security Questionnaire Automation.
- **MR**: [project-context/1.define/mr.md](../1.define/mr.md) — AAMAD Deep Research: B2B Security Questionnaire Automation.
- **Full SAD**: [project-context/2.build/sad.md](sad.md) — System Architecture Document (full MVP).
- **SAD Template**: [.cursor/templates/sad-template.md](../../.cursor/templates/sad-template.md).
- **AAMAD rules**: .cursor/rules/aamad-core.mdc, adapter-crewai.mdc, adapter-registry.mdc.

---

## Assumptions

- Demo is run in a controlled environment (live or recorded) with one rehearsed path; no requirement to support arbitrary questionnaires or adversarial inputs.
- “60–90 seconds” includes presenter intro (10s), upload/paste (5–10s), processing (45–60s), results review (15–20s), and export (5–10s); pipeline target is &lt; 60s.
- A single demo questionnaire file (3–5 questions) and a small fixed KB are sufficient to prove value; full multi-format and large KB come in full MVP.
- Backend can be Python (FastAPI/Flask) or called from Next.js API route; no requirement for a separate microservice for MVP1.

---

## Open Questions

- Exact demo question set and demo KB chunks to be finalized in first 2–3 days (aligned with one SOC 2 domain).
- Whether to support file upload or only paste for MVP1 (paste is faster to build; file is more “product-like” for the demo).
- PDF vs Word for export—choose one for 15-day scope; the other can follow in full MVP.

---

## Audit

| Field | Value |
|-------|--------|
| Document | sad.mvp1.md |
| Location | project-context/2.build/sad.mvp1.md |
| Persona | system-arch |
| Action | create-sad-mvp1 |
| Sources | prd.md, mr.md, sad.md, sad-template.md |
| Scope | Single 60–90s demo scenario; 15-day build |
| Timestamp | 2025-03-11 |
| Note | MVP1 SAD for demo-only; full MVP remains in sad.md. |
