// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.0-flash"; // Standard naming, update if using a specific preview

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

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ errorType: "MethodNotAllowed", errorMessage: "Only POST requests are allowed." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ errorType: "MissingAPIKey", errorMessage: "GEMINI_API_KEY is missing." });
    }

    // contextHistory will be an array of previous strings
    const { secretTag, difficultyTier, genre, contextHistory = [] } = req.body;
    
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({ errorType: "InvalidRequest", errorMessage: "Missing secretTag or difficultyTier." });
    }

    const genAI = new GoogleGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Determine if we are in Story Mode based on if context exists
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
- ${isStoryMode ? "This is a CONTINUATION. You must follow the characters, plot, and tone established in the STORY CONTEXT above." : "This is a STANDALONE fragment."}
- The fragment must fit the specified GENRE perfectly.
- Subtly embed the causal force (${secretTag}) into the narrative.
- Tone and complexity must match Difficulty Tier ${difficultyTier}.
- Do NOT explain the secret directly in the fragment text.
- Provide a brief revelation (revelationText) explaining how ${secretTag} was the hidden driver of this specific fragment.

Return ONLY a valid JSON object:
{
  "fragmentText": "string",
  "revelationText": "string"
}
`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { 
                temperature: 0.8,
                responseMimeType: "application/json" 
            }
        });

        const response = await result.response;
        const data = parseAIResponse(response.text());

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
