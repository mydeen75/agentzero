from __future__ import annotations

import threading
from typing import Any, Dict, Optional

from backend.runtime.rag_store import InMemoryRAGStore
from backend.runtime.vault_config import default_document_vault_dir


_LOCK = threading.Lock()
_RAG: Optional[InMemoryRAGStore] = None


def get_rag() -> InMemoryRAGStore:
    global _RAG
    with _LOCK:
        if _RAG is None:
            _RAG = InMemoryRAGStore()
        return _RAG


def ensure_rag_built(
    *,
    force_rebuild: bool = False,
    max_files: Optional[int] = None,
    chunk_size: int = 1200,
    chunk_overlap: int = 150,
) -> Dict[str, Any]:
    rag = get_rag()
    vault = default_document_vault_dir()
    if force_rebuild or rag.built_from != str(vault):
        stats = rag.build_from_dir(
            str(vault),
            max_files=max_files,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        return {"built_from": rag.built_from, **stats}
    return {"built_from": rag.built_from, "documents_indexed": 0, "chunks_indexed": rag.chunk_count}

