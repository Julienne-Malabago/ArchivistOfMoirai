// api/generate-fragment.js (REPLACE server.js content)

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv'; 

// IMPORTANT: Vercel serverless environment variables must be set in the Vercel dashboard,
// but keeping dotenv config for local testing is fine. Vercel ignores the .env file.
dotenv.config();

const app = express();
// REMOVE: const PORT = process.env.PORT || 3001;
// REMOVE: app.listen(...)

// ... (Keep the rest of your imports and configuration: GenAI setup, allowedOrigins, extractJson) ...

// --- Express Middleware ---
app.use(express.json());
app.use(cors({
    // ... your CORS configuration ...
}));

// --- API Route: Generate Fragment ---
// CRITICAL: The route path should now be `/` since the file itself is `/api/generate-fragment`
app.post('/', async (req, res) => {
    // ... (Keep the content of your original app.post('/api/generate-fragment', ...) handler) ...
    const { secretTag, difficultyTier } = req.body;
    // ... (The rest of the AI logic) ...
});


// Export the Express app for Vercel to use as a serverless function
// NOTE: Depending on your project structure, this might need to be `module.exports = app`
export default app;
