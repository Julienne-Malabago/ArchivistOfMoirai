// api/generate-fragment.js

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv'; 

// IMPORTANT: dotenv.config() is for local development only. 
// On Vercel, the environment variables (like GEMINI_API_KEY) are read directly.
dotenv.config();

const app = express();

// --- GENAI Configuration ---
const apiKey = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash';

if (!apiKey) {
    // This will only run locally if the key is missing. Vercel handles this differently.
    console.error("CRITICAL: GEMINI_API_KEY is not set! Please set it in Vercel environment variables for production.");
    // We won't exit here, but the API calls will fail if the key is truly missing on Vercel.
}

// Initialize the GenAI Client
// Note: This will be initialized with an undefined key if running locally without a .env, but Vercel will inject the key.
const genai = new GoogleGenAI({ apiKey });

const allowedOrigins = [
    'http://localhost:5173',
    // Include your Vercel domain for good practice, although Vercel often handles this internally
    'https://archivistofmoirai.vercel.app', 
    'https://archivistofmoirai-8wn2sfrs1-seafoames-projects.vercel.app',
];

// --- Express Middleware ---
app.use(express.json());

// Configure CORS
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl) or if the origin is in the allowed list
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
// CRITICAL FIX: Route is changed from '/api/generate-fragment' to '/' 
// because the file itself is located at api/generate-fragment.js in Vercel's structure.
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
// CRITICAL FIX: Export the Express app object for Vercel to handle the request listening.
export default app;
