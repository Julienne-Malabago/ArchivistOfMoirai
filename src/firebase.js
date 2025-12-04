// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore"; // <-- ADDED: Firestore import

// Your web app's Firebase configuration
// Exporting firebaseConfig so other files can access it if needed (though not strictly necessary here)
export const firebaseConfig = {
  apiKey: "AIzaSyC-Qir77Q8xhy8SPS2Key68-n5ncg4WIx0",
  authDomain: "archivist-of-moirai.firebaseapp.com",
  projectId: "archivist-of-moirai",
  storageBucket: "archivist-of-moirai.firebasestorage.app",
  messagingSenderId: "995251049396",
  appId: "1:995251049396:web:0bf7e3349f2b4e6fbb18e1",
  measurementId: "G-G10YSEFSE6"
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);
// Initialize services and export them
export const auth = getAuth(app);
export const db = getFirestore(app); // <-- EXPORTED: Initialized Firestore database instance

let analytics;
try {
  analytics = getAnalytics(app);
} catch (err) {
  console.warn('Analytics failed to initialize:', err);
}

export { analytics };