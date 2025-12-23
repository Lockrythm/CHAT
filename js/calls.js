import { auth, db, rtdb, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { collection, query, where, onSnapshot, addDoc, orderBy, serverTimestamp, limit } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { ref as dbRef, onDisconnect, set, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";
import { startCall, answerCall } from "./calls.js";

let currentUser = null;
let currentChatId = null;
let currentChatUser = null;

// Voice Recorder vars
let mediaRecorder = null;
let audioChunks = [];
let recStartTime = 0;
let recTimerInterval = null;

// 1. AUTH STATE & SETUP
onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.href = "index.html";
    currentUser = user;

    updateProfileUI(user);
    setupPresence(user);
    loadContacts();
    listenForIncomingCalls(user.uid);
});

function updateProfileUI(user) {
    let safeName = user.displayName || user.email?.split('@')[0] || "User";
    document.getElementById("my-name").textContent = safeName;
    document.getElementById("my-avatar").src = user.photoURL || `https://ui-avatars.com/api/?name=${safeName}&background=random`;
}

// 2. REALTIME PRESENCE (Online/Offline)
function setupPresence(user) {
    const userStatusRef = dbRef(rtdb, '/status/' + user.uid);
    const isOfflineForDatabase = { state: 'offline', last_changed: serverTimestamp() };
    const isOnlineForDatabase = { state: 'online', last_changed: serverTimestamp() };

    set(userStatusRef, isOnlineForDatabase);
    onDisconnect(userStatusRef).set(isOfflineForDatabase);
}

// 3. CONTACT LIST
function loadContacts() {
    // Note: In a real app with thousands of users, do NOT read the whole 'users' collection.
    // You would use a 'friends' subcollection. For this demo, we read all users.
    onSnapshot(collection(db, "users"), snap => {
        const list = document.getElementById("user-list");
        list.innerHTML = "";
        
        snap.forEach(d => {
            const u = d.data();
            if (u.uid === currentUser.uid) return;

            const item = document.createElement("div");
            item.className = "user-item";
            
            // Check realtime status
            // (In a full app, you'd listen to RTDB here for green dots)
            
            const pic = u.photoURL || `https://ui-avatars.com/api/?name=${u.name}&background=random`;
            item.innerHTML = `
                <img src="${pic}" class="avatar">
                <div>
                    <div style="font-weight:600; color:white;">${u.name || "User"}</div>
                    <div style="font-size:0.8rem; color:#aaa;">Tap to chat</div>
                </div>`;
                
            item.onclick = () => loadChat(u);
            list.appendChild(item);
        });
    });
}

// 4. LOAD CHAT (Includes your new Mobile Logic)
function loadChat(user) {
    currentChatUser = user;
    currentChatId = [currentUser.uid, user.uid].sort().join("_");
    
    // --- MOBILE UI TOGGLE ---
    if(window.openChatUI) window.openChatUI();
    // ------------------------

    // Update Header
    document.getElementById("chat-name").textContent = user.name || "User";
    document.getElementById("chat-avatar").src = user.photoURL || `https://ui-avatars.com/api/?name=${user.name}`;
    document.getElementById("chat-status").textContent = "Online"; // Ideally fetch from RTDB

    // Buttons
    document.getElementById("video-call-btn").onclick = () => startCall(user.uid, 'video');
    // We add a specific listener for the audio call button if it exists in HTML
    const phoneBtn = document.querySelector('.icon-btn[title="Phone Call"]');
    if(phoneBtn) phoneBtn.onclick = () => startCall(user.uid, 'audio');

    // Load Messages
    const q = query(
        collection(db, "chats", currentChatId, "messages"), 
        orderBy("timestamp", "asc"),
        limit(100)
    );
    
    onSnapshot(q, snap => {
        const container = document.getElementById("messages-container");
        container.innerHTML = ""; // Clear existing (basic approach)
        
        snap.forEach(d => renderMessage(d.data()));
        
        // Auto Scroll to bottom
        container.scrollTop = container.scrollHeight;
    });
}

// 5. SEND MESSAGES
async function sendMessage(fileUrl = null, type = "text") {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    
    if (!text && !fileUrl) return;

    if(type === 'text') input.value = ""; // Clear input immediately for speed

    try {
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            text: text,
            media: fileUrl,
            type: type,
            senderId: currentUser.uid,
            timestamp: serverTimestamp()
        });
        toggleSendButton();
    } catch(e) {
        console.error("Send failed", e);
    }
}

// 6. VOICE NOTE LOGIC (Fixing "totally not working")
const micBtn = document.getElementById("mic-btn");
const cancelRecBtn = document.getElementById("cancel-rec-btn");

micBtn.onclick = async () => {
    // Request Mic Permission First
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startRecording(stream);
    } catch(e) {
        alert("Microphone access denied. Cannot record.");
    }
};

function startRecording(stream) {
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    document.getElementById("recording-overlay").style.display = "flex";
    recStartTime = Date.now();
    
    // Timer UI
    recTimerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - recStartTime) / 1000);
        const mins = Math.floor(diff / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        document.getElementById("rec-timer").innerText = `${mins}:${secs}`;
    }, 1000);

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    
    mediaRecorder.onstop = async () => {
        clearInterval(recTimerInterval);
        document.getElementById("recording-overlay").style.display = "none";
        document.getElementById("rec-timer").innerText = "00:00";
        
        // Stop all tracks to release mic
        stream.getTracks().forEach(t => t.stop());

        if (audioChunks.length > 0) {
            // Upload
            const blob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
            const fileRef = sRef(storage, `voice/${Date.now()}.webm`);
            await uploadBytes(fileRef, blob);
            const url = await getDownloadURL(fileRef);
            sendMessage(url, "audio");
        }
    };

    mediaRecorder.start();
}

cancelRecBtn.onclick = () => {
    if(mediaRecorder) {
        audioChunks = []; // Clear data so we don't send
        mediaRecorder.stop();
    }
}

// 7. FILE & IMAGE INPUT
document.getElementById("media-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Quick UI feedback (optional)
    alert("Uploading " + file.name + "...");

    const fileRef = sRef(storage, `uploads/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    
    const type = file.type.startsWith("video") ? "video" : "image";
    sendMessage(url, type);
});

// 8. RENDER MESSAGES
function renderMessage(msg) {
    const div = document.createElement("div");
    div.className = `message ${msg.senderId === currentUser.uid ? 'sent' : 'received'}`;
    
    let content = "";
    
    if (msg.type === "text") {
        content = `<div style="margin-bottom:4px;">${msg.text}</div>`;
    } 
    else if (msg.type === "image") {
        content = `<img src="${msg.media}" class="media-img" style="cursor:pointer;" onclick="window.open('${msg.media}')">`;
        if(msg.text) content += `<div>${msg.text}</div>`;
    }
    else if (msg.type === "video") {
        content = `<video src="${msg.media}" controls class="media-img"></video>`;
    }
    else if (msg.type === "audio") {
        content = `
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="fas fa-play-circle" style="font-size:1.5rem;"></i>
                <audio src="${msg.media}" controls style="height:30px; width:200px;"></audio>
            </div>
        `;
    }
    
    // Timestamp
    const time = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "...";
    content += `<div class="timestamp">${time} <i class="fas fa-check-double" style="font-size:0.6rem;"></i></div>`;
    
    div.innerHTML = content;
    document.getElementById("messages-container").appendChild(div);
}

// 9. INCOMING CALL LISTENER
function listenForIncomingCalls(uid) {
    const q = query(collection(db, "calls"), where("receiverId", "==", uid), where("status", "==", "ringing"));
    
    onSnapshot(q, snap => {
        snap.docChanges().forEach(change => {
            if (change.type === "added") {
                const callData = change.doc.data();
                const callType = callData.type || 'video';
                
                // Play Ringtone here if you want
                
                if (confirm(`Incoming ${callType.toUpperCase()} Call... Accept?`)) {
                    answerCall(change.doc.id, callData);
                } else {
                    // Reject logic could go here
                }
            }
        });
    });
}

// UI Helpers
const msgInput = document.getElementById("message-input");
msgInput.addEventListener("input", toggleSendButton);
msgInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

function toggleSendButton() {
    const sendBtn = document.getElementById("send-btn");
    const micBtn = document.getElementById("mic-btn");
    
    if (msgInput.value.trim().length > 0) {
        sendBtn.style.display = "block";
        micBtn.style.display = "none";
    } else {
        sendBtn.style.display = "none";
        micBtn.style.display = "block";
    }
}

document.getElementById("send-btn").onclick = () => sendMessage();
document.getElementById("logout-btn").onclick = () => signOut(auth);