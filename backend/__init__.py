"""
Backend package for the CrewAI MVP1 pipeline.

This package is responsible for:
- Loading CrewAI agent and task configurations from YAML under the top-level config/ directory.
- Exposing a Python API for running the MVP1 4-agent pipeline (ingestion, retrieval, drafting, citation).
- Integrating with the active AAMAD adapter (default: crewai) via environment variable AAMAD_ADAPTER.
"""

