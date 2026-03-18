import React, { useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { transition, type UiState } from "./fsm";
import type { AnswerReviewStatus, QuestionInput, ResultItem } from "./types";
import { buildRagIndex, startRun, type RAGBuildResponse } from "./services";

const MAX_QUESTIONS = 5;

const DEMO_QUESTION_POOL: string[] = [
  // Questions that should find citations from the demo docs
  "What is the company’s policy on least privilege and role-based access control?",
  "Is multi-factor authentication required for privileged access and remote access?",
  "How often are user access reviews performed for production systems?",
  "What approvals are required before granting access to production or sensitive systems?",
  "How quickly must standard user access be disabled after employee termination?",
  "How quickly must privileged access be revoked after termination?",
  "Are shared accounts allowed under the access control standard?",
  "What evidence is required before onboarding a high-risk vendor?",
  "How often are high-risk vendors reassessed?",
  "What information must be documented for a security policy exception?",
  "What triggers a formal risk assessment?",
  "When is a post-incident review required, and how soon must it be completed?",

  // Questions that should NOT find answers from the demo docs
  "What is the company’s encryption key rotation schedule for databases and backups?",
  "What is the backup retention period for production systems and how often are restore tests performed?",
  "What secure software development lifecycle controls are required for code review, SAST, and dependency scanning?"
];

function pickRandomUnique<T>(items: T[], n: number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function buildDemoQuestionsText(): string {
  return pickRandomUnique(DEMO_QUESTION_POOL, 3).join("\n\n");
}

const DEMO_PLACEHOLDER =
  "Click “Load Demo Questions” to insert a seeded 3-question demo set.";

function normalizeQuestions(raw: string): QuestionInput[] {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.slice(0, MAX_QUESTIONS).map((text, index) => ({
    id: `q-${index + 1}`,
    text
  }));
}

function clampQuestions(raw: string): string {
  const normalized = normalizeQuestions(raw);
  return normalized.map((q) => q.text).join("\n");
}

function statusPillColor(status: AnswerReviewStatus): string {
  switch (status) {
    case "approved":
      return "rgba(34, 197, 94, 0.18)";
    case "edited":
      return "rgba(56, 189, 248, 0.18)";
    case "flagged":
      return "rgba(249, 115, 22, 0.18)";
    case "draft":
    default:
      return "rgba(148, 163, 184, 0.15)";
  }
}

function statusTextColor(status: AnswerReviewStatus): string {
  switch (status) {
    case "approved":
      return "#86efac";
    case "edited":
      return "#7dd3fc";
    case "flagged":
      return "#fdba74";
    case "draft":
    default:
      return "#cbd5e1";
  }
}

function formatBuiltFrom(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "agent0");
  if (idx >= 0) {
    // Show the *last* folder name under Agent0
    // e.g. .../Agent0/project-context/2.build -> "2.build"
    return parts[parts.length - 1] ?? input;
  }
  // Fallback: last path segment
  return parts[parts.length - 1] ?? input;
}

type AgentStep = {
  key: "ingestion" | "retrieval" | "drafting" | "citation";
  label: string;
  sublabel: string;
};

const AGENT_STEPS: AgentStep[] = [
  { key: "ingestion", label: "Ingestion Agent", sublabel: "Parsing questions" },
  { key: "retrieval", label: "Retrieval Agent", sublabel: "Finding evidence in KB" },
  { key: "drafting", label: "Drafting Agent", sublabel: "Formulating answers" },
  { key: "citation", label: "Citation Agent", sublabel: "Attaching sources" }
];

export const App: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>("idle");
  const [rawInput, setRawInput] = useState("");
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activePage, setActivePage] = useState<
    "dashboard" | "knowledgeBase" | "settings"
  >("dashboard");
  const [ragBuild, setRagBuild] = useState<RAGBuildResponse | null>(null);
  const [ragBuilding, setRagBuilding] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragLastBuiltAt, setRagLastBuiltAt] = useState<string | null>(null);

  const [exportWithFlagged, setExportWithFlagged] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});
  const [showNotes, setShowNotes] = useState<Record<string, boolean>>({});

  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const intervalRef = useRef<number | null>(null);
  const stepTimeoutsRef = useRef<number[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const questionCount = useMemo(() => normalizeQuestions(rawInput).length, [rawInput]);
  const hasTooManyQuestions = useMemo(() => {
    const nonEmpty = rawInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean).length;
    return nonEmpty > MAX_QUESTIONS;
  }, [rawInput]);

  const canStart =
    uiState !== "running" && questionCount > 0 && !hasTooManyQuestions;

  const viewMode: "input" | "running" | "results" = useMemo(() => {
    if (uiState === "running") return "running";
    if (results && results.length > 0) return "results";
    return "input";
  }, [uiState, results]);

  const canExport = useMemo(() => {
    if (!results || results.length === 0) return false;
    const allNonDraft = results.every((r) => r.status !== "draft");
    if (!allNonDraft) return false;

    const allApprovedOrEdited = results.every(
      (r) => r.status === "approved" || r.status === "edited"
    );
    if (allApprovedOrEdited) return true;

    if (!exportWithFlagged) return false;

    return results.every(
      (r) =>
        r.status === "approved" ||
        r.status === "edited" ||
        r.status === "flagged"
    );
  }, [results, exportWithFlagged]);

  async function handleBuildRag() {
    setRagBuilding(true);
    setRagError(null);
    try {
      const stats = await buildRagIndex();
      setRagBuild(stats);
      setRagLastBuiltAt(new Date().toISOString());
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to build knowledge base index.";
      setRagError(message);
    } finally {
      setRagBuilding(false);
    }
  }

  const reviewProgress = useMemo(() => {
    const counts: Record<AnswerReviewStatus, number> = {
      draft: 0,
      approved: 0,
      edited: 0,
      flagged: 0
    };
    for (const r of results ?? []) {
      counts[r.status] += 1;
    }
    return counts;
  }, [results]);

  function clearTimers() {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stepTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
    stepTimeoutsRef.current = [];
  }

  function startTimers() {
    clearTimers();
    intervalRef.current = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt == null) return;
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10));
    }, 100);

    // Simulated step progression so the demo looks alive even if backend returns fast.
    const schedule = [1400, 3000, 4800] as const;
    schedule.forEach((ms, idx) => {
      const t = window.setTimeout(() => setActiveStepIndex(idx + 1), ms);
      stepTimeoutsRef.current.push(t);
    });
  }

  async function handleStartRun() {
    if (!canStart) return;
    const questions = normalizeQuestions(rawInput);
    if (questions.length === 0) return;

    setError(null);
    setExportWithFlagged(false);
    setResults(null);
    setExpandedEvidence({});
    setShowNotes({});

    setUiState((prev) => transition(prev, { type: "START" }));
    setActiveStepIndex(0);
    const started = Date.now();
    startedAtRef.current = started;
    setRunStartedAtMs(started);
    setElapsedSeconds(0);
    startTimers();

    try {
      const { results: runResults } = await startRun(questions);
      clearTimers();
      setActiveStepIndex(AGENT_STEPS.length - 1);

      // Ensure review fields exist (demo-friendly defaults).
      const normalizedResults =
        (runResults ?? []).map((r) => ({
          ...r,
          status: r.status ?? "draft"
        })) ?? null;

      setResults(normalizedResults);
      setUiState((prev) => transition(prev, { type: "RESOLVE" }));
    } catch (e) {
      clearTimers();
      setError(e instanceof Error ? e.message : "Unknown error starting run.");
      setUiState((prev) => transition(prev, { type: "FAIL" }));
    }
  }

  function handleStartOver() {
    clearTimers();
    startedAtRef.current = null;
    setUiState((prev) => transition(prev, { type: "RESET" }));
    setResults(null);
    setError(null);
    setExportWithFlagged(false);
    setActiveStepIndex(0);
    setRunStartedAtMs(null);
    setElapsedSeconds(0);
    setExpandedEvidence({});
    setShowNotes({});
  }

  function updateResult(
    questionId: string,
    patch: Partial<Pick<ResultItem, "status" | "review_notes" | "reviewed_by" | "reviewed_at">>
  ) {
    setResults((prev) => {
      if (!prev) return prev;
      return prev.map((r) => (r.questionId === questionId ? { ...r, ...patch } : r));
    });
  }

  function setStatus(questionId: string, status: AnswerReviewStatus) {
    const patch: Partial<ResultItem> = { status };
    if (status === "approved" || status === "edited" || status === "flagged") {
      patch.reviewed_at = new Date().toISOString();
    } else {
      patch.reviewed_at = undefined;
    }
    updateResult(questionId, patch);
  }

  function handleExportJson() {
    if (!canExport || !results || results.length === 0) return;
    const blob = new Blob([JSON.stringify({ results }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-questionnaire-results-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportPdf() {
    if (!canExport || !results || results.length === 0) return;

    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const left = 48;
    const right = 48;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - left - right;
    let y = 56;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Security Questionnaire Review", left, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, left, y);
    y += 22;

    const ensureSpace = (needed: number) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      if (y + needed > pageHeight - 56) {
        doc.addPage();
        y = 56;
      }
    };

    results.forEach((r, idx) => {
      ensureSpace(80);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Q${idx + 1}:`, left, y);
      const qLines = doc.splitTextToSize(r.questionText, maxWidth - 28);
      doc.text(qLines, left + 28, y);
      y += 16 + qLines.length * 12;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text("Answer:", left, y);
      const aLines = doc.splitTextToSize(r.answer, maxWidth);
      doc.text(aLines, left, y + 14);
      y += 18 + aLines.length * 12;

      doc.setFontSize(10);
      doc.text(`Status: ${r.status}`, left, y);
      y += 14;
      if (r.reviewed_by) {
        doc.text(`Reviewed by: ${r.reviewed_by}`, left, y);
        y += 14;
      }
      if (r.reviewed_at) {
        doc.text(`Reviewed at: ${new Date(r.reviewed_at).toLocaleString()}`, left, y);
        y += 14;
      }
      if (r.review_notes) {
        const noteLines = doc.splitTextToSize(`Notes: ${r.review_notes}`, maxWidth);
        doc.text(noteLines, left, y);
        y += noteLines.length * 12 + 4;
      }

      doc.setFont("helvetica", "bold");
      doc.text("Evidence sources:", left, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      if (r.citations.length === 0) {
        doc.text("No evidence available.", left, y);
        y += 14;
      } else {
        r.citations.forEach((c) => {
          const txt = `- ${c.document} · ${c.section} — ${c.snippet}`;
          const lines = doc.splitTextToSize(txt, maxWidth);
          ensureSpace(14 + lines.length * 12);
          doc.text(lines, left, y);
          y += lines.length * 12 + 2;
        });
      }

      y += 10;
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.5);
      ensureSpace(14);
      doc.line(left, y, pageWidth - right, y);
      y += 14;
    });

    doc.save(
      `security-questionnaire-results-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.pdf`
    );
  }

  const shellBg = {
    minHeight: "100vh",
    color: "#e5e7eb",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    background:
      "radial-gradient(1000px 600px at 50% 10%, rgba(99,102,241,0.25), transparent 60%), radial-gradient(900px 600px at 80% 40%, rgba(168,85,247,0.20), transparent 60%), radial-gradient(900px 700px at 20% 55%, rgba(56,189,248,0.14), transparent 60%), linear-gradient(180deg, #020617 0%, #0b1024 55%, #020617 100%)"
  } as const;

  const glass = {
    backgroundColor: "rgba(2, 6, 23, 0.6)",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)",
    backdropFilter: "blur(10px)"
  } as const;

  return (
    <div style={shellBg}>
      <nav
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
          backgroundColor: "rgba(2, 6, 23, 0.55)",
          backdropFilter: "blur(12px)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              background:
                "linear-gradient(135deg, rgba(99,102,241,1), rgba(168,85,247,1))",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 10px 20px rgba(99,102,241,0.25)"
            }}
            aria-hidden
          >
            <span style={{ fontWeight: 800 }}>✓</span>
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontWeight: 700 }}>EvidenceFlow</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              AUTOMATED SECURITY RESPONSES
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, color: "#cbd5e1", fontSize: 14 }}>
          <button
            type="button"
            onClick={() => setActivePage("dashboard")}
            style={{
              background: "transparent",
              border: "none",
              color: activePage === "dashboard" ? "#e2e8f0" : "#cbd5e1",
              opacity: 0.95,
              cursor: "pointer",
              padding: 0,
              fontSize: 14,
              fontWeight: activePage === "dashboard" ? 700 : 500
            }}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={async () => {
              setActivePage("knowledgeBase");
            }}
            style={{
              background: "transparent",
              border: "none",
              color: activePage === "knowledgeBase" ? "#e2e8f0" : "#cbd5e1",
              opacity: 0.95,
              cursor: "pointer",
              padding: 0,
              fontSize: 14,
              fontWeight: activePage === "knowledgeBase" ? 700 : 500
            }}
          >
            Knowledge Base
          </button>
          <button
            type="button"
            onClick={() => setActivePage("settings")}
            style={{
              background: "transparent",
              border: "none",
              color: activePage === "settings" ? "#e2e8f0" : "#cbd5e1",
              opacity: 0.95,
              cursor: "pointer",
              padding: 0,
              fontSize: 14,
              fontWeight: activePage === "settings" ? 700 : 500
            }}
          >
            Settings
          </button>
        </div>

        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            backgroundColor: "rgba(148,163,184,0.15)",
            border: "1px solid rgba(148,163,184,0.22)",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            color: "#e2e8f0"
          }}
          aria-label="User"
        >
          JD
        </div>
      </nav>

      {activePage === "knowledgeBase" && (
        <main style={{ padding: "54px 18px 84px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 750,
                  letterSpacing: "-0.02em"
                }}
              >
                Knowledge Base
              </div>
              <div style={{ marginTop: 8, color: "#94a3b8", fontSize: 16 }}>
                Build or refresh the demo RAG index used by the Retrieval Agent.
              </div>
            </div>

            <section
              style={{
                ...glass,
                borderRadius: 18,
                padding: 18
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      backgroundColor: ragError
                        ? "#f97373"
                        : ragBuilding
                        ? "#38bdf8"
                        : ragBuild
                        ? "#22c55e"
                        : "#9ca3af",
                      boxShadow: ragError
                        ? "0 0 12px rgba(248,113,113,0.35)"
                        : ragBuilding
                        ? "0 0 12px rgba(56,189,248,0.25)"
                        : ragBuild
                        ? "0 0 12px rgba(34,197,94,0.22)"
                        : "none"
                    }}
                    aria-hidden
                  />
                  <div style={{ fontSize: 13, color: "#cbd5e1" }}>
                    Status:{" "}
                    <span style={{ fontWeight: 800 }}>
                      {ragError
                        ? "error"
                        : ragBuilding
                        ? "building"
                        : ragBuild
                        ? "built"
                        : "not built"}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  Last built:{" "}
                  <span style={{ color: "#cbd5e1", fontWeight: 700 }}>
                    {ragLastBuiltAt
                      ? new Date(ragLastBuiltAt).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap"
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>RAG index</div>
                  <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 13 }}>
                    Endpoint: <span style={{ color: "#cbd5e1" }}>/api/rag/build</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleBuildRag}
                  disabled={ragBuilding}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.22)",
                    background: ragBuilding
                      ? "rgba(148,163,184,0.12)"
                      : "linear-gradient(135deg, rgba(34,197,94,0.95), rgba(16,185,129,0.95))",
                    color: ragBuilding ? "#cbd5e1" : "#04110a",
                    fontWeight: 800,
                    cursor: ragBuilding ? "not-allowed" : "pointer"
                  }}
                >
                  {ragBuilding ? "Building…" : "Build / Refresh index"}
                </button>
              </div>

              {ragError && (
                <div
                  role="alert"
                  style={{
                    marginTop: 14,
                    padding: "12px 12px",
                    borderRadius: 12,
                    backgroundColor: "rgba(127, 29, 29, 0.75)",
                    border: "1px solid rgba(248, 113, 113, 0.35)",
                    color: "#fee2e2",
                    fontSize: 13
                  }}
                >
                  {ragError}
                </div>
              )}

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 12
                }}
              >
                <div style={{ ...glass, borderRadius: 14, padding: 14 }}>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>Built from</div>
                  <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#e2e8f0" }}>
                    {ragBuild?.built_from ? formatBuiltFrom(ragBuild.built_from) : "—"}
                  </div>
                </div>
                <div style={{ ...glass, borderRadius: 14, padding: 14 }}>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>Documents indexed</div>
                  <div style={{ marginTop: 6, fontWeight: 800, fontSize: 20 }}>
                    {ragBuild?.documents_indexed ?? "—"}
                  </div>
                </div>
                <div style={{ ...glass, borderRadius: 14, padding: 14 }}>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>Chunks indexed</div>
                  <div style={{ marginTop: 6, fontWeight: 800, fontSize: 20 }}>
                    {ragBuild?.chunks_indexed ?? "—"}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      )}

      {activePage === "settings" && (
        <main style={{ padding: "54px 18px 84px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <div style={{ fontSize: 34, fontWeight: 750, letterSpacing: "-0.02em" }}>
              Settings
            </div>
            <div style={{ marginTop: 10, color: "#94a3b8" }}>
              MVP placeholder.
            </div>
          </div>
        </main>
      )}

      {activePage === "dashboard" && viewMode === "input" && (
        <main style={{ padding: "54px 18px 84px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 750,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.02
                }}
              >
                Answer Questionnaires
                <br />
                with Evidence.
              </div>
              <p
                style={{
                  marginTop: 14,
                  color: "#94a3b8",
                  fontSize: 18,
                  maxWidth: 720,
                  marginLeft: "auto",
                  marginRight: "auto"
                }}
              >
                Paste your vendor security questions below. Our 4-agent AI pipeline will
                retrieve policies from your Knowledge Base and draft cited responses in seconds.
              </p>
            </div>

            <section
              style={{
                ...glass,
                borderRadius: 18,
                padding: 22
              }}
              aria-label="Security Questions"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#a78bfa", fontWeight: 700 }}>▤</span>
                  <div style={{ fontWeight: 650 }}>Security Questions</div>
                </div>
                <button
                  type="button"
                  onClick={() => setRawInput(buildDemoQuestionsText())}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#cbd5e1",
                    fontSize: 14,
                    cursor: "pointer",
                    opacity: 0.85
                  }}
                >
                  Load Demo Questions
                </button>
              </div>

              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={8}
                placeholder={DEMO_PLACEHOLDER}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  maxWidth: "100%",
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.20)",
                  backgroundColor: "rgba(2, 6, 23, 0.55)",
                  color: "#e5e7eb",
                  padding: 16,
                  fontSize: 16,
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical"
                }}
              />

              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16
                }}
              >
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  Supports max {MAX_QUESTIONS} questions for this MVP demo.
                  {hasTooManyQuestions ? (
                    <span style={{ color: "#fda4af" }}>
                      {" "}
                      You entered more than {MAX_QUESTIONS}.
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={handleStartRun}
                  disabled={!canStart}
                  style={{
                    padding: "14px 22px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.18)",
                    background: canStart
                      ? "linear-gradient(135deg, rgba(99,102,241,1), rgba(168,85,247,1))"
                      : "rgba(148,163,184,0.18)",
                    color: "#0b1024",
                    fontWeight: 750,
                    fontSize: 16,
                    cursor: canStart ? "pointer" : "not-allowed",
                    minWidth: 220
                  }}
                >
                  Generate Answers →
                </button>
              </div>
            </section>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  backgroundColor: "rgba(127, 29, 29, 0.6)",
                  border: "1px solid rgba(248,113,113,0.35)",
                  color: "#fee2e2",
                  maxWidth: 980,
                  marginLeft: "auto",
                  marginRight: "auto"
                }}
              >
                {error}
              </div>
            )}
          </div>
        </main>
      )}

      {activePage === "dashboard" && viewMode === "running" && (
        <main style={{ padding: "56px 18px 84px" }}>
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              ...glass,
              borderRadius: 22,
              padding: "42px 38px"
            }}
          >
            <div style={{ display: "grid", placeItems: "center", marginBottom: 22 }}>
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 999,
                  border: "4px solid rgba(99,102,241,0.35)",
                  borderTopColor: "rgba(168,85,247,0.95)",
                  boxShadow: "0 0 40px rgba(168,85,247,0.18)",
                  animation: "spin 1.1s linear infinite"
                }}
              />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 750 }}>AI Agents Working</div>
              <div style={{ marginTop: 6, color: "#94a3b8" }}>
                Elapsed time: {elapsedSeconds.toFixed(1)}s
              </div>
            </div>

            <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 14 }}>
              {AGENT_STEPS.map((s, idx) => {
                const isDone = idx < activeStepIndex;
                const isActive = idx === activeStepIndex;
                const icon = isDone ? "✓" : isActive ? "●" : "○";
                return (
                  <div
                    key={s.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid rgba(148,163,184,0.18)",
                      backgroundColor: isActive
                        ? "rgba(99,102,241,0.14)"
                        : "rgba(2,6,23,0.3)",
                      opacity: idx > activeStepIndex ? 0.55 : 1
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        backgroundColor: isDone
                          ? "rgba(34,197,94,0.18)"
                          : isActive
                          ? "rgba(168,85,247,0.20)"
                          : "rgba(148,163,184,0.14)",
                        border: "1px solid rgba(148,163,184,0.22)",
                        color: isDone
                          ? "#86efac"
                          : isActive
                          ? "#c4b5fd"
                          : "#cbd5e1",
                        fontWeight: 800,
                        fontSize: 12
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 650 }}>
                        {s.label}:{" "}
                        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                          {s.sublabel}
                        </span>
                      </div>
                    </div>
                    <div style={{ color: "#94a3b8" }}>•••</div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 26, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
              Status: drafting
            </div>
          </div>

          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </main>
      )}

      {activePage === "dashboard" && viewMode === "results" && (
        <main style={{ padding: "44px 18px 84px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <header
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 18,
                marginBottom: 16
              }}
            >
              <div>
                <div style={{ fontSize: 34, fontWeight: 780, letterSpacing: "-0.02em" }}>
                  Draft Complete
                </div>
                <div style={{ marginTop: 6, color: "#94a3b8" }}>
                  Processed {results?.length ?? 0} question
                  {(results?.length ?? 0) === 1 ? "" : "s"} in{" "}
                  {elapsedSeconds.toFixed(1)}s.
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handleStartOver}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.22)",
                    backgroundColor: "rgba(2,6,23,0.35)",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontWeight: 650
                  }}
                >
                  ↺ Start Over
                </button>

                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={!canExport}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.18)",
                    background: canExport
                      ? "linear-gradient(135deg, rgba(99,102,241,1), rgba(168,85,247,1))"
                      : "rgba(148,163,184,0.18)",
                    color: "#0b1024",
                    cursor: canExport ? "pointer" : "not-allowed",
                    fontWeight: 750,
                    opacity: canExport ? 1 : 0.7
                  }}
                >
                  ⬇ Export PDF
                </button>
              </div>
            </header>

            <div
              style={{
                ...glass,
                borderRadius: 16,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                marginBottom: 18
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#cbd5e1" }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>Review Progress:</span>
                <span style={{ fontSize: 13 }}>
                  {reviewProgress.draft} draft
                  {reviewProgress.draft === 1 ? "" : "s"}
                </span>
                {reviewProgress.flagged > 0 && (
                  <span style={{ fontSize: 13, color: "#fdba74" }}>
                    • {reviewProgress.flagged} flagged
                  </span>
                )}
                {reviewProgress.approved > 0 && (
                  <span style={{ fontSize: 13, color: "#86efac" }}>
                    • {reviewProgress.approved} approved
                  </span>
                )}
                {reviewProgress.edited > 0 && (
                  <span style={{ fontSize: 13, color: "#7dd3fc" }}>
                    • {reviewProgress.edited} edited
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "#94a3b8",
                    userSelect: "none"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={exportWithFlagged}
                    onChange={(e) => setExportWithFlagged(e.target.checked)}
                    style={{ accentColor: "#a78bfa" }}
                  />
                  Export with flagged items
                </label>

                <button
                  type="button"
                  onClick={handleExportJson}
                  disabled={!canExport}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.22)",
                    backgroundColor: canExport
                      ? "rgba(2, 6, 23, 0.5)"
                      : "rgba(148,163,184,0.12)",
                    color: "#e5e7eb",
                    cursor: canExport ? "pointer" : "not-allowed",
                    fontWeight: 650,
                    fontSize: 13
                  }}
                >
                  Export JSON
                </button>
              </div>
            </div>

            {!canExport && (
              <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
                Review all answers to enable export.
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  marginBottom: 16,
                  padding: "12px 14px",
                  borderRadius: 12,
                  backgroundColor: "rgba(127, 29, 29, 0.6)",
                  border: "1px solid rgba(248,113,113,0.35)",
                  color: "#fee2e2"
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(results ?? []).map((item, idx) => {
                const isExpanded = expandedEvidence[item.questionId] ?? true;
                const showItemNotes = showNotes[item.questionId] ?? false;

                return (
                  <section
                    key={item.questionId}
                    style={{
                      ...glass,
                      borderRadius: 18,
                      padding: 18
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 14
                      }}
                    >
                      <div style={{ display: "flex", gap: 12, flex: 1 }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            display: "grid",
                            placeItems: "center",
                            backgroundColor: "rgba(99,102,241,0.18)",
                            border: "1px solid rgba(99,102,241,0.25)",
                            color: "#c4b5fd",
                            fontWeight: 800,
                            fontSize: 13,
                            marginTop: 2
                          }}
                        >
                          {idx + 1}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 18, fontWeight: 750, lineHeight: 1.25 }}>
                            {item.questionText}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          backgroundColor: statusPillColor(item.status),
                          border: "1px solid rgba(148,163,184,0.18)",
                          color: statusTextColor(item.status),
                          fontSize: 13,
                          fontWeight: 700,
                          textTransform: "capitalize",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {item.status}
                      </div>
                    </div>

                    <p style={{ marginTop: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
                      {item.answer}
                    </p>

                    <div
                      style={{
                        marginTop: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "#94a3b8", fontSize: 13 }}>Set status:</span>

                        {(
                          [
                            ["approved", "Approve"],
                            ["edited", "Edited"],
                            ["flagged", "Flag"],
                            ["draft", "Draft"]
                          ] as const
                        ).map(([status, label]) => {
                          const isSelected = item.status === status;
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() => setStatus(item.questionId, status)}
                              style={{
                                padding: "7px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(148,163,184,0.22)",
                                backgroundColor: isSelected
                                  ? "rgba(99,102,241,0.18)"
                                  : "rgba(2,6,23,0.35)",
                                color: "#e5e7eb",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 650
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setShowNotes((prev) => ({
                            ...prev,
                            [item.questionId]: !showItemNotes
                          }))
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#cbd5e1",
                          cursor: "pointer",
                          fontSize: 13,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          opacity: 0.9
                        }}
                      >
                        <span>✎</span>
                        {showItemNotes ? "Hide Notes" : "Add Notes"}{" "}
                        <span style={{ opacity: 0.7 }}>▾</span>
                      </button>
                    </div>

                    {showItemNotes && (
                      <div
                        style={{
                          marginTop: 12,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12
                        }}
                      >
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>
                            reviewed_by (optional)
                          </span>
                          <input
                            value={item.reviewed_by ?? ""}
                            onChange={(e) =>
                              updateResult(item.questionId, {
                                reviewed_by: e.target.value || undefined
                              })
                            }
                            placeholder="e.g. JD"
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(148,163,184,0.20)",
                              backgroundColor: "rgba(2,6,23,0.55)",
                              color: "#e5e7eb",
                              padding: "10px 12px",
                              fontSize: 14,
                              outline: "none"
                            }}
                          />
                        </label>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>
                            reviewed_at (auto)
                          </span>
                          <div
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(148,163,184,0.14)",
                              backgroundColor: "rgba(2,6,23,0.35)",
                              padding: "10px 12px",
                              color: item.reviewed_at ? "#e5e7eb" : "#94a3b8",
                              fontSize: 14
                            }}
                          >
                            {item.reviewed_at
                              ? new Date(item.reviewed_at).toLocaleString()
                              : "—"}
                          </div>
                        </div>

                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            gridColumn: "1 / -1"
                          }}
                        >
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>
                            review_notes (optional)
                          </span>
                          <textarea
                            value={item.review_notes ?? ""}
                            onChange={(e) =>
                              updateResult(item.questionId, {
                                review_notes: e.target.value || undefined
                              })
                            }
                            rows={2}
                            placeholder="Notes for reviewers (e.g. missing evidence for retention window)."
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(148,163,184,0.20)",
                              backgroundColor: "rgba(2,6,23,0.55)",
                              color: "#e5e7eb",
                              padding: "10px 12px",
                              fontSize: 14,
                              outline: "none",
                              resize: "vertical"
                            }}
                          />
                        </label>
                      </div>
                    )}

                    <div style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEvidence((prev) => ({
                            ...prev,
                            [item.questionId]: !isExpanded
                          }))
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 10,
                          color: "#a78bfa",
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontSize: 12
                        }}
                      >
                        ⛨ Evidence Sources <span style={{ color: "#94a3b8" }}>▾</span>
                      </button>

                      {isExpanded && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                          {(item.citations.length === 0
                            ? [
                                {
                                  document: "No evidence",
                                  section: "",
                                  snippet: "No evidence available for this answer."
                                }
                              ]
                            : item.citations
                          ).map((c, i) => (
                            <div
                              key={`${item.questionId}-e-${i}`}
                              style={{
                                borderRadius: 14,
                                border: "1px solid rgba(148,163,184,0.20)",
                                backgroundColor: "rgba(2,6,23,0.55)",
                                padding: 14
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    backgroundColor: "rgba(99,102,241,0.18)",
                                    border: "1px solid rgba(99,102,241,0.22)",
                                    color: "#c4b5fd",
                                    fontSize: 12,
                                    fontWeight: 750
                                  }}
                                >
                                  {c.document}
                                </span>
                                <span style={{ color: "#94a3b8", fontSize: 13 }}>
                                  {c.section ? `Section: ${c.section}` : ""}
                                </span>
                              </div>
                              <div style={{ marginTop: 10, color: "#cbd5e1", fontStyle: "italic", lineHeight: 1.6 }}>
                                “{c.snippet}”
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </main>
      )}
    </div>
  );
};

