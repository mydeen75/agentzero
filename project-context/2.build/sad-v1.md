# System Architecture Document: B2B Security Questionnaire Automation

## Context & Instructions

This document specifies the system architecture for the B2B Security Questionnaire Automation product. It is generated from the Product Requirements Document (PRD) and Market Research (MR) in project-context/1.define. It serves as the blueprint for AI development agents and engineers implementing the MVP and subsequent phases.

**Source requirements**: [project-context/1.define/prd.md](project-context/1.define/prd.md), [project-context/1.define/mr.md](project-context/1.define/mr.md)  
**MVP scope**: Core value—questionnaire ingestion, evidence-bound drafting with citations, risk scoring, review queue, and export with evidence bundle (PRD Phase 1).

---

## 1. MVP Architecture Philosophy & Principles

### MVP Design Principles

- **Evidence-first**: Every answer must be supported by retrieved evidence; claim-level citations (document, section, version/date) are mandatory. No unsupported claims; refuse or flag when evidence is missing (PRD §3, §4 P0-2).
- **Human-in-the-loop by policy**: High-risk or low-confidence answers route to human review; no agent finalizes customer-facing content without optional or mandatory human gate per org policy (PRD §6).
- **Audit-grade**: Append-only audit log for drafts, citations, routing decisions, and approvals; traceability from answer to evidence (PRD §3, §5 NFR).
- **Deploy to validate**: MVP delivers end-to-end flow for one framework (e.g., SOC 2), one intake format, one export format; review workflow and audit trail in place to prove product-market fit (PRD §8 Phase 1).

### Core vs. Future Features

- **MVP (Phase 1)**: Ingestion (1 format), Retrieval, Drafting, Citation, Risk, Review Router; minimal knowledge base; RAG with citation attachment; configurable risk thresholds and review queue; basic web UI (upload, review queue, approve/edit/reject, export); audit logging; RBAC; encryption (PRD §8).
- **Phase 2**: Multiple intake/export formats; CRM integration; knowledge base management UI; trust center/compliance platform integration; production hardening (PRD §8).
- **Phase 3**: Additional frameworks/question banks; analytics; enterprise features (SSO, custom SLAs); scale and geographic expansion (PRD §8).

### Technical Architecture Decisions

- **Multi-agent over monolith**: Separate concerns (parse, retrieve, draft, cite, score, route) map to specialized agents; governance and HITL fit audit patterns; sequential + conditional flows (e.g., high-risk → review) suit CrewAI crews (PRD §3, MR).
- **RAG + citation enforcement**: Compliance-acceptable answers require citation from approved sources only; evidence-bundle–enforced RAG reduces hallucination (research: 15–30% → ~3.2%); claim-level citations are standard for SOC 2, GDPR, HIPAA (MR §2).
- **Web app for primary interaction**: Dashboard, upload/intake, review queue (filters, side-by-side answer/evidence/citation), approve/edit/reject, export; optional mobile-friendly review (PRD §6).
- **API-first, stateless agents**: Agent execution stateless; persistent document store and audit log; scale by queue depth and questionnaire volume (PRD §3).

---

## 2. Multi-Agent System Specification

### Agent Architecture Requirements

- **Agent count**: Six specialized agents for MVP—Ingestion, Retrieval, Drafting, Citation, Risk, Review Router (PRD §3).
- **Roles, goals, backstories**: Defined per PRD §3 table; each agent is domain-specific and action-oriented; no delegation for build personas (allow_delegation=false).
- **Collaboration**: Sequential pipeline—Ingestion → Retrieval → Drafting → Citation → Risk → Review Router; optional review sub-crew or human_input task for high-risk items (PRD §3).
- **Memory**: memory=false for reproducible artifact creation; context passed via Task.context; no reliance on conversation memory for artifact creation (AAMAD/CrewAI adapter).
- **Tools**: Each agent has declared tools only; tools bound at construction from YAML; no dynamic tool sets (adapter-registry, adapter-crewai).

### Agent Definitions (from PRD §3)

| Agent | Role | Goal | Tools (representative) | Memory | Delegation |
|-------|------|-----|------------------------|--------|------------|
| ingestion_agent | Questionnaire intake and normalization specialist | Parse and tag incoming questionnaires so every question is machine-readable and mappable to the knowledge base | document_parser, format_detector, question_tagger | false | false |
| retrieval_agent | Evidence retrieval specialist | Return only approved evidence chunks with document id, section, version | knowledge_base_search, evidence_retriever, version_resolver | false | false |
| drafting_agent | Answer author (evidence-bound) | Produce draft answers using exclusively retrieved evidence; no unsupported claims | answer_drafter, template_filler | false | false |
| citation_agent | Citation and validation specialist | Attach claim-level citations; refuse or flag when evidence missing | citation_attacher, coverage_validator, guardrail_check | false | false |
| risk_agent | Risk and confidence scorer | Score each answer; output routing recommendation | risk_scorer, threshold_evaluator | false | false |
| review_router_agent | Review workflow router | Route to auto-approve or human review queue based on risk and org policy | router, audit_logger | false | false |

### Task Orchestration

- **Inputs/outputs**: Each task has defined expected_output (target path, required headings); context passed via Task.context (PRD §3, adapter-crewai).
- **Review gates**: human_input=true or dedicated review task for high-risk; routing decision and audit log recorded (PRD §3, P0-3, P0-4).
- **Error handling**: Retries with backoff for transient failures; idempotent tasks where possible; no silent data loss (PRD §5).
- **Performance**: First draft for typical questionnaire (e.g., 100 questions) within 15 minutes end-to-end; retrieval latency target < 2s per question batch (PRD §5); max_iter and max_execution_time tuned per task (adapter-crewai).

### CrewAI Framework Configuration

- **Crew composition**: Single sequential crew for MVP pipeline; process type sequential; hierarchical crew only if SAD explicitly requires (e.g., review sub-crew) (PRD §3).
- **Configuration**: Agents and tasks externalized to YAML under config/ (e.g., config/agents.yaml, config/tasks.yaml); no inline Python agent/task definitions (adapter-crewai).
- **Integration**: Backend service layer (Python) invokes CrewAI; Next.js or equivalent API routes call backend for kickoff and streaming where applicable (PRD §3, §4).

---

## 3. Frontend Architecture Specification

### Technology Stack Requirements

- **Framework**: Modern web framework (e.g., Next.js 14+ App Router or equivalent) for dashboard, upload, review queue, and export (PRD §6; template suggests Next.js for Phase 3 alignment).
- **UI**: Components for upload, review queue (filters, side-by-side answer/evidence/citation), approve/edit/reject, export; consistent styling (e.g., Tailwind); TypeScript for type safety (PRD §6).
- **State**: Client-side state for queue, filters, and form state; server state for questionnaire and evidence (PRD §6).

### Application Structure

- **Pages/views**: Dashboard (queue depth, recent questionnaires); upload/intake; review queue; export/download (PRD §6).
- **Components**: Reusable UI for table/cards, file upload, side-by-side viewer, action buttons (approve/edit/reject); loading and error states (PRD §6).

### User Interface Requirements

- **Primary interaction**: Web app for upload, review queue, and export; optional mobile-friendly review for approvals (PRD §6).
- **Review queue**: Filterable by risk/confidence; side-by-side answer + evidence + citation; approve/edit/reject with full context (PRD P0-4).
- **Accessibility**: WCAG 2.1 AA where applicable; keyboard navigation; clear labels and error messages (PRD §6).
- **Transparency**: Every answer shows evidence and citations; risk and confidence visible; "no evidence" or "refused" states explained (PRD §6).

### MVP Scope Boundaries (Frontend)

- Single-user sessions without complex user management (template MVP boundaries); RBAC and tenant isolation per PRD §5.
- Basic analytics (e.g., queue depth) without advanced business intelligence in MVP (PRD §8 Phase 1).

---

## 4. Backend Architecture Specification

### API Architecture Requirements

- **API layer**: RESTful or equivalent API for (1) questionnaire upload and ingestion trigger, (2) pipeline status and results, (3) review queue CRUD, (4) approve/edit/reject, (5) export request and download (PRD §4, §6).
- **Streaming**: Support streaming for long-running pipeline progress or real-time queue updates where beneficial (PRD §3 integration patterns).
- **Request/response**: JSON-serializable structures; validation and sanitization at API entry (PRD §5, adapter-crewai).
- **Rate limiting and security**: Rate limiting at API and agent entry-points; CORS and security headers (PRD §5, adapter-crewai).

### Database Architecture Specification

- **Data models**: Conversation/questionnaire metadata; question set and tags; draft answers and citations; risk scores and routing state; review queue items; audit log (append-only); user/org and RBAC (PRD §3).
- **Technology**: SQLite acceptable for MVP with path to PostgreSQL; schema and migrations managed (e.g., Prisma or equivalent) (template; PRD §3 "versioned repository").
- **Policies**: Data retention and cleanup; backup and recovery; no training on customer content (PRD §5).

### CrewAI Integration Layer

- **Service layer**: Python service for agent orchestration; loads agents/tasks from YAML; invokes crew.kickoff() (or equivalent) with context binding (adapter-crewai).
- **Tool integration**: Whitelisted tools only (file I/O, knowledge_base_search, evidence_retriever, etc.); config JSON-serializable; secrets from env (adapter-crewai).
- **Logging**: Pipeline latency (ingest → export); retrieval hit rate; citation coverage; risk distribution; review queue depth; agent/task logs for audit and debugging (PRD §3).

### Authentication & Security

- **Authentication**: User authentication (e.g., NextAuth.js or equivalent) for web app; API key or session for API access (PRD §5).
- **Authorization**: RBAC; tenant/org isolation; audit log for all access and actions on questionnaires and approvals (PRD §5).
- **Secrets**: No hardcoded API keys; .env.example with required variable names; manual population in local/dev/test (adapter-crewai).

---

## 5. DevOps & Deployment Architecture

### CI/CD Pipeline Requirements

- **Automation**: GitHub Actions or equivalent for build, test, and deploy (template).
- **Build**: Build process for frontend and backend; run tests (unit, integration, E2E as defined in §9).
- **Deployment**: Deployment gates and approval; rollback and blue-green where applicable (template).

### Infrastructure

- **Cloud**: AWS, Azure, or GCP; API-first; stateless agent execution; persistent document store and audit log (PRD §3).
- **Compute**: Sufficient for embedding + LLM calls (RAG + drafting + citation); scale by queue depth and questionnaire volume (PRD §3).
- **Secrets and env**: Environment variable management and secrets; no egress of customer content to public models without consent (PRD §5).

### Monitoring & Observability

- **Metrics**: Pipeline latency (ingest → first draft, draft → export); retrieval hit rate; citation coverage; risk distribution; review queue depth (PRD §3).
- **Logging**: Agent/task logs for audit and debugging; log aggregation and analysis (PRD §3, template).
- **Alerting**: Operational visibility and alerting for errors and SLO breaches (template).

---

## 6. Data Flow & Integration Architecture

### Request/Response Flow

- **Upload**: User uploads questionnaire (Word/PDF/Excel per MVP scope) → API → ingestion agent → structured question set with optional domain/framework tags (PRD P0-1).
- **Pipeline**: Questions → retrieval (versioned knowledge base) → drafting (evidence-only) → citation attachment → risk scoring → review router → auto-approve or review queue (PRD §3, P0-2, P0-3).
- **Review**: Reviewer sees queue → side-by-side answer/evidence/citation → approve/edit/reject → audit trail (PRD P0-4).
- **Export**: Completed questionnaire exported in original (or agreed) format with evidence bundle; traceability from answer to evidence (PRD P0-5).

### External Integration Requirements

- **Document store**: Versioned knowledge base for policies, certifications, prior Q&A; claim-level retrieval with document id, section, version/date (PRD §3).
- **Optional (Phase 2+)**: CRM (e.g., Salesforce) for deal context and metrics; SSO/IdP; trust center/compliance platforms (PRD §4 P1-2, P1-5).

### Analytics & Feedback

- **Event collection**: User actions (upload, review, export); pipeline metrics; citation coverage and risk distribution (PRD §7).
- **Privacy**: Data handling and anonymization per GDPR; no training on customer content without consent (PRD §5).

---

## 7. Performance & Scalability Specifications

### Performance Requirements

- **Response time**: First draft for typical questionnaire (e.g., 100 questions) within 15 minutes end-to-end; review queue load within 2s (PRD §5).
- **Throughput**: Support N concurrent questionnaires (N by tier); batch retrieval and drafting to respect LLM rate limits (PRD §5).
- **Retrieval**: Latency target < 2s per question batch; support 200+ questions per questionnaire (PRD §3, §5).

### Scalability

- **Auto-scaling**: Scale agent workers and retrieval by queue depth and tenant load (PRD §5).
- **Efficiency**: Caching and batching for retrieval; model and tier choices to balance latency and cost (PRD §5).

### Resource Optimization

- **Token usage**: Optimize LLM and embedding usage; respect context_window and max_iter (adapter-crewai).
- **Storage**: Versioned knowledge base and audit log; retention and archival policies (PRD §5).

---

## 8. Security & Compliance Architecture

### Security Framework

- **Data protection**: Encryption at rest and in transit; no use of customer questionnaire or knowledge-base content for model training without explicit consent (PRD §5).
- **Access control**: RBAC; tenant/org isolation; audit log for all access and actions (PRD §5).
- **API security**: Input validation and sanitization; rate limiting; security scanning and vulnerability management (PRD §5, adapter-crewai).

### Data Privacy & Compliance

- **Regulatory alignment**: Design for SOC 2, GDPR, HIPAA as applicable; data residency and retention policies (PRD §5).
- **Audit**: Append-only audit log; compliance reporting and user consent where required (PRD §5).

---

## 9. Testing & Quality Assurance Specifications

### Testing Strategy

- **Unit**: Coverage for business logic, validation, and tool behavior (template).
- **Integration**: API and database layers; CrewAI crew execution with mocked tools (template).
- **E2E**: Complete user workflows—upload → pipeline → review → export (template, PRD §8).
- **Quality**: Citation enforcement and guardrails; refusal when evidence missing (PRD §4, §8 risk mitigation).

### Quality Gates

- **Pre-deploy**: Code quality and automated checks; deployment validation and smoke testing (template).
- **Acceptance**: Pipeline completes within 15 min for 100 questions; citation coverage and audit trail present (PRD §5, §8).

---

## 10. MVP Launch & Feedback Strategy

### Beta Testing

- **Target**: 5–10 B2B SaaS companies (50–500 employees), regulated industries; security/compliance and sales feedback (PRD §9).
- **Metrics**: Time to first draft, review rate, export time, satisfaction (PRD §9).
- **Iteration**: Feedback on review UX and risk rules; structured interviews and usage analytics (PRD §9).

### Success Criteria (MVP)

- End-to-end flow for one framework (e.g., SOC 2), one intake format, one export format; review workflow and audit trail in place (PRD §8 Phase 1).
- No critical security or compliance incidents; measurable reduction in time per questionnaire (PRD §9).

---

## Implementation Guidance for Development Agents

### Phase 2 Build Priorities (AAMAD)

1. **Foundation**: Project structure, config/ for agents and tasks (YAML), Python CrewAI service.
2. **Tools**: document_parser, knowledge_base_search, evidence_retriever, citation_attacher, risk_scorer, router, audit_logger (and related) implemented and whitelisted.
3. **Pipeline**: Sequential crew Ingestion → Retrieval → Drafting → Citation → Risk → Review Router; context binding via Task.context; human_input or review task for high-risk.
4. **API layer**: Endpoints for upload, status, review queue, approve/edit/reject, export.
5. **Frontend**: Dashboard, upload, review queue (filters, side-by-side), export.
6. **Database**: Schema for questionnaires, drafts, citations, queue, audit log; migrations.
7. **Auth**: RBAC and tenant isolation; audit logging.
8. **Testing**: Unit and integration for pipeline and API; E2E for critical path.

### Critical Architecture Decisions to Implement

- Strict citation enforcement: drafting agent uses only retrieved evidence; citation agent attaches claim-level citations and refuses or flags when evidence missing.
- Review router is rule-driven (non-cognitive); routing and human_input gates per org policy.
- Temp-write-then-atomic-replace for file outputs; append-only audit log (AAMAD core).
- All agent/task definitions from YAML; no inline definitions (adapter-crewai).

### MVP Scope Boundaries

- One intake format (e.g., Word) and one export format; minimal knowledge base (schema + sample content) (PRD §8 Phase 1).
- Single-user sessions; basic web UI; essential security without enterprise-grade features (template).

---

## Architecture Validation Checklist

- [ ] All PRD P0 requirements mapped to architectural components (ingestion, retrieval, drafting, citation, risk, review, export).
- [ ] Six agents properly defined for security questionnaire domain with YAML and tools.
- [ ] Frontend supports upload, review queue (side-by-side answer/evidence/citation), approve/edit/reject, export.
- [ ] Database schema supports questions, drafts, citations, queue, audit log, and future scaling.
- [ ] API design supports pipeline trigger, status, review queue, and export with proper error handling.
- [ ] Security: RBAC, encryption, no training on customer content, audit log.
- [ ] CI/CD supports build, test, and deploy with rollback option.
- [ ] Monitoring covers pipeline latency, retrieval hit rate, citation coverage, queue depth.
- [ ] Architecture supports transition from MVP to Phase 2 (formats, CRM, KB UI).

---

## Sources

- **PRD**: [project-context/1.define/prd.md](project-context/1.define/prd.md) — Product Requirements Document: B2B Security Questionnaire Automation.
- **Market Research**: [project-context/1.define/mr.md](project-context/1.define/mr.md) — AAMAD Deep Research: B2B Security Questionnaire Automation.
- **SAD Template**: [.cursor/templates/sad-template.md](.cursor/templates/sad-template.md) — AAMAD MVP System Architecture Template.
- **AAMAD rules**: .cursor/rules/aamad-core.mdc, adapter-crewai.mdc, adapter-registry.mdc, epics-index.mdc.

---

## Assumptions

- No separate **SRD** (System Requirements Document) was present in the repository; system requirements are taken from the PRD and MR. If an SRD is added later, this SAD should be reconciled with it.
- Frontend technology is assumed to be a modern web stack (e.g., Next.js) for Phase 3 alignment; alternatives that satisfy PRD §6 are acceptable.
- MVP uses one questionnaire format (e.g., Word) and one export format; schema and pipeline are designed to add formats in Phase 2.
- Active adapter is **crewai** (AAMAD_ADAPTER default); architecture decisions align with CrewAI runtime semantics.

---

## Open Questions

- Exact choice of document parser library and supported format (Word) for MVP to be finalized during implementation.
- Whether review sub-crew or human_input task is preferred for high-risk items; both satisfy PRD; implementer may choose per CrewAI best practices.
- Staging vs. production environment separation and exact AWS App Runner (or equivalent) sizing to be defined in DevOps module.

---

## Audit

| Field | Value |
|-------|--------|
| Document | sad.md |
| Location | project-context/2.build/sad.md |
| Persona | system-arch |
| Action | create-sad |
| Sources | prd.md, mr.md, sad-template.md |
| Adapter | crewai (default) |
| Timestamp | 2025-03-11 |
| Note | Generated from PRD and MR; no SRD found; saved under 2.build per request. |
