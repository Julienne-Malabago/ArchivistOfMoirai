import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

const GAME_SESSION_KEY = "moirai_game_session";

export function Game({ user, onSignOut }) {
    // --- User Stats ---
    const [stats, setStats] = useState({
        username: "The Archivist",
        currentScore: 0,
        currentStreak: 0,
        highestStreak: 0,
        difficultyTier: 1,
        highestScore: 0,
        totalCorrect: 0,
        totalIncorrect: 0,
    });

    // --- Game State ---
    const [gameState, setGameState] = useState("loading"); // loading, playing, revealing, error, ready_to_start
    const [currentFragment, setCurrentFragment] = useState("");
    const [userClassification, setUserClassification] = useState(null);
    const [secretTag, setSecretTag] = useState(null);
    const [revelationText, setRevelationText] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    const [attemptCount, setAttemptCount] = useState(1);
    const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // --- Profile & Dropdown ---
    const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [newUsername, setNewUsername] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");
    const dropdownRef = useRef(null);

    const classifierOptions = ["FATE", "CHOICE", "CHANCE"];

    const showAlert = useCallback((title, message) => {
        setErrorMessage({ title, message });
    }, []);

    const totalAttempts = stats.totalCorrect + stats.totalIncorrect;
    const accuracyRate =
        totalAttempts > 0
            ? ((stats.totalCorrect / totalAttempts) * 100).toFixed(1)
            : "N/A";

    // --- Profile Dropdown Outside Click ---
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
    const updateStatsInDb = useCallback(
        async (newStats) => {
            if (!user?.uid) return;
            try {
                await updateDoc(doc(db, "users", user.uid), {
                    username: newStats.username,
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
                console.error("Error updating stats:", error);
            }
        },
        [user, totalRoundsPlayed, attemptCount]
    );

    // --- Load User & Session ---
    useEffect(() => {
        const fetchUserDataAndSession = async () => {
            setGameState("loading");
            if (!user) return;

            try {
                const docSnap = await getDoc(doc(db, "users", user.uid));
                const permanentStats = docSnap.exists() ? docSnap.data() : {};
                setStats((s) => ({
                    ...s,
                    username: permanentStats.username || "The Archivist",
                    highestStreak: permanentStats.highestStreak || 0,
                    difficultyTier: permanentStats.difficultyTier || 1,
                    highestScore: permanentStats.highestScore || 0,
                    totalCorrect: permanentStats.totalCorrect || 0,
                    totalIncorrect: permanentStats.totalIncorrect || 0,
                }));
                setAttemptCount(permanentStats.attemptCount ?? 1);
                setTotalRoundsPlayed(permanentStats.totalRoundsPlayed || 0);

                // Load session
                const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
                if (storedSession) {
                    const sessionData = JSON.parse(storedSession);
                    if (sessionData.userId === user.uid) {
                        setStats((prev) => ({
                            ...prev,
                            currentScore: sessionData.currentScore ?? prev.currentScore,
                            currentStreak: sessionData.currentStreak ?? prev.currentStreak,
                            highestScore: Math.max(prev.highestScore, sessionData.highestScore || 0),
                            highestStreak: Math.max(prev.highestStreak, sessionData.highestStreak || 0),
                            difficultyTier: sessionData.difficultyTier ?? prev.difficultyTier,
                        }));
                        setAttemptCount(sessionData.attemptCount ?? 1);
                        setTotalRoundsPlayed(
                            sessionData.totalRoundsPlayed ?? permanentStats.totalRoundsPlayed ?? 0
                        );
                        setCurrentFragment(sessionData.currentFragment || "");
                        setSecretTag(sessionData.secretTag || null);
                        setRevelationText(sessionData.revelationText || null);
                        setGameState(sessionData.gameState || "ready_to_start");
                    } else sessionStorage.removeItem(GAME_SESSION_KEY);
                } else setGameState("ready_to_start");
            } catch (error) {
                console.error("Error fetching user data:", error);
                showAlert("Data Error", "Could not load user progress.");
                setGameState("error");
            }
            setInitialLoadComplete(true);
        };
        fetchUserDataAndSession();
    }, [user, showAlert]);

    // --- Persist Session ---
    useEffect(() => {
        if (user) {
            sessionStorage.setItem(
                GAME_SESSION_KEY,
                JSON.stringify({
                    userId: user.uid,
                    currentFragment,
                    secretTag,
                    revelationText,
                    gameState,
                    attemptCount,
                    totalRoundsPlayed,
                    currentScore: stats.currentScore,
                    currentStreak: stats.currentStreak,
                    highestScore: stats.highestScore,
                    highestStreak: stats.highestStreak,
                    difficultyTier: stats.difficultyTier,
                })
            );
        }
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats]);

    // --- Start New Fragment ---
    const startNewFragment = useCallback(
        async (currentDifficulty) => {
            if (attemptCount > 5) return showAlert("No Attempts Remaining", "All 5 attempts used.");
            setGameState("loading");
            setErrorMessage(null);
            setUserClassification(null);
            setRevelationText(null);
            setCurrentFragment("");

            const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
            const randomSecretTag = classifierOptions[Math.floor(Math.random() * classifierOptions.length)];

            try {
                const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(
                    effectiveDifficulty,
                    randomSecretTag
                );
                setSecretTag(randomSecretTag);
                setCurrentFragment(fragmentText);
                setRevelationText(revText);
                setGameState("playing");
            } catch (error) {
                console.error("Fragment generation failed:", error);
                setSecretTag("ERROR");
                setCurrentFragment("");
                setRevelationText("System error.");
                setGameState("error");
                showAlert("AI Error", error.message || String(error));
            }
        },
        [attemptCount, stats.difficultyTier, showAlert]
    );

    // --- Classification ---
    const handleClassification = (choice) => {
        if (gameState !== "playing") return;
        setUserClassification(choice);
        setGameState("revealing");

        const isCorrect = choice === secretTag;
        let newStats = { ...stats };
        let promotionMessage = null;

        if (isCorrect) {
            newStats.currentScore += 10;
            newStats.currentStreak += 1;
            newStats.totalCorrect += 1;
            newStats.highestStreak = Math.max(newStats.highestStreak, newStats.currentStreak);
            newStats.highestScore = Math.max(newStats.highestScore, newStats.currentScore);
            if (newStats.currentStreak % 5 === 0) {
                newStats.difficultyTier += 1;
                promotionMessage = `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}.`;
            }
        } else {
            newStats.currentStreak = 0;
            newStats.totalIncorrect += 1;
        }

        let nextAttemptCount = attemptCount + 1;
        let updatedTotalRounds = totalRoundsPlayed;
        if (nextAttemptCount > 5) {
            updatedTotalRounds += 1;
            nextAttemptCount = 1;
        }

        setStats(newStats);
        setAttemptCount(nextAttemptCount);
        setTotalRoundsPlayed(updatedTotalRounds);

        updateStatsInDb({
            ...newStats,
            attemptCount: nextAttemptCount,
            totalRoundsPlayed: updatedTotalRounds,
        });

        if (promotionMessage) showAlert("Promotion Achieved", promotionMessage);
    };

    // --- Profile Functions ---
    const handleSignOut = () => onSignOut?.();
    const handleUsernameChange = async () => {
        if (!newUsername.trim()) return showAlert("Error", "Username cannot be empty.");
        const updatedStats = { ...stats, username: newUsername.trim() };
        setStats(updatedStats);
        await updateStatsInDb(updatedStats);
        setNewUsername("");
        setEditProfileOpen(false);
    };
    const handlePasswordChange = () => {
        showAlert("Info", "Password change not implemented.");
    };

    const displayAttemptCount = attemptCount;

    const dropdownStyles = {
        display: profileDropdownOpen ? "block" : "none",
        position: "absolute",
        right: 0,
        top: "2.5rem",
        background: "#222",
        color: "#fff",
        padding: "0.5rem",
        borderRadius: "0.25rem",
        width: "200px",
        zIndex: 10,
    };
    const dropdownButtonStyles = {
        width: "100%",
        padding: "0.25rem",
        background: "#222",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        marginBottom: "0.25rem",
    };

    return (
        <div className="game-container">
            {/* Error Modal */}
            {errorMessage && (
                <div className="custom-modal-overlay">
                    <div className="custom-modal-content">
                        <h3>{errorMessage.title}</h3>
                        <p>{errorMessage.message}</p>
                        <button onClick={() => setErrorMessage(null)} className="button-primary">
                            Acknowledge
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="game-header ribbon-layout" style={{ position: "relative" }}>
                <div className="header-left">
                    <h1>ARCHIVIST OF MOIRAI ✨</h1>
                </div>
                <div className="header-right" style={{ position: "relative" }} ref={dropdownRef}>
                    <span style={{ fontSize: "2rem", cursor: "pointer" }} onClick={() => setProfileDropdownOpen(prev => !prev)}>📜</span>
                    <div style={dropdownStyles}>
                        <p><strong>Username:</strong> {stats.username}</p>
                        <p><strong>UserID:</strong> {user?.uid}</p>
                        <hr style={{ borderColor: "#555", margin: "0.5rem 0" }} />
                        <button style={dropdownButtonStyles} onClick={() => { setEditProfileOpen(true); setProfileDropdownOpen(false); }}>🪶 Edit Profile</button>
                        <button style={dropdownButtonStyles} onClick={handleSignOut}>🗝️ Log Out</button>
                    </div>
                </div>
            </header>

            {/* Edit Profile */}
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

            {/* Metrics */}
            <div className="metrics-tally" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "1rem" }}>
                {[
                    { icon: "#", label: "Total Rounds", value: totalRoundsPlayed },
                    { icon: "🎯", label: "Round Attempts", value: `${displayAttemptCount}/5` },
                    { icon: "⚡", label: "Current Score", value: stats.currentScore },
                    { icon: "⭐", label: "Highest Score", value: stats.highestScore },
                    { icon: "❤", label: "Current Streak", value: stats.currentStreak },
                    { icon: "🏆", label: "Highest Streak", value: stats.highestStreak },
                    { icon: "🎚️", label: "Difficulty Tier", value: stats.difficultyTier },
                    { icon: "✅", label: "Total Correct", value: stats.totalCorrect },
                    { icon: "❌", label: "Total Incorrect", value: stats.totalIncorrect },
                    { icon: "🎯", label: "Accuracy Rate", value: `${accuracyRate}%` },
                ].map((m, i) => (
                    <div key={i} className="metric" style={{ border: "1px solid #555", padding: "0.5rem", borderRadius: "0.25rem", width: "120px" }}>
                        <span className="metric-icon" style={{ fontSize: "1.2rem" }}>{m.icon}</span>
                        <p className="metric-label">{m.label}</p>
                        <p className="metric-value">{m.value}</p>
                    </div>
                ))}
            </div>

            {/* Fragment Display */}
            <div className="archival-scroll fragment-container" style={{ marginTop: "1rem" }}>
                <h3>The Archival Scroll (Fragment)</h3>
                <p>{gameState === "loading" || gameState === "error"
                    ? "Accessing the Archival Stream..."
                    : currentFragment || "Press 'Start Round' to access a fragment from the Moirai Archives..."}</p>
            </div>

            {/* Classification Buttons */}
            {gameState === "playing" && (
                <div className="classification-buttons" style={{ marginTop: "1rem" }}>
                    {classifierOptions.map(option => (
                        <button key={option} onClick={() => handleClassification(option)} style={{ marginRight: "0.5rem" }}>
                            {option}
                        </button>
                    ))}
                </div>
            )}

            {/* Revelation Panel */}
            {(gameState === "revealing" || gameState === "error") && (
                <div className="revelation-overlay">
                    <div className="revelation-panel">
                        <h2>{userClassification === secretTag ? "✅ Correct" : "❌ Incorrect"}</h2>
                        <p>The True Causal Force: {secretTag}</p>
                        <p>Revelation Text: {revelationText}</p>
                        <button onClick={() => startNewFragment(stats.difficultyTier)}>Continue</button>
                    </div>
                </div>
            )}

            {/* Ready to Start */}
            {gameState === "ready_to_start" && (
                <div className="start-game-section" style={{ marginTop: "1rem" }}>
                    <button onClick={() => startNewFragment(stats.difficultyTier)}>Start Round</button>
                </div>
            )}
        </div>
    );
}
