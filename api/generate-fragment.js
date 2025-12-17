// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const MODEL_NAME = "gemini-2.5-flash";

/**
 * Safely extract JSON even if Gemini wraps it in ```json blocks
 */
function extractJson(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error("No valid JSON found in Gemini response");
    }
    return JSON.parse(match[0]);
}

export default async function handler(req, res) {
    // --- METHOD CHECK ---
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    // --- ENV CHECK ---
    if (!process.env.GEMINI_API_KEY) {
        console.error("CRITICAL: GEMINI_API_KEY missing");
        return res.status(500).json({
            error: "Server configuration error: Missing GEMINI_API_KEY",
        });
    }

    const { secretTag, difficultyTier, genre } = req.body;

    // --- INPUT VALIDATION ---
    if (!secretTag || difficultyTier === undefined) {
        return res.status(400).json({
            error: "Missing required fields: secretTag or difficultyTier",
        });
    }

    const activeGenre =
        genre && genre !== "Random"
            ? genre
            : "a randomly chosen literary genre";

    // --- PROMPT (MERGED FROM YOUR CODE, CLEANED) ---
    const prompt = `
You are the Archivist of Moirai, a narrative AI.

Your task is to generate a short story fragment (100–150 words)
that subtly embeds a hidden causal force.

Instructions:
1. Genre: ${activeGenre}
2. SECRET_TAG (true causal force): ${secretTag}
3. Difficulty Tier: ${difficultyTier}
   - Higher tiers should be more subtle and ambiguous.
4. The fragment must feel natural and literary.
5. Do NOT mention SECRET_TAG explicitly in the fragment.

After the fragment, explain the causal force clearly.

Return ONLY a JSON object.
Do NOT use markdown.
Do NOT wrap in \`\`\`.

The JSON MUST follow this exact structure:
{
  "fragmentText": "A short narrative fragment (100–150 words)",
  "revelationText": "A concise explanation (1–2 sentences) revealing why ${secretTag} is the true causal force."
}
`;

    try {
        // --- GEMINI CALL ---
        const response = await client.models.generateContent({
            model: MODEL_NAME,
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }],
                },
            ],
        });

        const rawText =
            response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
            throw new Error("Empty response from Gemini");
        }

        const data = extractJson(rawText);

        // --- FINAL VALIDATION ---
        if (!data.fragmentText || !data.revelationText) {
            throw new Error("AI response missing required fields");
        }

        return res.status(200).json(data);

    } catch (err) {
        console.error("GenAI Error:", err);
        return res.status(500).json({
            error: "Archivist AI failed to respond.",
            details: err.message,
        });
    }
}
