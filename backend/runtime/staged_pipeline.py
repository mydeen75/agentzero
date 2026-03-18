from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

from crewai import Agent, Crew, Task

from backend.runtime.crew_runner import load_agents_config, CrewConfigError
from backend.runtime.rag_singleton import ensure_rag_built, get_rag


ProgressCb = Callable[[str], None]


def _agent_from_cfg(agent_key: str) -> Agent:
    cfg = load_agents_config()
    spec = cfg.get(agent_key)
    if not isinstance(spec, dict):
        raise CrewConfigError(f"Missing agent spec for '{agent_key}'")

    return Agent(
        role=spec.get("role", ""),
        goal=spec.get("goal", ""),
        backstory=spec.get("backstory", ""),
        llm=spec.get("llm"),
        verbose=bool(spec.get("verbose", False)),
        allow_delegation=bool(spec.get("allow_delegation", False)),
        memory=bool(spec.get("memory", False)),
        max_iter=int(spec.get("max_iter", 6)),
    )


def _run_single_task(agent: Agent, description: str, expected_output: str, inputs: Dict[str, Any]) -> Any:
    task = Task(description=description, agent=agent, expected_output=expected_output)
    crew = Crew(agents=[agent], tasks=[task], process="sequential", memory=False, verbose=False)
    return crew.kickoff(inputs=inputs)


def run_mvp1_staged(
    questions: List[Dict[str, str]],
    progress: ProgressCb | None = None,
) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """
    Run MVP1 as four explicit stages so we can time/log each one.

    This avoids relying on internal CrewAI callbacks and gives clear
    boundaries for server-side timeouts and progress reporting.
    """

    timings: Dict[str, int] = {}

    def note(stage: str) -> None:
        if progress:
            progress(stage)

    # Stage 1: ingestion (normalize questions)
    note("ingestion")
    t0 = time.perf_counter()
    ingestion_agent = _agent_from_cfg("ingestion_agent")
    ingestion_desc = (
        "Normalize the input questions into a JSON array of objects: "
        '[{ "id": "...", "text": "...", "domain": "optional" }]. '
        "Do not include any extra text."
    )
    ingestion_out = _run_single_task(
        ingestion_agent,
        description=ingestion_desc,
        expected_output="A valid JSON array of question objects.",
        inputs={"questions": questions},
    )
    timings["ingestion"] = int((time.perf_counter() - t0) * 1000)

    normalized_questions: List[Dict[str, Any]]
    try:
        raw = getattr(ingestion_out, "raw", ingestion_out)
        normalized_questions = json.loads(raw) if isinstance(raw, str) else list(raw)
    except Exception:
        # Fallback to original input if parsing fails
        normalized_questions = [{"id": q.get("id"), "text": q.get("text")} for q in questions]
    # Safety net: if ingestion produced an empty list, fall back to the original input.
    if not normalized_questions:
        normalized_questions = [{"id": q.get("id"), "text": q.get("text")} for q in questions]

    # Stage 2: retrieval (demo KB lookup)
    note("retrieval")
    t1 = time.perf_counter()
    # Deterministic retrieval: build (or reuse) an in-memory index from the Document Vault
    # and return evidence chunks per question. This avoids "guessing" evidence.
    ensure_rag_built()
    rag = get_rag()
    evidence_by_qid: Dict[str, Any] = {}
    for q in normalized_questions:
        qid = q.get("id")
        qtext = (q.get("text") or "").strip()
        if not qid:
            continue
        hits = rag.search(qtext, k=6)
        evidence_by_qid[qid] = [
            {
                "document": Path(h["path"]).name,
                "section": h["chunk_id"],
                "snippet": h["snippet"],
            }
            for h in hits
        ]
    timings["retrieval"] = int((time.perf_counter() - t1) * 1000)
    # Ensure every question id exists in the mapping, even if empty.
    for q in normalized_questions:
        qid = q.get("id")
        if qid and qid not in evidence_by_qid:
            evidence_by_qid[qid] = []

    # Stage 3: drafting (evidence-bound answers)
    note("drafting")
    t2 = time.perf_counter()
    drafting_agent = _agent_from_cfg("drafting_agent")
    drafting_desc = (
        "Draft an answer for each question using ONLY the provided evidence. "
        "Return a JSON array of {question_id, question_text, answer}. "
        "If evidence is empty, answer must say evidence is missing."
    )
    drafting_out = _run_single_task(
        drafting_agent,
        description=drafting_desc,
        expected_output="A valid JSON array of drafted answers.",
        inputs={"questions": normalized_questions, "evidence": evidence_by_qid},
    )
    timings["drafting"] = int((time.perf_counter() - t2) * 1000)

    drafts: List[Dict[str, Any]] = []
    try:
        raw = getattr(drafting_out, "raw", drafting_out)
        drafts = json.loads(raw) if isinstance(raw, str) else list(raw)
    except Exception:
        drafts = [
            {
                "question_id": q.get("id"),
                "question_text": q.get("text", ""),
                "answer": "Evidence missing for this question.",
            }
            for q in normalized_questions
        ]
    # Safety net: if drafting produced an empty list, fall back to per-question drafts.
    if not drafts:
        drafts = [
            {
                "question_id": q.get("id"),
                "question_text": q.get("text", ""),
                "answer": "Evidence missing for this question.",
            }
            for q in normalized_questions
        ]

    # Stage 4: citation (attach evidence)
    note("citation")
    t3 = time.perf_counter()
    citation_agent = _agent_from_cfg("citation_agent")
    citation_desc = (
        "Attach citations to each drafted answer. Return a JSON array of "
        "{question_id, question_text, answer, citations:[{document, section, snippet}]}. "
        "Citations must come from the provided evidence for that question."
    )
    citation_out = _run_single_task(
        citation_agent,
        description=citation_desc,
        expected_output="A valid JSON array of answers with citations.",
        inputs={"drafts": drafts, "evidence": evidence_by_qid},
    )
    timings["citation"] = int((time.perf_counter() - t3) * 1000)

    results: List[Dict[str, Any]] = []
    try:
        raw = getattr(citation_out, "raw", citation_out)
        results = json.loads(raw) if isinstance(raw, str) else list(raw)
    except Exception:
        results = [
            {
                "question_id": d.get("question_id"),
                "question_text": d.get("question_text", ""),
                "answer": d.get("answer", ""),
                "citations": [
                    {
                        "document": c.get("document", "No evidence"),
                        "section": c.get("section", ""),
                        "snippet": c.get("snippet", ""),
                    }
                    for c in (evidence_by_qid.get(d.get("question_id")) or [])[:1]
                ],
            }
            for d in drafts
        ]

    # Safety net: if the citation stage produced an empty list (common
    # when the model doesn't follow JSON instructions), fall back to the
    # drafts + evidence so the API still returns usable results.
    if not results and drafts:
        results = [
            {
                "question_id": d.get("question_id"),
                "question_text": d.get("question_text", ""),
                "answer": d.get("answer", ""),
                "citations": [
                    {
                        "document": c.get("document", "No evidence"),
                        "section": c.get("section", ""),
                        "snippet": c.get("snippet", ""),
                    }
                    for c in (evidence_by_qid.get(d.get("question_id")) or [])[:1]
                ],
            }
            for d in drafts
        ]

    # Final safety net: never return empty results when input questions exist.
    if not results and normalized_questions:
        results = [
            {
                "question_id": q.get("id"),
                "question_text": q.get("text", ""),
                "answer": "Unable to generate an answer within the demo constraints.",
                "citations": [],
            }
            for q in normalized_questions
        ]

    return {"results": results}, timings

