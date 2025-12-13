import { auth, db, rtdb, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { collection, query, where, onSnapshot, addDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { ref as dbRef, onDisconnect, set } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";
import { startCall, answerCall, sendFileViaWebRTC, isCallActive } from "./calls.js";

let currentUser = null;
let currentChatId = null;
let mediaRecorder = null;
let audioChunks = [];

onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.href = "index.html";
    currentUser = user;
    
    document.getElementById("my-name").textContent = user.displayName || user.email.split('@')[0];
    document.getElementById("my-avatar").src = user.photoURL || "https://via.placeholder.com/40";

    const userStatusRef = dbRef(rtdb, '/status/' + user.uid);
    set(userStatusRef, { state: 'online', last_changed: serverTimestamp() });
    onDisconnect(userStatusRef).set({ state: 'offline' });

    loadContacts();
    listenForCalls(user.uid);
});

// P2P FILE LISTENER
document.addEventListener('webrtc-file-received', (e) => {
    const { url, name, type } = e.detail;
    renderMessage({
        text: `📁 Direct P2P Transfer: ${name}`,
        media: url,
        type: type.startsWith('image') ? 'image' : 'video', 
        senderId: 'partner', 
        timestamp: null
    });
});

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
                    <div style="font-weight:600;">${u.name}</div>
                    <div style="font-size:0.8rem; color:#aaa;">Tap to chat</div>
                </div>`;
            item.onclick = () => loadChat(u);
            list.appendChild(item);
        });
    });
}

function loadChat(user) {
    currentChatId = [currentUser.uid, user.uid].sort().join("_");
    document.getElementById("chat-header").style.display = "flex";
    document.getElementById("input-area").style.display = "flex";
    document.getElementById("chat-name").textContent = user.name;
    document.getElementById("chat-avatar").src = user.photoURL;

    const q = query(collection(db, "chats", currentChatId, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(q, snap => {
        const container = document.getElementById("messages-container");
        container.innerHTML = "";
        snap.forEach(d => renderMessage(d.data()));
        container.scrollTop = container.scrollHeight;
    });

    document.getElementById("video-call-btn").onclick = () => startCall(user.uid);
}

// HYBRID SEND
async function sendMessage(fileUrl = null, type = "text") {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    
    if (!text && !fileUrl) return;
    input.value = "";
    toggleSendButton();

    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        text: text,
        media: fileUrl,
        type: type,
        senderId: currentUser.uid,
        timestamp: serverTimestamp()
    });
}

// FILE INPUT HANDLER
document.getElementById("media-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (isCallActive()) {
        console.log("Sending via WebRTC (P2P)...");
        const sent = sendFileViaWebRTC(file);
        if (sent) {
            renderMessage({
                text: `⚡ Sent via P2P: ${file.name}`,
                senderId: currentUser.uid,
                type: 'text'
            });
            return; 
        }
    }

    // Fallback: Storage
    const fileRef = sRef(storage, `uploads/${Date.now()}_${file.name}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    const type = file.type.startsWith("video") ? "video" : "image";
    sendMessage(url, type);
});

// UI HANDLERS
const msgInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");

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
msgInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// VOICE RECORDING
let isRecording = false;

micBtn.onclick = async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
            
            mediaRecorder.onstop = async () => {
                if(audioChunks.length === 0) return;
                const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                const fileRef = sRef(storage, `voice/${Date.now()}.mp3`);
                await uploadBytes(fileRef, audioBlob);
                const url = await getDownloadURL(fileRef);
                sendMessage(url, "audio");
            };

            mediaRecorder.start();
            isRecording = true;
            document.getElementById("recording-overlay").style.display = "flex";
        } catch(e) {
            alert("Mic Error: " + e.message);
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById("recording-overlay").style.display = "none";
    }
};

document.getElementById("cancel-rec-btn").onclick = () => {
    if(mediaRecorder) {
        audioChunks = [];
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById("recording-overlay").style.display = "none";
    }
}

function renderMessage(msg) {
    const div = document.createElement("div");
    div.className = `message ${msg.senderId === currentUser.uid ? 'sent' : 'received'}`;
    
    let content = "";
    if (msg.type === "text") content = `<p style="margin:0;">${msg.text}</p>`;
    if (msg.type === "image") content = `<img src="${msg.media}" class="media-img" onclick="window.open(this.src)">`;
    if (msg.type === "video") content = `<video src="${msg.media}" controls class="media-img"></video>`;
    if (msg.type === "audio") content = `<audio src="${msg.media}" controls style="width:200px; height:40px; margin-top:5px;"></audio>`;
    
    const time = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "...";
    content += `<div class="timestamp">${time}</div>`;
    
    div.innerHTML = content;
    document.getElementById("messages-container").appendChild(div);
}

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
