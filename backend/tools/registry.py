"""
Tool registry for CrewAI agents.

For MVP1 wiring, this module exposes a simple mapping from tool names
used in config/agents.yaml to concrete Tool instances compatible with
CrewAI's tool interface. Implementations are intentionally minimal
placeholders; they can be extended later with real logic (demo KB,
parsing, etc.).
"""

from typing import Any, Dict

from crewai.tools import Tool


class ToolNotFoundError(KeyError):
    """Raised when an agent references a tool that is not registered."""


def _stub_tool(name: str) -> Tool:
    """
    Return a no-op Tool implementation that satisfies CrewAI's expected
    BaseTool interface.

    These stubs are placeholders to keep wiring simple until real tool
    logic (demo KB, parser, etc.) is implemented.
    """

    def _fn(*args: Any, **kwargs: Any) -> Any:
        return {
            "tool": name,
            "args": args,
            "kwargs": kwargs,
            "note": "MVP1 stub tool – replace with real implementation.",
        }

    return Tool(
        name=name,
        description=f"MVP1 stub tool for {name}; replace with real implementation.",
        func=_fn,
    )


_REGISTRY: Dict[str, Tool] = {
    "document_parser": _stub_tool("document_parser"),
    "question_tagger": _stub_tool("question_tagger"),
    "knowledge_base_search": _stub_tool("knowledge_base_search"),
    "evidence_retriever": _stub_tool("evidence_retriever"),
    "answer_drafter": _stub_tool("answer_drafter"),
    "citation_attacher": _stub_tool("citation_attacher"),
    "coverage_validator": _stub_tool("coverage_validator"),
}


def get_tool(name: str) -> Tool:
    """
    Look up a tool by name.

    Raises ToolNotFoundError if the tool is not registered, so that
    configuration issues are caught at startup.
    """
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise ToolNotFoundError(f"Unknown tool referenced in config: {name}") from exc


def list_tools() -> Dict[str, Tool]:
    """
    Return the current registry mapping for inspection or debugging.
    """
    return dict(_REGISTRY)

