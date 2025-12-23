import { auth, db } from "./firebase-config.js";
import { 
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    RecaptchaVerifier, signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Global Redirect
onAuthStateChanged(auth, (user) => {
    if (user && window.location.pathname.includes("index.html")) {
        window.location.href = "chat.html";
    }
});

// Google Login
const googleBtn = document.getElementById("google-btn");
if (googleBtn) {
    googleBtn.onclick = async () => {
        const provider = new GoogleAuthProvider();
        try {
            const res = await signInWithPopup(auth, provider);
            await saveUser(res.user);
        } catch (e) { 
            console.error(e);
            alert("Login Failed: " + e.message); 
        }
    };
}

// Email Login
const emailBtn = document.getElementById("email-login-btn");
if (emailBtn) {
    emailBtn.onclick = async () => {
        const email = document.getElementById("email-in").value;
        const pass = document.getElementById("pass-in").value;
        
        if(!email || !pass) return alert("Please enter email and password");

        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (e) {
            if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
                // Auto-signup if not found
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

// Phone Login
const phoneBtn = document.getElementById("phone-btn");
if (phoneBtn) {
    // Initialize Recaptcha (Invisible)
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', { 
        'size': 'invisible' 
    }, auth);

    phoneBtn.onclick = async () => {
        const number = document.getElementById("phone-in").value;
        if(!number) return alert("Enter phone number");

        try {
            phoneBtn.disabled = true;
            phoneBtn.textContent = "Sending...";
            window.confirmationResult = await signInWithPhoneNumber(auth, number, window.recaptchaVerifier);
            
            document.getElementById("otp-area").style.display = "block";
            phoneBtn.style.display = "none";
        } catch (e) { 
            phoneBtn.disabled = false;
            phoneBtn.textContent = "Send Code";
            alert("Phone Error: " + e.message); 
        }
    };

    document.getElementById("otp-verify-btn").onclick = async () => {
        const code = document.getElementById("otp-in").value;
        try {
            const res = await window.confirmationResult.confirm(code);
            await saveUser(res.user);
        } catch (e) { alert("Invalid Code"); }
    };
}

async function saveUser(user) {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    
    // Only set if new, to preserve existing data like custom photos
    if (!snap.exists()) {
        await setDoc(userRef, {
            uid: user.uid,
            name: user.displayName || user.email?.split('@')[0] || user.phoneNumber, 
            email: user.email || "",
            photoURL: user.photoURL || null,
            createdAt: serverTimestamp()
        });
    }
    window.location.href = "chat.html";
}