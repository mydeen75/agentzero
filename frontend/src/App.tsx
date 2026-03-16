import React, { useMemo, useState } from "react";
import { transition, type UiState } from "./fsm";
import {
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
  }

  function handleExport() {
    if (!results || results.length === 0) return;

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
              <button
                type="button"
                onClick={handleExport}
                style={{
                  marginLeft: "auto",
                  padding: "0.5rem 1.1rem",
                  borderRadius: "999px",
                  border: "1px solid rgba(148, 163, 184, 0.6)",
                  backgroundColor: "#020617",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  fontSize: "0.9rem"
                }}
              >
                Export JSON
              </button>
            )}
          </div>

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

