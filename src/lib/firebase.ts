// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig1 = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

function initializeAppSafely(config: object, appName: string): FirebaseApp {
    try {
        return getApp(appName);
    } catch (e) {
        return initializeApp(config, appName);
    }
}

const app1: FirebaseApp = initializeAppSafely(firebaseConfig1, 'app1');
const db1: Firestore = getFirestore(app1, "live");

// The second project (supermoney-sales-hub) is deliberately not reached from the browser.
// Its rules deny every client read and write, and this portal authenticates with
// iron-session rather than Firebase Auth, so a client-SDK call would always be refused.
// Server code reads that data through the Admin SDK instead — see src/lib/leads-data.ts.

export { db1 };
