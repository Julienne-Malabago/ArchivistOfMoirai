import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
} from "firebase/firestore";
import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

/* ===================== CONSTANTS ===================== */

const GAME_SESSION_KEY = "moirai_game_session";
const GENRE_OPTIONS = [
  "Random",
  "Fantasy",
  "Sci-Fi",
  "Mystery",
  "Romance",
  "Horror",
  "Cyberpunk",
  "Noir",
];
const MODE_OPTIONS = ["Random", "Story"];
const classifierOptions = ["FATE", "CHOICE", "CHANCE"];

/* ===================== GAME ===================== */

export function Game({ user, onSignOut }) {
  /* ---------- STATS ---------- */
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

  const [gameState, setGameState] = useState("loading");
  const [currentFragment, setCurrentFragment] = useState("");
  const [userClassification, setUserClassification] = useState(null);
  const [secretTag, setSecretTag] = useState(null);
  const [revelationText, setRevelationText] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  /* ---------- MODE ---------- */
  const [selectedGenre, setSelectedGenre] = useState("Random");
  const [gameMode, setGameMode] = useState("Random");
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

  /* ---------- REPORTS ---------- */
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
      : "N/A";

  const displayAttemptCount = attemptCount + 1;

  /* ===================== DROPDOWN CLOSE ===================== */

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ===================== UPDATE STATS ===================== */

  const updateStatsInDb = useCallback(
    async (newStats, roundsPlayed) => {
      if (!user || !user.uid) return;
      await updateDoc(doc(db, "users", user.uid), {
        currentScore: newStats.currentScore,
        currentStreak: newStats.currentStreak,
        highestStreak: newStats.highestStreak,
        difficultyTier: newStats.difficultyTier,
        highestScore: newStats.highestScore,
        totalRoundsPlayed: roundsPlayed,
        totalCorrect: newStats.totalCorrect,
        totalIncorrect: newStats.totalIncorrect,
      });
    },
    [user]
  );

  /* ===================== REPORT UPSERT ===================== */

  const upsertUserReport = async () => {
    if (!user) return;

    const reportRef = doc(db, "user_reports", user.uid);
    const snap = await getDoc(reportRef);

    const avgSeconds =
      attemptTimes.length > 0
        ? Math.round(
            attemptTimes.reduce((a, b) => a + b, 0) / attemptTimes.length
          )
        : 0;

    const accuracy =
      totalAttempts > 0
        ? Math.round((stats.totalCorrect / totalAttempts) * 100)
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
      recommendation,
    };

    if (!snap.exists()) {
      await setDoc(reportRef, {
        userId: user.uid,
        createdAt: new Date().toISOString(),
        reports: [entry],
      });
    } else {
      await updateDoc(reportRef, {
        reports: arrayUnion(entry),
      });
    }

    setAttemptTimes([]);
  };

  /* ===================== LOAD REPORTS ===================== */

  useEffect(() => {
    if (!showProgressArchive || !user) return;

    const loadReports = async () => {
      const snap = await getDoc(doc(db, "user_reports", user.uid));
      if (snap.exists()) setUserReports(snap.data().reports || []);
    };

    loadReports();
  }, [showProgressArchive, user]);

  /* ===================== START NEW ROUND ===================== */

  const startNewRound = useCallback(
    async (currentDifficulty) => {
      setGameState("loading");
      setErrorMessage(null);
      setUserClassification(null);
      setRevelationText(null);
      setCurrentFragment("");
      setAttemptStartTime(Date.now());

      const effectiveDifficulty =
        currentDifficulty || stats.difficultyTier;
      const randomSecretTag =
        classifierOptions[Math.floor(Math.random() * classifierOptions.length)];
      const activeGenre =
        selectedGenre === "Random"
          ? GENRE_OPTIONS[
              Math.floor(Math.random() * (GENRE_OPTIONS.length - 1)) + 1
            ]
          : selectedGenre;

      const contextHistory = gameMode === "Story" ? storyHistory : [];

      const { fragmentText, revelationText: revText } =
        await fetchFragmentFromAI(
          effectiveDifficulty,
          randomSecretTag,
          activeGenre,
          contextHistory
        );

      const nextAttemptCount = attemptCount === 4 ? 0 : attemptCount + 1;

      if (gameMode === "Story") {
        if (nextAttemptCount === 0) setStoryHistory([]);
        else setStoryHistory((prev) => [...prev, fragmentText]);
      } else {
        setStoryHistory([]);
      }

      if (nextAttemptCount === 0) {
        setTotalRoundsPlayed((r) => r + 1);
        await upsertUserReport();
      }

      setAttemptCount(nextAttemptCount);
      setSecretTag(randomSecretTag);
      setCurrentFragment(fragmentText);
      setRevelationText(revText);
      setGameState("playing");
    },
    [
      stats.difficultyTier,
      attemptCount,
      selectedGenre,
      gameMode,
      storyHistory,
    ]
  );

  /* ===================== CLASSIFY ===================== */

  const handleClassification = (choice) => {
    if (gameState !== "playing") return;

    const secondsSpent = Math.round(
      (Date.now() - attemptStartTime) / 1000
    );
    setAttemptTimes((prev) => [...prev, secondsSpent]);

    setUserClassification(choice);
    setGameState("revealing");

    const isCorrect = choice === secretTag;
    let newStats = { ...stats };

    if (isCorrect) {
      newStats.currentScore += 10;
      newStats.currentStreak += 1;
      newStats.totalCorrect += 1;

      if (newStats.currentStreak > newStats.highestStreak)
        newStats.highestStreak = newStats.currentStreak;
      if (newStats.currentScore > newStats.highestScore)
        newStats.highestScore = newStats.currentScore;

      if (
        newStats.currentStreak > 0 &&
        newStats.currentStreak % 5 === 0
      ) {
        newStats.difficultyTier += 1;
        showAlert(
          "Promotion Achieved",
          `Archivist Promotion! Difficulty Tier is now ${newStats.difficultyTier}.`
        );
      }
    } else {
      newStats.currentStreak = 0;
      newStats.totalIncorrect += 1;
    }

    setStats(newStats);
    updateStatsInDb(newStats, totalRoundsPlayed);
  };

  /* ===================== SIGN OUT ===================== */

  const handleSignOut = async () => {
    sessionStorage.removeItem(GAME_SESSION_KEY);
    await updateStatsInDb(
      { ...stats, currentScore: 0, currentStreak: 0 },
      totalRoundsPlayed
    );
    onSignOut();
  };

  /* ===================== UI ===================== */

  return (
    <div className="game-container">
      {/* ERROR MODAL */}
      {errorMessage && (
        <div className="custom-modal-overlay">
          <div className="custom-modal-content">
            <h3>{errorMessage.title}</h3>
            <p>{errorMessage.message}</p>
            <button onClick={() => setErrorMessage(null)}>
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="game-header ribbon-layout">
        <div className="ribbon-left">
          <span>✨</span>
          <h1>ARCHIVIST OF MOIRAI</h1>
        </div>

        <div className="ribbon-right" ref={dropdownRef}>
          <span onClick={() => setProfileDropdownOpen((p) => !p)}>📜</span>
          {profileDropdownOpen && (
            <div className="dropdown">
              <p>
                <strong>Username:</strong> {stats.username}
              </p>
              <button onClick={() => setShowProgressArchive(true)}>
                📚 Archives of Progress
              </button>
              <button onClick={() => setEditProfileOpen(true)}>
                🪶 Edit Profile
              </button>
              <button onClick={handleSignOut}>🗝️ Log Out</button>
            </div>
          )}
        </div>
      </header>

      {/* METRICS */}
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

      {/* FRAGMENT */}
      <div className="archival-scroll">
        <h3>
          {gameMode === "Story"
            ? `The Eternal Chronicle (Part ${displayAttemptCount})`
            : "The Archival Scroll"}
        </h3>
        <p>
          {gameState === "loading"
            ? "Accessing the Archival Stream..."
            : currentFragment}
        </p>
      </div>

      {/* CLASSIFIER */}
      {gameState === "playing" && (
        <div className="classifier">
          {classifierOptions.map((opt) => (
            <button key={opt} onClick={() => handleClassification(opt)}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* REVELATION */}
      {gameState === "revealing" && (
        <div className="revelation-panel">
          <h2>
            {userClassification === secretTag
              ? "✅ Axiom Confirmed"
              : "❌ Axiom Error"}
          </h2>
          <p>
            <strong>True Force:</strong> {secretTag}
          </p>
          <p>{revelationText}</p>
          <button onClick={() => startNewRound(stats.difficultyTier)}>
            {attemptCount === 0 ? "Begin Next Round" : "Next Fragment"}
          </button>
        </div>
      )}

      {/* PROGRESS ARCHIVE */}
      {showProgressArchive && (
        <div className="custom-modal-overlay">
          <div className="custom-modal-content">
            <h3>📜 Archives of Progress</h3>
            {userReports.map((r, i) => (
              <div key={i} className="report-box">
                <p>
                  <strong>Date:</strong>{" "}
                  {new Date(r.timestamp).toLocaleString()}
                </p>
                <p>
                  <strong>Avg Seconds:</strong>{" "}
                  {r.avgSecondsPerAnswer}s
                </p>
                <p>
                  <strong>Accuracy:</strong> {r.accuracy}%
                </p>
                <p>
                  <strong>Rating:</strong> {r.rating}
                </p>
                <p>
                  <strong>Recommendation:</strong>{" "}
                  {r.recommendation}
                </p>
              </div>
            ))}
            <button onClick={() => setShowProgressArchive(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
