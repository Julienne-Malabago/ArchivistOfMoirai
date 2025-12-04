// api/generate-fragment.js

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv'; 

// Load environment variables for local development only. Vercel uses its dashboard settings.
dotenv.config();

const app = express();

// --- GENAI Configuration ---
const apiKey = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash';

if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY is not set! Ensure it is configured in your Vercel project environment variables.");
}

// Initialize the GenAI Client
const genai = new GoogleGenAI({ apiKey });

// Allowed origins for CORS (customize this list for your production setup)
const allowedOrigins = [
    'http://localhost:5173',
    // Add your Vercel production and preview domains here
    'https://archivistofmoirai.vercel.app', 
];

// --- Express Middleware ---
// CRITICAL: Middleware to parse JSON request bodies.
app.use(express.json());

// Configure CORS
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl) or if the origin is explicitly allowed
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(ao => origin.startsWith(ao))) {
            return callback(null, true);
        } else {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
    },
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
}));

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
// FIX: The route is set to '/' because Vercel maps the file path 
// 'api/generate-fragment.js' to the URL path '/api/generate-fragment'.
app.post('/', async (req, res) => {
    
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

        const jsonText = response.text.trim();
        const data = extractJson(jsonText);
        
        if (data && data.fragmentText && data.revelationText) {
            return res.json(data);
        } else {
            console.error("GenAI Response Error (Invalid JSON structure):", jsonText);
            return res.status(500).json({ error: "AI response format was invalid or unparsable." });
        }

    } catch (error) {
        console.error("GenAI API Error:", error.message);
        return res.status(500).json({ error: `GenAI API call failed: ${error.message}` });
    }
});

// --- Serverless Export ---
// Export the Express app object for Vercel to handle the serverless execution.
export default app;
