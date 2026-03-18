import React, { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { transition, type UiState } from "./fsm";
import {
  type AnswerReviewStatus,
  type QuestionInput,
  type ResultItem,
  type RunSummary,
  type RunStatus
} from "./types";
import { startRun } from "./services";

const MAX_QUESTIONS = 5;

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

function countQuestions(raw: string): number {
  return normalizeQuestions(raw).length;
}

export const App: React.FC = () => {
  const [uiState, setUiState] = useState<UiState>("idle");
  const [rawInput, setRawInput] = useState("");
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [exportWithFlagged, setExportWithFlagged] = useState(false);

  const questionCount = useMemo(() => countQuestions(rawInput), [rawInput]);
  const hasTooManyQuestions = questionCount > MAX_QUESTIONS;
  const canStart =
    uiState !== "running" &&
    questionCount > 0 &&
    !hasTooManyQuestions;

  async function handleStartRun() {
    if (!canStart) return;

    const questions = normalizeQuestions(rawInput);
    if (questions.length === 0) return;

    setUiState((prev) => transition(prev, { type: "START" }));
    setLastUpdated(new Date().toISOString());
    setError(null);

    const startedAt = new Date().toISOString();

    try {
      const { runId, results: runResults } = await startRun(questions);

      const summary: RunSummary = {
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "completed",
        questionCount: questions.length
      };

      setRuns((prev) => [summary, ...prev]);
      setActiveRunId(runId);
      setResults(runResults ?? null);
      setExportWithFlagged(false);
      setUiState((prev) => transition(prev, { type: "RESOLVE" }));
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unknown error starting run.";
      setError(message);

      const failedSummary: RunSummary = {
        runId: `failed-${Date.now()}`,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "failed",
        questionCount: questions.length,
        lastError: message
      };

      setRuns((prev) => [failedSummary, ...prev]);
      setUiState((prev) => transition(prev, { type: "FAIL" }));
      setLastUpdated(new Date().toISOString());
    }
  }

  function handleNewRun() {
    setUiState((prev) => transition(prev, { type: "RESET" }));
    setResults(null);
    setActiveRunId(null);
    setError(null);
    setLastUpdated(new Date().toISOString());
    setExportWithFlagged(false);
  }

  function updateResult(
    questionId: string,
    patch: Partial<
      Pick<
        ResultItem,
        "status" | "review_notes" | "reviewed_by" | "reviewed_at"
      >
    >
  ) {
    setResults((prev) => {
      if (!prev) return prev;
      return prev.map((r) =>
        r.questionId === questionId
          ? {
              ...r,
              ...patch
            }
          : r
      );
    });
    setLastUpdated(new Date().toISOString());
  }

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

  function handleExport() {
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

    const doc = new jsPDF({
      unit: "pt",
      format: "letter"
    });

    const left = 48;
    const rightMargin = 48;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - left - rightMargin;

    let y = 56;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Security Questionnaire Review (MVP1)", left, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, left, y);
    y += 18;

    results.forEach((r, idx) => {
      const ensureSpace = (needed: number) => {
        const pageHeight = doc.internal.pageSize.getHeight();
        if (y + needed > pageHeight - 56) {
          doc.addPage();
          y = 56;
        }
      };

      ensureSpace(60);

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
        doc.text(
          `Reviewed at: ${new Date(r.reviewed_at).toLocaleString()}`,
          left,
          y
        );
        y += 14;
      }
      if (r.review_notes) {
        const noteLines = doc.splitTextToSize(
          `Notes: ${r.review_notes}`,
          maxWidth
        );
        doc.text(noteLines, left, y);
        y += noteLines.length * 12 + 4;
      }

      doc.setFont("helvetica", "bold");
      doc.text("Citations:", left, y);
      y += 14;
      doc.setFont("helvetica", "normal");

      if (r.citations.length === 0) {
        doc.text("No evidence available.", left, y);
        y += 14;
      } else {
        r.citations.forEach((c) => {
          const citationText = `${c.document} · ${c.section} — ${c.snippet}`;
          const cLines = doc.splitTextToSize(`- ${citationText}`, maxWidth);
          ensureSpace(14 + cLines.length * 12);
          doc.text(cLines, left, y);
          y += cLines.length * 12 + 2;
        });
      }

      y += 10;
      ensureSpace(10);
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.5);
      doc.line(left, y, pageWidth - rightMargin, y);
      y += 14;
    });

    doc.save(
      `security-questionnaire-results-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.pdf`
    );
  }

  const disableInput = uiState === "running";

  const crewStatusLabel =
    uiState === "running"
      ? "Crew: running"
      : uiState === "done"
      ? error
        ? "Crew: error"
        : "Crew: done"
      : "Crew: idle";

  const crewStatusColor =
    uiState === "running"
      ? "#38bdf8"
      : uiState === "done"
      ? error
        ? "#f97373"
        : "#22c55e"
      : "#9ca3af";

  let progressLabel: string | null = null;
  if (uiState === "running") {
    progressLabel = "Processing: Parsing → Finding evidence → Drafting → Attaching citations…";
  }

  const exportHelperText = useMemo(() => {
    if (!results || results.length === 0) return null;
    if (canExport) {
      return exportWithFlagged
        ? "Export enabled (including flagged items)."
        : "Export enabled (all answers approved/edited).";
    }

    const hasDraft = results.some((r) => r.status === "draft");
    if (hasDraft) return "Export disabled: all answers must be reviewed (no drafts).";

    if (!exportWithFlagged) {
      return "Export disabled: approve/edit all answers, or choose “Export with flagged items”.";
    }

    return "Export disabled: answers must be approved/edited/flagged.";
  }, [results, canExport, exportWithFlagged]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        backgroundColor: "#0f172a",
        color: "#e5e7eb"
      }}
    >
      <header
        style={{
          padding: "1.5rem 2rem",
          borderBottom: "1px solid rgba(148, 163, 184, 0.3)"
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
          Security Questionnaire Review
        </h1>
        <p style={{ marginTop: "0.25rem", color: "#9ca3af" }}>
          First draft with evidence-grade citations in under 90 seconds.
        </p>

        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem 0.9rem",
            borderRadius: "999px",
            border: "1px solid rgba(148, 163, 184, 0.5)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.6rem",
            fontSize: "0.85rem",
            backgroundColor: "rgba(15, 23, 42, 0.9)"
          }}
          aria-label="Crew status"
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "999px",
              backgroundColor: crewStatusColor,
              boxShadow: `0 0 10px ${crewStatusColor}`
            }}
          />
          <span>{crewStatusLabel}</span>
          {lastUpdated && (
            <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
              • Last updated:{" "}
              {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <main
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          gap: "1.5rem",
          padding: "1.5rem 2rem",
          flex: 1
        }}
      >
        <section
          aria-label="Question input and results"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem"
          }}
        >
          <div
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "0.75rem",
              backgroundColor: "#020617",
              border: "1px solid rgba(148, 163, 184, 0.35)"
            }}
          >
            <div style={{ marginBottom: "0.5rem" }}>
              <label
                htmlFor="questions"
                style={{ fontWeight: 500, display: "block", marginBottom: 4 }}
              >
                Questions (1–5)
              </label>
              <p style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
                Paste up to 5 security questionnaire items, one per line.
              </p>
            </div>
            <textarea
              id="questions"
              value={rawInput}
              onChange={(e) => {
                if (uiState === "done") {
                  setUiState((prev) => transition(prev, { type: "RESET" }));
                }
                setRawInput(e.target.value);
              }}
              disabled={disableInput}
              rows={8}
              style={{
                width: "100%",
                borderRadius: "0.5rem",
                border: "1px solid rgba(148, 163, 184, 0.6)",
                padding: "0.75rem",
                fontSize: "0.95rem",
                backgroundColor: disableInput ? "#020617" : "#020817",
                color: "#e5e7eb",
                resize: "vertical"
              }}
              placeholder={[
                "Does your organization enforce multi-factor authentication (MFA) for production access?",
                "How are security patches and updates applied to critical systems?",
                "Describe how access to customer data is logged and monitored."
              ].join("\n")}
            />
            <div
              style={{
                marginTop: "0.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.8rem"
              }}
            >
              <span
                style={{
                  color: hasTooManyQuestions ? "#f97373" : "#9ca3af"
                }}
              >
                {questionCount} / {MAX_QUESTIONS} questions
                {hasTooManyQuestions
                  ? " — please reduce to 5."
                  : null}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem"
            }}
          >
            <button
              type="button"
              onClick={handleStartRun}
              disabled={!canStart}
              style={{
                padding: "0.6rem 1.4rem",
                borderRadius: "999px",
                border: "none",
                cursor: canStart ? "pointer" : "not-allowed",
                background: canStart
                  ? "linear-gradient(135deg, #22c55e, #16a34a)"
                  : "rgba(55, 65, 81, 0.9)",
                color: "#020617",
                fontWeight: 600,
                fontSize: "0.95rem"
              }}
            >
              {uiState === "running" ? "Running…" : "Start run"}
            </button>

            {uiState === "done" && (
              <button
                type="button"
                onClick={handleNewRun}
                style={{
                  padding: "0.5rem 1.1rem",
                  borderRadius: "999px",
                  border: "1px solid rgba(148, 163, 184, 0.6)",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "0.9rem"
                }}
              >
                New run
              </button>
            )}

            {results && results.length > 0 && (
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem"
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    fontSize: "0.85rem",
                    color: "#9ca3af",
                    userSelect: "none"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={exportWithFlagged}
                    onChange={(e) => setExportWithFlagged(e.target.checked)}
                    style={{ accentColor: "#38bdf8" }}
                  />
                  Export with flagged items
                </label>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!canExport}
                  style={{
                    padding: "0.5rem 1.1rem",
                    borderRadius: "999px",
                    border: "1px solid rgba(148, 163, 184, 0.6)",
                    backgroundColor: canExport
                      ? "#020617"
                      : "rgba(55, 65, 81, 0.9)",
                    color: "#e5e7eb",
                    cursor: canExport ? "pointer" : "not-allowed",
                    fontSize: "0.9rem"
                  }}
                >
                  Export JSON
                </button>

                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={!canExport}
                  style={{
                    padding: "0.5rem 1.1rem",
                    borderRadius: "999px",
                    border: "1px solid rgba(148, 163, 184, 0.6)",
                    backgroundColor: canExport
                      ? "rgba(168, 85, 247, 0.18)"
                      : "rgba(55, 65, 81, 0.9)",
                    color: "#e5e7eb",
                    cursor: canExport ? "pointer" : "not-allowed",
                    fontSize: "0.9rem"
                  }}
                >
                  Export PDF
                </button>
              </div>
            )}
          </div>

          {exportHelperText && (
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "0.8rem",
                color: canExport ? "#86efac" : "#9ca3af"
              }}
            >
              {exportHelperText}
            </div>
          )}

          {progressLabel && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.85rem",
                color: "#a855f7"
              }}
            >
              {progressLabel}
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: "0.5rem",
                padding: "0.7rem 0.9rem",
                borderRadius: "0.5rem",
                backgroundColor: "rgba(127, 29, 29, 0.8)",
                color: "#fee2e2",
                fontSize: "0.85rem"
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              marginTop: "0.5rem",
              padding: "1rem 1.25rem",
              borderRadius: "0.75rem",
              backgroundColor: "#020617",
              border: "1px solid rgba(148, 163, 184, 0.35)",
              flex: 1,
              overflowY: "auto"
            }}
          >
            <h2
              style={{
                fontSize: "1rem",
                fontWeight: 500,
                marginBottom: "0.75rem"
              }}
            >
              Results
            </h2>

            {!results || results.length === 0 ? (
              <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
                Start a run to see draft answers and evidence-grade citations.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem"
                }}
              >
                {results.map((item) => (
                  <li
                    key={item.questionId}
                    style={{
                      padding: "0.9rem 1rem",
                      borderRadius: "0.75rem",
                      background:
                        "radial-gradient(circle at top left, rgba(37, 99, 235, 0.18), #020617)",
                      border: "1px solid rgba(148, 163, 184, 0.45)"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        marginBottom: "0.35rem"
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#9ca3af",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em"
                        }}
                      >
                        Review status
                      </div>
                      <select
                        value={item.status}
                        onChange={(e) => {
                          const nextStatus = e.target
                            .value as AnswerReviewStatus;
                          const patch: Partial<ResultItem> = {
                            status: nextStatus
                          };

                          if (
                            nextStatus === "approved" ||
                            nextStatus === "edited" ||
                            nextStatus === "flagged"
                          ) {
                            patch.reviewed_at = new Date().toISOString();
                          } else {
                            patch.reviewed_at = undefined;
                          }

                          updateResult(item.questionId, patch);
                        }}
                        style={{
                          backgroundColor: "#0b1220",
                          color: "#e5e7eb",
                          border: "1px solid rgba(148, 163, 184, 0.6)",
                          borderRadius: "0.5rem",
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.85rem"
                        }}
                      >
                        <option value="draft">draft</option>
                        <option value="approved">approved</option>
                        <option value="edited">edited</option>
                        <option value="flagged">flagged</option>
                      </select>
                    </div>

                    <div
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: 500,
                        marginBottom: "0.3rem",
                        color: "#e5e7eb"
                      }}
                    >
                      Q: {item.questionText}
                    </div>
                    <div
                      style={{
                        fontSize: "0.9rem",
                        color: "#d1d5db",
                        marginBottom: "0.5rem"
                      }}
                    >
                      {item.answer}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.6rem",
                        marginBottom: "0.6rem"
                      }}
                    >
                      <label style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                          reviewed_by (optional)
                        </span>
                        <input
                          value={item.reviewed_by ?? ""}
                          onChange={(e) =>
                            updateResult(item.questionId, {
                              reviewed_by: e.target.value || undefined
                            })
                          }
                          placeholder="e.g. Alice"
                          style={{
                            marginTop: 4,
                            backgroundColor: "#0b1220",
                            color: "#e5e7eb",
                            border: "1px solid rgba(148, 163, 184, 0.6)",
                            borderRadius: "0.5rem",
                            padding: "0.4rem 0.6rem",
                            fontSize: "0.85rem"
                          }}
                        />
                      </label>

                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                          reviewed_at (auto)
                        </span>
                        <div
                          style={{
                            marginTop: 4,
                            backgroundColor: "#0b1220",
                            border: "1px solid rgba(148, 163, 184, 0.25)",
                            borderRadius: "0.5rem",
                            padding: "0.4rem 0.6rem",
                            fontSize: "0.85rem",
                            color: item.reviewed_at ? "#e5e7eb" : "#9ca3af"
                          }}
                        >
                          {item.reviewed_at
                            ? new Date(item.reviewed_at).toLocaleString()
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <label style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
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
                          marginTop: 4,
                          backgroundColor: "#0b1220",
                          color: "#e5e7eb",
                          border: "1px solid rgba(148, 163, 184, 0.6)",
                          borderRadius: "0.5rem",
                          padding: "0.5rem 0.6rem",
                          fontSize: "0.85rem",
                          resize: "vertical"
                        }}
                      />
                    </label>

                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#9ca3af"
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 500,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontSize: "0.75rem"
                        }}
                      >
                        Citations
                      </span>
                      {item.citations.length === 0 ? (
                        <div style={{ marginTop: "0.25rem" }}>
                          No evidence available for this answer.
                        </div>
                      ) : (
                        <ul
                          style={{
                            listStyle: "none",
                            padding: 0,
                            margin: "0.25rem 0 0",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.25rem"
                          }}
                        >
                          {item.citations.map((c, index) => (
                            <li key={`${item.questionId}-cit-${index}`}>
                              <span style={{ color: "#e5e7eb" }}>
                                {c.document}
                              </span>
                              {" · "}
                              <span>{c.section}</span>
                              {" — "}
                              <span style={{ fontStyle: "italic" }}>
                                {c.snippet}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside
          aria-label="Run history"
          style={{
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            backgroundColor: "#020617",
            border: "1px solid rgba(148, 163, 184, 0.35)",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 500,
              marginBottom: "0.75rem"
            }}
          >
            Run history
          </h2>

          {runs.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
              Runs from this browser session will appear here with status and
              timestamps.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                overflowY: "auto"
              }}
            >
              {runs.map((run) => {
                const isActive = run.runId === activeRunId;
                const statusLabel: Record<RunStatus, string> = {
                  running: "Running",
                  completed: "Completed",
                  failed: "Failed"
                };

                const badgeColor =
                  run.status === "completed"
                    ? "#22c55e"
                    : run.status === "failed"
                    ? "#f97316"
                    : "#38bdf8";

                return (
                  <li
                    key={run.runId}
                    style={{
                      padding: "0.6rem 0.75rem",
                      borderRadius: "0.6rem",
                      border: isActive
                        ? "1px solid rgba(96, 165, 250, 0.9)"
                        : "1px solid rgba(148, 163, 184, 0.4)",
                      backgroundColor: isActive
                        ? "rgba(15, 23, 42, 0.95)"
                        : "rgba(15, 23, 42, 0.7)",
                      cursor: "default",
                      fontSize: "0.8rem"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "0.25rem"
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo",
                          fontSize: "0.75rem",
                          color: "#9ca3af"
                        }}
                      >
                        {new Date(run.startedAt).toLocaleTimeString()}
                      </span>
                      <span
                        style={{
                          padding: "0.1rem 0.45rem",
                          borderRadius: "999px",
                          backgroundColor: badgeColor,
                          color: "#020617",
                          fontWeight: 600,
                          fontSize: "0.75rem"
                        }}
                      >
                        {statusLabel[run.status]}
                      </span>
                    </div>
                    <div>
                      {run.questionCount} question
                      {run.questionCount === 1 ? "" : "s"}
                    </div>
                    {run.lastError && (
                      <div
                        style={{
                          marginTop: "0.2rem",
                          color: "#f97373"
                        }}
                      >
                        {run.lastError}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
};

