import { auth, db } from "../../firebase";
import { fetchFragmentFromAI } from "../../api/ai";

// Constant for the Session Storage key
// Constants
const GAME_SESSION_KEY = "moirai_game_session";
const GENRE_OPTIONS = ['Random', 'Fantasy', 'Sci-Fi', 'Mystery', 'Romance', 'Horror', 'Cyberpunk', 'Noir'];
const MODE_OPTIONS = ['Random', 'Story'];

export function Game({ user, onSignOut }) {
// --- Game & User Stats ---
@@ -27,8 +28,10 @@ export function Game({ user, onSignOut }) {
const [revelationText, setRevelationText] = useState(null);
const [errorMessage, setErrorMessage] = useState(null);

    // Genre State
    // Mode & Genre State
const [selectedGenre, setSelectedGenre] = useState('Random');
    const [gameMode, setGameMode] = useState('Random');
    const [storyHistory, setStoryHistory] = useState([]); // Context for Story Mode

const [attemptCount, setAttemptCount] = useState(0); 
const [totalRoundsPlayed, setTotalRoundsPlayed] = useState(0);
@@ -88,7 +91,7 @@ export function Game({ user, onSignOut }) {
}
}, [user]);

    // --- Start New Round ---
    // --- Start New Round (Supports Story History) ---
const startNewRound = useCallback(async (currentDifficulty) => {
setGameState('loading');
setErrorMessage(null);
@@ -99,17 +102,34 @@ export function Game({ user, onSignOut }) {
const effectiveDifficulty = currentDifficulty || stats.difficultyTier;
const randomSecretTag = classifierOptions[Math.floor(Math.random() * classifierOptions.length)];

        // Determine the genre for this specific call
const activeGenre = selectedGenre === 'Random' 
? GENRE_OPTIONS[Math.floor(Math.random() * (GENRE_OPTIONS.length - 1)) + 1] 
: selectedGenre;

try {
            // Updated fetch call to include the genre parameter
            const { fragmentText, revelationText: revText } = await fetchFragmentFromAI(effectiveDifficulty, randomSecretTag, activeGenre);
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
@@ -124,11 +144,10 @@ export function Game({ user, onSignOut }) {
console.error("Fragment generation failed:", error);
setSecretTag("ERROR");
setRevelationText("Due to a system failure, the true causal force cannot be determined.");
            setCurrentFragment("");
setGameState('error');
showAlert("AI Generation Error", error.message || String(error));
}
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions, selectedGenre]);
    }, [stats.difficultyTier, attemptCount, showAlert, classifierOptions, selectedGenre, gameMode, storyHistory]);

// --- Load User Stats & Session ---
useEffect(() => {
@@ -184,6 +203,8 @@ export function Game({ user, onSignOut }) {
setAttemptCount(sessionData.attemptCount);
setTotalRoundsPlayed(sessionData.totalRoundsPlayed);
if(sessionData.selectedGenre) setSelectedGenre(sessionData.selectedGenre);
                        if(sessionData.gameMode) setGameMode(sessionData.gameMode);
                        if(sessionData.storyHistory) setStoryHistory(sessionData.storyHistory);
setIsSessionActive(true);
} else {
sessionStorage.removeItem(GAME_SESSION_KEY);
@@ -212,6 +233,8 @@ export function Game({ user, onSignOut }) {
attemptCount,
totalRoundsPlayed,
selectedGenre,
                gameMode,
                storyHistory,
currentScore: stats.currentScore,
currentStreak: stats.currentStreak,
difficultyTier: stats.difficultyTier,
@@ -220,7 +243,7 @@ export function Game({ user, onSignOut }) {
};
sessionStorage.setItem(GAME_SESSION_KEY, JSON.stringify(sessionData));
}
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre]);
    }, [user, gameState, currentFragment, secretTag, revelationText, attemptCount, totalRoundsPlayed, stats, selectedGenre, gameMode, storyHistory]);

const resumeSession = () => {
const storedSession = sessionStorage.getItem(GAME_SESSION_KEY);
@@ -234,6 +257,8 @@ export function Game({ user, onSignOut }) {
setAttemptCount(sessionData.attemptCount);
setTotalRoundsPlayed(sessionData.totalRoundsPlayed);
if(sessionData.selectedGenre) setSelectedGenre(sessionData.selectedGenre);
        if(sessionData.gameMode) setGameMode(sessionData.gameMode);
        if(sessionData.storyHistory) setStoryHistory(sessionData.storyHistory);

setStats(prevStats => ({
...prevStats,
@@ -251,6 +276,7 @@ export function Game({ user, onSignOut }) {
sessionStorage.removeItem(GAME_SESSION_KEY);
setStats(prev => ({ ...prev, currentScore: 0, currentStreak: 0 }));
setAttemptCount(0);
        setStoryHistory([]);
setIsSessionActive(false);
setGameState('ready_to_start');
};
@@ -334,26 +360,27 @@ export function Game({ user, onSignOut }) {
padding: '0.5rem 0.75rem', borderRadius: '4px', cursor: 'pointer',
};

    const genreContainerStyle = {
        margin: '20px auto',
    const configContainerStyle = {
        margin: '10px auto',
padding: '15px',
background: 'rgba(26, 26, 26, 0.6)',
borderRadius: '12px',
border: '1px solid #333',
        maxWidth: '400px',
        maxWidth: '450px',
textAlign: 'center'
};

    const genreSelectStyle = {
    const selectStyle = {
background: '#000',
        color: '#d4af37', // Gold archival color
        color: '#d4af37',
border: '1px solid #d4af37',
padding: '8px 12px',
borderRadius: '4px',
fontSize: '1rem',
fontFamily: 'serif',
cursor: 'pointer',
        outline: 'none'
        outline: 'none',
        margin: '0 5px'
};

if (gameState === 'loading' && !initialLoadComplete) {
@@ -439,65 +466,55 @@ export function Game({ user, onSignOut }) {
</div>
)}

            {/* Metrics Tally */}

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
                    <p className="metric-label">Round Attempts:</p>
                    <p className="metric-label">Round Steps:</p>
<p className="metric-value">{displayAttemptCount} / 5</p>
</div>
<div className="metric">
<span className="metric-icon">⚡</span>
                    <p className="metric-label">Current Score:</p>
                    <p className="metric-label">Score:</p>
<p className="metric-value">{stats.currentScore}</p>
</div>
                <div className="metric">
                    <span className="metric-icon">⭐</span>
                    <p className="metric-label">Highest Score:</p>
                    <p className="metric-value">{stats.highestScore}</p>
                </div>
<div className="metric">
<span className="metric-icon">❤</span>
                    <p className="metric-label">Current Streak:</p>
                    <p className="metric-label">Streak:</p>
<p className="metric-value">{stats.currentStreak}</p>
</div>
<div className="metric">
                    <span className="metric-icon">🏆</span>
                    <p className="metric-label">Highest Streak:</p>
                    <p className="metric-value">{stats.highestStreak}</p>
                </div>
                <div className="metric">
                    <span className="metric-icon"> tier</span>
                    <p className="metric-label">Difficulty Tier:</p>
                    <span className="metric-icon">🛡️</span>
                    <p className="metric-label">Tier:</p>
<p className="metric-value">{stats.difficultyTier}</p>
</div>
<div className="metric">
<span className="metric-icon">✅</span>
                    <p className="metric-label">Total Correct:</p>
                    <p className="metric-label">Correct:</p>
<p className="metric-value">{stats.totalCorrect}</p>
</div>
                <div className="metric">
                    <span className="metric-icon">❌</span>
                    <p className="metric-label">Total Incorrect:</p>
                    <p className="metric-value">{stats.totalIncorrect}</p>
                </div>
<div className="metric">
<span className="metric-icon">🎯</span>
                    <p className="metric-label">Accuracy Rate:</p>
                    <p className="metric-label">Accuracy:</p>
<p className="metric-value">{accuracyRate}%</p>
</div>
</div>

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
</div>
