from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize


@dataclass(frozen=True)
class RAGChunk:
    doc_id: str
    path: str
    chunk_id: str
    text: str
    meta: Dict[str, Any]


def _safe_read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _read_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    parts: List[str] = []
    for page in reader.pages:
        txt = page.extract_text() or ""
        if txt.strip():
            parts.append(txt)
    return "\n\n".join(parts)


def _read_docx(path: Path) -> str:
    from docx import Document

    doc = Document(str(path))
    parts: List[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    return "\n".join(parts)


def _chunk_text(
    text: str,
    *,
    chunk_size: int = 1200,
    chunk_overlap: int = 150,
) -> List[str]:
    t = " ".join(text.split())
    if not t:
        return []

    if chunk_overlap >= chunk_size:
        chunk_overlap = max(0, chunk_size // 4)

    chunks: List[str] = []
    start = 0
    n = len(t)
    while start < n:
        end = min(n, start + chunk_size)
        chunk = t[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        start = max(0, end - chunk_overlap)
    return chunks


def _iter_files(root: Path, exts: Sequence[str], max_files: Optional[int]) -> Iterable[Path]:
    count = 0
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue
        yield p
        count += 1
        if max_files is not None and count >= max_files:
            return


class InMemoryRAGStore:
    """
    Minimal in-memory RAG index:
    - Load docs from a local folder
    - Chunk into text spans
    - TF-IDF embed + cosine similarity search

    This is intentionally local-first (no remote embeddings) and fast to iterate on.
    """

    def __init__(self) -> None:
        self._vectorizer: Optional[TfidfVectorizer] = None
        self._matrix = None  # sparse CSR
        self._chunks: List[RAGChunk] = []
        self._built_from: Optional[str] = None

    @property
    def built_from(self) -> Optional[str]:
        return self._built_from

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)

    def clear(self) -> None:
        self._vectorizer = None
        self._matrix = None
        self._chunks = []
        self._built_from = None

    def build_from_dir(
        self,
        directory: str,
        *,
        exts: Sequence[str] = (".txt", ".md", ".pdf", ".docx"),
        max_files: Optional[int] = None,
        chunk_size: int = 1200,
        chunk_overlap: int = 150,
        min_chunk_chars: int = 80,
    ) -> Dict[str, Any]:
        root = Path(directory).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Directory does not exist or is not a folder: {root}")

        chunks: List[RAGChunk] = []
        doc_count = 0

        for fp in _iter_files(root, tuple(e.lower() for e in exts), max_files):
            doc_count += 1
            suffix = fp.suffix.lower()
            try:
                if suffix in {".txt", ".md"}:
                    text = _safe_read_text(fp)
                elif suffix == ".pdf":
                    text = _read_pdf(fp)
                elif suffix == ".docx":
                    text = _read_docx(fp)
                else:
                    continue
            except Exception:
                # Skip unreadable docs; caller can use logs for details later.
                continue

            for i, chunk in enumerate(
                _chunk_text(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
            ):
                if len(chunk) < min_chunk_chars:
                    continue
                doc_id = fp.stem
                chunk_id = f"{doc_id}:{i}"
                chunks.append(
                    RAGChunk(
                        doc_id=doc_id,
                        path=str(fp),
                        chunk_id=chunk_id,
                        text=chunk,
                        meta={"ext": suffix, "i": i},
                    )
                )

        if not chunks:
            self.clear()
            self._built_from = str(root)
            return {"documents_indexed": doc_count, "chunks_indexed": 0}

        vectorizer = TfidfVectorizer(
            lowercase=True,
            stop_words="english",
            max_features=120_000,
            ngram_range=(1, 2),
        )
        matrix = vectorizer.fit_transform([c.text for c in chunks])
        matrix = normalize(matrix, norm="l2", axis=1, copy=False)

        self._vectorizer = vectorizer
        self._matrix = matrix
        self._chunks = chunks
        self._built_from = str(root)

        return {"documents_indexed": doc_count, "chunks_indexed": len(chunks)}

    def search(self, query: str, *, k: int = 5) -> List[Dict[str, Any]]:
        if not query or not query.strip():
            return []
        if not self._vectorizer or self._matrix is None or not self._chunks:
            return []

        qv = self._vectorizer.transform([query])
        qv = normalize(qv, norm="l2", axis=1, copy=False)

        # Cosine similarity since vectors are L2-normalized.
        scores = (self._matrix @ qv.T).toarray().reshape(-1)
        if scores.size == 0:
            return []

        k = max(1, min(int(k), scores.size))
        top_idx = np.argpartition(-scores, kth=k - 1)[:k]
        top_idx = top_idx[np.argsort(-scores[top_idx])]

        out: List[Dict[str, Any]] = []
        for idx in top_idx.tolist():
            c = self._chunks[idx]
            s = float(scores[idx])
            if s <= 0.0:
                continue
            out.append(
                {
                    "doc_id": c.doc_id,
                    "path": c.path,
                    "chunk_id": c.chunk_id,
                    "score": s,
                    "snippet": c.text[:500],
                }
            )
        return out

