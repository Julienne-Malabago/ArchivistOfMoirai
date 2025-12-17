// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

// ================================
// CONFIG
// ================================
const MODEL_NAME = "gemini-2.5-flash";

// ================================
// SAFE JSON EXTRACTOR (NO CRASH)
// ================================
function extractJsonSafe(text) {
    try {
        if (!text) throw new Error("Empty AI response");

        // Remove markdown fences if present
        text = text.replace(/```json|```/g, "").trim();

        const start = text.indexOf("{");
        const end = text.lastIndexOf("}") + 1;

        if (start === -1 || end === -1) {
            throw new Error("No JSON object found");
        }

        return JSON.parse(text.substring(start, end));
    } catch (err) {
        console.error("JSON PARSE FAILED:", err.message);

        // 🔐 FAILSAFE LORE (GAME NEVER BREAKS)
        return {
            fragmentText:
                "The Archivist reaches for the fragment, but the parchment fades into silence before the words can be preserved.",
            revelationText:
                "The causal force remains obscured, lost in a distortion within the Archive."
        };
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
            error: "Server misconfiguration: GEMINI_API_KEY is missing"
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
- Tone and complexity should match the difficulty tier.
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
            response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        console.log("GEMINI RAW RESPONSE:", rawText);

        const data = extractJsonSafe(rawText);

        return res.status(200).json(data);
    } catch (err) {
        console.error("GENAI FAILURE:", err);

        // Absolute last-resort fallback
        return res.status(200).json({
            fragmentText:
                "A tear runs through the Archive. Ink spills, but meaning refuses to take form.",
            revelationText:
                "The Archivist was unable to stabilize the causal thread."
        });
    }
}
