import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from "firebase/auth";

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

    // --- Profile/Form State ---
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");

    // --- Game Logic State ---
    const [gameState, setGameState] = useState('loading'); 
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    const [roundStartTime, setRoundStartTime] = useState(null);
    const [roundLogs, setRoundLogs] = useState([]); 
    const [reportsOpen, setReportsOpen] = useState(false);
    const [archivedReports, setArchivedReports] = useState([]); 
    
    const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]); 

    const [attemptCount, setAttemptCount] = useState(0); 
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

    const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];
    const dropdownRef = useRef(null);

    const showAlert = useCallback((title, message) => setErrorMessage({ title, message }), []);
    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate = totalAttempts > 0 ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1) : '0.0';

    const generateEvaluation = (accuracy) => {
        if (accuracy >= 100) return { grade: "S", rec: "Your intuition is flawless. You see the threads of reality as they truly are." };
        if (accuracy >= 80) return { grade: "A", rec: "Exceptional archival work. Focus on the subtle overlap between Choice and Fate." };
        if (accuracy >= 60) return { grade: "B", rec: "Strong performance. Remember: Chance is often just a pattern you haven't recognized yet." };
        if (accuracy >= 40) return { grade: "C", rec: "Adequate. You are prone to mistaking human Choice for the iron hand of Fate." };
        return { grade: "F", rec: "The scroll is blurred to your eyes. Study the axioms and try again, initiate." };
    };

    const updateStatsInDb = useCallback(async (newStats, roundsPlayed) => {
        if (!user?.uid) return;
        try {
            await updateDoc(doc(db, "users", user.uid), {
                ...newStats,
                totalRoundsPlayed: roundsPlayed,
            });
        } catch (error) { console.error("Firestore Update Error:", error); }
    }, [user]);

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

    // FIX: Marked as async to allow await usage
    const handleFinishRound = async () => {
        const totalDuration = roundLogs.reduce((acc, log) => acc + log.duration, 0);
        const avgDuration = (totalDuration / Math.max(roundLogs.length, 1)).toFixed(2);
        const correctCount = roundLogs.filter(l => l.isCorrect).length;
        const accuracy = (correctCount / Math.max(roundLogs.length, 1)) * 100;
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
    
        if (user?.uid) {
            try {
                const userRef = doc(db, "users", user.uid);
                // Use arrayUnion to safely add to the reports array in Firestore
                await updateDoc(userRef, {
                    reports: arrayUnion(newReport)
                });
                setArchivedReports(prev => [...prev, newReport]);
            } catch (e) { console.error("Error saving archive:", e); }
        }
    
        setRoundLogs([]);
        setAttemptCount(0);
        setTotalRoundsPlayed(prev => prev + 1);
        setStoryHistory([]);
        setGameState('ready_to_start');
    };

    const handleClassification = (choice) => {
        if (gameState !== 'playing') return;

        const duration = (Date.now() - roundStartTime) / 1000;
        const isCorrect = choice === secretTag;

        setRoundLogs(prev => [...prev, { isCorrect, duration }]);
        setUserClassification(choice);
        setGameState('revealing');
    
        setStats(prev => {
            const newStats = { ...prev };
            if (isCorrect) {
                newStats.currentScore += 10;
                newStats.currentStreak += 1;
                newStats.totalCorrect += 1;
                if (newStats.currentStreak > newStats.highestStreak) newStats.highestStreak = newStats.currentStreak;
                if (newStats.currentScore > newStats.highestScore) newStats.highestScore = newStats.currentScore;
                if (newStats.currentStreak > 0 && newStats.currentStreak % 5 === 0) {
                    newStats.difficultyTier += 1;
                    setTimeout(() => showAlert("Promotion", `Difficulty Tier is now ${newStats.difficultyTier}.`), 0);
                }
            } else {
                newStats.currentStreak = 0;
                newStats.totalIncorrect += 1;
            }
            updateStatsInDb(newStats, totalRoundsPlayed);
            return newStats;
        });
    };

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
        if (!currentPassword || !newPassword || newPassword !== confirmNewPassword) {
            showAlert("Error", "Please verify your password inputs.");
            return;
        }
        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(auth.currentUser, credential); 
            await updatePassword(auth.currentUser, newPassword);
            setEditProfileOpen(false);
            showAlert("Success", "Password updated.");
        } catch (e) { showAlert("Error", e.message); }
    };

    useEffect(() => {
        const load = async () => {
            if (!user) return;
            const docSnap = await getDoc(doc(db, "users", user.uid));
            if (docSnap.exists()) {
                const d = docSnap.data();
                setStats(s => ({ ...s, ...d, currentScore: 0, currentStreak: 0 }));
                setTotalRoundsPlayed(d.totalRoundsPlayed || 0);
                setArchivedReports(d.reports || []);
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

    // Styling Helpers
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
        color: '#d4af37', // Gold archival color
        border: '1px solid #d4af37',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '1rem',
        fontFamily: 'serif',
        cursor: 'pointer',
        outline: 'none',
        margin: '0 5px'
    };

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

            {reportsOpen && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content report-ledger" style={{ maxWidth: '600px', textAlign: 'left' }}>
                        <h2 style={{ borderBottom: '1px solid #d4af37', paddingBottom: '10px' }}>📜 Archive of Progress</h2>
                        <div style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '20px' }}>
                            {archivedReports.length === 0 ? (
                                <p style={{fontStyle: 'italic', color: '#666'}}>No records found in the Great Library yet.</p>
                            ) : (
                                [...archivedReports].reverse().map((report, i) => (
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

            <header className="game-header ribbon-layout">
                <div className="header-left ribbon-left">
                    <h1 className="game-title">✨ ARCHIVIST OF MOIRAI</h1>
                </div>
                <div className="header-right ribbon-right" ref={dropdownRef}>
                    <span className="profile-icon" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown-menu">
                            <p><strong>{stats.username}</strong></p>
                            <button onClick={() => { setReportsOpen(true); setProfileDropdownOpen(false); }}>📖 Archive of Progress</button>
                            <button onClick={() => { setEditProfileOpen(true); setProfileDropdownOpen(false); }}>⚙️ Edit Profile</button>
                            <button onClick={onSignOut}>🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            <div className="metrics-tally">
                <div className="metric"><span>📖</span><p>Mode: {gameMode}</p></div>
                <div className="metric"><span>#</span><p>Rounds: {totalRoundsPlayed}</p></div>
                <div className="metric"><span>🎯</span><p>Steps: {attemptCount} / 5</p></div>
                <div className="metric"><span>⚡</span><p>Score: {stats.currentScore}</p></div>
                <div className="metric"><span>❤</span><p>Streak: {stats.currentStreak}</p></div>
                <div className="metric"><span>🛡️</span><p>Tier: {stats.difficultyTier}</p></div>
                <div className="metric"><span>🎯</span><p>Acc: {accuracyRate}%</p></div>
            </div>

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
                <div className="start-game-section" style={{ textAlign: 'center' }}>
                    <div style={configContainerStyle}>
                        <p style={{ 
                            marginBottom: '10px', 
                            fontSize: '0.8rem', 
                            color: '#888', 
                            textTransform: 'uppercase', 
                            letterSpacing: '1px' 
                        }}>
                            Archive Configuration
                        </p>
                        
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'center', 
                            alignItems: 'center', 
                            gap: '10px', 
                            flexWrap: 'wrap' 
                        }}>
                            {/* Genre Selector */}
                            <select 
                                value={selectedGenre} 
                                onChange={(e) => setSelectedGenre(e.target.value)} 
                                style={selectStyle}
                            >
                                {GENRE_OPTIONS.map(genre => (
                                    <option key={genre} value={genre}>{genre}</option>
                                ))}
                            </select>
            
                            {/* Mode Selector */}
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
            
                        <p style={{ 
                            marginTop: '10px', 
                            fontSize: '0.75rem', 
                            color: '#555', 
                            fontStyle: 'italic' 
                        }}>
                            {gameMode === 'Story' 
                                ? "Fragments will weave a single continuous narrative." 
                                : "Each fragment is a disconnected echo from the void."}
                        </p>
                    </div>
                    
                    <button 
                        className="button-primary" 
                        onClick={() => startNewRound(stats.difficultyTier)}
                    >
                        Initialize Archive
                    </button>
                </div>
            )}
        </div>
    );
}
