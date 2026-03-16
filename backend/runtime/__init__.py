"""
Runtime utilities for invoking CrewAI based on AAMAD configuration.

This module is intentionally minimal for MVP1 scaffolding. It will be
extended to:
- Select the active adapter (currently crewai) via AAMAD_ADAPTER.
- Load agents and tasks definitions from YAML.
- Construct and run the MVP1 crew for the four-agent pipeline.
"""

