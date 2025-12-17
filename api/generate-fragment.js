import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.0-flash"; // Optimized for speed and JSON

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Missing API Key" });
    }

    const genai = new GoogleGenAI(apiKey);

    // Destructure data from the request body
    const { secretTag, difficultyTier, genre } = req.body;

    // CORE VALIDATION: Only fail if the mechanical game data is missing
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({
            error: "Missing required game parameters: secretTag or difficultyTier"
        });
    }

    // FALLBACK: If genre is missing or "Random", handle it gracefully
    const activeGenre = (genre && genre !== "Random") ? genre : "a randomly chosen literary genre";

    const JSON_SCHEMA = {
        type: "object",
        properties: {
            fragmentText: { type: "string" },
            revelationText: { type: "string" }
        },
        required: ["fragmentText", "revelationText"]
    };

    const prompt = `
        You are the Archivist of Moirai, a cosmic observer of causality.
        Generate a short story fragment (100–150 words).

        Rules:
        - Genre: ${activeGenre}
        - Secret Causal Force: ${secretTag}
        - Difficulty Tier: ${difficultyTier} (Higher means the causal force is more subtle)

        The fragment should reflect the chosen genre's tone and tropes. 
        The causal force (${secretTag}) must be the driving factor of the scene but should not be explicitly named in the fragmentText.
        
        The revelationText should be a 1-2 sentence cryptic explanation of how ${secretTag} manifested in the story.

        Return ONLY valid JSON.
    `;

    try {
        const model = genai.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: JSON_SCHEMA,
                temperature: 0.8,
            }
        });

        const data = JSON.parse(result.response.text());
        return res.status(200).json(data);

    } catch (err) {
        console.error("GenAI error:", err);
        return res.status(500).json({ error: `AI generation failed: ${err.message}` });
    }
}
