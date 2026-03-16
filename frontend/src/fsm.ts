export type UiState = "idle" | "running" | "done";

export type UiEvent =
  | { type: "START" }
  | { type: "RESOLVE" }
  | { type: "FAIL" }
  | { type: "RESET" };

export function transition(state: UiState, event: UiEvent): UiState {
  switch (state) {
    case "idle": {
      if (event.type === "START") return "running";
      return state;
    }
    case "running": {
      if (event.type === "RESOLVE" || event.type === "FAIL") {
        return "done";
      }
      return state;
    }
    case "done": {
      if (event.type === "RESET") return "idle";
      if (event.type === "START") return "running";
      return state;
    }
    default:
      return state;
  }
}

