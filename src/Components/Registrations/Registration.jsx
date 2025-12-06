import React, { useState, useEffect } from "react";
import { 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider, 
    createUserWithEmailAndPassword,
    onAuthStateChanged, 
    signOut 
} from "firebase/auth";
import { 
    doc, 
    setDoc,
    getDoc,
} from "firebase/firestore";
import '../../index.css';
import { auth, db } from "../../firebase.js"; 
import { Game } from "../Game/Game.jsx"; 

export function Registration() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState(""); // NEW
    const [username, setUsername] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);
    const [message, setMessage] = useState({ text: "", type: "" });

    const [showPopup, setShowPopup] = useState(false); // NEW — incorrect password popup
    const [popupMessage, setPopupMessage] = useState(""); // NEW — popup content

    const [isLoading, setIsLoading] = useState(true); 
    const [isAuthenticated, setIsAuthenticated] = useState(null); 

    const googleProvider = new GoogleAuthProvider();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setIsAuthenticated(user);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const formTitle = isRegistering ? 'Enroll in the Archives' : 'Enter the Athenaeum';
    const mainActionText = isRegistering ? 'Sign Up' : 'Log In';
    const toggleText = isRegistering ? 'Already a member? ' : 'New to the Athenaeum? ';
    const toggleLinkText = isRegistering ? 'Log In' : 'Sign Up';
    const messageClass = `message-box message-${message.type}`;

    // --- EMAIL/PASSWORD SUBMIT ---
    const handleEmailPasswordSubmit = async (e) => {
        e.preventDefault();
        setMessage({ text: "", type: "" });
        setIsLoading(true);

        try {
            // 🔐 REGISTRATION MODE
            if (isRegistering) {
                // Confirm Password Check
                if (password !== confirmPassword) {
                    setPopupMessage("Passwords do not match. Please confirm your cipher key.");
                    setShowPopup(true);
                    setIsLoading(false);
                    return;
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await setDoc(doc(db, "users", user.uid), {
                    email: user.email,
                    username,
                    currentScore: 0,
                    highestScore: 0,
                    currentStreak: 0,
                    highestStreak: 0,
                    difficultyTier: 1, 
                    roundCount: 0,
                    totalRoundsPlayed: 0,
                    joinedDate: new Date().toISOString()
                });

                setMessage({ text: "Registration successful! Proceeding to Log In.", type: "success" });
                setIsRegistering(false);
            } 
            else {
                // 🔐 LOGIN MODE
                await signInWithEmailAndPassword(auth, email, password);
                setMessage({ text: `Welcome back, Archivist!`, type: "success" });
            }

        } catch (error) {
            const errorMessage = error.code ? error.code.replace("auth/", "").replace(/-/g, " ") : error.message;

            // 🔔 SPECIAL HANDLING FOR WRONG PASSWORD
            if (error.code === "auth/wrong-password") {
                setPopupMessage("Incorrect password. The Cipher Key is invalid.");
                setShowPopup(true);
            } else {
                setMessage({ text: `Error: ${errorMessage}.`, type: "error" });
            }
        } finally {
            setIsLoading(false);
        }
    };

    // --- GOOGLE LOGIN ---
    const handleGoogleLogIn = async () => {
        setMessage({ text: "", type: "" });
        setIsLoading(true);

        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;

            const userDocRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userDocRef);

            if (!docSnap.exists()) {
                await setDoc(userDocRef, {
                    email: user.email,
                    username: user.displayName || "The Archivist",
                    currentScore: 0,
                    highestScore: 0,
                    currentStreak: 0,
                    highestStreak: 0,
                    difficultyTier: 1, 
                    roundCount: 0,
                    totalRoundsPlayed: 0,
                    joinedDate: new Date().toISOString()
                });
            }
        } catch (error) {
            const errorMessage = error.code ? error.code.replace("auth/", "").replace(/-/g, " ") : error.message;
            setMessage({ text: `Google Sign-in Error: ${errorMessage}.`, type: "error" });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignOut = async () => {
        await signOut(auth);
        setMessage({ text: "Successfully logged out. Farewell, Archivist.", type: "success" });
    };

    const toggleMode = () => {
        setIsRegistering(!isRegistering);
        setMessage({ text: "", type: "" });
        setEmail("");
        setPassword("");
        setConfirmPassword(""); // NEW
        setUsername("");
    };

    // --- RENDER: LOADING ---
    if (isLoading) {
        return (
            <div className="login-container">
                <h1 className="header-title">ARCHIVES ACCESS</h1>
                <p className="header-subtitle">Checking Authentication...</p>
                <div className="loading-spinner" style={{ fontSize: "2em" }}>⏳</div>
            </div>
        );
    }

    // --- RENDER: AUTHENTICATED ---
    if (isAuthenticated) {
        return <Game user={isAuthenticated} onSignOut={handleSignOut} />;
    }

    // --- RENDER: POPUP MODAL ---
    const popupModal = showPopup && (
        <div className="custom-modal-overlay">
            <div className="custom-modal-content">
                <h3>Authentication Error</h3>
                <p>{popupMessage}</p>
                <button 
                    className="button-primary" 
                    onClick={() => setShowPopup(false)}
                >
                    Close
                </button>
            </div>
        </div>
    );

    // --- RENDER: LOGIN / REGISTER FORM ---
    return (
        <div className="login-container">
            {popupModal}

            {message.text && (
                <div className={messageClass}>{message.text}</div>
            )}

            <h1 className="header-title">{formTitle}</h1>
            <p className="header-subtitle">Archivist of Moirai</p>

            <form onSubmit={handleEmailPasswordSubmit}>
                <div className="input-group">
                    <span className="input-icon">✉</span>
                    <input 
                        type="email" 
                        placeholder="Archivist Email"
                        required 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isLoading}
                    />
                </div>

                {isRegistering && (
                    <>
                        <div className="input-group">
                            <span className="input-icon">👤</span>
                            <input 
                                type="text" 
                                placeholder="Desired Username"
                                required 
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="input-group">
                            <span className="input-icon">🔑</span>
                            <input 
                                type="password" 
                                placeholder="Cipher Key"
                                required 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        {/* ✅ CONFIRM PASSWORD FIELD */}
                        <div className="input-group">
                            <span className="input-icon">🔒</span>
                            <input 
                                type="password" 
                                placeholder="Confirm Cipher Key"
                                required 
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                    </>
                )}

                {!isRegistering && (
                    <div className="input-group">
                        <span className="input-icon">🔑</span>
                        <input 
                            type="password" 
                            placeholder="Cipher Key"
                            required 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading}
                        />
                    </div>
                )}

                <button type="submit" className="button-primary" disabled={isLoading}>
                    {isLoading ? "Processing..." : mainActionText}
                </button>
            </form>

            <button 
                onClick={handleGoogleLogIn} 
                className="button-primary google-button"
                disabled={isLoading}
            >
                Continue with Google
            </button>

            <div className="toggle-text">
                <span>{toggleText}</span>
                <span className="toggle-link" onClick={toggleMode}>
                    {toggleLinkText}
                </span>
            </div>
        </div>
    );
}
