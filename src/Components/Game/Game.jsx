setUserClassification(null);
setRevelationText(null);
setCurrentFragment("");

        // Calculate next attempt count (0 to 4 cycle)
        const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;
        
        // **FIX:** Use the setter form for totalRoundsPlayed to ensure it uses the latest value
        setAttemptCount(nextAttemptCount);
        if (nextAttemptCount === 0) {
             setTotalRoundsPlayed(prev => prev + 1);
        }

    
const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
const randomSecretTag = classifierOptions[Math.floor(Math.random() * classifierOptions.length)];

    
try {
            // --- 1. CALL API ---
            // This is the only line that can fail due to the 503 error
const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(effectiveDifficulty, randomSecretTag);
    
            // --- 2. SUCCESS: Apply State Updates (Only if API call succeeds) ---
            
            // Calculate next attempt count (0 to 4 cycle)
            const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;
            
            // **FIX IMPLEMENTED HERE:**
            // Set state only upon successful fragment generation.
            setAttemptCount(nextAttemptCount);
            if (nextAttemptCount === 0) {
                // Increment total rounds only when a full 5-attempt round cycle starts
                setTotalRoundsPlayed(prev => prev + 1);
            }
    
            // Set the new game data
setSecretTag(randomSecretTag);
setCurrentFragment(fragmentText);
setRevelationText(revText);
setGameState('playing');
            
} catch (error) {
            // --- 3. FAILURE: Do NOT Apply State Updates ---
            // attemptCount and totalRoundsPlayed remain at their previous values.
console.error("Fragment generation failed:", error);
setSecretTag("ERROR");
setRevelationText("Due to a system failure, the true causal force cannot be determined. Check console for details.");
setCurrentFragment("");
setGameState('error');
            // This will display the button to retry, which re-runs this function
            // without counting the failed attempt.
showAlert("AI Generation Error", error.message || String(error));
}
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions]); // Added classifierOptions dependency
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions]);

// --- Load User Stats & Session ---
useEffect(() => {
