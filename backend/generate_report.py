import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("XAI_API_KEY")
model = os.getenv("XAI_MODEL")

if not api_key:
    raise RuntimeError("XAI_API_KEY is missing from .env")

if not model:
    raise RuntimeError("XAI_MODEL is missing from .env")

with open("runoff_debt.json", encoding="utf-8") as file:
    runoff_debt = json.load(file)

with open("exposure_metrics.json", encoding="utf-8") as file:
    exposure_metrics = json.load(file)

evidence = {
    "runoff_debt": runoff_debt,
    "downstream_screening": exposure_metrics
}

client = OpenAI(
    api_key=api_key,
    base_url="https://api.x.ai/v1"
)

system_prompt = """
You are the public-explanation component of an environmental
screening tool.

Explain technical results in plain, careful language.

Rules:
1. Use only numbers supplied in the evidence.
2. Never invent measurements, causes, damages, or affected people.
3. Call the paths "modeled overland flow paths."
4. Call intersecting features "features inside the modeled
   screening corridor."
5. Do not claim that buildings flooded or wetlands were damaged.
6. Explain that storm drains, culverts, detention ponds, and
   underground infrastructure are not modeled.
7. State that this is a screening estimate, not an engineering
   flood study.
8. Keep the explanation concise and understandable to residents.
9. Do not use em dashes.
"""

user_prompt = f"""
Write a community-facing environmental screening report for the
Amazon Distribution Center in Clear Brook, Virginia.

Verified evidence:

{json.dumps(evidence, indent=2)}

Use these sections:

Summary
What changed
Where water may travel
Features in the screening corridor
Important limitations
Suggested next steps

Return plain Markdown.
"""

response = client.chat.completions.create(
    model=model,
    temperature=0.2,
    messages=[
        {
            "role": "system",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": user_prompt
        }
    ]
)

report = response.choices[0].message.content

with open(
    "community_report.md",
    "w",
    encoding="utf-8"
) as file:
    file.write(report)

print(report)
print("\nSaved community_report.md")
