import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
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

    const generateEvaluation = (accuracy) => {
        if (accuracy >= 100) return { grade: "S", rec: "Your intuition is flawless. You see the threads of reality as they truly are." };
        if (accuracy >= 80) return { grade: "A", rec: "Exceptional archival work. Focus on the subtle overlap between Choice and Fate." };
        if (accuracy >= 60) return { grade: "B", rec: "Strong performance. Remember: Chance is often just a pattern you haven't recognized yet." };
        if (accuracy >= 40) return { grade: "C", rec: "Adequate. You are prone to mistaking human Choice for the iron hand of Fate." };
        return { grade: "F", rec: "The scroll is blurred to your eyes. Study the axioms and try again, initiate." };
    };

    const [gameState, setGameState] = useState('loading'); 
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    const [roundStartTime, setRoundStartTime] = useState(null);
    const [roundLogs, setRoundLogs] = useState([]); // Tracks specific outcomes of the 5 steps
    const [reportsOpen, setReportsOpen] = useState(false);
    const [archivedReports, setArchivedReports] = useState([]); // Historical reports from DB
    
    // Mode & Genre State
    const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]); 

    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);

    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [newUsername, setNewUsername] = useState("");

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const dropdownRef = useRef(null);

    const showAlert = useCallback((title, message) => setErrorMessage({ title, message }), []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0 ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1) : '0.0';

    // --- Update Stats in Firestore ---
    const updateStatsInDb = useCallback(async (newStats, roundsPlayed) => {
        if (!user?.uid) return;
        try {
            await updateDoc(doc(db, "users", user.uid), {
                ...newStats,
                totalRoundsPlayed: roundsPlayed,
            });
        } catch (error) { console.error("Firestore Update Error:", error); }
    }, [user]);

    // --- Core Game Logic: Fetching Fragment ---
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

            // Increment count only when a fragment is successfully generated
            setAttemptCount(prev => prev + 1);
            
            if (gameMode === 'Story') setStoryHistory(prev => [...prev, fragmentText]);
            else setStoryHistory([]);

            setSecretTag(randomSecretTag);
            setCurrentFragment(fragmentText);
            setRevelationText(revText);
            setGameState('playing');
            setRoundStartTime(Date.now());
        } catch (error) {
            setGameState('error');
            showAlert("AI Generation Error", error.message);
        }
    }, [stats.difficultyTier, selectedGenre, gameMode, storyHistory, showAlert]);

    const handleFinishRound = () => {
        // 1. Calculate Stats for this specific round
        const totalDuration = roundLogs.reduce((acc, log) => acc + log.duration, 0);
        const avgDuration = (totalDuration / roundLogs.length).toFixed(2);
        const correctCount = roundLogs.filter(l => l.isCorrect).length;
        const accuracy = (correctCount / roundLogs.length) * 100;
        const { grade, rec } = generateEvaluation(accuracy);
    
        const newReport = {
            date: new Date().toISOString(),
            accuracy,
            avgDuration,
            grade,
            recommendation: rec,
            mode: gameMode,
            genre: selectedGenre
        };
    
        // 2. Save to Firestore (Push to an 'archives' collection)
        if (user?.uid) {
            try {
                const userRef = doc(db, "users", user.uid);
                // We'll store reports in a sub-collection or an array. 
                // For simplicity here, let's assume we fetch them when the user clicks 'Archive'
                await updateDoc(userRef, {
                    reports: [...archivedReports, newReport]
                });
                setArchivedReports(prev => [...prev, newReport]);
            } catch (e) { console.error("Error saving archive:", e); }
        }
    
        // 3. Reset for next round
        setRoundLogs([]);
        setAttemptCount(0);
        setTotalRoundsPlayed(prev => prev + 1);
        setStoryHistory([]);
        setGameState('ready_to_start');
    };

    // --- Classification ---
    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;

        const endTime = Date.now();
        const duration = (endTime - roundStartTime) / 1000; // in seconds
        const isCorrect = choice === secretTag;

    // Log this specific step for the final report
    setRoundLogs(prev => [...prev, { isCorrect, duration }]);
        
        const isCorrect = choice === secretTag;
        setUserClassification(choice);
        setGameState('revealing');
    
        // 1. Calculate the new state based on current stats
        setStats(prev => {
            const newStats = { ...prev };
            
            if (isCorrect) {
                newStats.currentScore += 10;
                newStats.currentStreak += 1;
                newStats.totalCorrect += 1;
                
                if (newStats.currentStreak > newStats.highestStreak) newStats.highestStreak = newStats.currentStreak;
                if (newStats.currentScore > newStats.highestScore) newStats.highestScore = newStats.currentScore;
    
                // Check for Tier Increase
                if (newStats.currentStreak > 0 && newStats.currentStreak % 5 === 0) {
                    newStats.difficultyTier += 1;
                    // TRIGGER ALERT HERE (Outside the return)
                    setTimeout(() => showAlert("Promotion", `Difficulty Tier is now ${newStats.difficultyTier}.`), 0);
                }
            } else {
                newStats.currentStreak = 0;
                newStats.totalIncorrect += 1;
            }
    
            // 2. Trigger Database Update
            updateStatsInDb(newStats, totalRoundsPlayed);
            
            return newStats;
        });
    };

    // --- Session & Initial Load ---
    useEffect(() => {
        const load = async () => {
            if (!user) return;
            const docSnap = await getDoc(doc(db, "users", user.uid));
            if (docSnap.exists()) {
                const d = docSnap.data();
                setStats(s => ({ ...s, ...d, currentScore: 0, currentStreak: 0 }));
                setTotalRoundsPlayed(d.totalRoundsPlayed || 0);
            }
            const stored = sessionStorage.getItem(GAME_SESSION_KEY);
            if (stored) setIsSessionActive(true);
            setInitialLoadComplete(true);
            setGameState('ready_to_start');
        };
        load();
    }, [user, showAlert]);

    useEffect(() => {
        if (user && (gameState === 'playing' || gameState === 'revealing')) {
            const session = {
                userId: user.uid, currentFragment, secretTag, revelationText,
                gameState, attemptCount, totalRoundsPlayed, selectedGenre, gameMode, storyHistory,
                ...stats
            };
            sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(session));
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre, gameMode, storyHistory]);

    const resumeSession = () => {
        const data = JSON.parse(sessionStorage.getItem(GAME_SESSION_KEY));
        setCurrentFragment(data.currentFragment);
        setSecretTag(data.secretTag);
        setRevelationText(data.revelationText);
        setGameState(data.gameState);
        setAttemptCount(data.attemptCount);
        setTotalRoundsPlayed(data.totalRoundsPlayed);
        setSelectedGenre(data.selectedGenre);
        setGameMode(data.gameMode);
        setStoryHistory(data.storyHistory);
        setStats(prev => ({ ...prev, currentScore: data.currentScore, currentStreak: data.currentStreak }));
        setIsSessionActive(false);
    };

    // --- Styles ---
    const selectStyle = { background: '#000', color: '#d4af37', border: '1px solid #d4af37', padding: '8px 12px', borderRadius: '4px', fontFamily: 'serif', cursor: 'pointer', margin: '0 5px' };
    const configContainerStyle = { margin: '10px auto', padding: '15px', background: 'rgba(26, 26, 26, 0.6)', borderRadius: '12px', border: '1px solid #333', maxWidth: '450px', textAlign: 'center' };

    if (gameState === 'loading' && !initialLoadComplete) return <div className="loading-spinner">Accessing the Archives...</div>;

    return (
        <div className="game-container">
            {/* Session Prompt Modal */}
            {isSessionActive && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content session-prompt">
                        <h3>Archival Session Detected ⏳</h3>
                        <p>Continue your previous record at Step {attemptCount}/5?</p>
                        <div className="button-group">
                            <button onClick={resumeSession} className="button-primary">Resume</button>
                            <button onClick={() => { sessionStorage.removeItem(GAME_SESSION_KEY); setIsSessionActive(false); }} className="button-primary button-danger">New Game</button>
                        </div>
                    </div>
                </div>
            )}

            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setErrorMessage(null)} className="button-primary">Acknowledge</button>
                    </div>
                </div>
            )}

            {reportsOpen && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content report-ledger" style={{ maxWidth: '600px', textAlign: 'left' }}>
                        <h2 style={{ borderBottom: '1px solid #d4af37', paddingBottom: '10px' }}>📜 Archive of Progress</h2>
                        <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '20px' }}>
                            {archivedReports.length === 0 ? (
                                <p style={{fontStyle: 'italic', color: '#666'}}>No records found in the Great Library yet.</p>
                            ) : (
                                archivedReports.map((report, i) => (
                                    <div key={i} style={{ marginBottom: '20px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#d4af37' }}>
                                            <strong>Record #{archivedReports.length - i}</strong>
                                            <span>Grade: <span style={{fontSize: '1.2rem'}}>{report.grade}</span></span>
                                        </div>
                                        <p style={{margin: '5px 0'}}><strong>Accuracy:</strong> {report.accuracy}% | <strong>Avg Speed:</strong> {report.avgDuration}s</p>
                                        <p style={{fontSize: '0.9rem', color: '#aaa', fontStyle: 'italic'}}>"{report.recommendation}"</p>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="button-primary" onClick={() => setReportsOpen(false)} style={{ marginTop: '20px', width: '100%' }}>Close Ledger</button>
                    </div>
                </div>
            )}

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
                            <button onClick={() => setReportsOpen(true)} className="dropdown-item">📖 Archive of Progress</button>
                        </div>
                    )}
                </div>
            </header>

            {/* Metrics */}
            <div className="metrics-tally">
                <div className="metric"><span>📖</span><p>Mode: {gameMode}</p></div>
                <div className="metric"><span>#</span><p>Rounds: {totalRoundsPlayed}</p></div>
                <div className="metric"><span>🎯</span><p>Steps: {attemptCount} / 5</p></div>
                <div className="metric"><span>⚡</span><p>Score: {stats.currentScore}</p></div>
                <div className="metric"><span>❤</span><p>Streak: {stats.currentStreak}</p></div>
                <div className="metric"><span>🛡️</span><p>Tier: {stats.difficultyTier}</p></div>
                <div className="metric"><span>🎯</span><p>Acc: {accuracyRate}%</p></div>
            </div>

            {/* Main Content */}
            <div className="archival-scroll fragment-container">
                <h3 className="scroll-title">
                    {gameMode === 'Story' ? `The Eternal Chronicle (Part ${attemptCount})` : `Fragment ${attemptCount} of 5`}
                </h3>
                <p className="scroll-fragment fragment-text">
                    {gameState === 'loading' ? "Consulting the Fates..." : (currentFragment || "Awaiting archival initialization...")}
                </p>
            </div>

            {gameState === 'playing' && (
                <div className="classification-section">
                    <h3 className="classifier-title">Classify the Causal Force:</h3>
                    <div className="classifier-buttons">
                        {classifierOptions.map(opt => (
                            <button key={opt} className="classifier-button" onClick={() => handleClassification(opt)}>{opt}</button>
                        ))}
                    </div>
                </div>
            )}

            {gameState === 'revealing' && (
                <div className="revelation-overlay">
                    <div className="revelation-panel">
                        <h2 className={userClassification === secretTag ? 'correct' : 'incorrect'}>
                            {userClassification === secretTag ? '✅ Axiom Confirmed' : '❌ Axiom Error'}
                        </h2>
                        <div className="revelation-text-box">
                            <p>True Force: <strong>{secretTag}</strong></p>
                            <p className="revelation-justification">{revelationText}</p>
                        </div>
                        <button 
                            className="button-primary continue-button" 
                            onClick={() => attemptCount >= 5 ? handleFinishRound() : startNewRound(stats.difficultyTier)}
                        >
                            {attemptCount >= 5 ? "Seal Archive Round" : "Next Fragment"}
                        </button>
                    </div>
                </div>
            )}

            {gameState === 'ready_to_start' && (
                <div className="start-game-section">
                    <div style={configContainerStyle}>
                        <p style={{color: '#888', fontSize: '0.8rem', textTransform: 'uppercase'}}>Configure Record</p>
                        <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)} style={selectStyle}>
                            {GENRE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select value={gameMode} onChange={(e) => setGameMode(e.target.value)} style={selectStyle}>
                            {MODE_OPTIONS.map(m => <option key={m} value={m}>{m} Mode</option>)}
                        </select>
                        <p style={{marginTop: '10px', fontSize: '0.75rem', fontStyle: 'italic', color: '#666'}}>
                            {gameMode === 'Story' ? "A continuous narrative thread." : "Disconnected echoes from the void."}
                        </p>
                    </div>
                    <button className="button-primary" onClick={() => { setAttemptCount(0); startNewRound(stats.difficultyTier); }}>Initialize Archive</button>
                </div>
            )}
        </div>
    );
}
