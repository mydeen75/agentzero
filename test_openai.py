from openai import OpenAI
import os
from dotenv import load_dotenv


def main() -> None:
    load_dotenv(override=True)

    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("MVP1_LLM_MODEL")

    print("Has OPENAI_API_KEY:", bool(api_key))
    print("Testing model:", repr(model))

    client = OpenAI()

    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Say 'ok, your Highness' and nothing else."}],
        max_tokens=5,
    )
    print("Success:", resp.choices[0].message.content)


if __name__ == "__main__":
    main()