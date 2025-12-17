// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const MODEL_NAME = "gemini-2.5-flash";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { secretTag, difficultyTier } = req.body;

    if (!secretTag || !difficultyTier) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        const response = await client.models.generateContent({
            model: MODEL_NAME,
            contents: [{
                role: "user",
                parts: [{
                    text: `
Return ONLY valid JSON in this exact format:
{
  "fragmentText": "string",
  "revelationText": "string"
}

SECRET_TAG: ${secretTag}
DIFFICULTY: ${difficultyTier}
`
                }]
            }],
        });

        const rawText =
            response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
            throw new Error("Empty response from Gemini");
        }

        const data = JSON.parse(rawText);
        return res.status(200).json(data);

    } catch (err) {
        console.error("GenAI Error:", err);
        return res.status(500).json({
            error: "Archivist AI failed to respond.",
            details: err.message,
        });
    }
}
