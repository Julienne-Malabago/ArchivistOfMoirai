// api/generate-fragment.js
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

// Use the new SDK's client structure
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = "gemini-2.5-flash"; 

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { secretTag, difficultyTier } = req.body;

    // Validation
    if (!secretTag || !difficultyTier) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        // Use the modern SDK call
        const response = await client.models.generateContent({
            model: MODEL_NAME,
            contents: [{
                role: "user",
                parts: [{ 
                    text: `You are the Archivist of Moirai. Generate a story fragment. 
                           SECRET_TAG: ${secretTag}, Difficulty: ${difficultyTier}. 
                           Return ONLY valid JSON.` 
                }]
            }],
            config: {
                // The 2.5 models handle structured output natively
                responseMimeType: "application/json",
                responseSchema: {
                    type: "object",
                    properties: {
                        fragmentText: { type: "string" },
                        revelationText: { type: "string" }
                    },
                    required: ["fragmentText", "revelationText"]
                }
            }
        });

        // The response.text property in the new SDK is already a string
        const data = JSON.parse(response.text);
        return res.status(200).json(data);

    } catch (err) {
        console.error("GenAI Error:", err);
        return res.status(500).json({ 
            error: "Archivist AI failed to respond.", 
            details: err.message 
        });
    }
}
