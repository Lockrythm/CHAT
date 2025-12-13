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
let unsubscribe = null; // To stop listening when call ends

// 1. Initialize Media (Camera/Mic)
async function openMediaSources() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById("localVideo");
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true; // Mute yourself to avoid feedback loop
        }
        
        remoteStream = new MediaStream();
        const remoteVideo = document.getElementById("remoteVideo");
        if (remoteVideo) remoteVideo.srcObject = remoteStream;

        return true;
    } catch (error) {
        console.error("Error accessing media devices:", error);
        alert("Could not access camera/microphone.");
        return false;
    }
}

// 2. CREATE A CALL (Caller Side)
export async function startCall(receiverId) {
    const success = await openMediaSources();
    if (!success) return;

    document.getElementById("call-modal").style.display = "flex";
    
    // Create Call Doc
    const callDocRef = doc(collection(db, "calls"));
    const offerCandidates = collection(callDocRef, "offerCandidates");
    const answerCandidates = collection(callDocRef, "answerCandidates");

    peerConnection = new RTCPeerConnection(servers);

    // Add local tracks to connection
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Listen for remote tracks
    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    // ICE Candidates (Internet Connection info)
    peerConnection.onicecandidate = event => {
        if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
    };

    // Create Offer
    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const callOffer = {
        offer: { type: offerDescription.type, sdp: offerDescription.sdp },
        callerId: auth.currentUser.uid,
        receiverId: receiverId,
        status: "ringing" // Initial status
    };

    await setDoc(callDocRef, callOffer);

    // Listen for Answer
    unsubscribe = onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if (!peerConnection.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            peerConnection.setRemoteDescription(answerDescription);
            document.getElementById("call-status").innerText = "Connected";
        }
    });

    // Listen for remote ICE candidates
    onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const candidate = new RTCIceCandidate(change.doc.data());
                peerConnection.addIceCandidate(candidate);
            }
        });
    });

    // Save Call ID to button for hangup
    document.getElementById("hangup-btn").onclick = () => endCall(callDocRef.id);
}

// 3. ANSWER A CALL (Receiver Side)
export async function answerCall(callId) {
    const success = await openMediaSources();
    if (!success) return;

    document.getElementById("call-modal").style.display = "flex";
    document.getElementById("call-status").innerText = "Connecting...";

    const callDocRef = doc(db, "calls", callId);
    const answerCandidates = collection(callDocRef, "answerCandidates");
    const offerCandidates = collection(callDocRef, "offerCandidates");

    peerConnection = new RTCPeerConnection(servers);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
    };

    // Fetch Offer
    const callSnapshot = await getDoc(callDocRef);
    const callData = callSnapshot.data();

    const offerDescription = callData.offer;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
    };

    await updateDoc(callDocRef, { answer, status: "connected" });

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

// 4. END CALL
async function endCall(callId) {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop()); // Turn off camera
    
    document.getElementById("call-modal").style.display = "none";
    
    if(callId) {
        // Optionally delete the call doc or mark as ended
        await updateDoc(doc(db, "calls", callId), { status: "ended" });
    }
    
    if (unsubscribe) unsubscribe();
    window.location.reload(); // Simple reset
}