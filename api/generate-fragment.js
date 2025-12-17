import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

const MODEL_NAME = "gemini-2.5-flash";

export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Missing API Key" });
    }

    const genai = new GoogleGenAI({ apiKey });

    // 🆕 RECEIVE GENRE
    const { secretTag, difficultyTier, genre } = req.body;

    if (!secretTag || !difficultyTier || !genre) {
        return res.status(400).json({
            error: "Missing secretTag, difficultyTier, or genre"
        });
    }

    const JSON_SCHEMA = {
        type: "object",
        properties: {
            fragmentText: { type: "string" },
            revelationText: { type: "string" }
        },
        required: ["fragmentText", "revelationText"]
    };

    // 🆕 GENRE-AWARE PROMPT
    const prompt = `
You are the Archivist of Moirai.

Generate a short story fragment (100–150 words).

Rules:
- Genre: ${genre === "Random" ? "Choose an appropriate genre randomly." : genre}
- Secret Causal Force: ${secretTag}
- Difficulty Tier: ${difficultyTier}

Genre should influence:
- Tone
- Setting
- Tropes
- Emotional beats

The causal force must be subtle.

Return ONLY valid JSON matching the schema.
`;

    try {
        const response = await genai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: JSON_SCHEMA,
                temperature: 0.85,
            }
        });

        const data = JSON.parse(response.text.trim());
        return res.status(200).json(data);

    } catch (err) {
        console.error("GenAI error:", err);
        return res.status(500).json({
            error: `AI generation failed: ${err.message}`
        });
    }
}
