// src/api/ai.js

/**
 * @typedef {'FATE' | 'CHOICE' | 'CHANCE'} AxiomTag
 */

// The endpoint of your Node/Express server
const API_ENDPOINT = '/api/server.js';

// Function to implement exponential backoff for retries
const exponentialBackoffFetch = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 && i < retries - 1) { // Rate limit
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                // console.log(`Rate limit hit. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            return response;
        } catch (error) {
            // console.error(`Fetch attempt ${i + 1} failed:`, error);
            if (i === retries - 1) throw error;
            // Delay before next retry (for connection errors)
            const delay = Math.pow(2, i) * 1000 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("Failed to connect to the AI service after multiple retries.");
};


/**
 * Fetches a new story fragment and its revelation from the secured backend.
 * @param {number} difficultyTier The current game difficulty.
 * @param {AxiomTag} secretTag The true causal force to embed.
 * @returns {Promise<{fragmentText: string, revelationText: string}>}
 */
export async function fetchFragmentFromAI(difficultyTier, secretTag) {
    
    try {
        const response = await exponentialBackoffFetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                secretTag: secretTag,
                difficultyTier: difficultyTier,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: 'Unknown server error', details: 'No JSON body available' }));
            throw new Error(`Server Error (${response.status}): ${errorBody.error || response.statusText}`);
        }

        const data = await response.json();
        
        // Final structural check
        if (data.fragmentText && data.revelationText) {
            return {
                fragmentText: data.fragmentText,
                revelationText: data.revelationText,
            };
        } else {
            throw new Error("API returned an unexpected data structure. Check backend response format.");
        }
        
    } catch (error) {
        console.error("AI Service Fatal Error:", error);
        // Provide a user-friendly error message on the frontend
        throw new Error(`Failed to contact the Archivist AI. Please ensure the backend server (${API_ENDPOINT}) is running. Details: ${error.message}`);
    }
}
