"""
Helpers to construct CrewAI agents, tasks, and crews from YAML config.

This module focuses purely on translating the externalized configuration
files under config/ into in-memory objects. The actual execution is
handled by the runner in crew_runner.py.
"""

from typing import Any, Dict, List

from .crew_runner import load_agents_config, load_tasks_config, load_crew_config, CrewConfigError

try:
    # crewai is an optional dependency at this stage; code is written so
    # that import errors surface clearly when wiring is attempted.
    from crewai import Agent, Task, Crew
except Exception:  # pragma: no cover - handled at runtime
    Agent = Any  # type: ignore
    Task = Any  # type: ignore
    Crew = Any  # type: ignore


def build_agents() -> Dict[str, Any]:
    """
    Build CrewAI Agent instances from agents.yaml.

    For MVP1 wiring, we deliberately ignore the configured tools list
    and construct agents without tools to avoid version-specific tool
    type requirements. Tool binding can be added later once concrete
    implementations are available.
    """
    cfg = load_agents_config()
    agents: Dict[str, Any] = {}

    for agent_name, spec in cfg.items():
        if not isinstance(spec, dict):
            raise CrewConfigError(f"Agent '{agent_name}' spec must be a mapping.")

        agent = Agent(
            role=spec.get("role", ""),
            goal=spec.get("goal", ""),
            backstory=spec.get("backstory", ""),
            llm=spec.get("llm"),
            verbose=bool(spec.get("verbose", False)),
            allow_delegation=bool(spec.get("allow_delegation", False)),
            memory=bool(spec.get("memory", False)),
            max_iter=int(spec.get("max_iter", 6)),
        )
        agents[agent_name] = agent

    return agents


def build_tasks(agents: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build CrewAI Task instances from tasks.yaml, binding them to agents.
    """
    cfg = load_tasks_config()
    tasks: Dict[str, Any] = {}

    for task_name, spec in cfg.items():
        if not isinstance(spec, dict):
            raise CrewConfigError(f"Task '{task_name}' spec must be a mapping.")

        agent_key = spec.get("agent")
        if agent_key not in agents:
            raise CrewConfigError(f"Task '{task_name}' references unknown agent '{agent_key}'.")

        description = spec.get("description", "")
        # CrewAI's Task model expects expected_output to be a string. Our
        # YAML uses a mapping with a "schema" field for readability, so
        # we extract that here.
        expected_output_cfg = spec.get("expected_output", {})
        if isinstance(expected_output_cfg, dict):
            expected_output = expected_output_cfg.get("schema", "")
        else:
            expected_output = str(expected_output_cfg or "")

        task = Task(
            description=description,
            agent=agents[agent_key],
            expected_output=expected_output,
            # Context wiring is enforced at the crew layer using the
            # crew.yaml task ordering and Task.context. For MVP1, we
            # rely on sequential execution with shared state.
        )
        tasks[task_name] = task

    return tasks


def build_crew() -> Any:
    """
    Build the MVP1 Crew from YAML configuration.
    """
    crew_cfg = load_crew_config()
    agents = build_agents()
    tasks_map = build_tasks(agents)

    task_names: List[str] = crew_cfg.get("tasks", []) or []
    if not task_names:
        raise CrewConfigError("crew.yaml must define a non-empty 'tasks' list.")

    ordered_tasks: List[Any] = []
    for name in task_names:
        if name not in tasks_map:
            raise CrewConfigError(f"crew.yaml references unknown task '{name}'.")
        ordered_tasks.append(tasks_map[name])

    process_type = crew_cfg.get("process_type", "sequential")
    if process_type != "sequential":
        raise CrewConfigError("Only 'sequential' process_type is supported for MVP1.")

    crew = Crew(
        agents=list(agents.values()),
        tasks=ordered_tasks,
        process=process_type,
        memory=bool(crew_cfg.get("memory", False)),
        verbose=bool(crew_cfg.get("verbose", False)),
    )

    return crew

