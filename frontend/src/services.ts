import type {
  AnswerReviewStatus,
  QuestionInput,
  ResultItem,
  RunStatus
} from "./types";

export type StartRunResponse = {
  runId: string;
  results?: ResultItem[];
};

export type GetRunStatusResponse = {
  status: RunStatus;
  results?: ResultItem[];
  error?: string;
};

const API_BASE_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:8000";

type BackendRunResultItem = {
  question_id: string;
  question_text: string;
  answer: string;
  status?: AnswerReviewStatus;
  review_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  citations: {
    document: string;
    section: string;
    snippet: string;
    [key: string]: unknown;
  }[];
};

type BackendStartRunResponse = {
  runId: string;
  results: BackendRunResultItem[];
};

export async function startRun(
  questions: QuestionInput[]
): Promise<StartRunResponse> {
  const response = await fetch(`${API_BASE_URL}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ questions })
  });

  if (!response.ok) {
    const message = await safeReadErrorMessage(response);
    throw new Error(
      message ?? `Failed to start run (status ${response.status}).`
    );
  }

  const data = (await response.json()) as BackendStartRunResponse;

  const results: ResultItem[] = (data.results ?? []).map((item) => ({
    questionId: item.question_id,
    questionText: item.question_text,
    answer: item.answer,
    status: item.status ?? "draft",
    review_notes: item.review_notes,
    reviewed_by: item.reviewed_by,
    reviewed_at: item.reviewed_at,
    citations: item.citations.map((c) => ({
      document: c.document,
      section: c.section,
      snippet: c.snippet
    }))
  }));

  return { runId: data.runId, results };
}

async function safeReadErrorMessage(
  response: Response
): Promise<string | null> {
  try {
    const data = (await response.json()) as { detail?: string };
    if (typeof data.detail === "string") {
      return data.detail;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function getRunStatus(
  runId: string
): Promise<GetRunStatusResponse> {
  console.debug("getRunStatus called with runId:", runId);

  // For MVP1 we treat the run as synchronous: once /api/run returns,
  // the results are already available. This function remains a stub
  // for potential future polling support.
  return {
    status: "completed"
  };
}

