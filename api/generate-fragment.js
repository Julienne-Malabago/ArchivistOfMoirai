// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.5-flash";

// --- Helper: Attempt strict parse first, fallback to cleaned JSON ---
function parseAIResponse(raw) {
    if (!raw) throw new Error("Empty AI response");

    try {
        // Strict JSON parse
        return JSON.parse(raw);
    } catch {
        // Fallback: remove markdown fences and extra text
        const cleaned = raw.replace(/```json|```/g, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}") + 1;
        if (start === -1 || end === -1) throw new Error("No valid JSON found in AI response");
        return JSON.parse(cleaned.substring(start, end));
    }
}

// --- Serverless Handler ---
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ 
            errorType: "MethodNotAllowed", 
            errorMessage: "Only POST requests are allowed." 
        });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ 
            errorType: "MissingAPIKey", 
            errorMessage: "GEMINI_API_KEY is missing from environment variables." 
        });
    }

    const { secretTag, difficultyTier } = req.body;
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({ 
            errorType: "InvalidRequest", 
            errorMessage: "Missing required fields: secretTag or difficultyTier." 
        });
    }

    const genAI = new GoogleGenAI({ apiKey });

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
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8 }
        });

        const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log("GEMINI RAW RESPONSE:", rawText);

        const data = parseAIResponse(rawText);

        if (!data.fragmentText || !data.revelationText) {
            throw new Error("AI returned JSON missing required keys");
        }

        return res.status(200).json(data);

    } catch (err) {
        console.error("ARCHIVIST AI ERROR:", err);

        // Return the actual error type and message
        return res.status(500).json({
            errorType: err.name || "UnknownError",
            errorMessage: err.message || "Archivist AI failed to respond"
        });
    }
}
