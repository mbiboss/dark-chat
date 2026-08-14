import { auth, database, messaging, ref, set, push, onValue, update, remove, serverTimestamp, get, signInWithEmailAndPassword, signOut, onAuthStateChanged, getToken, onMessage } from './firebase.js';
import crypto from './crypto.js';

let currentAdmin = null;
let selectedUserId = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;

// DOM Elements
const adminLogin = document.getElementById('admin-login');
const adminDashboard = document.getElementById('admin-dashboard');
const adminEmail = document.getElementById('admin-email');
const adminPassword = document.getElementById('admin-password');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const loginError = document.getElementById('login-error');
const usersList = document.getElementById('users-list');
const userSearch = document.getElementById('user-search');
const conversationHeader = document.getElementById('conversation-header');
const adminMessages = document.getElementById('admin-messages');
const adminMessageInput = document.getElementById('admin-message-input');
const adminSendBtn = document.getElementById('admin-send-btn');
const voiceCallBtn = document.getElementById('voice-call-btn');
const videoCallBtn = document.getElementById('video-call-btn');
const endCallBtn = document.getElementById('end-call-btn');
const muteSelfBtn = document.getElementById('mute-self-btn');
const muteUserBtn = document.getElementById('mute-user-btn');
const toggleCameraBtn = document.getElementById('toggle-camera-btn');
const adminVideo = document.getElementById('admin-video');

// Admin login
adminLoginBtn.addEventListener('click', async () => {
    const email = adminEmail.value.trim();
    const password = adminPassword.value;
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        currentAdmin = userCredential.user;
        
        // Verify admin role in database
        const adminRef = ref(database, `admins/${currentAdmin.uid}`);
        const snapshot = await get(adminRef);
        
        if (snapshot.exists() && snapshot.val().role === 'admin') {
            showScreen('admin-dashboard');
            initializeAdmin();
        } else {
            loginError.textContent = 'NOT AUTHORIZED';
            await signOut(auth);
        }
    } catch (error) {
        loginError.textContent = 'ACCESS DENIED';
    }
});

// Admin logout
adminLogoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    showScreen('admin-login');
    currentAdmin = null;
});

// Show screen
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// Initialize admin dashboard
function initializeAdmin() {
    loadUsers();
    setupAdminNotifications();
    setupCallListeners();
}

// Load users
function loadUsers() {
    const usersRef = ref(database, 'users');
    
    onValue(usersRef, (snapshot) => {
        usersList.innerHTML = '';
        const users = snapshot.val();
        
        if (users) {
            Object.keys(users).forEach(userId => {
                const user = users[userId];
                const searchTerm = userSearch.value.toLowerCase();
                
                if (!searchTerm || user.username.toLowerCase().includes(searchTerm)) {
                    displayUser(userId, user);
                }
            });
        }
    });
}

// Search users
userSearch.addEventListener('input', loadUsers);

// Display user
function displayUser(userId, user) {
    const userDiv = document.createElement('div');
    userDiv.className = `user-item ${userId === selectedUserId ? 'selected' : ''}`;
    userDiv.onclick = () => selectUser(userId, user);
    
    const statusClass = user.online ? 'online' : 'offline';
    const unreadBadge = user.unreadCount ? `<span class="unread-badge">${user.unreadCount}</span>` : '';
    
    userDiv.innerHTML = `
        <span class="user-status ${statusClass}"></span>
        ${user.username}
        ${unreadBadge}
    `;
    
    usersList.appendChild(userDiv);
}

// Select user
function selectUser(userId, user) {
    selectedUserId = userId;
    conversationHeader.textContent = `CHANNEL://${userId}`;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.user-item').classList.add('selected');
    
    // Load conversation
    loadConversation(userId);
    
    // Mark messages as read
    set(ref(database, `conversations/${userId}/unread`), 0);
}

// Load conversation
function loadConversation(userId) {
    const messagesRef = ref(database, `conversations/${userId}/messages`);
    
    onValue(messagesRef, (snapshot) => {
        adminMessages.innerHTML = '';
        const messages = snapshot.val();
        
        if (messages) {
            Object.keys(messages).forEach(key => {
                const message = messages[key];
                displayAdminMessage(message);
                
                // Mark as read
                if (message.sender === 'user') {
                    update(ref(database, `conversations/${userId}/messages/${key}`), { read: true });
                }
            });
        }
        
        adminMessages.scrollTop = adminMessages.scrollHeight;
    });
    
    // Listen for typing
    const typingRef = ref(database, `conversations/${userId}/typing`);
    onValue(typingRef, (snapshot) => {
        const isTyping = snapshot.val();
        if (isTyping) {
            conversationHeader.textContent = `CHANNEL://${userId} - TYPING...`;
        } else {
            conversationHeader.textContent = `CHANNEL://${userId}`;
        }
    });
}

// Display admin message
function displayAdminMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === 'admin' ? 'message-admin' : 'message-user'}`;
    
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    
    messageDiv.innerHTML = `
        <div class="message-sender">${message.sender === 'admin' ? 'YOU' : 'USER'}</div>
        <div class="message-content">${crypto.decrypt(message.content)}</div>
        <div class="message-timestamp">${timestamp}</div>
    `;
    
    adminMessages.appendChild(messageDiv);
}

// Send message
adminSendBtn.addEventListener('click', sendAdminMessage);
adminMessageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendAdminMessage();
});

function sendAdminMessage() {
    const content = adminMessageInput.value.trim();
    if (!content || !selectedUserId) return;
    
    const messagesRef = ref(database, `conversations/${selectedUserId}/messages`);
    const newMessageRef = push(messagesRef);
    
    set(newMessageRef, {
        content: crypto.encrypt(content),
        sender: 'admin',
        timestamp: serverTimestamp()
    });
    
    // Update user notifications
    set(ref(database, `notifications/users/${selectedUserId}`), {
        message: content,
        timestamp: serverTimestamp()
    });
    
    adminMessageInput.value = '';
}

// Setup admin notifications
function setupAdminNotifications() {
    const notificationsRef = ref(database, 'notifications/admin');
    
    onValue(notificationsRef, (snapshot) => {
        const notifications = snapshot.val();
        if (notifications) {
            Object.keys(notifications).forEach(userId => {
                const notification = notifications[userId];
                if (notification && !notification.notified) {
                    showAdminNotification(notification);
                    update(ref(database, `notifications/admin/${userId}`), { notified: true });
                }
            });
        }
    });
}

function showAdminNotification(notification) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notificationObj = new Notification('🔔 DARK CHAT', {
            body: `NEW MESSAGE FROM: ${notification.username}`,
            icon: '/icons/icon-192x192.png'
        });
        
        notificationObj.onclick = () => {
            window.focus();
            // Find and select the user
            const userId = Object.keys(notification).find(key => key !== 'username' && key !== 'message');
            if (userId) {
                selectUser(userId, { username: notification.username });
            }
        };
    }
}

// WebRTC Call Functions
async function startVoiceCall() {
    if (!selectedUserId) return;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Set call state
        await set(ref(database, `calls/${selectedUserId}`), {
            state: 'active',
            mode: 'voice',
            adminMuted: false,
            userMuted: false,
            adminCamera: false,
            userCamera: false,
            timestamp: serverTimestamp()
        });
        
        await setupPeerConnection('voice');
        
    } catch (error) {
        console.error('Voice call error:', error);
    }
}

async function startVideoCall() {
    if (!selectedUserId) return;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: true 
        });
        
        adminVideo.srcObject = localStream;
        
        // Set call state
        await set(ref(database, `calls/${selectedUserId}`), {
            state: 'active',
            mode: 'video',
            adminMuted: false,
            userMuted: false,
            adminCamera: true,
            userCamera: false,
            timestamp: serverTimestamp()
        });
        
        await setupPeerConnection('video');
        
    } catch (error) {
        console.error('Video call error:', error);
    }
}

async function setupPeerConnection(mode) {
    peerConnection = new RTCPeerConnection();
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        const remoteVideo = document.createElement('video');
        remoteVideo.srcObject = remoteStream;
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        document.querySelector('.conversation-panel').appendChild(remoteVideo);
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            const candidateRef = push(ref(database, `calls/${selectedUserId}/iceCandidates`));
            set(candidateRef, event.candidate.toJSON());
        }
    };
    
    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await set(ref(database, `calls/${selectedUserId}/offer`), offer);
    
    // Listen for answer
    const answerRef = ref(database, `calls/${selectedUserId}/answer`);
    onValue(answerRef, async (snapshot) => {
        const answer = snapshot.val();
        if (answer && peerConnection) {
            await peerConnection.setRemoteDescription(answer);
        }
    });
    
    // Listen for ICE candidates
    const iceRef = ref(database, `calls/${selectedUserId}/iceCandidates`);
    onValue(iceRef, (snapshot) => {
        const candidates = snapshot.val();
        if (candidates && peerConnection) {
            Object.keys(candidates).forEach(key => {
                if (candidates[key] && !candidates[key].added) {
                    peerConnection.addIceCandidate(candidates[key]);
                    candidates[key].added = true;
                }
            });
        }
    });
}

function endCall() {
    if (!selectedUserId) return;
    
    // End call
    set(ref(database, `calls/${selectedUserId}`), {
        state: 'ended',
        timestamp: serverTimestamp()
    });
    
    // Cleanup
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    
    adminVideo.srcObject = null;
}

function toggleMuteSelf() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach(track => {
        track.enabled = !track.enabled;
    });
    
    // Update database
    update(ref(database, `calls/${selectedUserId}`), {
        adminMuted: !audioTracks[0].enabled
    });
}

function toggleMuteUser() {
    if (!selectedUserId) return;
    
    update(ref(database, `calls/${selectedUserId}`), {
        userMuted: !getCurrentUserMuted()
    });
}

function getCurrentUserMuted() {
    // Read from database
    const callRef = ref(database, `calls/${selectedUserId}/userMuted`);
    let muted = false;
    get(callRef).then(snapshot => {
        muted = snapshot.val() || false;
    });
    return muted;
}

function toggleCamera() {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    videoTracks.forEach(track => {
        track.enabled = !track.enabled;
    });
    
    update(ref(database, `calls/${selectedUserId}`), {
        adminCamera: videoTracks[0].enabled
    });
}

// Event listeners for call controls
voiceCallBtn.addEventListener('click', startVoiceCall);
videoCallBtn.addEventListener('click', startVideoCall);
endCallBtn.addEventListener('click', endCall);
muteSelfBtn.addEventListener('click', toggleMuteSelf);
muteUserBtn.addEventListener('click', toggleMuteUser);
toggleCameraBtn.addEventListener('click', toggleCamera);

// Setup call listeners
function setupCallListeners() {
    if (selectedUserId) {
        const callRef = ref(database, `calls/${selectedUserId}`);
        onValue(callRef, (snapshot) => {
            const callData = snapshot.val();
            if (callData) {
                handleCallData(callData);
            }
        });
    }
}

function handleCallData(callData) {
    // Update UI based on call state
    if (callData.state === 'active') {
        endCallBtn.textContent = 'END CALL';
        muteSelfBtn.textContent = callData.adminMuted ? 'UNMUTE SELF' : 'MUTE SELF';
        muteUserBtn.textContent = callData.userMuted ? 'UNMUTE USER' : 'MUTE USER';
        toggleCameraBtn.textContent = callData.adminCamera ? 'DISABLE CAMERA' : 'ENABLE CAMERA';
    } else if (callData.state === 'ended') {
        endCallBtn.textContent = 'END CALL';
        muteSelfBtn.textContent = 'MUTE SELF';
        muteUserBtn.textContent = 'MUTE USER';
        toggleCameraBtn.textContent = 'TOGGLE CAMERA';
    }
}
