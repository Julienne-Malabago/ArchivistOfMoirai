// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

// ================================
// CONFIG
// ================================
const MODEL_NAME = "gemini-2.5-flash";

// ================================
// STRICT JSON EXTRACTOR (THROWS)
// ================================
function extractJsonStrict(text) {
    if (!text) {
        throw new Error("Empty AI response");
    }

    // Remove markdown fences if present
    const cleaned = text.replace(/```json|```/g, "").trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}") + 1;

    if (start === -1 || end === -1) {
        throw new Error("No valid JSON object found in AI response");
    }

    try {
        return JSON.parse(cleaned.substring(start, end));
    } catch (err) {
        throw new Error("Failed to parse JSON: " + err.message);
    }
}

// ================================
// SERVERLESS HANDLER
// ================================
export default async function handler(req, res) {
    // ---- METHOD GUARD ----
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            error: "Server configuration error: GEMINI_API_KEY is missing"
        });
    }

    const { secretTag, difficultyTier } = req.body;

    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({
            error: "Missing required fields: secretTag or difficultyTier"
        });
    }

    const genAI = new GoogleGenAI({ apiKey });

    // ================================
    // PROMPT (ARCHIVIST OF MOIRAI)
    // ================================
    const prompt = `
You are the Archivist of Moirai.

Generate a short narrative fragment (100–150 words).

Secret Causal Force (SECRET_TAG): ${secretTag}
Difficulty Tier: ${difficultyTier}

Rules:
- The fragment must subtly embed the causal force.
- Tone and complexity must match the difficulty tier.
- Do NOT explain the secret directly in the fragment.
- After the fragment, provide a brief revelation explaining the causal force.

Return ONLY a valid JSON object in this exact format:
{
  "fragmentText": "string",
  "revelationText": "string"
}

No markdown. No commentary. No extra text.
`;

    try {
        const response = await genAI.models.generateContent({
            model: MODEL_NAME,
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            ],
            generationConfig: {
                temperature: 0.8
            }
        });

        const rawText =
            response?.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("GEMINI RAW RESPONSE:", rawText);

        const data = extractJsonStrict(rawText);

        return res.status(200).json(data);

    } catch (err) {
        console.error("ARCHIVIST AI ERROR:", err);

        return res.status(500).json({
            error: "Archivist AI failed to respond.",
            details: err.message
        });
    }
}
