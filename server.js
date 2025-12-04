// server.js (Refactored for Vercel Serverless)

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
// import * as dotenv from 'dotenv'; // REMOVE: Vercel loads environment vars automatically

// dotenv.config(); // REMOVE: Vercel loads environment vars automatically

const app = express();
// const PORT = process.env.PORT || 3001; // REMOVE: Vercel handles the port

// --- GENAI Configuration ---
// Vercel loads GEMINI_API_KEY from environment variables configured in the dashboard.
const apiKey = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash';

if (!apiKey) {
    // Vercel deployment will log this error if the environment variable is missing
    console.error("CRITICAL: GEMINI_API_KEY environment variable is not set!");
    // We do not call process.exit(1) in a serverless function, just log and handle the error.
}

// Initialize the GenAI Client (only if key is present)
const genai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Allow all origins when deployed on Vercel, as the frontend will be on the same domain.
// During local development, the frontend may still need specific localhost:port allowed.
// For Vercel deployment, we simplify this.
app.use(cors());

// --- Express Middleware ---

// Middleware to parse JSON request bodies.
app.use(express.json());

// --- Helper Function to Extract JSON from Text ---
function extractJson(text) {
    try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        if (start !== -1 && end !== -1 && start < end) {
            const jsonString = text.substring(start, end);
            return JSON.parse(jsonString);
        }
    } catch (e) {
        console.error("Failed to parse JSON string:", text.trim(), e);
    }
    return null;
}

// --- API Route: Generate Fragment ---
// The route remains /api/generate-fragment
app.post('/api/generate-fragment', async (req, res) => {
    // Check for API Key configuration
    if (!genai) {
        return res.status(500).json({ error: "AI Service Not Configured: Missing GEMINI_API_KEY environment variable." });
    }
    
    const { secretTag, difficultyTier } = req.body;

    if (!secretTag || !difficultyTier) {
        return res.status(400).json({ error: "Missing secretTag or difficultyTier in request body." });
    }

    // Define the required JSON format and constraint the model's output
    const JSON_SCHEMA = {
        type: "object",
        properties: {
            fragmentText: {
                type: "string",
                description: "A short, engaging story fragment about 100-150 words long."
            },
            revelationText: {
                type: "string",
                description: "The detailed explanation (1-2 sentences) of why the Causal Force is the SECRET_TAG. This must justify the SECRET_TAG based on the fragment."
            }
        },
        required: ["fragmentText", "revelationText"]
    };

    const prompt = `
        You are the Archivist of Moirai, a philosophical AI that generates short narrative fragments.
        Your task is to write a single narrative fragment based on the requested Difficulty Tier and secretly embed a Causal Force.

        **Instructions:**
        1. The fragment must be subtle and ambiguous.
        2. The true Causal Force must be hidden, but logically justifiable.
        3. The SECRET_TAG for this fragment is: ${secretTag}.
        4. The current difficulty is Tier ${difficultyTier}. Increase the subtlety and complexity of the writing style for higher tiers.
        5. **Your output MUST be a single JSON object that strictly adheres to the provided JSON Schema.** DO NOT include any text, markdown formatting, or explanations outside the JSON block.
    `;

    try {
        const response = await genai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: JSON_SCHEMA,
                temperature: 0.8,
            }
        });

        // GenAI with JSON mode should return a parsable JSON string in the text response
        const jsonText = response.text.trim();
        const data = extractJson(jsonText);
        
        if (data && data.fragmentText && data.revelationText) {
            return res.status(200).json(data);
        } else {
            console.error("GenAI Response Error (Invalid JSON structure):", jsonText);
            return res.status(500).json({ error: "AI response format was invalid or unparsable." });
        }

    } catch (error) {
        console.error("GenAI API Error:", error.message);
        return res.status(500).json({ error: `GenAI API call failed: ${error.message}` });
    }
});

// --- CRITICAL CHANGE: REMOVE app.listen(...) AND EXPORT THE APP ---
// app.listen(PORT, ...) block removed.

export default app;
