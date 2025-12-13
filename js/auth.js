import { auth, db } from "./keys.js"; // USING YOUR NEW KEYS FILE
import { 
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    RecaptchaVerifier, signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Global redirect check
onAuthStateChanged(auth, (user) => {
    if (user && window.location.pathname.includes("index.html")) {
        window.location.href = "chat.html";
    }
});

// 1. Google Login
const googleBtn = document.getElementById("google-btn");
if (googleBtn) {
    googleBtn.onclick = async () => {
        const provider = new GoogleAuthProvider();
        try {
            const res = await signInWithPopup(auth, provider);
            await saveUser(res.user);
        } catch (e) { alert(e.message); }
    };
}

// 2. Email Login/Signup
const emailBtn = document.getElementById("email-login-btn");
if (emailBtn) {
    emailBtn.onclick = async () => {
        const email = document.getElementById("email-in").value;
        const pass = document.getElementById("pass-in").value;
        try {
            // Try login first
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (e) {
            // If user not found, create new
            if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password') { // Simplified check
                 try {
                     const res = await createUserWithEmailAndPassword(auth, email, pass);
                     await saveUser(res.user);
                 } catch (err) { alert(err.message); }
            } else {
                alert(e.message);
            }
        }
    };
}

// 3. Phone Login
const phoneBtn = document.getElementById("phone-btn");
if (phoneBtn) {
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', { 'size': 'invisible' }, auth);
    
    phoneBtn.onclick = async () => {
        const number = document.getElementById("phone-in").value;
        try {
            window.confirmationResult = await signInWithPhoneNumber(auth, number, window.recaptchaVerifier);
            document.getElementById("otp-area").style.display = "block";
            phoneBtn.style.display = "none";
        } catch (e) { alert("Phone Error: " + e.message); }
    };

    document.getElementById("otp-verify-btn").onclick = async () => {
        const code = document.getElementById("otp-in").value;
        try {
            const res = await window.confirmationResult.confirm(code);
            await saveUser(res.user);
        } catch (e) { alert("Invalid Code"); }
    };
}

// Helper: Save User to Firestore
async function saveUser(user) {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
        await setDoc(userRef, {
            uid: user.uid,
            name: user.displayName || user.email || user.phoneNumber, // Fallback names
            email: user.email || "",
            photoURL: user.photoURL || "https://ui-avatars.com/api/?background=random&name=" + (user.email || "User"),
            createdAt: serverTimestamp()
        });
    }
    window.location.href = "chat.html";
}
