import { auth, database, messaging, ref, set, push, onValue, update, remove, serverTimestamp, get, signInAnonymously, onAuthStateChanged, getToken, onMessage } from './firebase.js';
import crypto from './crypto.js';

let currentUser = null;
let username = '';
let selectedUserId = null;
let peerConnection = null;
let localStream = null;

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const chatScreen = document.getElementById('chat-screen');
const callScreen = document.getElementById('call-screen');
const usernameInput = document.getElementById('username-input');
const enterChatBtn = document.getElementById('enter-chat-btn');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages-container');
const typingIndicator = document.getElementById('typing-indicator');

// Show screen function
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// Enter chat
enterChatBtn.addEventListener('click', async () => {
    username = usernameInput.value.trim();
    if (!username) return;
    
    try {
        const userCredential = await signInAnonymously(auth);
        currentUser = userCredential.user;
        
        // Save user info to database
        await set(ref(database, `users/${currentUser.uid}`), {
            username: username,
            online: true,
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp()
        });
        
        showScreen('chat-screen');
        initializeChat();
        setupPresence();
    } catch (error) {
        console.error('Auth error:', error);
    }
});

// Initialize chat
function initializeChat() {
    const conversationRef = ref(database, `conversations/${currentUser.uid}/messages`);
    
    onValue(conversationRef, (snapshot) => {
        messagesContainer.innerHTML = '';
        const messages = snapshot.val();
        
        if (messages) {
            Object.keys(messages).forEach(key => {
                const message = messages[key];
                displayMessage(message);
            });
        }
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
    
    // Listen for typing indicator
    const typingRef = ref(database, `conversations/${currentUser.uid}/typing`);
    onValue(typingRef, (snapshot) => {
        const isTyping = snapshot.val();
        typingIndicator.textContent = isTyping ? 'ADMIN is typing...' : '';
    });
    
    // Setup push notifications
    setupNotifications();
}

// Display message
function displayMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === 'admin' ? 'message-admin' : 'message-user'}`;
    
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    
    messageDiv.innerHTML = `
        <div class="message-sender">${message.sender === 'admin' ? 'ADMIN' : 'YOU'}</div>
        <div class="message-content">${crypto.decrypt(message.content)}</div>
        <div class="message-timestamp">${timestamp}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
}

// Send message
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentUser) return;
    
    const messagesRef = ref(database, `conversations/${currentUser.uid}/messages`);
    const newMessageRef = push(messagesRef);
    
    set(newMessageRef, {
        content: crypto.encrypt(content),
        sender: 'user',
        timestamp: serverTimestamp(),
        read: false
    });
    
    // Update admin notifications
    set(ref(database, `notifications/admin/${currentUser.uid}`), {
        username: username,
        message: content,
        timestamp: serverTimestamp(),
        read: false
    });
    
    messageInput.value = '';
}

// Message input typing indicator
messageInput.addEventListener('input', () => {
    const typingRef = ref(database, `conversations/${currentUser.uid}/typing`);
    set(typingRef, true);
    
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
        set(typingRef, false);
    }, 1000);
});

// Setup presence
function setupPresence() {
    const userRef = ref(database, `users/${currentUser.uid}`);
    const connectedRef = ref(database, '.info/connected');
    
    onValue(connectedRef, (snapshot) => {
        if (snapshot.val() === true) {
            update(userRef, { online: true });
            
            // Set offline on disconnect
            const onDisconnectRef = ref(database, `users/${currentUser.uid}`);
            onDisconnectRef.onDisconnect().update({ online: false });
        }
    });
}

// Setup notifications
async function setupNotifications() {
    try {
        if (messaging) {
            const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' });
            // Save token to database
            set(ref(database, `users/${currentUser.uid}/fcmToken`), token);
            
            onMessage(messaging, (payload) => {
                showNotification(payload.notification.title, payload.notification.body);
            });
        }
    } catch (error) {
        console.log('Notification permission denied');
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`🔔 ${title}`, {
            body: body,
            icon: '/icons/icon-192x192.png'
        });
    }
}

// Listen for call state
if (currentUser) {
    const callRef = ref(database, `calls/${currentUser.uid}/state`);
    onValue(callRef, (snapshot) => {
        const callState = snapshot.val();
        if (callState) {
            handleCallState(callState);
        } else {
            showScreen('chat-screen');
        }
    });
}

// Handle call state
async function handleCallState(callState) {
    if (callState === 'incoming' || callState === 'active') {
        showScreen('call-screen');
        document.getElementById('call-state-display').textContent = 
            callState === 'incoming' ? 'INCOMING CALL...' : 'CALL ACTIVE';
        
        // Get call details
        const callRef = ref(database, `calls/${currentUser.uid}`);
        onValue(callRef, async (snapshot) => {
            const callData = snapshot.val();
            if (callData) {
                if (callData.mode === 'video' && callData.userCamera) {
                    await initializeWebRTC(callData);
                }
            }
        });
    } else if (callState === 'ended') {
        showScreen('chat-screen');
        cleanupWebRTC();
    }
}

// Initialize WebRTC
async function initializeWebRTC(callData) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: callData.mode === 'video' && callData.userCamera
        });
        
        peerConnection = new RTCPeerConnection();
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remote-video');
            remoteVideo.srcObject = event.streams[0];
        };
        
        if (callData.offer) {
            await peerConnection.setRemoteDescription(callData.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            set(ref(database, `calls/${currentUser.uid}/answer`), answer);
        }
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateRef = push(ref(database, `calls/${currentUser.uid}/iceCandidates`));
                set(candidateRef, event.candidate.toJSON());
            }
        };
        
        // Listen for ICE candidates
        const iceRef = ref(database, `calls/${currentUser.uid}/iceCandidates`);
        onValue(iceRef, (snapshot) => {
            const candidates = snapshot.val();
            if (candidates) {
                Object.keys(candidates).forEach(key => {
                    if (candidates[key] && !candidates[key].added) {
                        peerConnection.addIceCandidate(candidates[key]);
                        candidates[key].added = true;
                    }
                });
            }
        });
        
    } catch (error) {
        console.error('WebRTC error:', error);
        document.getElementById('call-error').textContent = 
            'CAMERA/MICROPHONE ACCESS DENIED';
    }
}

function cleanupWebRTC() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}
