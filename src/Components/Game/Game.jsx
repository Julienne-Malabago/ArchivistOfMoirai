import React, { useState, useEffect, useCallback, useRef } from "react";
import {
    doc,
    getDoc,
    updateDoc,
    setDoc,
    arrayUnion
} from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

/* ===================== CONSTANTS ===================== */
const GAME_SESSION_KEY = "moirai_game_session";
const GENRE_OPTIONS = ['Random', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Horror', 'Cyberpunk', 'Noir'];
const MODE_OPTIONS = ['Random', 'Story'];
const classifierOptions = ['FATE', 'CHOICE', 'CHANCE'];

/* ===================== GAME ===================== */
export function Game({ user, onSignOut }) {

    /* ---------- STATS ---------- */
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

    /* ---------- MODE ---------- */
    const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]);

    /* ---------- ROUND ---------- */
    const [attemptCount, setAttemptCount] = useState(0);
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);

    /* ---------- SESSION ---------- */
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [isSessionActive, setIsSessionActive] = useState(false);

    /* ---------- PROFILE ---------- */
    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);

    const [newUsername, setNewUsername] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");

    /* ---------- PROGRESS ARCHIVE ---------- */
    const [showProgressArchive, setShowProgressArchive] = useState(false);
    const [userReports, setUserReports] = useState([]);

    /* ---------- TIMING ---------- */
    const [attemptStartTime, setAttemptStartTime] = useState(null);
    const [attemptTimes, setAttemptTimes] = useState([]);

    const dropdownRef = useRef(null);

    /* ===================== HELPERS ===================== */
    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate =
        totalAttempts > 0
            ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
            : 'N/A';

    const displayAttemptCount = attemptCount + 1;

    /* ===================== DROPDOWN CLOSE ===================== */
    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setProfileDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    /* ===================== UPDATE STATS ===================== */
    const updateStatsInDb = async (newStats, rounds) => {
        if (!user) return;
        await updateDoc(doc(db, "users", user.uid), {
            ...newStats,
            totalRoundsPlayed: rounds
        });
    };

    /* ===================== USER REPORT ===================== */
    const upsertUserReport = async () => {
        if (!user) return;

        const reportRef = doc(db, "user_reports", user.uid);
        const snap = await getDoc(reportRef);

        const avgSeconds =
            attemptTimes.length > 0
                ? Math.round(attemptTimes.reduce((a, b) => a + b, 0) / attemptTimes.length)
                : 0;

        const roundAttempts = stats.totalCorrect + stats.totalIncorrect;
        const accuracy = roundAttempts > 0
            ? Math.round((stats.totalCorrect / roundAttempts) * 100)
            : 0;

        let rating = "C";
        let recommendation = "Review causal patterns more carefully.";

        if (accuracy >= 90 && avgSeconds <= 40) {
            rating = "A";
            recommendation = "Excellent discernment. Increase difficulty.";
        } else if (accuracy >= 75) {
            rating = "B";
            recommendation = "Strong instincts. Improve response speed.";
        }

        const entry = {
            timestamp: new Date().toISOString(),
            avgSecondsPerAnswer: avgSeconds,
            accuracy,
            rating,
            recommendation
        };

        if (!snap.exists()) {
            await setDoc(reportRef, {
                userId: user.uid,
                createdAt: new Date().toISOString(),
                reports: [entry]
            });
        } else {
            await updateDoc(reportRef, {
                reports: arrayUnion(entry)
            });
        }

        setAttemptTimes([]);
    };

    /* ===================== LOAD REPORTS ===================== */
    useEffect(() => {
        if (!showProgressArchive || !user) return;

        const load = async () => {
            const snap = await getDoc(doc(db, "user_reports", user.uid));
            if (snap.exists()) setUserReports(snap.data().reports || []);
        };

        load();
    }, [showProgressArchive, user]);

    /* ===================== START ROUND ===================== */
    const startNewRound = async () => {
        setGameState('loading');
        setUserClassification(null);
        setAttemptStartTime(Date.now());

        const secret = classifierOptions[Math.floor(Math.random() * 3)];
        const genre =
            selectedGenre === 'Random'
                ? GENRE_OPTIONS[Math.floor(Math.random() * (GENRE_OPTIONS.length - 1)) + 1]
                : selectedGenre;

        const context = gameMode === 'Story' ? storyHistory : [];

        const { fragmentText, revelationText } = await fetchFragmentFromAI(
            stats.difficultyTier,
            secret,
            genre,
            context
        );

        setSecretTag(secret);
        setCurrentFragment(fragmentText);
        setRevelationText(revelationText);
        setGameState('playing');
    };

    /* ===================== CLASSIFY ===================== */
    const handleClassification = async (choice) => {
        const seconds = Math.round((Date.now() - attemptStartTime) / 1000);
        setAttemptTimes(prev => [...prev, seconds]);

        const correct = choice === secretTag;
        const newStats = { ...stats };

        if (correct) {
            newStats.currentScore += 10;
            newStats.currentStreak++;
            newStats.totalCorrect++;
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect++;
        }

        setStats(newStats);
        setGameState('revealing');
        await updateStatsInDb(newStats, totalRoundsPlayed);
    };

    /* ===================== UI ===================== */
    return (
        <div className="game-container">

            {/* ---------- HEADER ---------- */}
            <header className="game-header ribbon-layout">
                <div className="ribbon-left">
                    <span>✨</span>
                    <h1>ARCHIVIST OF MOIRAI</h1>
                </div>

                <div className="ribbon-right" ref={dropdownRef}>
                    <span onClick={() => setProfileDropdownOpen(p => !p)}>📜</span>
                    {profileDropdownOpen && (
                        <div className="dropdown">
                            <p><strong>Username:</strong> {stats.username}</p>
                            <button onClick={() => setShowProgressArchive(true)}>📚 Archives of Progress</button>
                            <button onClick={() => setEditProfileOpen(true)}>🪶 Edit Profile</button>
                            <button onClick={onSignOut}>🗝️ Log Out</button>
                        </div>
                    )}
                </div>
            </header>

            {/* ---------- METRICS TALLY ---------- */}
            <div className="metrics-tally">
                <div>📖 Mode: {gameMode}</div>
                <div># Rounds: {totalRoundsPlayed}</div>
                <div>🎯 Step: {displayAttemptCount}/5</div>
                <div>⚡ Score: {stats.currentScore}</div>
                <div>❤ Streak: {stats.currentStreak}</div>
                <div>🛡 Tier: {stats.difficultyTier}</div>
                <div>✅ Correct: {stats.totalCorrect}</div>
                <div>🎯 Accuracy: {accuracyRate}%</div>
            </div>

            {/* ---------- FRAGMENT ---------- */}
            <div className="archival-scroll">
                <h3>{gameMode === 'Story' ? `Chronicle ${displayAttemptCount}` : "Archival Fragment"}</h3>
                <p>{currentFragment}</p>
            </div>

            {/* ---------- CLASSIFIER ---------- */}
            {gameState === 'playing' && (
                <div className="classifier">
                    {classifierOptions.map(opt => (
                        <button key={opt} onClick={() => handleClassification(opt)}>{opt}</button>
                    ))}
                </div>
            )}

            {/* ---------- REVELATION ---------- */}
            {gameState === 'revealing' && (
                <div className="revelation-panel">
                    <h2>True Force: {secretTag}</h2>
                    <p>{revelationText}</p>
                    <button onClick={async () => {
                        if (attemptCount === 4) {
                            await upsertUserReport();
                            setAttemptCount(0);
                            setTotalRoundsPlayed(r => r + 1);
                        } else {
                            setAttemptCount(c => c + 1);
                        }
                        startNewRound();
                    }}>
                        Continue
                    </button>
                </div>
            )}

            {/* ---------- PROGRESS ARCHIVE ---------- */}
            {showProgressArchive && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>📜 Archives of Progress</h3>
                        {userReports.map((r, i) => (
                            <div key={i} className="report-box">
                                <p><strong>Date-Time:</strong> {new Date(r.timestamp).toLocaleString()}</p>
                                <p><strong>Average secs per answer:</strong> {r.avgSecondsPerAnswer}s</p>
                                <p><strong>Accuracy:</strong> {r.accuracy}%</p>
                                <p><strong>Rating:</strong> {r.rating}</p>
                                <p><strong>Recommendation:</strong> {r.recommendation}</p>
                            </div>
                        ))}
                        <button onClick={() => setShowProgressArchive(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
