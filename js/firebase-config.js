import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyD9VAI5ULb0uHj4AFHIJwUs_A0TNEw8cFw",
    authDomain: "lockrythm-31a20.firebaseapp.com",
    databaseURL: "https://lockrythm-31a20-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lockrythm-31a20",
    storageBucket: "lockrythm-31a20.firebasestorage.app",
    messagingSenderId: "850988951870",
    appId: "1:850988951870:web:c4901a026c06e21fb7646f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

// Enable Offline Persistence (WhatsApp-like behavior)
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence disabled");
    } else if (err.code == 'unimplemented') {
        console.warn("Browser doesn't support persistence");
    }
});