// api/server.js (Refactored for Vercel Serverless)

import { GoogleGenAI } from '@google/genai';

// CRITICAL: Vercel loads environment variables automatically from the deployment settings.
const apiKey = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash';

if (!apiKey) {
    // This will show up in the Vercel logs if the environment variable is missing
    console.error("CRITICAL: GEMINI_API_KEY environment variable is not set!");
}

// Initialize the GenAI Client only if the key is available
const genai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Define the required JSON format (Kept outside the handler for performance)
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

// --- Main Handler Function for Vercel ---
// Vercel handles the request lifecycle. This function will be accessible at /api/server
export default async function handler(req, res) {
    // 1. Check for API Key configuration
    if (!genai) {
        return res.status(500).json({ error: "AI Service Not Configured: Missing GEMINI_API_KEY environment variable." });
    }

    // 2. Check for POST request
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method Not Allowed. Use POST." });
    }
    
    // 3. Destructure request body (Vercel automatically parses JSON)
    const { secretTag, difficultyTier } = req.body;

    if (!secretTag || !difficultyTier) {
        return res.status(400).json({ error: "Missing secretTag or difficultyTier in request body." });
    }

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

        const jsonText = response.text.trim();
        const data = JSON.parse(jsonText); 
        
        if (data && data.fragmentText && data.revelationText) {
            // Success response
            return res.status(200).json(data);
        } else {
            console.error("GenAI Response Error (Invalid JSON structure):", jsonText);
            return res.status(500).json({ error: "AI response format was invalid or unparsable." });
        }

    } catch (error) {
        console.error("GenAI API Error:", error.message);
        return res.status(500).json({ error: `GenAI API call failed: ${error.message}` });
    }
}
