from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    # backend/runtime/ -> backend/ -> project root
    here = Path(__file__).resolve()
    return here.parents[2]


def default_document_vault_dir() -> Path:
    """
    Resolve the document vault directory.

    Precedence:
    1) DOCUMENT_VAULT_DIR env var (absolute or relative)
    2) <project_root>/Document Vault
    """
    env = (os.getenv("DOCUMENT_VAULT_DIR") or "").strip()
    if env:
        p = Path(env).expanduser()
        if not p.is_absolute():
            p = (project_root() / p).resolve()
        return p
    return (project_root() / "Document Vault").resolve()

