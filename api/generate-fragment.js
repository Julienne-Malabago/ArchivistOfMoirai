// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.5-flash";

// --- Helper: Parse AI Response ---
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

    const { secretTag, difficultyTier, genre, contextHistory = [] } = req.body;
    
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({ 
            errorType: "InvalidRequest", 
            errorMessage: "Missing required fields: secretTag or difficultyTier." 
        });
    }

    // Initialize using the @google/genai pattern
    const genAI = new GoogleGenAI({ apiKey });

    const isStoryMode = contextHistory.length > 0;
    const historyText = isStoryMode 
        ? `\nSTORY CONTEXT (Previous Events):\n${contextHistory.map((text, i) => `Part ${i+1}: ${text}`).join('\n')}\n`
        : "";

    const prompt = `
You are the Archivist of Moirai.

Generate a short narrative fragment (100–150 words) in the following setting:
GENRE: ${genre || "Random"}
${historyText}
Secret Causal Force (SECRET_TAG): ${secretTag}
Difficulty Tier: ${difficultyTier}

Rules:
- ${isStoryMode ? "CONTINUATION: Follow the plot and characters established in the STORY CONTEXT." : "STANDALONE: Create a new scenario."}
- The fragment must fit the specified GENRE perfectly.
- Subtly embed the causal force (${secretTag}).
- Tone and complexity must match the difficulty tier.
- Do NOT explain the secret directly in the fragment text.
- Provide a brief revelation explaining how the causal force was at work.

Return ONLY a valid JSON object in this exact format:
{
  "fragmentText": "string",
  "revelationText": "string"
}
`;

    try {
        // Use the .models.generateContent method for the @google/genai SDK
        const response = await genAI.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { 
                temperature: 0.8,
                responseMimeType: "application/json" 
            }
        });

        // Extract text from the response object
        const rawText = response.text;
        const data = parseAIResponse(rawText);

        if (!data.fragmentText || !data.revelationText) {
            throw new Error("AI returned JSON missing required keys");
        }

        return res.status(200).json(data);

    } catch (err) {
        console.error("ARCHIVIST AI ERROR:", err);
        return res.status(500).json({
            errorType: err.name || "UnknownError",
            errorMessage: err.message || "An unknown error occurred"
        });
    }
}
