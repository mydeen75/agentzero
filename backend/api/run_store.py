from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class RunRecord:
    run_id: str
    status: str  # queued|running|completed|failed|timeout
    stage: Optional[str] = None
    error: Optional[str] = None
    timings_ms: Dict[str, int] = field(default_factory=dict)
    results: Optional[Dict[str, Any]] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class RunStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: Dict[str, RunRecord] = {}

    def create(self) -> RunRecord:
        run_id = str(uuid.uuid4())
        rec = RunRecord(run_id=run_id, status="queued")
        with self._lock:
            self._runs[run_id] = rec
        return rec

    def get(self, run_id: str) -> Optional[RunRecord]:
        with self._lock:
            return self._runs.get(run_id)

    def update(self, run_id: str, **patch: Any) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return
            for k, v in patch.items():
                setattr(rec, k, v)
            rec.updated_at = time.time()


RUNS = RunStore()

