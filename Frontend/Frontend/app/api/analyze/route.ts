import { NextResponse } from "next/server";
import { localExplanation } from "@/lib/explain";
import { validateMetrics } from "@/lib/site";

const schema = {
  name: "runoff_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { resident: { type: "string" }, professional: { type: "string" } },
    required: ["resident", "professional"],
  },
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !validateMetrics(body.metrics)) return NextResponse.json({ error: "Valid site metrics are required." }, { status: 400 });
  const fallback = localExplanation(body.metrics);
  if (!process.env.XAI_API_KEY) return NextResponse.json(fallback);
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.1-fast",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Explain supplied runoff-screening facts. Never claim flooding, contamination, causality, certainty, or regulatory compliance. Resident text should be plain language. Professional text should include the measurements and methodological limits." },
          { role: "user", content: JSON.stringify(body.metrics) },
        ],
        response_format: { type: "json_schema", json_schema: schema },
      }),
    });
    if (!response.ok) throw new Error(`xAI returned ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    if (typeof parsed.resident !== "string" || typeof parsed.professional !== "string") throw new Error("Invalid structured response");
    return NextResponse.json({ ...parsed, source: "grok" });
  } catch (error) {
    console.error("Grok analysis fallback", error);
    return NextResponse.json(fallback);
  }
}
