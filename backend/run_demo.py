import os
from typing import List, Dict

from dotenv import load_dotenv

from backend.runtime.crew_runner import kickoff_mvp1_pipeline


def main() -> None:
    # Load environment variables from .env if present.
    # override=True ensures .env values take precedence over any
    # existing process/OS variables so you can control the model
    # from this project file.
    load_dotenv(override=True)

    # Ensure required env vars are present
    openai_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("MVP1_LLM_MODEL")
    if not openai_key or not model:
        raise SystemExit(
            "OPENAI_API_KEY and MVP1_LLM_MODEL must be set in the environment or .env before running this demo."
        )

    # Show which model we are about to use so you can confirm the
    # environment is being read correctly.
    print(f"Using model from env MVP1_LLM_MODEL={model!r}")

    questions: List[Dict[str, str]] = [
        {"id": "q1", "text": "Do you have a SOC 2 Type II report?"},
        {"id": "q2", "text": "How is customer data encrypted at rest?"},
    ]

    result = kickoff_mvp1_pipeline(questions)
    print(result)


if __name__ == "__main__":
    main()

