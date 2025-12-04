import React, { useState, useEffect } from "react";
import { 
    getAuth,
    onAuthStateChanged,
    signOut as firebaseSignOut,
    signInWithCustomToken,
    signInAnonymously
} from 'firebase/auth';
import { 
    initializeApp 
} from 'firebase/app';
import { 
    getFirestore,
    doc, 
    onSnapshot, // Crucial for real-time score updates
    setLogLevel,
    getDoc,
    setDoc
} from 'firebase/firestore';

// --- THEME COLORS (Reference from user's CSS) ---
// --color-dark-teal: #1a1a2e;
// --color-parchment: #f7f4e9;
// --color-dark-text: #363636;
// --color-gold: #ffd700; 

// --- GLOBAL VARIABLES INJECTION ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'archivist-moirai';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- FIREBASE INITIALIZATION ---
let firebaseApp;
let auth;
let db;

try {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    setLogLevel('error'); // Set level to error to reduce console noise unless needed
} catch (e) {
    console.error("Firebase initialization failed:", e);
    auth = null;
    db = null;
}

// --- UTILITY: Profile Data Fetcher/Listener ---
const useUserProfile = (currentUser) => {
    const [profile, setProfile] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);

    useEffect(() => {
        if (!db || !currentUser || currentUser.isAnonymous) {
            setProfile(null);
            setProfileLoading(false);
            return;
        }

        const userID = currentUser.uid;
        // Path: /artifacts/{appId}/users/{userId}/profiles/{userId}
        const profileDocRef = doc(db, `artifacts/${appId}/users/${userID}/profiles`, userID);

        // Fetch initial data, or ensure it exists if this is the first time logging in
        const initializeProfile = async () => {
             const docSnap = await getDoc(profileDocRef);
             if (!docSnap.exists()) {
                 console.warn("User profile not found, initializing basic data.");
                 await setDoc(profileDocRef, {
                    email: currentUser.email || 'N/A',
                    username: currentUser.displayName || currentUser.email.split('@')[0], 
                    score: 0,   
                    streak: 0,
                    highestStreak: 0,
                    joinedDate: new Date().toISOString(),
                    uid: userID
                });
             }
        };

        initializeProfile();
        
        // Setup real-time listener
        const unsubscribe = onSnapshot(profileDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setProfile({ ...docSnap.data(), id: docSnap.id });
            } else {
                setProfile({ score: 0, streak: 0, highestStreak: 0, username: 'Archivist' }); 
            }
            setProfileLoading(false);
        }, (error) => {
            console.error("Error listening to user profile:", error);
            setProfileLoading(false);
        });

        return () => unsubscribe(); // Clean up listener
    }, [currentUser]);

    return { profile, profileLoading };
}

// --- MAIN GAME DASHBOARD COMPONENT ---
export default function App() {
    // Authentication State
    const [currentUser, setCurrentUser] = useState(null); 
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [message, setMessage] = useState({ text: "", type: "" });
    
    // Game State & Profile Data
    const { profile, profileLoading } = useUserProfile(currentUser);
    const [fragmentText, setFragmentText] = useState("Click 'Generate Fragment' to begin weaving the narrative...");
    const [isRevelationVisible, setIsRevelationVisible] = useState(false);
    const [selectedAxiom, setSelectedAxiom] = useState(null);
    const [correctAxiom, setCorrectAxiom] = useState(null);
    const [revelationText, setRevelationText] = useState("");
    const [isGameLoading, setIsGameLoading] = useState(false);

    // --- INITIAL AUTH & SIGN-IN (Runs once on mount) ---
    useEffect(() => {
        if (!auth) {
            setIsAuthLoading(false);
            setMessage({ text: "System Error: Firebase initialization failed.", type: "error" });
            return;
        }

        const handleInitialAuth = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Initial sign-in failed:", error);
            }

            const unsubscribe = onAuthStateChanged(auth, (user) => {
                setCurrentUser(user);
                setIsAuthLoading(false);
            });
            return () => unsubscribe();
        };

        handleInitialAuth();
    }, []);

    // --- GAME LOGIC PLACEHOLDERS ---
    // Note: In a real app, this logic would live on a Flask backend and communicate via API calls.
    const handleGenerateFragment = () => {
        setIsGameLoading(true);
        setFragmentText("The Fragment Weaver is at work... constructing a sophisticated deception...");
        setSelectedAxiom(null);
        setIsRevelationVisible(false);

        // Simulate API delay and result
        setTimeout(() => {
            setFragmentText(
                "In the gilded clockwork city of Aethel, the inventor Kael needed one gear—the Chronos wheel—to complete his Perpetual Engine. He had two options: pay the price to the Merchant Guild and bankrupt his family (Choice A), or steal the wheel from the forgotten Catacombs, risking eternal exile (Choice B). He chose A, believing he controlled his fate. However, the wheel he purchased was sabotaged years ago by a rogue Artisan, ensuring the Engine would fail regardless of his moral decision. The failure triggered a city-wide power surge that was inevitable the moment the component was crafted."
            );
            setCorrectAxiom('Fate'); 
            setIsGameLoading(false);
        }, 3000);
    };

    const handleAxiomClassification = (choice) => {
        if (isRevelationVisible || isGameLoading) return;
        
        setSelectedAxiom(choice);
        setIsRevelationVisible(true);
        setIsGameLoading(true);

        const isCorrect = choice === correctAxiom;

        let newRevelationText = "";
        let newScore = profile.score || 0;
        let newStreak = profile.streak || 0;
        let newHighestStreak = profile.highestStreak || 0;

        if (isCorrect) {
            newScore += 10;
            newStreak += 1;
            newHighestStreak = Math.max(newHighestStreak, newStreak);
            newRevelationText = `CORRECT! The true causal force was ${correctAxiom}. Kael's choice was merely the mechanism of delivery. The Chronos Wheel was always destined to fail, rendering his choice irrelevant to the inevitable system collapse. The Fragment Weaver's narrative suggested Choice, but the underlying causality was Fate.`;
        } else {
            newStreak = 0;
            newRevelationText = `INCORRECT. The true causal force was ${correctAxiom}. You classified it as ${choice}. Kael's decision to buy the wheel strongly suggested Choice, but the sabotage happened long ago (a form of Fate), guaranteeing failure no matter what he did. The narrative deception was successful.`;
        }

        setRevelationText(newRevelationText);

        // --- UPDATE FIRESTORE PROFILE ---
        if (currentUser && !currentUser.isAnonymous && db) {
            const userID = currentUser.uid;
            const profileDocRef = doc(db, `artifacts/${appId}/users/${userID}/profiles`, userID);
            setDoc(profileDocRef, { 
                score: newScore, 
                streak: newStreak, 
                highestStreak: newHighestStreak 
            }, { merge: true }).catch(err => {
                console.error("Failed to update profile:", err);
            });
        }

        setIsGameLoading(false);
    };

    const handleCloseRevelation = () => {
        setIsRevelationVisible(false);
        setFragmentText("Ready for the next Fragment...");
    }

    const handleSignOut = async () => {
        await firebaseSignOut(auth);
    }
    
    // --- RENDER CHECKS ---
    const LoadingSpinner = (
        <div className="flex items-center justify-center min-h-screen bg-[#1a1a2e] text-[#f7f4e9] font-['Playfair_Display']">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd700]"></div>
            <p className="ml-3 text-[#ffd700]">Establishing link to the Athenaeum...</p>
        </div>
    );

    if (isAuthLoading || profileLoading) {
        return LoadingSpinner;
    }

    if (!currentUser || currentUser.isAnonymous) {
        return (
            <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-8 text-[#f7f4e9] font-['Playfair_Display']">
                <style>
                    {`
                        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
                    `}
                </style>
                <div className="max-w-md w-full text-center p-8 bg-[#f7f4e9] text-[#363636] rounded-xl shadow-2xl border-4 border-[#ffd700] transition-all duration-300 hover:shadow-[0_0_20px_#ffd700]">
                    <h1 className="text-3xl font-['Cinzel'] text-[#5d4037] mb-4 tracking-wider">Access Denied</h1>
                    <p className="text-[#363636] mb-6">You must be logged in with a permanent account to access the Archivist's dashboard and persist your progress.</p>
                    <p className="text-sm text-[#795548]">Please return to the previous screen and sign up/log in.</p>
                    <p className="text-xs mt-4 break-all">UID: {currentUser?.uid || 'N/A'}</p>
                    <button 
                        onClick={handleSignOut} 
                        className="mt-6 py-2 px-6 bg-[#ffd700] hover:bg-[#b8860b] text-[#363636] font-['Cinzel'] rounded-lg font-semibold transition duration-200 shadow-md"
                    >
                        Sign Out (Return)
                    </button>
                </div>
            </div>
        );
    }

    // --- MAIN DASHBOARD RENDER COMPONENTS ---
    const TallyCard = ({ title, value, colorClass }) => (
        <div className={`p-4 rounded-lg shadow-xl text-center bg-[#f7f4e9]/95 border-t-4 ${colorClass} transition-all duration-300 hover:shadow-2xl`}>
            <div className="text-3xl font-extrabold text-[#363636] font-['Cinzel']">{value}</div>
            <div className="text-sm font-medium text-[#795548] mt-1">{title}</div>
        </div>
    );

    const ClassifierButton = ({ label, axiom, onClick, isDisabled }) => {
        const baseStyle = "w-full py-4 text-lg font-bold rounded-xl transition duration-300 shadow-2xl transform hover:scale-[1.03] border-2";
        let colorStyle = "";
        
        // Thematic colors: Fate (Red/Maroon), Choice (Gold/Parchment), Chance (Deep Teal/Blue)
        switch (axiom) {
            case 'Fate':
                colorStyle = "bg-[#cc0000] hover:bg-red-800 text-[#f7f4e9] border-[#f7f4e9]";
                break;
            case 'Choice':
                colorStyle = "bg-[#ffd700] hover:bg-[#b8860b] text-[#363636] border-[#363636]";
                break;
            case 'Chance':
                colorStyle = "bg-[#1a1a2e] hover:bg-gray-700 text-[#f7f4e9] border-[#ffd700]";
                break;
            default:
                colorStyle = "bg-gray-600 hover:bg-gray-700 text-white";
        }
        
        const selectedStyle = selectedAxiom === axiom && isRevelationVisible ? "ring-4 ring-offset-4 ring-offset-[#1a1a2e] ring-[#ffd700]" : "";
        const disabledStyle = isDisabled ? "opacity-50 cursor-not-allowed hover:scale-100 shadow-none" : "hover:shadow-[0_0_15px_rgba(255,215,0,0.5)]";

        return (
            <button
                className={`${baseStyle} ${colorStyle} ${selectedStyle} ${disabledStyle} font-['Cinzel']`}
                onClick={() => onClick(axiom)}
                disabled={isDisabled}
            >
                {label}
            </button>
        );
    };


    return (
        <div className="min-h-screen font-['Playfair_Display'] p-6 md:p-10" style={{
            backgroundColor: '#1a1a2e',
            backgroundImage: `linear-gradient(rgba(26, 26, 46, 0.95), rgba(26, 26, 46, 0.9)), url('https://placehold.co/1920x1080/1a1a2e/ffd700?text=Ancient+Library+Doors')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            color: '#f7f4e9'
        }}>
            <style>
                {/* Custom fonts must be loaded via a style block in React */}
                {`
                    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
                `}
            </style>

            <div className="max-w-7xl mx-auto backdrop-blur-sm bg-black/10 p-4 rounded-xl shadow-2xl">
                
                {/* Header and User Info */}
                <header className="flex flex-col md:flex-row justify-between items-center mb-8 pb-4 border-b border-[#ffd700]/50">
                    <div className="text-center md:text-left">
                        <h1 className="text-4xl md:text-5xl font-['Cinzel'] font-light text-[#ffd700] tracking-widest">
                            The Atheneum of Moirai
                        </h1>
                        <p className="text-lg text-[#f7f4e9]/80 mt-1 italic">Archivist: <span className="font-semibold text-[#f7f4e9]">{profile?.username || 'Loading...'}</span></p>
                    </div>
                    <div className="mt-4 md:mt-0 text-center">
                        <span className="text-sm text-gray-500 block mb-2 break-all">UID: {currentUser.uid}</span>
                        <button 
                            onClick={handleSignOut} 
                            className="text-sm py-2 px-4 bg-[#795548] hover:bg-[#5d4037] text-[#f7f4e9] rounded-lg transition shadow-md"
                        >
                            Log Out
                        </button>
                    </div>
                </header>

                {/* Tally Module (Score & Streak) */}
                <div className="grid grid-cols-3 gap-6 mb-10">
                    <TallyCard title="Total Score" value={profile?.score ?? 0} colorClass="border-[#5d4037]" />
                    <TallyCard title="Current Streak" value={profile?.streak ?? 0} colorClass="border-[#ffd700]" />
                    <TallyCard title="Highest Streak" value={profile?.highestStreak ?? 0} colorClass="border-[#795548]" />
                </div>

                {/* Main Game Area */}
                <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* The Archival Scroll */}
                    <div className="lg:col-span-2 bg-[#f7f4e9]/95 p-8 rounded-xl shadow-2xl border-4 border-[#ffd700]/70 text-[#363636]">
                        <h2 className="text-2xl font-['Cinzel'] text-[#5d4037] mb-4 border-b border-[#795548]/50 pb-2 tracking-wide">The Archival Scroll (Fragment)</h2>
                        
                        <div className="min-h-[250px] p-6 bg-[#fffaf0] rounded-lg text-lg leading-relaxed whitespace-pre-wrap flex items-center justify-center border border-[#795548]">
                            {isGameLoading && !isRevelationVisible ? (
                                <div className="flex flex-col items-center">
                                    <div className="animate-pulse text-[#795548] text-xl mb-2">Weaving Fragment...</div>
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ffd700]"></div>
                                </div>
                            ) : (
                                fragmentText
                            )}
                        </div>
                        
                        <button 
                            onClick={handleGenerateFragment} 
                            disabled={isGameLoading || isRevelationVisible}
                            className="mt-6 w-full py-3 bg-[#ffd700] hover:bg-[#b8860b] text-[#363636] font-['Cinzel'] font-bold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-amber-900/40"
                        >
                            {isGameLoading ? 'Weaving...' : (fragmentText === "Ready for the next Fragment..." || fragmentText.includes("Click 'Generate Fragment'")) ? 'Generate Fragment' : 'Continue to Next Fragment'}
                        </button>
                    </div>

                    {/* The Classifier */}
                    <div className="lg:col-span-1 bg-[#f7f4e9]/95 p-8 rounded-xl shadow-2xl border-4 border-[#ffd700]/70 text-[#363636]">
                        <h2 className="text-2xl font-['Cinzel'] text-[#5d4037] mb-6 border-b border-[#795548]/50 pb-2 tracking-wide">Classifier: Select Axiom</h2>
                        <div className="space-y-4">
                            <ClassifierButton 
                                label="FATE (Inevitable Predetermination)" 
                                axiom="Fate" 
                                onClick={handleAxiomClassification} 
                                isDisabled={isRevelationVisible || fragmentText.includes("Click 'Generate Fragment'")}
                            />
                            <ClassifierButton 
                                label="CHOICE (Critical, Preventable Decision)" 
                                axiom="Choice" 
                                onClick={handleAxiomClassification} 
                                isDisabled={isRevelationVisible || fragmentText.includes("Click 'Generate Fragment'")}
                            />
                            <ClassifierButton 
                                label="CHANCE (Random, Unpreventable Occurrence)" 
                                axiom="Chance" 
                                onClick={handleAxiomClassification} 
                                isDisabled={isRevelationVisible || fragmentText.includes("Click 'Generate Fragment'")}
                            />
                        </div>
                    </div>
                </main>
                
                {/* The Revelation Panel Modal */}
                {isRevelationVisible && (
                    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                        <div className="bg-[#f7f4e9] p-8 rounded-xl shadow-2xl max-w-2xl w-full border-t-8 border-[#ffd700] text-[#363636] font-['Playfair_Display']">
                            <h3 className={`text-3xl font-['Cinzel'] font-bold mb-4 tracking-wide ${selectedAxiom === correctAxiom ? 'text-green-700' : 'text-red-700'}`}>
                                {selectedAxiom === correctAxiom ? 'Revelation Confirmed' : 'Narrative Deception'}
                            </h3>
                            
                            <p className="text-lg whitespace-pre-wrap">{revelationText}</p>
                            
                            <button
                                onClick={handleCloseRevelation}
                                className="mt-6 w-full py-3 bg-[#ffd700] hover:bg-[#b8860b] text-[#363636] font-['Cinzel'] font-bold rounded-lg transition duration-200 shadow-xl shadow-amber-900/40"
                            >
                                Close Revelation & Continue
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}