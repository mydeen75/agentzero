from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class QuestionInput(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class RunRequest(BaseModel):
    questions: List[QuestionInput] = Field(..., min_length=1, max_length=5)


class Citation(BaseModel):
    document: str
    section: str
    snippet: str


class ResultItem(BaseModel):
    question_id: str
    question_text: str
    answer: str
    citations: List[Citation]


class RunResponse(BaseModel):
    runId: str
    results: List[ResultItem]


class StatusResponse(BaseModel):
    runId: str
    status: str
    stage: Optional[str] = None
    error: Optional[str] = None
    timings_ms: Optional[dict] = None
    results: Optional[List[ResultItem]] = None


class RAGBuildRequest(BaseModel):
    path: Optional[str] = Field(
        None,
        description="Local directory path to index. If omitted, uses DOCUMENT_VAULT_DIR or ./Document Vault.",
    )
    max_files: Optional[int] = Field(None, ge=1, le=50_000)
    chunk_size: int = Field(1200, ge=200, le=20_000)
    chunk_overlap: int = Field(150, ge=0, le=10_000)


class RAGBuildResponse(BaseModel):
    built_from: str
    documents_indexed: int
    chunks_indexed: int


class RAGSearchResponseItem(BaseModel):
    doc_id: str
    path: str
    chunk_id: str
    score: float
    snippet: str


class RAGSearchResponse(BaseModel):
    built_from: Optional[str] = None
    results: List[RAGSearchResponseItem]

