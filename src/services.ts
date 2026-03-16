import type { QuestionInput, ResultItem, RunStatus } from "./types";

export type StartRunResponse = {
  runId: string;
  results?: ResultItem[];
};

export type GetRunStatusResponse = {
  status: RunStatus;
  results?: ResultItem[];
  error?: string;
};

export async function startRun(
  questions: QuestionInput[]
): Promise<StartRunResponse> {
  // Stub implementation for MVP1 frontend: deterministic mock data.
  const runId = `run-${Date.now()}`;

  const results: ResultItem[] = questions.map((q, index) => ({
    questionId: q.id,
    questionText: q.text,
    answer: `This is a mock draft answer for question ${index + 1}. In a real system, this would be generated from evidence in the demo knowledge base.`,
    citations: [
      {
        document: "Information Security Policy",
        section: "§4.2 Access Control",
        snippet:
          "Access to production systems is restricted based on least privilege and reviewed quarterly."
      }
    ]
  }));

  // Simulate network/processing latency.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  return { runId, results };
}

export async function getRunStatus(
  runId: string
): Promise<GetRunStatusResponse> {
  // Stub implementation for MVP1 frontend: immediately completed.
  console.debug("getRunStatus stub called with runId:", runId);

  // In a real integration this would poll backend /api/status or similar.
  return {
    status: "completed"
  };
}

