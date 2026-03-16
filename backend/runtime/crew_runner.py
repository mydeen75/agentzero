import os
from typing import Any, Dict, List

import yaml


# project root = one level above the backend package
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(_BACKEND_DIR)
CONFIG_DIR = os.path.join(PROJECT_ROOT, "config")


class CrewConfigError(Exception):
    """Raised when CrewAI configuration is missing or invalid."""


def _load_yaml(path: str) -> Any:
    if not os.path.exists(path):
        raise CrewConfigError(f"Missing required config file: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_agents_config() -> Dict[str, Any]:
    """
    Load agents configuration from top-level config/agents.yaml.
    """
    agents_path = os.path.join(CONFIG_DIR, "agents.yaml")
    data = _load_yaml(agents_path)
    if not isinstance(data, dict):
        raise CrewConfigError("agents.yaml must contain a mapping of agents.")
    return data


def load_tasks_config() -> Dict[str, Any]:
    """
    Load tasks configuration from top-level config/tasks.yaml.
    """
    tasks_path = os.path.join(CONFIG_DIR, "tasks.yaml")
    data = _load_yaml(tasks_path)
    if not isinstance(data, dict):
        raise CrewConfigError("tasks.yaml must contain a mapping of tasks.")
    return data


def load_crew_config() -> Dict[str, Any]:
    """
    Load high-level crew configuration from top-level config/crew.yaml.
    """
    crew_path = os.path.join(CONFIG_DIR, "crew.yaml")
    data = _load_yaml(crew_path)
    if not isinstance(data, dict):
        raise CrewConfigError("crew.yaml must contain a mapping.")
    return data


def get_active_adapter() -> str:
    """
    Determine the active execution adapter.

    Defaults to 'crewai' when AAMAD_ADAPTER is unset or unknown.
    """
    adapter = os.getenv("AAMAD_ADAPTER", "crewai").strip().lower() or "crewai"
    # For now we only support crewai; other adapters can be added later.
    if adapter not in {"crewai"}:
        # Fall back to crewai but signal via return value so callers can log a warning.
        return "crewai"
    return adapter


def kickoff_mvp1_pipeline(
    questions: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    Entry point for running the MVP1 four-agent pipeline.

    This function now wires in the CrewAI library using the YAML
    configuration. It constructs the crew, injects the questionnaire
    input into the first task, executes the sequential pipeline, and
    normalizes the final output to match the /api/process schema
    described in sad.mvp1.md.
    """
    from .crew_loader import build_crew  # local import to avoid cycles

    adapter = get_active_adapter()
    if adapter != "crewai":
        raise CrewConfigError(f"Unsupported adapter for MVP1 pipeline: {adapter}")

    crew = build_crew()

    # For MVP1, we pass the questions as the main input payload. The
    # first task (question_intake) is responsible for normalizing them
    # into the internal structure.
    try:
        # The exact API may differ depending on CrewAI version; this
        # call assumes a simple kickoff(entry_input) pattern.
        crew_output: Any = crew.kickoff(inputs={"questions": questions})  # type: ignore[attr-defined]
    except AttributeError as exc:  # pragma: no cover - runtime guard
        raise CrewConfigError(
            "Crew object does not support 'kickoff' with 'inputs' argument. "
            "Verify CrewAI version and wiring."
        ) from exc

    # Normalize output into the response schema expected by the backend
    # and frontend: { results: [ { question_id, question_text, answer, citations[] } ] }.
    # We allow either:
    # - a dict with 'results' already present, or
    # - a raw list/tuple of per-question entries, or
    # - a single scalar/tuple that we coerce into one entry.
    if isinstance(crew_output, dict) and "results" in crew_output:
        results = crew_output["results"]
    else:
        results = crew_output

    if results is None:
        results_list: List[Any] = []
    elif isinstance(results, (list, tuple)):
        results_list = list(results)
    else:
        results_list = [results]

    normalized: List[Dict[str, Any]] = []
    for idx, item in enumerate(results_list):
        if isinstance(item, dict):
            qid = item.get("question_id") or item.get("id") or f"q-{idx+1}"
            text = item.get("question_text") or item.get("text") or ""
            answer = item.get("answer") or ""
            citations = item.get("citations") or []
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            # Heuristic: (question_text, answer, [citations?])
            text = str(item[0])
            answer = str(item[1])
            citations = item[2] if len(item) > 2 else []
            qid = f"q-{idx+1}"
        else:
            # Fallback: treat the item as an opaque answer string.
            qid = f"q-{idx+1}"
            text = ""
            answer = str(item)
            citations = []

        normalized.append(
            {
                "question_id": qid,
                "question_text": text,
                "answer": answer,
                "citations": citations,
            }
        )

    return {"results": normalized}


