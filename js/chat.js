import { auth, db, rtdb } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { collection, query, where, onSnapshot, addDoc, orderBy, serverTimestamp, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { ref, onDisconnect, set, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
// IMPORT BOTH FUNCTIONS HERE:
import { startCall, answerCall } from "./calls.js"; 

let currentUser = null;
let currentChatUserId = null;
let currentChatId = null;

// 1. Auth & Presence Logic
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }
    currentUser = user;
    
    // UI Setup
    document.getElementById("my-avatar").src = user.photoURL;
    document.getElementById("my-name").textContent = user.displayName;

    // Realtime Presence System (Online/Offline)
    const userStatusRef = ref(rtdb, '/status/' + user.uid);
    const isOfflineForDatabase = { state: 'offline', last_changed: serverTimestamp() };
    const isOnlineForDatabase = { state: 'online', last_changed: serverTimestamp() };

    set(userStatusRef, isOnlineForDatabase);
    onDisconnect(userStatusRef).set(isOfflineForDatabase);

    loadUsers();

    // ----------------------------------------------------
    // 📞 LISTENER FOR INCOMING CALLS (ADDED HERE)
    // ----------------------------------------------------
    const callsRef = collection(db, "calls");
    const q = query(callsRef, where("receiverId", "==", user.uid), where("status", "==", "ringing"));
    
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
                const callData = change.doc.data();
                const callId = change.doc.id;
                
                // Simple Browser Alert for MVP
                // If user clicks OK, we answer. If Cancel, we ignore.
                const accept = confirm("Incoming Video Call! Accept?");
                if (accept) {
                    answerCall(callId);
                } else {
                    // Optional: You could update the doc status to "rejected" here
                }
            }
        });
    });
    // ----------------------------------------------------
});

// 2. Load Users List (Sidebar)
function loadUsers() {
    const usersRef = collection(db, "users");
    onSnapshot(usersRef, (snapshot) => {
        const userList = document.getElementById("user-list");
        userList.innerHTML = "";
        
        snapshot.forEach(docSnap => {
            const user = docSnap.data();
            if (user.uid === currentUser.uid) return; // Don't show myself

            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `
                <img src="${user.photoURL}" class="avatar">
                <div>
                    <div>${user.name}</div>
                    <div style="font-size:0.8rem; color:#aaa;">Click to chat</div>
                </div>
                <div class="status-dot" id="status-${user.uid}"></div>
            `;
            div.onclick = () => openChat(user);
            userList.appendChild(div);

            // Listen for their Online Status
            const statusRef = ref(rtdb, '/status/' + user.uid);
            onValue(statusRef, (snap) => {
                const status = snap.val();
                const dot = document.getElementById(`status-${user.uid}`);
                if (status && status.state === 'online') {
                    dot.classList.add('online');
                } else {
                    dot.classList.remove('online');
                }
            });
        });
    });
}

// 3. Open Chat Logic
function openChat(user) {
    currentChatUserId = user.uid;
    currentChatId = [currentUser.uid, user.uid].sort().join("_");
    
    // UI Updates
    document.getElementById("messages-container").innerHTML = "";
    document.getElementById("chat-header").style.display = "flex";
    document.getElementById("input-area").style.display = "flex";
    document.getElementById("chat-avatar").src = user.photoURL;
    document.getElementById("chat-name").textContent = user.name;
    
    // Load Messages
    const msgsRef = collection(db, "chats", currentChatId, "messages");
    const q = query(msgsRef, orderBy("timestamp", "asc"));

    onSnapshot(q, (snapshot) => {
        const container = document.getElementById("messages-container");
        container.innerHTML = "";
        snapshot.forEach(doc => {
            renderMessage(doc.data());
        });
        container.scrollTop = container.scrollHeight; // Auto scroll
    });

    // Call Button Hook - Starts a VIDEO call
    document.getElementById("video-call-btn").onclick = () => startCall(user.uid);
    // Audio call button can use same logic, just disable video track in calls.js later
    document.getElementById("audio-call-btn").onclick = () => startCall(user.uid); 
}

// 4. Send Message Logic
document.getElementById("send-btn").addEventListener("click", sendMessage);
document.getElementById("message-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

async function sendMessage() {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = ""; // Clear input immediately

    const msgsRef = collection(db, "chats", currentChatId, "messages");
    await addDoc(msgsRef, {
        text: text,
        senderId: currentUser.uid,
        timestamp: serverTimestamp(),
        type: "text"
    });
}

function renderMessage(msg) {
    const div = document.createElement("div");
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? "sent" : "received"}`;
    div.innerHTML = `
        ${msg.text}
        <div class="timestamp">
            ${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "..."}
        </div>
    `;
    document.getElementById("messages-container").appendChild(div);
}

// Logout
document.getElementById("logout-btn").addEventListener("click", () => {
    signOut(auth).then(() => window.location.href = "index.html");
});