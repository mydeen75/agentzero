export type Citation = {
  document: string;
  section: string;
  snippet: string;
};

export type QuestionInput = {
  id: string;
  text: string;
};

export type ResultItem = {
  questionId: string;
  questionText: string;
  answer: string;
  citations: Citation[];
};

export type RunStatus = "running" | "completed" | "failed";

export type RunSummary = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  questionCount: number;
  lastError?: string;
};

