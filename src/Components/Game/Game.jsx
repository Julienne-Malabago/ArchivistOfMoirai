import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc, setDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constants
const GENRE_OPTIONS = ['Random', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Horror', 'Cyberpunk', 'Noir'];
const MODE_OPTIONS = ['Random', 'Story'];

// Inline Styles to fix missing references
const configContainerStyle = { margin: '20px 0', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' };
const selectStyle = { padding: '8px', borderRadius: '4px', background: '#222', color: '#fff', border: '1px solid #444', cursor: 'pointer' };

export function Game({ user, onSignOut }) {
    // --- Stats State ---
    const [stats, setStats] = useState({
        username: user?.displayName || 'The Archivist',
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
        : '0.0';

    const displayAttemptCount = attemptCount + 1;

    // ================= INITIALIZATION =================
    useEffect(() => {
        if (user) {
            loadReports();
            setGameState('ready_to_start');
        }
    }, [user]);

    // ================= REPORT LOGIC =================
    const saveRoundReport = async (finalDurations, currentStats) => {
        if (!user || finalDurations.length === 0) return;

        const avgSeconds = Math.round(
            finalDurations.reduce((a, b) => a + b, 0) / finalDurations.length
        );

        const accuracy = Math.round((currentStats.totalCorrect / (currentStats.totalCorrect + currentStats.totalIncorrect)) * 100);

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
            loadReports(); // Refresh local list
        } catch (e) { console.error("Report save failed", e); }
        setAttemptDurations([]);
    };

    const loadReports = async () => {
        if (!user) return;
        try {
            const snap = await getDoc(doc(db, "user_reports", user.uid));
            if (snap.exists()) setReports(snap.data().reports || []);
        } catch (e) { console.error("Failed to load reports", e); }
    };

    // ================= GAME LOGIC =================
    const startNewRound = useCallback(async (currentDifficulty) => {
        setGameState('loading');
        setErrorMessage(null);
        setUserClassification(null);
        setRevelationText(null);

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
            } else {
                setStoryHistory([]);
            }

            if (attemptCount === 4) {
                setTotalRoundsPlayed(prev => prev + 1);
            }
            
            setAttemptCount(nextAttemptCount);
            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
            setAttemptStartTime(Date.now()); 
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
                    <span className="profile-icon" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)} style={{cursor: 'pointer'}}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown-menu">
                            <p><strong>{stats.username}</strong></p>
                            <button onClick={() => {setShowReports(true); setProfileDropdownOpen(false)}}>📊 Reports</button>
                            <button onClick={onSignOut}>🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            {/* Metrics Tally */}
            <div className="metrics-tally">
                <div className="metric">
                    <span className="metric-icon">📖</span>
                    <p className="metric-label">Mode: {gameMode}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🎯</span>
                    <p className="metric-label">Steps: {displayAttemptCount} / 5</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">⚡</span>
                    <p className="metric-label">Score: {stats.currentScore}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">🛡️</span>
                    <p className="metric-label">Tier: {stats.difficultyTier}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon">✅</span>
                    <p className="metric-label">Accuracy: {accuracyRate}%</p>
                </div>
            </div>

            {/* Fragment Section */}
             <div className="archival-scroll fragment-container">
                <h3 className="scroll-title">
                    {gameMode === 'Story' ? `The Eternal Chronicle (Part ${displayAttemptCount})` : 'The Archival Scroll (Fragment)'}
                </h3>
                <div className="scroll-fragment fragment-text">
                    {gameState === 'loading' ? (
                         <p className="loading-text">Accessing the Archival Stream...</p>
                    ) : (
                        <p>{currentFragment || "Select your settings and begin the record..."}</p>
                    )}
                </div>
            </div>

            {/* Classification Buttons */}
            {gameState === 'playing' && (
                <div className="controls-section">
                    <p className="instruction-text">Classify this echo:</p>
                    <div className="button-group">
                        {classifierOptions.map(option => (
                            <button key={option} className="button-choice" onClick={() => handleClassification(option)}>
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Revelation / Results */}
            {gameState === 'revealing' && (
                <div className="revelation-overlay">
                    <div className="revelation-card">
                        <h2 className={userClassification === secretTag ? "text-success" : "text-error"}>
                            {userClassification === secretTag ? "Correct Discernment" : "Causal Misalignment"}
                        </h2>
                        <div className="revelation-content">
                            <p>This echo was bound by <strong>{secretTag}</strong>.</p>
                            <hr />
                            <p className="revelation-justification"><strong>Revelation:</strong> {revelationText}</p>
                        </div>
                        <button className="button-primary continue-button" onClick={() => startNewRound(stats.difficultyTier)}>
                            {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
                        </button>
                    </div>
                </div>
            )}

            {/* Start Screen */}
            {gameState === 'ready_to_start' && (
                <div className="start-game-section" style={{textAlign: 'center'}}>
                    <div style={configContainerStyle}>
                        <p style={{marginBottom: '10px', fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', letterSpacing: '1px'}}>Archive Configuration</p>
                        <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', flexWrap: 'wrap'}}>
                            <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} style={selectStyle}>
                                {GENRE_OPTIONS.map(genre => <option key={genre} value={genre}>{genre}</option>)}
                            </select>

                            <select value={gameMode} onChange={(e) => setGameMode(e.target.value)} style={selectStyle}>
                                {MODE_OPTIONS.map(mode => <option key={mode} value={mode}>{mode} Mode</option>)}
                            </select>
                        </div>
                        <p style={{marginTop: '10px', fontSize: '0.75rem', color: '#555', fontStyle: 'italic'}}>
                            {gameMode === 'Story' ? "Fragments will weave a single continuous narrative." : "Each fragment is a disconnected echo from the void."}
                        </p>
                    </div>
                    <button className="button-primary" onClick={() => startNewRound(stats.difficultyTier)}>Initialize Archive</button>
                </div>
            )}

            {/* Error State */}
            {gameState === 'error' && (
                <div className="error-container">
                    <p>{errorMessage?.message}</p>
                    <button onClick={() => setGameState('ready_to_start')}>Retry</button>
                </div>
            )}

            {/* Reports Modal */}
            {showReports && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>📚 Archives of Progress</h3>
                        <div className="reports-container" style={{maxHeight: '350px', overflowY: 'auto'}}>
                            {reports.length === 0 ? <p>No records found in the archive yet.</p> : 
                                reports.map((r, i) => (
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
