import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

const GAME_SESSION_KEY = "moirai_game_session";

export function Game({ user, onSignOut }) {
    // --- State ---
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

    const [gameState, setGameState] = useState('loading'); // loading, ready_to_start, playing, revealing, error
    const [currentFragment, setCurrentFragment] = useState("");
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [selectedGenre, setSelectedGenre] = useState("Random");
    const [isSessionActive, setIsSessionActive] = useState(false);
    
    // UI States
    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const dropdownRef = useRef(null);

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const genreOptions = ["Random", "Romance", "Mystery", "Fantasy", "Sci-Fi", "Horror", "Historical", "Slice of Life"];

    // --- Derived Values ---
    const displayAttemptCount = attemptCount + 1;
    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0 ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1) : '0';

    // --- Core Logic ---
    const updateStatsInDb = useCallback(async (newStats, roundsPlayed) => {
        if (!user) return;
        try {
            await updateDoc(doc(db, "users", user.uid), {
                ...newStats,
                totalRoundsPlayed: roundsPlayed
            });
        } catch (e) { console.error("Database sync failed", e); }
    }, [user]);

    const startNewRound = useCallback(async () => {
        setGameState('loading');
        setErrorMessage(null);
        setCurrentFragment("");
    
        const randomTag = classifierOptions[Math.floor(Math.random() * 3)];
    
        try {
            // CALLING THE UPDATED UTILITY
            const data = await fetchFragmentFromAI(stats.difficultyTier, randomTag, selectedGenre);
    
            const nextAttempt = attemptCount === 4 ? 0 : attemptCount + 1;
            setAttemptCount(nextAttempt);
            if (nextAttempt === 0) setTotalRoundsPlayed(prev => prev + 1);

            setSecretTag(randomTag);
            setCurrentFragment(data.fragmentText);
            setRevelationText(data.revelationText);
            setGameState('playing');
        } catch (error) {
            setGameState('error');
            setErrorMessage({ title: "Archival Link Severed", message: error.message });
        }
    }, [stats.difficultyTier, attemptCount, selectedGenre]);

    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;
        setGameState('revealing');

        const isCorrect = choice === secretTag;
        const newStats = { ...stats };

        if (isCorrect) {
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1;
            if (newStats.currentStreak > newStats.highestStreak) newStats.highestStreak = newStats.currentStreak;
            if (newStats.currentScore > newStats.highestScore) newStats.highestScore = newStats.currentScore;
            if (newStats.currentStreak % 5 === 0) newStats.difficultyTier += 1;
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        setStats(newStats);
        updateStatsInDb(newStats, totalRoundsPlayed);
    };

    // --- Persistence & Lifecycle ---
    useEffect(() => {
        const loadUser = async () => {
            if (!user) return;
            const docSnap = await getDoc(doc(db, "users", user.uid));
            if (docSnap.exists()) {
                const d = docSnap.data();
                setStats(prev => ({ ...prev, ...d }));
                setTotalRoundsPlayed(d.totalRoundsPlayed || 0);
            }
            
            const saved = sessionStorage.getItem(GAME_SESSION_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                if (data.userId === user.uid) setIsSessionActive(true);
            }
            setGameState(saved ? 'loading' : 'ready_to_start');
        };
        loadUser();
    }, [user]);

    useEffect(() => {
        if (user && (gameState === 'playing' || gameState === 'revealing')) {
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify({
                userId: user.uid, currentFragment, secretTag, revelationText, 
                gameState, attemptCount, totalRoundsPlayed, selectedGenre, ...stats
            }));
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre]);

    const resumeSession = () => {
        const data = JSON.parse(sessionStorage.getItem(GAME_SESSION_KEY));
        setCurrentFragment(data.currentFragment);
        setSecretTag(data.secretTag);
        setRevelationText(data.revelationText);
        setGameState(data.gameState);
        setAttemptCount(data.attemptCount);
        setSelectedGenre(data.selectedGenre || "Random");
        setIsSessionActive(false);
    };

    // --- Render ---
    if (isSessionActive) {
        return (
            <div className="game-container fullscreen-layout">
                <div className="custom-modal-content session-prompt">
                    <h3>📜 Session Restored</h3>
                    <p>Continue your previous investigation?</p>
                    <button onClick={resumeSession} className="button-primary">Resume</button>
                    <button onClick={() => { sessionStorage.removeItem(GAME_SESSION_KEY); setIsSessionActive(false); setGameState('ready_to_start'); }} className="button-primary button-danger">New Game</button>
                </div>
            </div>
        );
    }

    return (
        <div className="game-container">
            {/* Header */}
            <header className="game-header ribbon-layout">
                <div className="header-left ribbon-left">
                    <span className="star-icon">✨</span>
                    <h1 className="game-title">ARCHIVIST OF MOIRAI</h1>
                </div>
                <div className="header-right ribbon-right" ref={dropdownRef}>
                    <span className="profile-icon" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown-menu">
                            <p><strong>{stats.username}</strong></p>
                            <button onClick={() => setEditProfileOpen(true)}>🪶 Edit Name</button>
                            <button onClick={onSignOut}>🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            {/* Metrics Tally with Missing Icons Restored */}
            <div className="metrics-tally">
                <div className="metric"><span className="metric-icon">#</span><p>{totalRoundsPlayed}</p></div>
                <div className="metric"><span className="metric-icon">🎯</span><p>{displayAttemptCount}/5</p></div>
                <div className="metric"><span className="metric-icon">⚡</span><p>{stats.currentScore}</p></div>
                <div className="metric"><span className="metric-icon">⭐</span><p>{stats.highestScore}</p></div>
                <div className="metric"><span className="metric-icon">❤</span><p>{stats.currentStreak}</p></div>
                <div className="metric"><span className="metric-icon">🏆</span><p>{stats.highestStreak}</p></div>
                <div className="metric"><span className="metric-icon">🎖️</span><p>{stats.difficultyTier}</p></div>
                <div className="metric"><span className="metric-icon">✅</span><p>{accuracyRate}%</p></div>
            </div>

            {/* Content Switcher */}
            {gameState === 'ready_to_start' ? (
                <div className="archival-scroll start-section">
                    <h2 className="scroll-title">Choose a Literary Thread</h2>
                    <div className="genre-selector">
                        {genreOptions.map(g => (
                            <button key={g} className={`genre-button ${selectedGenre === g ? 'active' : ''}`} onClick={() => setSelectedGenre(g)}>
                                {g}
                            </button>
                        ))}
                    </div>
                    <button className="button-primary start-btn" onClick={startNewRound}>Open the Archives</button>
                </div>
            ) : (
                <div className="archival-scroll">
                    <h3 className="scroll-title">The Fragment</h3>
                    <p className="scroll-fragment">
                        {gameState === 'loading' ? "Whispering to the Fates..." : currentFragment}
                    </p>

                    {gameState === 'playing' && (
                        <div className="classification-buttons">
                            {classifierOptions.map(opt => (
                                <button key={opt} className="classifier-button" onClick={() => handleClassification(opt)}>{opt}</button>
                            ))}
                        </div>
                    )}

                    {gameState === 'revealing' && (
                        <div className="revelation-panel">
                            <h3 className="revelation-title">Force Identified: {secretTag}</h3>
                            <p className="revelation-text">{revelationText}</p>
                            <button className="button-primary" onClick={startNewRound}>
                                {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Modals */}
            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setGameState('ready_to_start')} className="button-primary">Return</button>
                    </div>
                </div>
            )}
        </div>
    );
}
