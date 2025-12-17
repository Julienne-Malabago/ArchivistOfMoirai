import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constants
const GAME_SESSION_KEY = "moirai_game_session";
const GENRE_OPTIONS = ['Random', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Horror', 'Cyberpunk', 'Noir'];
const MODE_OPTIONS = ['Random', 'Story'];

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

    const [gameState, setGameState] = useState('loading'); 
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    // Mode & Genre State
    const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]); // Context for Story Mode

    const [attemptCount, setAttemptCount] = useState(0); 
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
                totalRoundsPlayed: roundsPlayed,
                totalCorrect: newStats.totalCorrect,
                totalIncorrect: newStats.totalIncorrect,
            });
        } catch (error) {
            console.error("Error updating stats in Firestore:", error);
        }
    }, [user]);

    // --- Start New Round (Supports Story History) ---
    const startNewRound = useCallback(async (currentDifficulty) => {
        setGameState('loading');
        setErrorMessage(null);
        setUserClassification(null);
        setRevelationText(null);
        setCurrentFragment("");
    
        const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
        const randomSecretTag = classifierOptions[Math.floor(Math.random() * classifierOptions.length)];
        
        const activeGenre = selectedGenre === 'Random' 
            ? GENRE_OPTIONS[Math.floor(Math.random() * (GENRE_OPTIONS.length - 1)) + 1] 
            : selectedGenre;
    
        try {
            // Send history only if in Story Mode
            const contextHistory = gameMode === 'Story' ? storyHistory : [];
            
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(
                effectiveDifficulty, 
                randomSecretTag, 
                activeGenre,
                contextHistory
            );
    
            const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;
            
            // Manage Story History
            if (gameMode === 'Story') {
                if (nextAttemptCount === 0) {
                    setStoryHistory([]); // Reset history after full round of 5
                } else {
                    setStoryHistory(prev => [...prev, fragmentText]); // Add to context
                }
            } else {
                setStoryHistory([]); // Clear history in Random mode
            }

            setAttemptCount(nextAttemptCount);
            if (nextAttemptCount === 0) {
                setTotalRoundsPlayed(prev => prev + 1);
            }
    
            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
            
        } catch (error) {
            console.error("Fragment generation failed:", error);
            setSecretTag("ERROR");
            setRevelationText("Due to a system failure, the true causal force cannot be determined.");
            setGameState('error');
            showAlert("AI Generation Error", error.message || String(error));
        }
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions, selectedGenre, gameMode, storyHistory]);

    // --- Load User Stats & Session ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
            setGameState('loading');
            if (!user) return;

            const userDocRef = doc(db, "users", user.uid);
            let permanentStats = {};
            let sessionFound = false;
            
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
                    setAttemptCount(0); 
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                showAlert("Data Error", "Could not load user progress.");
                setGameState('error');
                setInitialLoadComplete(true);
                return;
            }

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
                        if(sessionData.selectedGenre) setSelectedGenre(sessionData.selectedGenre);
                        if(sessionData.gameMode) setGameMode(sessionData.gameMode);
                        if(sessionData.storyHistory) setStoryHistory(sessionData.storyHistory);
                        setIsSessionActive(true);
                    } else {
                        sessionStorage.removeItem(GAME_SESSION_KEY);
                    }
                } catch (e) {
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
                selectedGenre,
                gameMode,
                storyHistory,
                currentScore: stats.currentScore,
                currentStreak: stats.currentStreak,
                difficultyTier: stats.difficultyTier,
                highestScore: stats.highestScore,
                highestStreak: stats.highestStreak,
            };
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(sessionData));
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre, gameMode, storyHistory]);

    const resumeSession = () => {
        const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
        if (!storedSession) { startNewGame(); return; }
        const sessionData = JSON.parse(storedSession);
        
        setCurrentFragment(sessionData.currentFragment);
        setSecretTag(sessionData.secretTag);
        setRevelationText(sessionData.revelationText);
        setGameState(sessionData.gameState);
        setAttemptCount(sessionData.attemptCount);
        setTotalRoundsPlayed(sessionData.totalRoundsPlayed);
        if(sessionData.selectedGenre) setSelectedGenre(sessionData.selectedGenre);
        if(sessionData.gameMode) setGameMode(sessionData.gameMode);
        if(sessionData.storyHistory) setStoryHistory(sessionData.storyHistory);

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
        setStats(prev => ({ ...prev, currentScore: 0, currentStreak: 0 }));
        setAttemptCount(0);
        setStoryHistory([]);
        setIsSessionActive(false);
        setGameState('ready_to_start');
    };

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
            
            if (newStats.currentStreak > 0 && newStats.currentStreak % 5 === 0) {
                newStats.difficultyTier += 1;
                promotionMessage = `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}.`;
            }
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        setStats(newStats);
        updateStatsInDb(newStats, totalRoundsPlayed);
        if (promotionMessage) showAlert("Promotion Achieved", promotionMessage);
    };

    const handleSignOut = useCallback(async () => {
        sessionStorage.removeItem(GAME_SESSION_KEY);
        const finalStats = { ...stats, currentScore: 0, currentStreak: 0 };
        await updateStatsInDb(finalStats, totalRoundsPlayed); 
        setAttemptCount(0);
        setTotalRoundsPlayed(0);
        onSignOut();
    }, [stats, onSignOut, updateStatsInDb, totalRoundsPlayed]);

    const handleUsernameChange = async () => {
        if (!newUsername.trim()) return;
        try {
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, { username: newUsername.trim() });
            setStats(prev => ({ ...prev, username: newUsername.trim() }));
            setEditProfileOpen(false);
            showAlert("Success", "Username updated.");
        } catch (e) { showAlert("Error", "Failed to update username."); }
    };

    const handlePasswordChange = async () => {
        if (!currentPassword || !newPassword || newPassword !== confirmNewPassword) return;
        try {
            const credential = auth.EmailAuthProvider.credential(user.email, currentPassword);
            await auth.currentUser.reauthenticateWithCredential(credential); 
            await auth.currentUser.updatePassword(newPassword);
            setEditProfileOpen(false);
            showAlert("Success", "Password updated.");
        } catch (e) { showAlert("Error", e.message); }
    };

    // --- Inline Styles ---
    const dropdownStyles = {
        position: 'absolute', top: 'calc(100% + 8px)', right: 0,
        background: '#1a1a1a', border: '1px solid #444', borderRadius: '8px',
        padding: '1rem', minWidth: '220px', zIndex: 50,
        boxShadow: '0 4px 15px rgba(0,0,0,0.4)', color: '#fff',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: profileDropdownOpen ? 1 : 0,
        transform: profileDropdownOpen ? 'translateY(0)' : 'translateY(-10px)',
        pointerEvents: profileDropdownOpen ? 'auto' : 'none'
    };

    const dropdownButtonStyles = {
        display: 'block', width: '100%', marginBottom: '0.5rem',
        background: '#222', color: '#fff', border: 'none',
        padding: '0.5rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
    };

    const configContainerStyle = {
        margin: '10px auto',
        padding: '15px',
        background: 'rgba(26, 26, 26, 0.6)',
        borderRadius: '12px',
        border: '1px solid #333',
        maxWidth: '450px',
        textAlign: 'center'
    };

    const selectStyle = {
        background: '#000',
        color: '#d4af37',
        border: '1px solid #d4af37',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '1rem',
        fontFamily: 'serif',
        cursor: 'pointer',
        outline: 'none',
        margin: '0 5px'
    };

    if (gameState === 'loading' && !initialLoadComplete) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="loading-spinner"><p>Accessing the Archives...</p></div>
            </div>
        );
    }

    if (isSessionActive) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content session-prompt">
                        <h3>Archival Session Detected ⏳</h3>
                        <p>A previous game session was found (Attempt {displayAttemptCount}/5).</p>
                        <div className="button-group">
                            <button onClick={resumeSession} className="button-primary">Resume Session</button>
                            <button onClick={startNewGame} className="button-primary button-danger">Start New Game</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container">
            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setErrorMessage(null)} className="button-primary">Acknowledge</button>
                    </div>
                </div>
            )}

            <header className="game-header ribbon-layout" style={{ position: 'relative' }}>
                <div className="header-left ribbon-left">
                    <div className="title-block">
                        <span className="star-icon">✨</span>
                        <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                    </div>
                </div>

                <div className="header-right ribbon-right" style={{ position: 'relative' }} ref={dropdownRef}>
                    <span className="profile-icon" style={{ fontSize: '2rem', cursor: 'pointer' }} onClick={() => setProfileDropdownOpen(prev => !prev)}>📜</span>
                    <div style={dropdownStyles}>
                        <p><strong>Username:</strong> {stats.username}</p>
                        <hr style={{ borderColor: '#555', margin: '0.5rem 0' }} />
                        <button style={dropdownButtonStyles} onClick={() => { setEditProfileOpen(true); setProfileDropdownOpen(false); }}>🪶 Edit Profile</button>
                        <button style={dropdownButtonStyles} onClick={handleSignOut}>🗝️ Log Out</button>
                    </div>
                </div>
            </header>

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

            <div className="metrics-tally">
                <div className="metric">
                    <span className="metric-icon">📖</span>
                    <p className="metric-label">Mode:</p>
                    <p className="metric-value">{gameMode}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">#</span>
                    <p className="metric-label">Total Rounds:</p>
                    <p className="metric-value">{totalRoundsPlayed}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🎯</span>
                    <p className="metric-label">Round Steps:</p>
                    <p className="metric-value">{displayAttemptCount} / 5</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">⚡</span>
                    <p className="metric-label">Score:</p>
                    <p className="metric-value">{stats.currentScore}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">❤</span>
                    <p className="metric-label">Streak:</p>
                    <p className="metric-value">{stats.currentStreak}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🛡️</span>
                    <p className="metric-label">Tier:</p>
                    <p className="metric-value">{stats.difficultyTier}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">✅</span>
                    <p className="metric-label">Correct:</p>
                    <p className="metric-value">{stats.totalCorrect}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🎯</span>
                    <p className="metric-label">Accuracy:</p>
                    <p className="metric-value">{accuracyRate}%</p>
                </div>
            </div>

            <div className="archival-scroll fragment-container">
                <h3 className="scroll-title">
                    {gameMode === 'Story' ? `The Eternal Chronicle (Part ${displayAttemptCount})` : 'The Archival Scroll (Fragment)'}
                </h3>
                <p className="scroll-fragment fragment-text">
                    {(gameState === 'loading' || gameState === 'error') ? "Accessing the Archival Stream..." : (currentFragment || "Choose your settings and begin the record...")}
                </p>
            </div>

            {gameState === 'playing' && (
                <div className="classification-buttons classifier">
                    <h3 className="classifier-title">Classify the Causal Force:</h3>
                    <div className="classifier-buttons">
                        {classifierOptions.map(option => (
                            <button key={option} className={`classifier-button ${userClassification === option ? 'selected' : ''}`} onClick={() => handleClassification(option)}>{option}</button>
                        ))}
                    </div>
                </div>
            )}

            {(gameState === 'revealing' || gameState === 'error') && (
                <div className="revelation-overlay">
                    <div className="revelation-panel">
                        <h2 className={`revelation-header ${userClassification === secretTag ? 'correct' : 'incorrect'}`}>
                            {gameState === 'error' ? '🛑 System Interruption' : (userClassification === secretTag ? '✅ Axiom Confirmed' : '❌ Axiom Error')}
                        </h2>
                        <div className="revelation-text-box">
                            <p className="revelation-focus">True Force: <strong>{secretTag}</strong></p>
                            <hr />
                            <p className="revelation-justification"><strong>Revelation:</strong> {revelationText}</p>
                        </div>
                        <button className="button-primary continue-button" onClick={() => startNewRound(stats.difficultyTier)}>
                            {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
                        </button>
                    </div>
                </div>
            )}

            {gameState === 'ready_to_start' && (
                <div className="start-game-section" style={{textAlign: 'center'}}>
                    <div style={configContainerStyle}>
                        <p style={{marginBottom: '10px', fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px'}}>Archive Configuration</p>
                        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', flexWrap: 'wrap'}}>
                            <select 
                                value={selectedGenre} 
                                onChange={(e) => setSelectedGenre(e.target.value)}
                                style={selectStyle}
                            >
                                {GENRE_OPTIONS.map(genre => (
                                    <option key={genre} value={genre}>{genre}</option>
                                ))}
                            </select>

                            <select 
                                value={gameMode} 
                                onChange={(e) => setGameMode(e.target.value)}
                                style={selectStyle}
                            >
                                {MODE_OPTIONS.map(mode => (
                                    <option key={mode} value={mode}>{mode} Mode</option>
                                ))}
                            </select>
                        </div>
                        <p style={{marginTop: '10px', fontSize: '0.75rem', color: '#555', fontStyle: 'italic'}}>
                            {gameMode === 'Story' ? "Fragments will weave a single continuous narrative." : "Each fragment is a disconnected echo from the void."}
                        </p>
                    </div>
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Initialize Archive</button>
                </div>
            )}
        </div>
    );
}
