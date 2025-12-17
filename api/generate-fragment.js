import { GoogleGenerativeAI } from "@google/generative-ai"; // Correct package import
import * as dotenv from "dotenv";

dotenv.config();

// Use a valid model name
const MODEL_NAME = "gemini-1.5-flash"; 

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Server configuration error: GEMINI_API_KEY is missing." });
    }

    // 1. Initialize the SDK correctly
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 2. Get the model instance
    const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const { secretTag, difficultyTier } = req.body;

    const prompt = `
        You are the Archivist of Moirai. Generate a short story fragment.
        SECRET_TAG: ${secretTag}
        DIFFICULTY: ${difficultyTier}
        
        Return JSON with keys: "fragmentText" and "revelationText".
    `;

    try {
        // 3. Use the correct method: generateContent
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Since you set responseMimeType: "application/json", 
        // Gemini returns a string that is already valid JSON.
        const data = JSON.parse(text);

        return res.status(200).json(data);
    } catch (err) {
        console.error("GenAI API Error:", err);
        return res.status(500).json({
            error: `GenAI API call failed: ${err.message}`
        });
    }
}
