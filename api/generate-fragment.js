// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.5-flash";

// --- Helper: Attempt strict parse first, fallback to cleaned JSON ---
function parseAIResponse(raw) {
    if (!raw) throw new Error("Empty AI response");

    try {
        return JSON.parse(raw);
    } catch {
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

    // Extract genre from request body
    const { secretTag, difficultyTier, genre } = req.body;
    
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({ 
            errorType: "InvalidRequest", 
            errorMessage: "Missing required fields: secretTag or difficultyTier." 
        });
    }

    const genAI = new GoogleGenAI({ apiKey });

    // Injected genre into the prompt instructions
    const prompt = `
You are the Archivist of Moirai.

Generate a short narrative fragment (100–150 words) in the following setting:
GENRE: ${genre || "Random"}

Secret Causal Force (SECRET_TAG): ${secretTag}
Difficulty Tier: ${difficultyTier}

Rules:
- The fragment must fit the specified GENRE perfectly.
- The fragment must subtly embed the causal force (${secretTag}).
- Tone and complexity must match the difficulty tier.
- Do NOT explain the secret directly in the fragment.
- Provide a brief revelation explaining how the causal force was at work.

Return ONLY a valid JSON object in this exact format:
{
  "fragmentText": "string",
  "revelationText": "string"
}
`;

    try {
        const response = await genAI.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { 
                temperature: 0.8,
                // Forces the model to output a valid JSON object
                responseMimeType: "application/json" 
            }
        });

        // Gemini 2.5 Flash SDK structure check
        const rawText = response.text;
        console.log("GEMINI RAW RESPONSE:", rawText);

        const data = parseAIResponse(rawText);

        if (!data.fragmentText || !data.revelationText) {
            throw new Error("AI returned JSON missing required keys");
        }

        return res.status(200).json(data);

    } catch (err) {
        console.error("ARCHIVIST AI ERROR:", err);

        if (err?.error) {
            const aiError = err.error;
            return res.status(err.status || 500).json({
                errorType: aiError.code || "ApiError",
                errorMessage: aiError.message || "AI returned an error",
                details: aiError.details || null
            });
        }

        return res.status(500).json({
            errorType: err.name || "UnknownError",
            errorMessage: err.message || "An unknown error occurred"
        });
    }
}
