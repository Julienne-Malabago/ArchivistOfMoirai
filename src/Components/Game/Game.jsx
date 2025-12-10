import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constant for the Session Storage key
const GAME_SESSION_KEY = "moirai_game_session";

export function Game({ user, onSignOut }) {
    // --- Game & User Stats ---
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

    const [gameState, setGameState] = useState('loading'); // 'loading', 'playing', 'revealing', 'error', 'ready_to_start'
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    // attemptCount is 0-indexed (0 to 4) for the 5 attempts in a round.
    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);

    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);

    // --- Edit Profile ---
    const [newUsername, setNewUsername] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const dropdownRef = useRef(null);

    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0
        ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
        : 'N/A';

    // **FIX 1: Corrected Display Attempt Count Logic**
    // 0 -> 1, 1 -> 2, ..., 4 -> 5. This resolves the NAN/5 display issue.
    const displayAttemptCount = attemptCount + 1; 

    // --- Close dropdown on outside click ---
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setProfileDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- Update Stats in Firestore ---
    // **FIX 2: Passed totalRoundsPlayed as an argument for accurate update**
    const updateStatsInDb = useCallback(async (newStats, roundsPlayed) => {
        if (!user || !user.uid) return;
        const userDocRef = doc(db, "users", user.uid);
        try {
            await updateDoc(userDocRef, {
                currentScore: newStats.currentScore,
                currentStreak: newStats.currentStreak,
                highestStreak: newStats.highestStreak,
                difficultyTier: newStats.difficultyTier,
                highestScore: newStats.highestScore,
                totalRoundsPlayed: roundsPlayed, // Use the passed argument
                totalCorrect: newStats.totalCorrect,
                totalIncorrect: newStats.totalIncorrect,
            });
        } catch (error) {
            console.error("Error updating stats in Firestore:", error);
        }
    }, [user]); // Removed totalRoundsPlayed from dependencies to avoid stale closures, using argument instead.

    // --- Start New Round ---
    const startNewRound = useCallback(async (currentDifficulty) => {
        setGameState('loading');
        setErrorMessage(null);
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
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(effectiveDifficulty, randomSecretTag);
            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
        } catch (error) {
            console.error("Fragment generation failed:", error);
            setSecretTag("ERROR");
            setRevelationText("Due to a system failure, the true causal force cannot be determined. Check console for details.");
            setCurrentFragment("");
            setGameState('error');
            showAlert("AI Generation Error", error.message || String(error));
        }
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions]); // Added classifierOptions dependency

    // --- Load User Stats & Session ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
            setGameState('loading');
            if (!user) return;

            const userDocRef = doc(db, "users", user.uid);
            let permanentStats = {};
            let sessionFound = false;
            
            // 1. Fetch Permanent Stats from DB
            try {
                const docSnap = await getDoc(userDocRef);
                if (docSnap.exists()) {
                    permanentStats = docSnap.data();
                    const dbRoundsPlayed = permanentStats.totalRoundsPlayed || 0;
                    setTotalRoundsPlayed(dbRoundsPlayed);
                    
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
                    setAttemptCount(0); // Reset attempt count on initial load/login
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                showAlert("Data Error", "Could not load user progress from the Archives.");
                setGameState('error');
                setInitialLoadComplete(true);
                return;
            }

            // 2. Check Session Storage
            const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
            if (storedSession) {
                try {
                    const sessionData = JSON.parse(storedSession);
                    if (sessionData.userId === user.uid) {
                        sessionFound = true;
                        setStats(prevStats => ({
                            ...prevStats,
                            currentScore: sessionData.currentScore,
                            currentStreak: sessionData.currentStreak,
                            difficultyTier: sessionData.difficultyTier,
                            highestStreak: Math.max(permanentStats.highestStreak || 0, sessionData.highestStreak),
                            highestScore: Math.max(permanentStats.highestScore || 0, sessionData.highestScore),
                        }));
                        setAttemptCount(sessionData.attemptCount);
                        setTotalRoundsPlayed(sessionData.totalRoundsPlayed);
                        setIsSessionActive(true);
                    } else {
                        sessionStorage.removeItem(GAME_SESSION_KEY);
                    }
                } catch (e) {
                    console.error("Error parsing session data:", e);
                    sessionStorage.removeItem(GAME_SESSION_KEY);
                }
            }

            setInitialLoadComplete(true);
            if (!sessionFound) setGameState('ready_to_start');
        };

        fetchUserDataAndSession();
    }, [user, showAlert]);

    // --- Persist Game State ---
    useEffect(() => {
        if (user && (gameState === 'playing' || gameState === 'revealing')) {
            const sessionData = {
                userId: user.uid,
                currentFragment,
                secretTag,
                revelationText,
                gameState,
                attemptCount,
                totalRoundsPlayed,
                currentScore: stats.currentScore,
                currentStreak: stats.currentStreak,
                difficultyTier: stats.difficultyTier,
                highestScore: stats.highestScore,
                highestStreak: stats.highestStreak,
            };
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(sessionData));
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats]);

    // --- Resume or Start New Session ---
    const resumeSession = () => {
        const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
        if (!storedSession) { startNewGame(); return; }
        const sessionData = JSON.parse(storedSession);
        
        // Restore state values
        setCurrentFragment(sessionData.currentFragment);
        setSecretTag(sessionData.secretTag);
        setRevelationText(sessionData.revelationText);
        setGameState(sessionData.gameState);
        setAttemptCount(sessionData.attemptCount);
        setTotalRoundsPlayed(sessionData.totalRoundsPlayed);

        // Restore stats (including session-specific high/streak which maxed out permanent ones on load)
        setStats(prevStats => ({
            ...prevStats,
            currentScore: sessionData.currentScore,
            currentStreak: sessionData.currentStreak,
            difficultyTier: sessionData.difficultyTier,
            highestScore: sessionData.highestScore,
            highestStreak: sessionData.highestStreak,
        }));
        
        setIsSessionActive(false); 
    };

    const startNewGame = () => {
        sessionStorage.removeItem(GAME_SESSION_KEY);
        
        // Preserve permanent stats (totals/highest), reset session stats
        setStats(prev => ({ 
            ...prev, 
            currentScore: 0, 
            currentStreak: 0,
        }));
        
        // Reset counters and state
        setAttemptCount(0);
        setIsSessionActive(false);
        setGameState('ready_to_start');
    };

    // --- Classification Handler ---
    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;
        setUserClassification(choice);
        setGameState('revealing');

        const isCorrect = choice === secretTag;
        let newStats = { ...stats };
        let promotionMessage = null;
        let currentRounds = totalRoundsPlayed;

        if (isCorrect) {
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1;
            if (newStats.currentStreak > newStats.highestStreak) newStats.highestStreak = newStats.currentStreak;
            if (newStats.currentScore > newStats.highestScore) newStats.highestScore = newStats.currentScore;
            
            if (newStats.currentStreak > 0 && newStats.currentStreak % 5 === 0) {
                newStats.difficultyTier += 1;
                promotionMessage = `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}. Prepare for greater subtlety!`;
            }
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        // **FIX: Update state and DB with correct totalRoundsPlayed**
        // If the current attempt was the 5th attempt (index 4), the round just ended, 
        // but totalRoundsPlayed state was already updated in startNewRound when the *next* round started.
        // We use the current state value of totalRoundsPlayed here.
        
        setStats(newStats);
        updateStatsInDb(newStats, currentRounds);

        if (promotionMessage) showAlert("Promotion Achieved", promotionMessage);
    };

    // --- Sign Out ---
    const handleSignOut = useCallback(async () => {
        sessionStorage.removeItem(GAME_SESSION_KEY);
        const finalStats = { ...stats, currentScore: 0, currentStreak: 0 };
        // Pass current totalRoundsPlayed to ensure persistence before sign out
        await updateStatsInDb(finalStats, totalRoundsPlayed); 
        setAttemptCount(0);
        setTotalRoundsPlayed(0);
        onSignOut();
    }, [stats, onSignOut, updateStatsInDb, totalRoundsPlayed]);

    // --- Edit Profile Handlers ---
    const handleUsernameChange = async () => {
        if (!newUsername.trim()) { showAlert("Invalid Username", "Please enter a valid username."); return; }
        try {
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, { username: newUsername.trim() });
            setStats(prev => ({ ...prev, username: newUsername.trim() }));
            setEditProfileOpen(false);
            showAlert("Username Updated", "Your username has been successfully updated.");
        } catch (e) { console.error("Error updating username:", e); showAlert("Error", "Failed to update username."); }
    };

    const handlePasswordChange = async () => {
        if (!currentPassword || !newPassword || newPassword !== confirmNewPassword) {
            showAlert("Password Error", "Passwords do not match or fields are empty.");
            return;
        }
        try {
            // Reauthenticate first (this uses the pattern you had in your code)
            const credential = auth.EmailAuthProvider.credential(user.email, currentPassword);
            // This line assumes you have imported Firebase 'auth' object correctly.
            await auth.currentUser.reauthenticateWithCredential(credential); 
            await auth.currentUser.updatePassword(newPassword);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmNewPassword("");
            setEditProfileOpen(false);
            showAlert("Password Changed", "Your password has been successfully updated.");
        } catch (e) { console.error("Password change failed:", e); showAlert("Password Change Failed", e.message); }
    };

    // --- Dropdown styles (kept inline for animation & immediate visual) ---
    const dropdownStyles = {
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        background: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '1rem',
        minWidth: '220px',
        zIndex: 50,
        boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
        color: '#fff',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: profileDropdownOpen ? 1 : 0,
        transform: profileDropdownOpen ? 'translateY(0)' : 'translateY(-10px)',
        pointerEvents: profileDropdownOpen ? 'auto' : 'none'
    };

    const dropdownButtonStyles = {
        display: 'block',
        width: '100%',
        marginBottom: '0.5rem',
        background: '#222',
        color: '#fff',
        border: 'none',
        padding: '0.5rem 0.75rem',
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'background 0.2s',
    };

    // --- Render Logic ---

    if (gameState === 'loading' && !initialLoadComplete) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="loading-spinner">
                    <p>Accessing the Archives and Loading User Profile...</p>
                </div>
            </div>
        );
    }

    // Session modal from original code (kept)
    if (isSessionActive) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content session-prompt">
                        <h3>Archival Session Detected ⏳</h3>
                        <p>A previous game session was found for {stats.username} (Attempt {displayAttemptCount}/5).</p>
                        <p>Would you like to resume, or start a new game (resetting current score and streak)?</p>
                        <div className="button-group">
                            <button onClick={resumeSession} className="button-primary">Resume Session</button>
                            <button onClick={startNewGame} className="button-primary button-danger">Start New Game</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- Main Render ---
    return (
        <div className="game-container">
            {/* Error Modal */}
            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setErrorMessage(null)} className="button-primary">Acknowledge</button>
                    </div>
                </div>
            )}

            {/* Header (ribbon + dropdown) */}
            <header className="game-header ribbon-layout" style={{ position: 'relative' }}>
                <div className="header-left ribbon-left">
                    <div className="title-block">
                        <span className="star-icon">✨</span>
                        <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                    </div>
                </div>

                <div className="header-right ribbon-right" style={{ position: 'relative' }} ref={dropdownRef}>
                    <span
                        className="profile-icon"
                        style={{ fontSize: '2rem', cursor: 'pointer' }}
                        onClick={() => setProfileDropdownOpen(prev => !prev)}
                    >
                        📜
                    </span>

                    <div style={dropdownStyles}>
                        <p style={{ textAlign: 'left' }}><strong>Username:</strong> {stats.username}</p>
                        <p style={{ textAlign: 'left' }}><strong>UserID:</strong> {user?.uid}</p>
                        <hr style={{ borderColor: '#555', margin: '0.5rem 0' }} />
                        <button
                            style={dropdownButtonStyles}
                            onMouseOver={e => e.currentTarget.style.background = '#333'}
                            onMouseOut={e => e.currentTarget.style.background = '#222'}
                            onClick={() => { setEditProfileOpen(true); setProfileDropdownOpen(false); }}
                        >
                            🪶 Edit Profile
                        </button>
                        <button
                            style={dropdownButtonStyles}
                            onMouseOver={e => e.currentTarget.style.background = '#333'}
                            onMouseOut={e => e.currentTarget.style.background = '#222'}
                            onClick={handleSignOut}
                        >
                            🗝️ Log Out
                        </button>
                    </div>
                </div>
            </header>

            {/* Edit Profile Modal */}
            {editProfileOpen && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content edit-profile-modal">
                        <h3>Edit Profile</h3>
                        <div className="form-group">
                            <label>New Username:</label>
                            <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} />
                            <button className="button-primary" onClick={handleUsernameChange}>Save Username</button>
                        </div>
                        <div className="form-group">
                            <label>Current Password:</label>
                            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>New Password:</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Confirm New Password:</label>
                            <input type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} />
                            <button className="button-primary" onClick={handlePasswordChange}>Change Password</button>
                        </div>
                        <button className="button-primary button-danger" onClick={() => setEditProfileOpen(false)}>Close</button>
                    </div>
                </div>
            )}

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
                    <span className="metric-icon">🎯</span>
                    <p className="metric-label">Accuracy Rate:</p>
                    <p className="metric-value">{accuracyRate}%</p>
                </div>
            </div>

            {/* The Archival Scroll (Fragment Display) */}
            <div className="archival-scroll fragment-container">
                <h3 className="scroll-title">The Archival Scroll (Fragment)</h3>
                <p className="scroll-fragment fragment-text">
                    {(gameState === 'loading' || gameState === 'error') ? "Accessing the Archival Stream..." : (currentFragment || "Press 'Start Round' to access a fragment from the Moirai Archives...")}
                </p>
            </div>

            {/* Classification Options / Buttons */}
            {gameState === 'playing' && (
                <div className="classification-buttons classifier">
                    <h3 className="classifier-title">Classify the Causal Force:</h3>
                    <div className="classifier-buttons">
                        {classifierOptions.map(option => (
                            <button
                                key={option}
                                className={`classifier-button ${userClassification === option ? 'selected' : ''}`}
                                onClick={() => handleClassification(option)}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Reveal / Revelation Panel */}
            {(gameState === 'revealing' || gameState === 'error') && (
                <div className="revelation-overlay">
                    <div className="revelation-panel">
                        <h2 className={`revelation-header ${userClassification === secretTag ? 'correct' : 'incorrect'}`}>
                            {gameState === 'error' ? '🛑 System Interruption' : (userClassification === secretTag ? '✅ Axiom Confirmed: Correct Classification' : '❌ Axiom Error: Narrative Deception Successful')}
                        </h2>

                        <div className="revelation-text-box">
                            <p className="revelation-focus">
                                The <strong>True Causal Force</strong> in this Fragment was: <strong>{secretTag}</strong>
                            </p>
                            <hr />
                            <p className="revelation-justification">
                                <strong>Revelation Text:</strong> {revelationText}
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

            {/* Ready to Start */}
            {gameState === 'ready_to_start' && (
                <div className="start-game-section">
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Start Round</button>
                </div>
            )}
        </div>
    );
}
