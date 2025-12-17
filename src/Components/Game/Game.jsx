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

    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);

    // Genre State
    const [selectedGenre, setSelectedGenre] = useState("Random");

    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);

    // Edit Profile Fields
    const [newUsername, setNewUsername] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const genreOptions = [
        "Random", "Romance", "Mystery", "Fantasy", 
        "Sci-Fi", "Horror", "Historical", "Slice of Life"
    ];

    const dropdownRef = useRef(null);

    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0
        ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
        : '0.0';

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

    // --- Start New Round / Next Fragment ---
    const startNewRound = useCallback(async (currentDifficulty) => {
        setGameState('loading');
        setErrorMessage(null);
        setUserClassification(null);
        setRevelationText(null);
        setCurrentFragment("");
    
        const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
        const randomSecretTag = classifierOptions[Math.floor(Math.random() * classifierOptions.length)];
    
        try {
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(
                effectiveDifficulty, 
                randomSecretTag,
                selectedGenre
            );
    
            const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;
            
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
            setGameState('error');
            showAlert("AI Generation Error", error.message || "Failed to generate fragment.");
        }
    }, [stats.difficultyTier, attemptCount, selectedGenre, showAlert]);

    // --- Load User Stats & Session ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
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
                        highestStreak: permanentStats.highestStreak || 0,
                        difficultyTier: permanentStats.difficultyTier || 1,
                        highestScore: permanentStats.highestScore || 0,
                        totalCorrect: permanentStats.totalCorrect || 0,
                        totalIncorrect: permanentStats.totalIncorrect || 0,
                    }));
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
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
                        setIsSessionActive(true);
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

    // --- Persist Session to Storage ---
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
                currentScore: stats.currentScore,
                currentStreak: stats.currentStreak,
                difficultyTier: stats.difficultyTier,
                highestScore: stats.highestScore,
                highestStreak: stats.highestStreak,
            };
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(sessionData));
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre]);

    // --- Resume/New Game Handlers ---
    const resumeSession = () => {
        const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
        if (!storedSession) { startNewGame(); return; }
        const data = JSON.parse(storedSession);
        
        setCurrentFragment(data.currentFragment);
        setSecretTag(data.secretTag);
        setRevelationText(data.revelationText);
        setGameState(data.gameState);
        setAttemptCount(data.attemptCount);
        setTotalRoundsPlayed(data.totalRoundsPlayed);
        setSelectedGenre(data.selectedGenre || "Random");
        setStats(prev => ({
            ...prev,
            currentScore: data.currentScore,
            currentStreak: data.currentStreak,
            difficultyTier: data.difficultyTier,
            highestScore: data.highestScore,
            highestStreak: data.highestStreak,
        }));
        setIsSessionActive(false); 
    };

    const startNewGame = () => {
        sessionStorage.removeItem(GAME_SESSION_KEY);
        setStats(prev => ({ ...prev, currentScore: 0, currentStreak: 0 }));
        setAttemptCount(0);
        setIsSessionActive(false);
        setGameState('ready_to_start');
    };

    // --- Gameplay Handlers ---
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

    // --- Profile & Sign Out Handlers ---
    const handleSignOut = useCallback(async () => {
        sessionStorage.removeItem(GAME_SESSION_KEY);
        const finalStats = { ...stats, currentScore: 0, currentStreak: 0 };
        await updateStatsInDb(finalStats, totalRoundsPlayed); 
        onSignOut();
    }, [stats, onSignOut, updateStatsInDb, totalRoundsPlayed]);

    const handleUsernameChange = async () => {
        if (!newUsername.trim()) return;
        try {
            await updateDoc(doc(db, "users", user.uid), { username: newUsername.trim() });
            setStats(prev => ({ ...prev, username: newUsername.trim() }));
            setEditProfileOpen(false);
            showAlert("Success", "Username updated.");
        } catch (e) { showAlert("Error", "Failed to update username."); }
    };

    // --- Render Helpers ---
    if (gameState === 'loading' && !initialLoadComplete) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="loading-spinner">
                    <p>Accessing the Archives and Loading User Profile...</p>
                </div>
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

            {/* Header */}
            <header className="game-header ribbon-layout" style={{ position: 'relative' }}>
                <div className="header-left ribbon-left">
                    <div className="title-block">
                        <span className="star-icon">✨</span>
                        <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                    </div>
                </div>

                <div className="header-right ribbon-right" ref={dropdownRef}>
                    <span className="profile-icon" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown-menu" style={{
                            position: 'absolute', top: '100%', right: 0, background: '#1a1a1a', 
                            border: '1px solid #444', padding: '1rem', zIndex: 100, minWidth: '200px'
                        }}>
                            <p><strong>{stats.username}</strong></p>
                            <button onClick={() => {setEditProfileOpen(true); setProfileDropdownOpen(false);}} className="dropdown-btn">🪶 Edit Profile</button>
                            <button onClick={handleSignOut} className="dropdown-btn">🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            {/* Metrics Tally */}
            <div className="metrics-tally">
                <div className="metric"><span className="metric-icon">#</span><p className="metric-label">Rounds:</p><p className="metric-value">{totalRoundsPlayed}</p></div>
                <div className="metric"><span className="metric-icon">🎯</span><p className="metric-label">Attempt:</p><p className="metric-value">{displayAttemptCount}/5</p></div>
                <div className="metric"><span className="metric-icon">⚡</span><p className="metric-label">Score:</p><p className="metric-value">{stats.currentScore}</p></div>
                <div className="metric"><span className="metric-icon">⭐</span><p className="metric-label">High:</p><p className="metric-value">{stats.highestScore}</p></div>
                <div className="metric"><span className="metric-icon">❤</span><p className="metric-label">Streak:</p><p className="metric-value">{stats.currentStreak}</p></div>
                <div className="metric"><span className="metric-icon">🏆</span><p className="metric-label">Best Streak:</p><p className="metric-value">{stats.highestStreak}</p></div>
                <div className="metric"><span className="metric-icon">🎖️</span><p className="metric-label">Tier:</p><p className="metric-value">{stats.difficultyTier}</p></div>
                <div className="metric"><span className="metric-icon">✅</span><p className="metric-label">Correct:</p><p className="metric-value">{stats.totalCorrect}</p></div>
                <div className="metric"><span className="metric-icon">🎯</span><p className="metric-label">Accuracy:</p><p className="metric-value">{accuracyRate}%</p></div>
            </div>

            {/* Main Gameplay Area */}
            {gameState === 'ready_to_start' ? (
                <div className="start-game-section archival-scroll" style={{textAlign: 'center'}}>
                    <h3 className="scroll-title">Select Genre for This Round</h3>
                    <div className="genre-selector" style={{display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', margin: '20px'}}>
                        {genreOptions.map(g => (
                            <button key={g} className={`genre-button ${selectedGenre === g ? 'selected' : ''}`} onClick={() => setSelectedGenre(g)}>
                                {g}
                            </button>
                        ))}
                    </div>
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Start Round</button>
                </div>
            ) : (
                <>
                    <div className="archival-scroll fragment-container">
                        <h3 className="scroll-title">The Archival Scroll (Fragment)</h3>
                        <p className="scroll-fragment fragment-text">
                            {gameState === 'loading' ? "Accessing the Stream..." : currentFragment}
                        </p>
                    </div>

                    {gameState === 'playing' && (
                        <div className="classification-buttons">
                            <h3 className="classifier-title">Classify the Causal Force:</h3>
                            <div className="classifier-buttons-row">
                                {classifierOptions.map(option => (
                                    <button key={option} className="classifier-button" onClick={() => handleClassification(option)}>
                                        {option}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {(gameState === 'revealing' || gameState === 'error') && (
                        <div className="revelation-panel archival-scroll">
                            <h3 className="revelation-title">Revelation: {secretTag}</h3>
                            <p className="revelation-text">{revelationText}</p>
                            <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>
                                {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Edit Profile Modal */}
            {editProfileOpen && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content edit-profile-modal">
                        <h3>Edit Profile</h3>
                        <input type="text" placeholder="New Username" value={newUsername} onChange={e => setNewUsername(e.target.value)} />
                        <button className="button-primary" onClick={handleUsernameChange}>Save</button>
                        <button className="button-primary button-danger" onClick={() => setEditProfileOpen(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
