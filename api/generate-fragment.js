// api/generate-fragment.js — Vercel Serverless Function
// =====================================================

// --- IMPORTS ---
// Full dotenv import for explicit configuration
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

// Explicitly load environment variables from .env in current working directory
dotenv.config();

const MODEL_NAME = "gemini-2.5-flash";
// --- CONSTANTS ---
const MODEL_NAME = "gemini-2.5-flash"; // The GenAI model to use

// Extract JSON from text
// --- HELPER FUNCTION ---
// Extract JSON object from a text string
function extractJson(text) {
try {
const start = text.indexOf("{");
@@ -15,75 +22,102 @@ function extractJson(text) {
const jsonString = text.substring(start, end);
return JSON.parse(jsonString);
}
    } catch (e) {
        console.error("Failed to parse JSON:", e);
    } catch (err) {
        console.error("Failed to parse JSON string:", text, err);
}
return null;
}

// --- SERVERLESS HANDLER ---
export default async function handler(req, res) {
    // --- METHOD CHECK ---
if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
        return res.status(405).json({ error: "Method Not Allowed. Only POST is supported." });
}

    // --- API KEY VALIDATION ---
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
        console.error("CRITICAL: GEMINI_API_KEY is not set in .env");
return res.status(500).json({
            error: "GEMINI_API_KEY is missing from environment variables.",
            error: "Server configuration error: GEMINI_API_KEY is missing."
});
}

    // --- INITIALIZE GENAI CLIENT ---
const genai = new GoogleGenAI({ apiKey });

    // --- REQUEST BODY VALIDATION ---
const { secretTag, difficultyTier } = req.body;

if (!secretTag || !difficultyTier) {
        return res
            .status(400)
            .json({ error: "Missing secretTag or difficultyTier" });
        return res.status(400).json({
            error: "Missing required fields: secretTag or difficultyTier"
        });
}

    // JSON schema
    // --- DEFINE JSON SCHEMA ---
    // Constrains the AI output to a strict JSON format
const JSON_SCHEMA = {
type: "object",
properties: {
            fragmentText: { type: "string" },
            revelationText: { type: "string" },
            fragmentText: {
                type: "string",
                description: "A short narrative fragment of about 100–150 words."
            },
            revelationText: {
                type: "string",
                description: "A concise explanation (1–2 sentences) of the Causal Force (SECRET_TAG) embedded in the fragment."
            }
},
        required: ["fragmentText", "revelationText"],
        required: ["fragmentText", "revelationText"]
};

    // Prompt
    // --- PROMPT CONSTRUCTION ---
    // Gives the AI clear instructions for output and style
const prompt = `
        You are the Archivist of Moirai.
        SECRET_TAG: ${secretTag}
        DIFFICULTY: ${difficultyTier}
        Output ONLY a JSON object following the schema.
        You are the Archivist of Moirai, a narrative AI.
        Your task is to generate a short story fragment based on a Difficulty Tier, 
        subtly embedding a Causal Force as SECRET_TAG.

        **Instructions:**
        1. The fragment must be subtle and engaging.
        2. SECRET_TAG: ${secretTag}.
        3. Difficulty Tier: ${difficultyTier}. Adjust subtlety and complexity accordingly.
        4. Output MUST be a JSON object following the provided JSON schema ONLY. 
           No extra text, markdown, or explanations outside the JSON.
   `;

try {
        // --- CALL GENAI API ---
const response = await genai.models.generateContent({
model: MODEL_NAME,
contents: prompt,
config: {
responseMimeType: "application/json",
responseSchema: JSON_SCHEMA,
temperature: 0.8,
            },
            }
});

        // --- PARSE AI RESPONSE ---
const jsonText = response.text.trim();
const data = extractJson(jsonText);

        if (!data) {
            console.error("Bad AI JSON:", jsonText);
            return res.status(500).json({ error: "Invalid AI JSON output" });
        // --- VALIDATE PARSED JSON ---
        if (data && data.fragmentText && data.revelationText) {
            return res.status(200).json(data);
        } else {
            console.error("Invalid AI JSON output:", jsonText);
            return res.status(500).json({
                error: "AI response was invalid or could not be parsed."
            });
}

        return res.status(200).json(data);
} catch (err) {
        console.error("GenAI Error:", err);
        return res.status(500).json({ error: err.message });
        // --- ERROR HANDLING ---
        console.error("GenAI API Error:", err);
        return res.status(500).json({
            error: `GenAI API call failed: ${err.message}`
        });
}
}
