import { GoogleGenerativeAI } from "@google/generative-ai"; // Use the standard import

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Missing API Key" });
    }

    // --- THE FIX ---
    // Pass the apiKey string directly, not as { apiKey: apiKey }
    const genAI = new GoogleGenerativeAI(apiKey); 
    const MODEL_NAME = "gemini-1.5-flash"; 

    const { secretTag, difficultyTier, genre } = req.body;

    // Safety check for inputs
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({ error: "Missing secretTag or difficultyTier" });
    }

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
        You are the Archivist of Moirai.
        Generate a short story fragment (100–150 words).
        Genre: ${activeGenre}
        Secret Causal Force: ${secretTag}
        Difficulty Tier: ${difficultyTier}
        Return ONLY valid JSON.
    `;

    try {
        // Initialize the model instance correctly
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: JSON_SCHEMA,
                temperature: 0.8,
            }
        });

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        return res.status(200).json(JSON.parse(responseText));

    } catch (err) {
        console.error("Gemini AI error:", err);
        return res.status(500).json({ error: `AI generation failed: ${err.message}` });
    }
}
