import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

const GAME_SESSION_KEY = "moirai_game_session";

export function Game({ user, onSignOut }) {
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

    const [gameState, setGameState] = useState('loading'); // loading, playing, revealing, error, ready_to_start
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    // Attempt counters
    const [attemptCount, setAttemptCount] = useState(1); // 1..5
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);

    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);

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

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setProfileDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const updateStatsInDb = useCallback(async (newStats) => {
        if (!user || !user.uid) return;
        const userDocRef = doc(db, "users", user.uid);
        try {
            await updateDoc(userDocRef, {
                currentScore: newStats.currentScore,
                currentStreak: newStats.currentStreak,
                highestStreak: newStats.highestStreak,
                difficultyTier: newStats.difficultyTier,
                highestScore: newStats.highestScore,
                totalRoundsPlayed: newStats.totalRoundsPlayed ?? totalRoundsPlayed,
                totalCorrect: newStats.totalCorrect,
                totalIncorrect: newStats.totalIncorrect,
                attemptCount: newStats.attemptCount ?? attemptCount,
            });
        } catch (error) {
            console.error("Error updating stats in Firestore:", error);
        }
    }, [user, totalRoundsPlayed, attemptCount]);

    // --- Load user stats & session ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
            setGameState('loading');
            if (!user) return;

            const userDocRef = doc(db, "users", user.uid);
            let permanentStats = {};
            try {
                const docSnap = await getDoc(userDocRef);
                if (docSnap.exists()) {
                    permanentStats = docSnap.data();
                    setTotalRoundsPlayed(permanentStats.totalRoundsPlayed || 0);
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
                    setAttemptCount(permanentStats.attemptCount ?? 1);
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                showAlert("Data Error", "Could not load user progress from the Archives.");
                setGameState('error');
                return;
            }

            // Load session
            const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
            if (storedSession) {
                try {
                    const sessionData = JSON.parse(storedSession);
                    if (sessionData.userId === user.uid) {
                        setStats(prev => ({
                            ...prev,
                            currentScore: sessionData.currentScore ?? prev.currentScore,
                            currentStreak: sessionData.currentStreak ?? prev.currentStreak,
                            difficultyTier: sessionData.difficultyTier ?? prev.difficultyTier,
                            highestStreak: Math.max(prev.highestStreak, sessionData.highestStreak || 0),
                            highestScore: Math.max(prev.highestScore, sessionData.highestScore || 0),
                        }));
                        setAttemptCount(sessionData.attemptCount ?? 1);
                        setTotalRoundsPlayed(sessionData.totalRoundsPlayed ?? (permanentStats.totalRoundsPlayed || 0));
                        setCurrentFragment(sessionData.currentFragment || "");
                        setSecretTag(sessionData.secretTag || null);
                        setRevelationText(sessionData.revelationText || null);
                        setGameState(sessionData.gameState || 'ready_to_start');
                        setIsSessionActive(false);
                    } else {
                        sessionStorage.removeItem(GAME_SESSION_KEY);
                    }
                } catch (e) {
                    console.error("Error parsing session data:", e);
                    sessionStorage.removeItem(GAME_SESSION_KEY);
                }
            }

            setInitialLoadComplete(true);
            if (!storedSession) setGameState('ready_to_start');
        };
        fetchUserDataAndSession();
    }, [user, showAlert]);

    // --- Persist session ---
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

    // --- Start a new round fragment ---
    const startNewFragment = useCallback(async (currentDifficulty) => {
        if (attemptCount > 5) {
            showAlert("No Attempts Remaining", "You have used all 5 attempts. Log out to reset attempts.");
            return;
        }

        setGameState('loading');
        setErrorMessage(null);
        setUserClassification(null);
        setRevelationText(null);
        setCurrentFragment("");

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
            setRevelationText("System error. True causal force unavailable.");
            setCurrentFragment("");
            setGameState('error');
            showAlert("AI Generation Error", error.message || String(error));
        }
    }, [attemptCount, stats.difficultyTier, showAlert]);

    // --- Classification / attempt handling ---
    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;
        setUserClassification(choice);
        setGameState('revealing');

        const isCorrect = choice === secretTag;
        let newStats = { ...stats };
        let promotionMessage = null;

        if (isCorrect) {
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1;
            if (newStats.currentStreak > newStats.highestStreak) newStats.highestStreak = newStats.currentStreak;
            if (newStats.currentScore > newStats.highestScore) newStats.highestScore = newStats.currentScore;
            if (newStats.currentStreak % 5 === 0) {
                newStats.difficultyTier += 1;
                promotionMessage = `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}.`;
            }
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        // Increment attemptCount
        const nextAttemptCount = attemptCount + 1;

        // If attempts reach 5, increment totalRoundsPlayed, reset attemptCount
        let updatedTotalRounds = totalRoundsPlayed;
        let resetAttempt = nextAttemptCount;
        if (nextAttemptCount > 5) {
            updatedTotalRounds += 1;
            resetAttempt = 1; // reset for new round
        }

        setStats(newStats);
        setAttemptCount(resetAttempt);
        setTotalRoundsPlayed(updatedTotalRounds);

        updateStatsInDb({
            ...newStats,
            attemptCount: resetAttempt,
            totalRoundsPlayed: updatedTotalRounds,
        });

        if (promotionMessage) showAlert("Promotion Achieved", promotionMessage);
    };

    const displayAttemptCount = attemptCount;

    return (
        <div className="game-container">
            {/* Render your UI here (header, fragment, buttons, metrics) */}
            <p>Round Attempts: {displayAttemptCount} / 5</p>
            <p>Total Rounds Completed: {totalRoundsPlayed}</p>
            <button onClick={() => startNewFragment(stats.difficultyTier)}>Start Fragment</button>
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
