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
    // Removed unused imports: updateDoc
} from "firebase/firestore";
import '../../index.css';
import { auth, db } from "../../firebase.js"; 
import { Game } from "../Game/Game.jsx"; 

// Export the component so it can be imported in main.jsx
export function Registration() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);
    const [message, setMessage] = useState({ text: "", type: "" });
    
    // START STATE: Set to true initially while Firebase checks local session/cookie
    const [isLoading, setIsLoading] = useState(true); 
    
    // Holds the user object (if logged in) or null (if logged out)
    const [isAuthenticated, setIsAuthenticated] = useState(null); 

    const googleProvider = new GoogleAuthProvider();

    // --- AUTH STATE LISTENER (THE CORE GUARD) ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setIsAuthenticated(user);
            setIsLoading(false); // Stop loading once the user state is definitively known (null or user object)
        });
        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    // Derived values for dynamic UI elements
    const formTitle = isRegistering ? 'Enroll in the Archives' : 'Enter the Athenaeum';
    const mainActionText = isRegistering ? 'Sign Up' : 'Log In';
    const toggleText = isRegistering ? 'Already a member? ' : 'New to the Athenaeum? ';
    const toggleLinkText = isRegistering ? 'Log In' : 'Sign Up';
    const messageClass = `message-box ${message.type}`;

    // --- LOGIC FOR EMAIL/PASSWORD SIGN UP/LOG IN ---
    const handleEmailPasswordSubmit = async (e) => {
        e.preventDefault();
        setMessage({ text: "", type: "" });
        setIsLoading(true);

        try {
            if (isRegistering) {
                // SIGN UP LOGIC
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                // Create a user profile document in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    email: user.email,
                    username: username,
                    currentScore: 0,
                    highestScore: 0,
                    currentStreak: 0,
                    highestStreak: 0,  
                    difficultyTier: 1, 
                    roundCount: 0,
                    // ADDED: totalRoundsPlayed initialization
                    totalRoundsPlayed: 0,
                    joinedDate: new Date().toISOString()
                });
                
                // After successful registration, switch to login view
                setMessage({ text: "Registration successful! Proceeding to Log In.", type: "success" });
                setIsRegistering(false); 
                
            } else {
                // LOG IN LOGIC
                await signInWithEmailAndPassword(auth, email, password);
                // Auth state listener handles setting isAuthenticated
                setMessage({ text: `Welcome back, Archivist!`, type: "success" });
            }
        } catch (error) {
            console.error("Auth error:", error);
            const errorMessage = error.code ? error.code.replace('auth/', '').replace(/-/g, ' ') : error.message;
            setMessage({ text: `Error: ${errorMessage}.`, type: "error" });
        } finally {
            setIsLoading(false);
        }
    }

    // --- LOGIC FOR GOOGLE SIGN IN/SIGN UP ---
    const handleGoogleLogIn = async () => {
        setMessage({ text: "", type: "" });
        setIsLoading(true);
        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;

            const userDocRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userDocRef);

            if (!docSnap.exists()) {
                // Create profile for new Google user
                await setDoc(userDocRef, {
                    email: user.email,
                    username: user.displayName || 'The Archivist',
                    currentScore: 0,
                    highestScore: 0,
                    currentStreak: 0,
                    highestStreak: 0,
                    difficultyTier: 1, 
                    roundCount: 0,
                    // ADDED: totalRoundsPlayed initialization
                    totalRoundsPlayed: 0,
                    joinedDate: new Date().toISOString()
                });
            }
            // Auth state listener handles setting isAuthenticated
        } catch (error) {
            console.error("Google Auth error:", error);
            const errorMessage = error.code ? error.code.replace('auth/', '').replace(/-/g, ' ') : error.message;
            setMessage({ text: `Google Sign-in Error: ${errorMessage}.`, type: "error" });
        } finally {
            setIsLoading(false);
        }
    }

    // --- SIGN OUT HANDLER ---
    const handleSignOut = async () => {
        await signOut(auth); // Use imported signOut
        setMessage({ text: 'Successfully logged out. Farewell, Archivist.', type: 'success' });
    }

    // --- UI TOGGLE HANDLER ---
    const toggleMode = () => {
        setIsRegistering(!isRegistering);
        setMessage({ text: "", type: "" });
        setEmail("");
        setPassword("");
        setUsername("");
    }
    
    // --- RENDER LOGIC ---

    // 1. Initial Loading Screen while checking Firebase session
    if (isLoading) {
        return (
            <div className="login-container">
                <div className="form-wrapper">
                    <h1 className="header-title">ARCHIVES ACCESS</h1>
                    <p className="header-subtitle">Checking Authentication...</p>
                    {/* You can replace this with a proper CSS spinner */}
                    <div className="loading-spinner" style={{ textAlign: 'center', fontSize: '2em' }}>⏳</div>
                </div>
            </div>
        );
    }
    
    // 2. Game Screen (Authenticated)
    if (isAuthenticated) {
        // If authenticated, render the main game
        return <Game user={isAuthenticated} onSignOut={handleSignOut} />;
    }

    // 3. Registration/Login Form (Not Authenticated)
    return (
        <div className="login-container"> 
            
            {/* Message/Error Display Box */}
            {message.text && (
                <div className={messageClass}>
                    {message.text}
                </div>
            )}
            
            {/* Login/Registration Form */}
            <div className="form-wrapper">
                <h1 className="header-title">{formTitle}</h1>
                <p className="header-subtitle">Archivist of Moirai</p>
                
                <form onSubmit={handleEmailPasswordSubmit}> 
                    <div className="input-group">
                        <span className="input-icon">✉</span> 
                        <label htmlFor="email">Email</label>
                        <input type="email" id="email" placeholder="Archivist Email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={isLoading} />
                    </div>
                    {isRegistering && (
                        <div className="input-group">
                            <span className="input-icon">👤</span> 
                            <label htmlFor="username">Username</label>
                            <input type="text" id="username" placeholder="Desired Username" required value={username} onChange={(e) => setUsername(e.target.value)} disabled={isLoading} />
                        </div>
                    )}
                    <div className="input-group">
                        <span className="input-icon">🔑</span> 
                        <label htmlFor="password">Cipher Key</label>
                        <input type="password" id="password" placeholder="Cipher Key" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={isLoading} />
                    </div>
                    
                    <button 
                        type="submit" 
                        className="button-primary"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Processing...' : mainActionText}
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
                    <span 
                        className="toggle-link" 
                        onClick={toggleMode}
                    >
                        {toggleLinkText}
                    </span>
                </div>
            </div>
        </div>
    );
}