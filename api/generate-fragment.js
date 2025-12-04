// api/generate-fragment.js — Vercel Serverless Function
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

const MODEL_NAME = "gemini-2.5-flash";

// Extract JSON from text
function extractJson(text) {
    try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}") + 1;
        if (start !== -1 && end !== -1 && start < end) {
            const jsonString = text.substring(start, end);
            return JSON.parse(jsonString);
        }
    } catch (e) {
        console.error("Failed to parse JSON:", e);
    }
    return null;
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "GEMINI_API_KEY is missing from environment variables.",
        });
    }

    const genai = new GoogleGenAI({ apiKey });

    const { secretTag, difficultyTier } = req.body;

    if (!secretTag || !difficultyTier) {
        return res
            .status(400)
            .json({ error: "Missing secretTag or difficultyTier" });
    }

    // JSON schema
    const JSON_SCHEMA = {
        type: "object",
        properties: {
            fragmentText: { type: "string" },
            revelationText: { type: "string" },
        },
        required: ["fragmentText", "revelationText"],
    };

    // Prompt
    const prompt = `
        You are the Archivist of Moirai.
        SECRET_TAG: ${secretTag}
        DIFFICULTY: ${difficultyTier}
        Output ONLY a JSON object following the schema.
    `;

    try {
        const response = await genai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: JSON_SCHEMA,
                temperature: 0.8,
            },
        });

        const jsonText = response.text.trim();
        const data = extractJson(jsonText);

        if (!data) {
            console.error("Bad AI JSON:", jsonText);
            return res.status(500).json({ error: "Invalid AI JSON output" });
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error("GenAI Error:", err);
        return res.status(500).json({ error: err.message });
    }
}
