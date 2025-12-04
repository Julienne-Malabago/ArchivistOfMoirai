// server.js (Node/Express Backend using @google/genai)

// CHANGE 1: Use full dotenv import for explicit configuration
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv'; 

// CHANGE 2: Explicitly call config to ensure the .env file is loaded from the current working directory
dotenv.config();

const app = express();
// PORT CHANGE: Reverting to port 3001 as requested.
const PORT = process.env.PORT || 3001;

// --- GENAI Configuration ---
// Note: GenAI uses GEMINI_API_KEY environment variable by default, 
// but we'll manually set it for clarity if OPENAI_API_KEY was previously used.
const apiKey = process.env.GEMINI_API_KEY; 
const MODEL_NAME = 'gemini-2.5-flash';

if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY is not set in the .env file! Please set it and restart.");
    process.exit(1);
}

// Initialize the GenAI Client
const genai = new GoogleGenAI({ apiKey });

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:5177',
];

// --- Express Middleware ---

// CRITICAL FIX: Middleware to parse JSON request bodies. 
// Without this, req.body is undefined, causing the server to crash on POST requests.
app.use(express.json());

// Allow the React frontend (running on default Vite port 5173) to access the API
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
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
app.post('/api/generate-fragment', async (req, res) => {
    // req.body should now be populated thanks to app.use(express.json())
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

// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Ensure you have set GEMINI_API_KEY in your .env file.`);
});
