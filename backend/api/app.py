from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

import anyio
from dotenv import load_dotenv
import threading

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from backend.api.models import (
    RAGBuildRequest,
    RAGBuildResponse,
    RAGSearchResponse,
    RunRequest,
    RunResponse,
    StatusResponse,
)
from backend.api.run_store import RUNS
from backend.runtime.staged_pipeline import run_mvp1_staged
from backend.runtime.rag_singleton import ensure_rag_built, get_rag
from backend.runtime.vault_config import default_document_vault_dir


load_dotenv(override=True)
RUN_TIMEOUT_SECONDS = int(os.getenv("MVP1_RUN_TIMEOUT_SECONDS", "60"))


app = FastAPI(title="CrewAI Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/rag/build", response_model=RAGBuildResponse)
def rag_build(req: RAGBuildRequest) -> Any:
    try:
        target = req.path or str(default_document_vault_dir())
        rag = get_rag()
        if req.path:
            stats = rag.build_from_dir(
                target,
                max_files=req.max_files,
                chunk_size=req.chunk_size,
                chunk_overlap=req.chunk_overlap,
            )
        else:
            stats = ensure_rag_built(
                force_rebuild=True,
                max_files=req.max_files,
                chunk_size=req.chunk_size,
                chunk_overlap=req.chunk_overlap,
            )
        return {
            "built_from": rag.built_from or target,
            "documents_indexed": int(stats.get("documents_indexed", 0)),
            "chunks_indexed": int(stats.get("chunks_indexed", 0)),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG build failed: {type(e).__name__}: {e}")


@app.get("/api/rag/search", response_model=RAGSearchResponse)
def rag_search(q: str = Query(..., min_length=1), k: int = Query(5, ge=1, le=50)) -> Any:
    rag = get_rag()
    results = rag.search(q, k=k)
    return {"built_from": rag.built_from, "results": results}


@app.post("/api/run", response_model=RunResponse)
async def run(req: RunRequest, async_mode: bool = Query(False, alias="async")) -> Any:
    """
    Run MVP1 pipeline. Includes server-side timeout and stage timing logs.

    Returns {runId, results}.
    """
    rec = RUNS.create()
    run_id = rec.run_id

    def progress(stage: str) -> None:
        RUNS.update(run_id, status="running", stage=stage)
        print(f"[run:{run_id}] stage={stage}")

    started = time.perf_counter()
    RUNS.update(run_id, status="running", stage="starting")

    def execute_sync() -> tuple[dict, dict]:
        return run_mvp1_staged([q.model_dump() for q in req.questions], progress=progress)

    if async_mode:
        def _bg() -> None:
            try:
                payload, timings = execute_sync()
                RUNS.update(
                    run_id,
                    status="completed",
                    stage="completed",
                    timings_ms=timings,
                    results=payload,
                )
                total_ms = int((time.perf_counter() - started) * 1000)
                print(
                    f"[run:{run_id}] completed total_ms={total_ms} timings_ms={timings}"
                )
            except Exception as e:
                msg = f"Run failed: {type(e).__name__}: {e}"
                RUNS.update(run_id, status="failed", error=msg)

        threading.Thread(target=_bg, daemon=True).start()
        return {"runId": run_id, "results": []}

    try:
        # Run in a worker thread so we can enforce timeout.
        with anyio.fail_after(RUN_TIMEOUT_SECONDS):
            payload, timings = await anyio.to_thread.run_sync(execute_sync)
        RUNS.update(run_id, status="completed", stage="completed", timings_ms=timings, results=payload)
        total_ms = int((time.perf_counter() - started) * 1000)
        print(f"[run:{run_id}] completed total_ms={total_ms} timings_ms={timings}")
        return {"runId": run_id, "results": payload.get("results", [])}
    except TimeoutError:
        msg = f"Run exceeded server timeout of {RUN_TIMEOUT_SECONDS}s."
        RUNS.update(run_id, status="timeout", error=msg)
        raise HTTPException(status_code=504, detail=msg)
    except Exception as e:
        msg = f"Run failed: {type(e).__name__}: {e}"
        RUNS.update(run_id, status="failed", error=msg)
        raise HTTPException(status_code=500, detail=msg)


@app.get("/api/status/{run_id}", response_model=StatusResponse)
def status(run_id: str) -> Any:
    rec = RUNS.get(run_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown runId.")
    return {
        "runId": rec.run_id,
        "status": rec.status,
        "stage": rec.stage,
        "error": rec.error,
        "timings_ms": rec.timings_ms or None,
        "results": (rec.results or {}).get("results") if rec.results else None,
    }

