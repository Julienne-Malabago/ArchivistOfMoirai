import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc, setDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constants
const GAME_SESSION_KEY = "moirai_game_session";
const GENRE_OPTIONS = ['Random', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Horror', 'Cyberpunk', 'Noir'];
const MODE_OPTIONS = ['Random', 'Story'];

export function Game({ user, onSignOut }) {
    // --- Stats State ---
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

    // --- Game Engine State ---
    const [gameState, setGameState] = useState('loading'); 
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    
    const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]);

    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // --- REPORT & TIMING STATE ---
    const [attemptStartTime, setAttemptStartTime] = useState(null);
    const [attemptDurations, setAttemptDurations] = useState([]);
    const [showReports, setShowReports] = useState(false);
    const [reports, setReports] = useState([]);

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const dropdownRef = useRef(null);
    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

    // --- Helpers ---
    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0
        ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
        : 'N/A';

    const displayAttemptCount = attemptCount + 1;

    // ================= REPORT LOGIC =================
    const saveRoundReport = async (finalDurations, currentStats) => {
        if (!user || finalDurations.length === 0) return;

        const avgSeconds = Math.round(
            finalDurations.reduce((a, b) => a + b, 0) / finalDurations.length
        );

        const accuracy = totalAttempts > 0
            ? Math.round((currentStats.totalCorrect / totalAttempts) * 100)
            : 0;

        let rating = "C";
        let recommendation = "Review causal distinctions more carefully.";
        if (accuracy >= 90 && avgSeconds <= 40) {
            rating = "A";
            recommendation = "Exceptional discernment. Increase difficulty.";
        } else if (accuracy >= 75) {
            rating = "B";
            recommendation = "Strong instincts. Improve response speed.";
        }

        const report = {
            timestamp: new Date().toISOString(),
            avgSecondsPerAnswer: avgSeconds,
            accuracy,
            rating,
            recommendation,
            mode: gameMode,
            genre: selectedGenre,
            tier: currentStats.difficultyTier
        };

        try {
            const ref = doc(db, "user_reports", user.uid);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                await setDoc(ref, { userId: user.uid, reports: [report] });
            } else {
                await updateDoc(ref, { reports: arrayUnion(report) });
            }
        } catch (e) { console.error("Report save failed", e); }
        setAttemptDurations([]);
    };

    const loadReports = async () => {
        if (!user) return;
        const snap = await getDoc(doc(db, "user_reports", user.uid));
        if (snap.exists()) setReports(snap.data().reports || []);
    };

    // ================= GAME LOGIC =================
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
            const contextHistory = gameMode === 'Story' ? storyHistory : [];
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(
                effectiveDifficulty, randomSecretTag, activeGenre, contextHistory
            );

            const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;

            if (gameMode === 'Story') {
                if (nextAttemptCount === 0) setStoryHistory([]);
                else setStoryHistory(prev => [...prev, fragmentText]);
            } else setStoryHistory([]);

            setAttemptCount(nextAttemptCount);
            if (nextAttemptCount === 0) setTotalRoundsPlayed(prev => prev + 1);

            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
            setAttemptStartTime(Date.now()); // 🔹 Timer Starts
        } catch (error) {
            setGameState('error');
            showAlert("AI Generation Error", error.message);
        }
    }, [stats.difficultyTier, attemptCount, selectedGenre, gameMode, storyHistory, showAlert]);

    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;

        const secondsSpent = Math.round((Date.now() - attemptStartTime) / 1000);
        const updatedDurations = [...attemptDurations, secondsSpent];
        setAttemptDurations(updatedDurations);

        setUserClassification(choice);
        setGameState('revealing');

        const isCorrect = choice === secretTag;
        let newStats = { ...stats };
        if (isCorrect) {
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1;
            if (newStats.currentStreak % 5 === 0) newStats.difficultyTier += 1;
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        setStats(newStats);
        if (attemptCount === 4) saveRoundReport(updatedDurations, newStats);
    };

    return (
        <div className="game-container">
            {/* Header */}
            <header className="game-header ribbon-layout">
                <div className="header-left ribbon-left">
                    <h1 className="game-title">✨ ARCHIVIST OF MOIRAI</h1>
                </div>
                <div className="header-right ribbon-right" ref={dropdownRef}>
                    <span className="profile-icon" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown-menu">
                            <p><strong>{stats.username}</strong></p>
                            <button onClick={() => {setShowReports(true); setProfileDropdownOpen(false)}}>📊 Reports</button>
                            <button onClick={onSignOut}>🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            {/* ================= METRICS TALLY (ICONS RESTORED) ================= */}
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

            {/* Fragment Section */}
             <div className="archival-scroll fragment-container">
                <h3 className="scroll-title">The Archival Scroll (Fragment)</h3>
                <h3 className="scroll-title">
                    {gameMode === 'Story' ? `The Eternal Chronicle (Part ${displayAttemptCount})` : 'The Archival Scroll (Fragment)'}
                </h3>
                <p className="scroll-fragment fragment-text">
                    {(gameState === 'loading' || gameState === 'error') ? "Accessing the Archival Stream..." : (currentFragment || "Select a genre and press 'Start Round'...")}
                    {(gameState === 'loading' || gameState === 'error') ? "Accessing the Archival Stream..." : (currentFragment || "Choose your settings and begin the record...")}
                </p>
            </div>

@@ -523,26 +540,43 @@ export function Game({ user, onSignOut }) {
                            <hr />
                            <p className="revelation-justification"><strong>Revelation:</strong> {revelationText}</p>
                        </div>
                        <button className="button-primary continue-button" onClick={() => startNewRound(stats.difficultyTier)}>Continue to Next Fragment</button>
                        <button className="button-primary continue-button" onClick={() => startNewRound(stats.difficultyTier)}>
                            {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
                        </button>
                    </div>
                </div>
            )}

            {gameState === 'ready_to_start' && (
                <div className="start-game-section" style={{textAlign: 'center'}}>
                    <div style={genreContainerStyle}>
                        <p style={{marginBottom: '10px', fontSize: '0.9rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px'}}>Choose Narrative Setting</p>
                        <select 
                            value={selectedGenre} 
                            onChange={(e) => setSelectedGenre(e.target.value)}
                            style={genreSelectStyle}
                        >
                            {GENRE_OPTIONS.map(genre => (
                                <option key={genre} value={genre}>{genre}</option>
                            ))}
                        </select>
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
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Start Round</button>
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Initialize Archive</button>
                </div>
            )}

            {/* Reports Modal */}
            {showReports && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>📚 Archives of Progress</h3>
                        <div className="reports-container" style={{maxHeight: '350px', overflowY: 'auto'}}>
                            {reports.map((r, i) => (
                                <div key={i} className="report-box" style={{borderBottom: '1px solid #333', padding: '10px 0'}}>
                                    <p><strong>{new Date(r.timestamp).toLocaleDateString()}</strong> - Rating: <span style={{color: '#d4af37'}}>{r.rating}</span></p>
                                    <p style={{fontSize: '0.8rem'}}>Accuracy: {r.accuracy}% | Avg: {r.avgSecondsPerAnswer}s</p>
                                    <p style={{fontSize: '0.75rem', fontStyle: 'italic', color: '#aaa'}}>{r.recommendation}</p>
                                </div>
                            ))}
                        </div>
                        <button className="button-primary" onClick={() => setShowReports(false)}>Close Archives</button>
                    </div>
                </div>
            )}
        </div>
    );
}
