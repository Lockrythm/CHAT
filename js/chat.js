import { auth, db, rtdb, storage } from "./keys.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { collection, query, where, onSnapshot, addDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { ref as dbRef, onDisconnect, set } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";
import { startCall, answerCall } from "./calls.js";

let currentUser = null;
let currentChatId = null;
let mediaRecorder = null;
let audioChunks = [];

// 1. AUTH & INIT
onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.href = "index.html";
    currentUser = user;
    
    // UI Update
    document.getElementById("my-name").textContent = user.displayName || user.email.split('@')[0];
    document.getElementById("my-avatar").src = user.photoURL || "https://via.placeholder.com/40";

    // Online Status
    const userStatusRef = dbRef(rtdb, '/status/' + user.uid);
    set(userStatusRef, { state: 'online', last_changed: serverTimestamp() });
    onDisconnect(userStatusRef).set({ state: 'offline' });

    loadContacts();
    listenForCalls(user.uid);
});

// 2. CONTACTS
function loadContacts() {
    onSnapshot(collection(db, "users"), snap => {
        const list = document.getElementById("user-list");
        list.innerHTML = "";
        snap.forEach(d => {
            const u = d.data();
            if (u.uid === currentUser.uid) return;
            
            const item = document.createElement("div");
            item.className = "user-item";
            item.innerHTML = `
                <img src="${u.photoURL}" class="avatar">
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:0.95rem;">${u.name}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">Tap to chat</div>
                </div>
            `;
            item.onclick = () => loadChat(u);
            list.appendChild(item);
        });
    });
}

// 3. CHAT LOGIC
function loadChat(user) {
    currentChatId = [currentUser.uid, user.uid].sort().join("_");
    
    // Show Chat UI
    document.getElementById("chat-header").style.display = "flex";
    document.getElementById("input-area").style.display = "flex";
    document.getElementById("chat-name").textContent = user.name;
    document.getElementById("chat-avatar").src = user.photoURL;

    // Load Messages
    const q = query(collection(db, "chats", currentChatId, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(q, snap => {
        const container = document.getElementById("messages-container");
        container.innerHTML = "";
        snap.forEach(d => renderMessage(d.data()));
        container.scrollTop = container.scrollHeight;
    });

    // Call Buttons
    document.getElementById("video-call-btn").onclick = () => startCall(user.uid);
}

// 4. SEND MESSAGES (Text, Image, Video, Audio)
async function sendMessage(fileUrl = null, type = "text") {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    
    if (!text && !fileUrl) return;
    input.value = ""; // Clear text
    toggleSendButton(); // Reset button state

    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        text: text,
        media: fileUrl,
        type: type,
        senderId: currentUser.uid,
        timestamp: serverTimestamp()
    });
}

// 5. INPUT HANDLERS
const msgInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");

// Toggle Mic vs Send Button
msgInput.addEventListener("input", toggleSendButton);

function toggleSendButton() {
    if (msgInput.value.trim().length > 0) {
        sendBtn.style.display = "block";
        micBtn.style.display = "none";
    } else {
        sendBtn.style.display = "none";
        micBtn.style.display = "block";
    }
}

document.getElementById("send-btn").onclick = () => sendMessage();
document.getElementById("message-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// File Upload
document.getElementById("media-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const fileRef = sRef(storage, `uploads/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    
    const type = file.type.startsWith("video") ? "video" : "image";
    sendMessage(url, type);
});

// 6. VOICE RECORDING LOGIC
let isRecording = false;

micBtn.onclick = async () => {
    if (!isRecording) {
        // Start Recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
            
            mediaRecorder.onstop = async () => {
                if(audioChunks.length === 0) return; // Cancelled
                const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                const fileRef = sRef(storage, `voice/${Date.now()}.mp3`);
                await uploadBytes(fileRef, audioBlob);
                const url = await getDownloadURL(fileRef);
                sendMessage(url, "audio");
            };

            mediaRecorder.start();
            isRecording = true;
            document.getElementById("recording-overlay").style.display = "flex";
            micBtn.style.color = "red";
        } catch(e) {
            alert("Mic Error: " + e.message);
        }
    } else {
        // Stop & Send
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById("recording-overlay").style.display = "none";
        micBtn.style.color = "var(--text-muted)";
    }
};

document.getElementById("cancel-rec-btn").onclick = () => {
    if(mediaRecorder) {
        audioChunks = []; // Clear chunks so onstop sends nothing
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById("recording-overlay").style.display = "none";
        micBtn.style.color = "var(--text-muted)";
    }
}


// 7. RENDER MESSAGE
function renderMessage(msg) {
    const div = document.createElement("div");
    const isMe = msg.senderId === currentUser.uid;
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    let content = "";
    
    if (msg.type === "text") content = `<p style="margin:0;">${msg.text}</p>`;
    if (msg.type === "image") content = `<img src="${msg.media}" class="media-img" onclick="window.open(this.src)">`;
    if (msg.type === "video") content = `<video src="${msg.media}" controls class="media-img"></video>`;
    if (msg.type === "audio") content = `<audio src="${msg.media}" controls style="width:200px; height:40px; margin-top:5px;"></audio>`;
    
    // Timestamp
    const time = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "...";
    content += `<div class="timestamp">${time}</div>`;
    
    div.innerHTML = content;
    document.getElementById("messages-container").appendChild(div);
}

// 8. CALL LISTENER
function listenForCalls(uid) {
    const q = query(collection(db, "calls"), where("receiverId", "==", uid), where("status", "==", "ringing"));
    onSnapshot(q, snap => {
        snap.docChanges().forEach(change => {
            if (change.type === "added") {
                if (confirm("Incoming Call from " + change.doc.data().callerId)) answerCall(change.doc.id);
            }
        });
    });
}

document.getElementById("logout-btn").onclick = () => signOut(auth);
