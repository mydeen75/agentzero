export type Citation = {
  document: string;
  section: string;
  snippet: string;
};

export type AnswerReviewStatus = "draft" | "approved" | "edited" | "flagged";

export type QuestionInput = {
  id: string;
  text: string;
};

export type ResultItem = {
  questionId: string;
  questionText: string;
  answer: string;
  citations: Citation[];
  status: AnswerReviewStatus;
  review_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
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

