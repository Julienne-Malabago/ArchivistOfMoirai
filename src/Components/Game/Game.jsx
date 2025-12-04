import React, { useState, useEffect, useCallback } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constant for the Session Storage key
const GAME_SESSION_KEY = "moirai_game_session"; 

// Component for the main game interface
export function Game({ user, onSignOut }) {
    // --- State for User Stats & Game Metrics ---
    const [stats, setStats] = useState({
        username: 'The Archivist',
        currentScore: 0,
        currentStreak: 0,
        highestStreak: 0,
        difficultyTier: 1,
        highestScore: 0, 
        totalCorrect: 0,
        totalIncorrect: 0,
    });

    // --- State for the Game Round ---
    const [gameState, setGameState] = useState('loading'); // 'loading', 'playing', 'revealing', 'error', 'ready_to_start'
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null); // 'FATE', 'CHOICE', 'CHANCE'
    const [secretTag, setSecretTag] = useState(null); // The true answer
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null); // For displaying API errors
    
    // Attempt Counter State (5 attempts = 1 round)
    const [attemptCount, setAttemptCount] = useState(0); 
    // Total Rounds Played State (A round is 5 attempts)
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);

    // Tracks if the user has loaded their profile but hasn't started the first round.
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // NEW STATE: Tracks if a previous session was found on load.
    const [isSessionActive, setIsSessionActive] = useState(false); 

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];

    // Utility function to show an alert box (replacing the native alert())
    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);
    
    // --- DERIVED VALUE: Calculate Accuracy Rate ---
    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0 
        ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
        : 'N/A';
    // ---------------------------------------------


    // --- FUNCTION: Start a New Game Round / Attempt ---
    const startNewRound = useCallback(async (currentDifficulty) => {
        setGameState('loading');
        setErrorMessage(null); // Clear previous errors
        setUserClassification(null);
        setRevelationText(null);
        setCurrentFragment(""); // Ensure fragment is clear during loading
        
        // **Round & Attempt Increment Logic**
        const nextAttemptCount = (attemptCount + 1) % 5;

        // If the NEW index is 0, it means the previous fragment was the 5th attempt.
        if (nextAttemptCount === 0) {
            setTotalRoundsPlayed(prevCount => prevCount + 1);
        }
        
        // 3. Update the attempt count state
        setAttemptCount(nextAttemptCount); // State is now 1 for first attempt, or 0 after 5th attempt

        // Use the passed difficulty, or fallback to state
        const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
        
        // 4. Determine the secret tag randomly
        const tags = ['FATE', 'CHOICE', 'CHANCE'];
        const randomSecretTag = tags[Math.floor(Math.random() * tags.length)];
        
        // 5. Call the REAL AI utility function
        try {
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(effectiveDifficulty, randomSecretTag);

            // 6. Update state to start playing
            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
        } catch (error) {
            console.error("Fragment generation failed:", error);
            // Set a dummy error state for the revelation panel
            setSecretTag("ERROR"); 
            setRevelationText("Due to a system failure, the true causal force cannot be determined. Please ensure your backend server is running and your API key is valid. Check console for details.");

            setCurrentFragment("");
            
            setGameState('error');
            showAlert("AI Generation Error", error.message);
        }
    }, [stats.difficultyTier, showAlert, attemptCount]);


    // --- FUNCTION: Update Stats in Firestore ---
    const updateStatsInDb = useCallback(async (newStats) => {
        const userDocRef = doc(db, "users", user.uid);
        try {
            await updateDoc(userDocRef, {
                currentScore: newStats.currentScore,
                currentStreak: newStats.currentStreak,
                highestStreak: newStats.highestStreak,
                difficultyTier: newStats.difficultyTier,
                highestScore: newStats.highestScore,
                // Ensure we save the updated totalRoundsPlayed
                totalRoundsPlayed: totalRoundsPlayed, 
                totalCorrect: newStats.totalCorrect,
                totalIncorrect: newStats.totalIncorrect,
            });
            console.log("Stats successfully updated in Firestore.");
        } catch (error) {
            console.error("Error updating stats in Firestore:", error);
        }
    }, [user.uid, totalRoundsPlayed]);

    // --- EFFECT: Load User Stats & Check Session Storage on Mount ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
            setGameState('loading');
            if (!user) return;

            const userDocRef = doc(db, "users", user.uid);
            let permanentStats = {}; // To hold Firestore data

            try {
                // 1. Fetch PERMANENT user stats from Firestore
                const docSnap = await getDoc(userDocRef);
                if (docSnap.exists()) {
                    permanentStats = docSnap.data();
                    
                    // Load the correct total rounds played
                    const initialTotalRounds = permanentStats.totalRoundsPlayed || 0;
                    setTotalRoundsPlayed(initialTotalRounds);

                    // Set initial permanent stats (currentScore/Streak are reset on login)
                    setStats(s => ({
                        ...s,
                        username: permanentStats.username || 'The Archivist',
                        currentScore: 0, 
                        currentStreak: 0,
                        highestStreak: permanentStats.highestStreak || 0,
                        difficultyTier: permanentStats.difficultyTier || 1,
                        highestScore: permanentStats.highestScore || 0,
                        totalCorrect: permanentStats.totalCorrect || 0,
                        totalIncorrect: permanentStats.totalIncorrect || 0,
                    }));
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                showAlert("Data Error", "Could not load user progress from the Archives.");
                setGameState('error');
                return;
            }

            // 2. Check TEMPORARY game state from Session Storage
            const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
            let sessionFound = false;

            if (storedSession) {
                try {
                    const sessionData = JSON.parse(storedSession);

                    // Check if the session belongs to the current user
                    if (sessionData.userId === user.uid) {
                        sessionFound = true;
                        
                        // Load the temporary states (overriding currentScore/Streak from Firestore)
                        setStats(prevStats => ({
                            ...prevStats,
                            currentScore: sessionData.currentScore,
                            currentStreak: sessionData.currentStreak,
                            difficultyTier: sessionData.difficultyTier,
                            // Highest stats take the greater value between permanent (Firestore) and temporary (Session)
                            highestStreak: Math.max(permanentStats.highestStreak || 0, sessionData.highestStreak),
                            highestScore: Math.max(permanentStats.highestScore || 0, sessionData.highestScore),
                            // Total Correct/Incorrect are permanent, and don't change until updateStatsInDb
                        }));
                        setAttemptCount(sessionData.attemptCount);
                        setTotalRoundsPlayed(sessionData.totalRoundsPlayed);
                        
                        // Set the flag to prompt the user
                        setIsSessionActive(true);
                    } else {
                        // Session exists, but belongs to a different user, so clear it
                        sessionStorage.removeItem(GAME_SESSION_KEY);
                    }
                } catch (e) {
                    console.error("Error parsing session data:", e);
                    sessionStorage.removeItem(GAME_SESSION_KEY); // Clear invalid session
                }
            }

            // 3. Complete Initial Load
            setInitialLoadComplete(true);
            // If NO session was found, set to 'ready_to_start'.
            if (!sessionFound) {
                setGameState('ready_to_start');
            }
        };

        fetchUserDataAndSession();
    }, [user, showAlert]);

    // --- EFFECT: Persist Game State to Session Storage ---
    useEffect(() => {
        // Only save if the user is logged in and the game is active
        if (user && (gameState === 'playing' || gameState === 'revealing')) {
            const sessionData = {
                userId: user.uid,
                // Game State
                currentFragment: currentFragment,
                secretTag: secretTag,
                revelationText: revelationText,
                gameState: gameState,
                
                // Core Metrics
                attemptCount: attemptCount,
                totalRoundsPlayed: totalRoundsPlayed,
                
                // Temporary/Highest Stats
                currentScore: stats.currentScore,
                currentStreak: stats.currentStreak,
                difficultyTier: stats.difficultyTier,
                highestScore: stats.highestScore,
                highestStreak: stats.highestStreak,
            };
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(sessionData));
        }
    }, [
        user, gameState, currentFragment, secretTag, revelationText, 
        attemptCount, totalRoundsPlayed, stats.currentScore, stats.currentStreak, 
        stats.difficultyTier, stats.highestScore, stats.highestStreak
    ]);


    // --- SESSION HANDLERS ---
    const resumeSession = () => {
        const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
        if (!storedSession) {
            startNewGame(); // Fallback if storage cleared somehow
            return;
        }
        
        const sessionData = JSON.parse(storedSession);

        // Re-load the fragment/tags
        setCurrentFragment(sessionData.currentFragment);
        setSecretTag(sessionData.secretTag);
        setRevelationText(sessionData.revelationText);
        
        // Set the game state back to where it was (playing or revealing)
        setGameState(sessionData.gameState); 
        
        // Clear the active session flag
        setIsSessionActive(false);
    };

    const startNewGame = () => {
        // 1. Clear the session storage
        sessionStorage.removeItem(GAME_SESSION_KEY);
        
        // 2. Reset temporary local stats (permanent stats like highestScore are retained from initial load)
        setStats(prevStats => ({
            ...prevStats,
            currentScore: 0, 
            currentStreak: 0,
        }));
        
        // 3. Reset game metrics
        setAttemptCount(0);
        
        // 4. Start the first round
        setInitialLoadComplete(true);
        setIsSessionActive(false); // Clear the active session flag
        setGameState('ready_to_start'); // Move to the initial start button
    };

    // --- HANDLER: User Classifies the Fragment ---
    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;

        setUserClassification(choice); // Record the user's choice
        setGameState('revealing'); // Enter the revelation phase

        const isCorrect = choice === secretTag;
        
        let newStats = { ...stats };
        let promotionMessage = null;
        
        if (isCorrect) {
            // Correct Logic: Increment Score, Streak, and Total Correct
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1; // Increment Total Correct
            
            // Update Highest Streak
            if (newStats.currentStreak > newStats.highestStreak) {
                newStats.highestStreak = newStats.currentStreak;
            }
            
            // Update Highest Score
            if (newStats.currentScore > newStats.highestScore) {
                newStats.highestScore = newStats.currentScore;
            }
            
            // Difficulty Scaling Logic: Every 5 consecutive correct answers
            if (newStats.currentStreak % 5 === 0) {
                newStats.difficultyTier += 1;
                promotionMessage = `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}. Prepare for greater subtlety!`;
            }

        } else {
            // Incorrect Logic: Reset Streak and Increment Total Incorrect
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1; // Increment Total Incorrect
        }
        
        setStats(newStats); // Update local state
        updateStatsInDb(newStats); // Update Firestore

        if (promotionMessage) {
            showAlert("Promotion Achieved", promotionMessage);
        }
    }
    
    // --- Custom Sign Out Handler to reset current score/streak before executing original sign out ---
    const handleSignOut = useCallback(async () => {
        // Clear session storage before signing out
        sessionStorage.removeItem(GAME_SESSION_KEY);

        // Prepare final stats for saving, ensuring currentScore and currentStreak are 0
        const finalStats = {
            ...stats,
            currentScore: 0,
            currentStreak: 0,
        };
        
        // Save the final stats to Firestore
        await updateStatsInDb(finalStats);
        
        // Reset local round/attempt states on sign-out for clean re-login
        setAttemptCount(0); 
        setTotalRoundsPlayed(0);

        // Execute the original sign out function
        onSignOut();
    }, [stats, onSignOut, updateStatsInDb]);


    // --- RENDER LOGIC: Loading/Waiting State ---
    if (gameState === 'loading' && !initialLoadComplete) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="loading-spinner">
                    <p>Accessing the Archives and Loading User Profile...</p>
                </div>
            </div>
        );
    }
    
    // --- RENDER LOGIC: Session Resume Prompt ---
    if (isSessionActive) {
        // Calculate the 1-based attempt count for display (1-5)
        const displayAttemptCount = attemptCount === 0 ? 5 : attemptCount;

        return (
            <div className="game-container fullscreen-layout">
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content session-prompt">
                        <h3>Archival Session Detected ⏳</h3>
                        <p>A previous game session was found for **{stats.username}** (Attempt **{displayAttemptCount}/5**). </p>
                        <p>Would you like to resume, or start a new game (resetting current score and streak)?</p>
                        <div className="button-group">
                            <button onClick={resumeSession} className="button-primary">
                                Resume Session
                            </button>
                            <button onClick={startNewGame} className="button-primary button-danger">
                                Start New Game
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Calculate the 1-based attempt count for display (1-5)
    // If attemptCount is 0, it means the state was just reset from 4 (after the 5th attempt), OR it's the initial load.
    const displayAttemptCount = attemptCount === 0 ? 5 : attemptCount;

    // --- RENDER LOGIC: Initial Start Button (New State) ---
    if (gameState === 'ready_to_start') {
        return (
            <div className="game-container">
                <header className="game-header ribbon-layout">
                    <div className="header-left ribbon-left">
                        <div className="title-block">
                            <span className="star-icon">✨</span>
                            <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                        </div>
                        <div className="user-info-block">
                            <p className="welcome-text">Username: **{stats.username}**</p>
                            <p className="user-id">User ID: {user.uid.substring(0, 20)}...</p>
                        </div>
                    </div>
                    <div className="header-right ribbon-right">
                        <span className="sign-out-link button-primary" onClick={handleSignOut}>
                            Log Out
                        </span>
                    </div>
                </header>
                
                <div className="metrics-tally">
                    <div className="metric">
                        <span className="metric-icon">#</span>
                        <p className="metric-label">Total Rounds:</p>
                        <p className="metric-value">{totalRoundsPlayed}</p>
                    </div>
                    <div className="metric">
                        <span className="metric-icon">⭐</span>
                        <p className="metric-label">Highest Score:</p>
                        <p className="metric-value">{stats.highestScore}</p>
                    </div>
                    <div className="metric">
                        <span className="metric-icon">🏆</span>
                        <p className="metric-label">Highest Streak:</p>
                        <p className="metric-value">{stats.highestStreak}</p>
                    </div>
                    <div className="metric">
                        <span className="metric-icon"> tier</span>
                        <p className="metric-label">Difficulty Tier:</p>
                        <p className="metric-value">{stats.difficultyTier}</p>
                    </div>
                    {/* NEW: Total Correct, Total Incorrect, Accuracy */}
                    <div className="metric">
                        <span className="metric-icon">✅</span>
                        <p className="metric-label">Total Correct:</p>
                        <p className="metric-value">{stats.totalCorrect}</p>
                    </div>
                    <div className="metric">
                        <span className="metric-icon">❌</span>
                        <p className="metric-label">Total Incorrect:</p>
                        <p className="metric-value">{stats.totalIncorrect}</p>
                    </div>
                    <div className="metric">
                        <span className="metric-icon">💯</span>
                        <p className="metric-label">Accuracy:</p>
                        <p className="metric-value">{accuracyRate}%</p>
                    </div>
                </div>
                
                <div className="archival-scroll start-message">
                    <h3 className="scroll-title">Archivist Login Complete</h3>
                    <p className="scroll-fragment">
                        Your profile is loaded, Archivist **{stats.username}**.
                        The next fragment awaits classification at Difficulty Tier **{stats.difficultyTier}**.
                    </p>
                </div>

                <div className="classifier-buttons start-round-container">
                    <button
                        className="button-primary begin-round-button"
                        onClick={() => {
                            setInitialLoadComplete(true);
                            startNewRound(stats.difficultyTier);
                        }}
                    >
                        Begin First Round (Generate Fragment)
                    </button>
                </div>
            </div>
        );
    }
    
    // --- RENDER LOGIC: Main Game UI ---
    return (
        <div className="game-container">

            {/* Custom Error/Alert Modal */}
            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setErrorMessage(null)} className="button-primary">Acknowledge</button>
                    </div>
                </div>
            )}

            {/* Header: Title and User Info */}
            <header className="game-header ribbon-layout">
                <div className="header-left ribbon-left">
                    <div className="title-block">
                        <span className="star-icon">✨</span>
                        <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                    </div>
                    <div className="user-info-block">
                        <p className="welcome-text">Username: **{stats.username}**</p>
                        <p className="user-id">User ID: {user.uid.substring(0, 20)}...</p>
                    </div>
                </div>
                <div className="header-right ribbon-right">
                    <span className="sign-out-link button-primary" onClick={handleSignOut}>
                        Log Out
                    </span>
                </div>
            </header>

            {/* Metrics Tally */}
            <div className="metrics-tally">
                <div className="metric">
                    <span className="metric-icon">#</span>
                    <p className="metric-label">Total Rounds:</p>
                    <p className="metric-value">{totalRoundsPlayed}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🎯</span>
                    <p className="metric-label">Round Attempts:</p>
                    <p className="metric-value">{displayAttemptCount} / 5</p> 
                </div>
                <div className="metric">
                    <span className="metric-icon">⚡</span>
                    <p className="metric-label">Current Score:</p>
                    <p className="metric-value">{stats.currentScore}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">⭐</span>
                    <p className="metric-label">Highest Score:</p>
                    <p className="metric-value">{stats.highestScore}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">❤</span>
                    <p className="metric-label">Current Streak:</p>
                    <p className="metric-value">{stats.currentStreak}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🏆</span>
                    <p className="metric-label">Highest Streak:</p>
                    <p className="metric-value">{stats.highestStreak}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon"> tier</span>
                    <p className="metric-label">Difficulty Tier:</p>
                    <p className="metric-value">{stats.difficultyTier}</p>
                </div>
                {/* NEW METRICS */}
                <div className="metric">
                    <span className="metric-icon">✅</span>
                    <p className="metric-label">Total Correct:</p>
                    <p className="metric-value">{stats.totalCorrect}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">❌</span>
                    <p className="metric-label">Total Incorrect:</p>
                    <p className="metric-value">{stats.totalIncorrect}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">💯</span>
                    <p className="metric-label">Accuracy:</p>
                    <p className="metric-value">{accuracyRate}%</p>
                </div>
            </div>

            {/* The Archival Scroll (Fragment Display) */}
            <div className="archival-scroll">
                <h3 className="scroll-title">The Archival Scroll (Fragment)</h3>
                <p className="scroll-fragment">
                    {(gameState === 'loading' || gameState === 'error')
                        ? "Accessing the Archival Stream..."
                        : currentFragment
                    }
                </p>
            </div>

            {/* The Classifier (Buttons) */}
            <div className="classifier">
                <h3 className="classifier-title">Classify the Causal Force:</h3>
                <div className="classifier-buttons">
                    {classifierOptions.map(option => (
                        <button
                            key={option}
                            className={`classifier-button ${userClassification === option ? 'selected' : ''}`}
                            onClick={() => handleClassification(option)}
                            disabled={gameState === 'revealing' || gameState === 'error' || gameState === 'loading'}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </div>

            {/* The Revelation Panel (Modal/Overlay) */}
            {(gameState === 'revealing' || gameState === 'error') && (
                <div className="revelation-overlay">
                    <div className="revelation-panel">
                        <h2 className={`revelation-header ${userClassification === secretTag ? 'correct' : 'incorrect'}`}>
                            {gameState === 'error'
                                ? '🛑 System Interruption'
                                : userClassification === secretTag
                                        ? '✅ Axiom Confirmed: Correct Classification'
                                        : '❌ Axiom Error: Narrative Deception Successful'
                            }
                        </h2>
                        
                        <div className="revelation-text-box">
                            <p className="revelation-focus">
                                The **True Causal Force** in this Fragment was: **{secretTag}**
                            </p>
                            <hr/>
                            <p className="revelation-justification">
                                **Revelation Text:** {revelationText}
                            </p>
                        </div>

                        <button
                            className="button-primary continue-button"
                            onClick={() => startNewRound(stats.difficultyTier)}
                        >
                            Continue to Next Fragment
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}