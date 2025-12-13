import { db, auth } from "./firebase-config.js";
import { collection, addDoc, onSnapshot, doc, setDoc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let dataChannel = null;
let unsubscribe = null;

// FILE TRANSFER VARIABLES
let receivedBuffers = [];
let receivedSize = 0;
let fileSize = 0;
let fileName = "";
let fileType = "";

// 1. Initialize Media
async function openMediaSources() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById("localVideo");
        if(localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true;
        }
        
        remoteStream = new MediaStream();
        const remoteVideo = document.getElementById("remoteVideo");
        if(remoteVideo) remoteVideo.srcObject = remoteStream;
        
        return true;
    } catch (error) {
        console.error("Media Error:", error);
        alert("Camera/Mic required for calls.");
        return false;
    }
}

// 2. DATA CHANNEL (P2P Storage)
function setupDataChannel(pc) {
    pc.ondatachannel = (event) => {
        const receiveChannel = event.channel;
        receiveChannel.onmessage = handleReceiveMessage;
    };
}

function createDataChannel(pc) {
    dataChannel = pc.createDataChannel("fileTransfer");
    dataChannel.onmessage = handleReceiveMessage;
    return dataChannel;
}

// 3. HANDLE INCOMING FILES
function handleReceiveMessage(event) {
    const data = event.data;

    if (typeof data === 'string') {
        const meta = JSON.parse(data);
        if(meta.type === 'metadata') {
            receivedBuffers = [];
            receivedSize = 0;
            fileName = meta.fileName;
            fileSize = meta.fileSize;
            fileType = meta.fileType;
            console.log(`Receiving ${fileName}...`);
        }
        return;
    }

    receivedBuffers.push(data);
    receivedSize += data.byteLength;

    if (receivedSize === fileSize) {
        const blob = new Blob(receivedBuffers, { type: fileType });
        receivedBuffers = [];
        const url = URL.createObjectURL(blob);
        
        // Dispatch event to chat.js
        const customEvent = new CustomEvent('webrtc-file-received', { 
            detail: { url, name: fileName, type: fileType } 
        });
        document.dispatchEvent(customEvent);
    }
}

// 4. SEND FILE FUNCTION
export function sendFileViaWebRTC(file) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("No P2P Connection. Start a call first!");
        return false;
    }

    // Send Metadata
    const meta = JSON.stringify({
        type: 'metadata',
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
    });
    dataChannel.send(meta);

    // Send File in Chunks
    const chunkSize = 16384; 
    const fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        if (offset < file.size) {
            readSlice(offset);
        }
    };

    const readSlice = (o) => {
        const slice = file.slice(o, o + chunkSize);
        fileReader.readAsArrayBuffer(slice);
    };

    readSlice(0);
    return true;
}

// 5. CALL LOGIC
export async function startCall(receiverId) {
    const success = await openMediaSources();
    if (!success) return;

    document.getElementById("call-modal").style.display = "flex";
    
    const callDocRef = doc(collection(db, "calls"));
    const offerCandidates = collection(callDocRef, "offerCandidates");
    const answerCandidates = collection(callDocRef, "answerCandidates");

    peerConnection = new RTCPeerConnection(servers);
    createDataChannel(peerConnection); // Init Data Channel

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
    };

    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    await setDoc(callDocRef, {
        offer: { type: offerDescription.type, sdp: offerDescription.sdp },
        callerId: auth.currentUser.uid,
        receiverId: receiverId,
        status: "ringing"
    });

    unsubscribe = onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if (!peerConnection.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            peerConnection.setRemoteDescription(answerDescription);
            document.getElementById("call-status").innerText = "Connected";
        }
    });

    onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                peerConnection.addIceCandidate(candidate);
            }
        });
    });

    document.getElementById("hangup-btn").onclick = () => endCall(callDocRef.id);
}

export async function answerCall(callId) {
    const success = await openMediaSources();
    if (!success) return;

    document.getElementById("call-modal").style.display = "flex";
    document.getElementById("call-status").innerText = "Connecting...";

    const callDocRef = doc(db, "calls", callId);
    const answerCandidates = collection(callDocRef, "answerCandidates");
    const offerCandidates = collection(callDocRef, "offerCandidates");

    peerConnection = new RTCPeerConnection(servers);
    setupDataChannel(peerConnection); // Setup Listener

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
    };

    const callSnapshot = await getDoc(callDocRef);
    const callData = callSnapshot.data();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    await updateDoc(callDocRef, {
        answer: { type: answerDescription.type, sdp: answerDescription.sdp },
        status: "connected"
    });

    onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                peerConnection.addIceCandidate(candidate);
            }
        });
    });

    document.getElementById("hangup-btn").onclick = () => endCall(callId);
}

export function isCallActive() {
    return (dataChannel && dataChannel.readyState === 'open');
}

async function endCall(callId) {
    if (peerConnection) peerConnection.close();
    if (dataChannel) dataChannel.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    
    document.getElementById("call-modal").style.display = "none";
    if(callId) await updateDoc(doc(db, "calls", callId), { status: "ended" });
    if (unsubscribe) unsubscribe();
    window.location.reload();
}
