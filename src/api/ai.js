// src/api/ai.js

/**
 * @typedef {'FATE' | 'CHOICE' | 'CHANCE'} AxiomTag
 */

const API_ENDPOINT =
    import.meta.env.DEV
        ? "http://localhost:3001/api/generate-fragment"
        : `${window.location.origin}/api/generate-fragment`;


// Function to implement exponential backoff for retries
const exponentialBackoffFetch = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 && i < retries - 1) { // Rate limit
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
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
 * @param {string} genre The selected narrative setting (e.g., 'Noir', 'Sci-Fi').
 * @returns {Promise<{fragmentText: string, revelationText: string}>}
 */
export async function fetchFragmentFromAI(difficultyTier, secretTag, genre) {
    
    try {
        const response = await exponentialBackoffFetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                secretTag: secretTag,
                difficultyTier: difficultyTier,
                genre: genre, // This ensures the backend receives the user's choice
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ 
                error: 'Unknown server error', 
                details: 'No JSON body available' 
            }));
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
        throw new Error(`Failed to contact the Archivist AI. Details: ${error.message}`);
    }
}
