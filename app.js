import { auth, database, messaging, ref, set, push, onValue, update, remove, serverTimestamp, get, signInAnonymously, onAuthStateChanged, getToken, onMessage } from './firebase.js';
import crypto from './crypto.js';

let currentUser = null;
let username = '';
let selectedUserId = null;
let activeListeners = new Map();

// DOM Elements - will be initialized after DOM loads
let welcomeScreen;
let chatScreen;
let callScreen;
let usernameInput;
let enterChatBtn;
let messageInput;
let sendBtn;
let messagesContainer;
let typingIndicator;

// Initialize DOM elements after page loads
function initializeDOMElements() {
    welcomeScreen = document.getElementById('welcome-screen');
    chatScreen = document.getElementById('chat-screen');
    callScreen = document.getElementById('call-screen');
    usernameInput = document.getElementById('username-input');
    enterChatBtn = document.getElementById('enter-chat-btn');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    messagesContainer = document.getElementById('messages-container');
    typingIndicator = document.getElementById('typing-indicator');
    
    setupEventListeners();
}

// Show screen function
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.add('active');
    }
}

// Setup event listeners
function setupEventListeners() {
    if (!enterChatBtn) {
        console.error('enterChatBtn not found');
        return;
    }
    
    // Enter chat
    enterChatBtn.addEventListener('click', async () => {
        username = usernameInput.value.trim();
        if (!username) {
            alert('Please enter your name');
            return;
        }
        
        enterChatBtn.disabled = true;
        enterChatBtn.textContent = 'CONNECTING...';
        
        try {
            // Try Firebase anonymous auth
            let userUid = null;
            try {
                const userCredential = await signInAnonymously(auth);
                currentUser = userCredential.user;
                userUid = currentUser.uid;
                console.log('Firebase auth successful:', userUid);
            } catch (authError) {
                console.warn('Firebase auth failed, using local UID:', authError);
                // Fallback: Create local user ID if Firebase auth fails
                userUid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                currentUser = { uid: userUid };
            }
            
            // Save user info to database
            try {
                await set(ref(database, `users/${userUid}`), {
                    username: username,
                    online: true,
                    lastSeen: serverTimestamp(),
                    createdAt: serverTimestamp()
                });
                console.log('User saved to database:', userUid);
            } catch (dbError) {
                console.error('Database error saving user:', dbError);
            }
            
            usernameInput.value = '';
            showScreen('chat-screen');
            initializeChat();
            setupPresence();
            
        } catch (error) {
            console.error('Critical error:', error);
            alert('Error: ' + (error.message || 'Could not connect'));
            enterChatBtn.disabled = false;
            enterChatBtn.textContent = 'ENTER CHAT';
        }
    });
    
    // Send message listeners
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
        
        messageInput.addEventListener('input', () => {
            if (!currentUser) return;
            const typingRef = ref(database, `conversations/${currentUser.uid}/typing`);
            set(typingRef, true).catch(err => console.log('Typing error:', err));
            
            clearTimeout(window.typingTimeout);
            window.typingTimeout = setTimeout(() => {
                set(typingRef, false).catch(err => console.log('Typing clear error:', err));
            }, 2000);
        });
    }
}

// Initialize chat
function initializeChat() {
    if (!currentUser) return;
    
    // Cleanup old listeners
    cleanupListeners();
    
    const conversationRef = ref(database, `conversations/${currentUser.uid}/messages`);
    
    const unsubscribe = onValue(conversationRef, (snapshot) => {
        messagesContainer.innerHTML = '';
        const messages = snapshot.val();
        
        if (messages) {
            Object.keys(messages).sort().forEach(key => {
                const message = messages[key];
                displayMessage(message);
            });
        }
        
        // Scroll to bottom
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    });
    
    activeListeners.set('messages', unsubscribe);
    
    // Listen for typing indicator
    const typingRef = ref(database, `conversations/${currentUser.uid}/typing`);
    const typingUnsub = onValue(typingRef, (snapshot) => {
        const isTyping = snapshot.val();
        typingIndicator.textContent = isTyping ? '[ADMIN TYPING...]' : '';
    });
    
    activeListeners.set('typing', typingUnsub);
    
    // Setup push notifications
    setupNotifications();
}

// Display message
function displayMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === 'admin' ? 'message-admin' : 'message-user'}`;
    
    let decrypted = message.content;
    try {
        decrypted = crypto.decrypt(message.content);
    } catch (e) {
        console.log('Decrypt error:', e);
    }
    
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    
    messageDiv.innerHTML = `
        <div class="message-sender">${message.sender === 'admin' ? '[ADMIN]' : '[YOU]'}</div>
        <div class="message-content">${decrypted}</div>
        <div class="message-timestamp">${timestamp}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
}

// Send message
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentUser) return;
    
    const messagesRef = ref(database, `conversations/${currentUser.uid}/messages`);
    const newMessageRef = push(messagesRef);
    
    let encrypted = content;
    try {
        encrypted = crypto.encrypt(content);
    } catch (e) {
        console.log('Encrypt error:', e);
    }
    
    set(newMessageRef, {
        content: encrypted,
        sender: 'user',
        timestamp: serverTimestamp(),
        read: false
    }).catch(err => {
        console.error('Send error:', err);
        alert('Failed to send message');
    });
    
    // Update admin notifications
    set(ref(database, `notifications/admin/${currentUser.uid}`), {
        username: username,
        userId: currentUser.uid,
        message: content,
        timestamp: serverTimestamp(),
        read: false
    }).catch(err => console.log('Notification error:', err));
    
    messageInput.value = '';
}

// Setup presence
function setupPresence() {
    if (!currentUser) return;
    
    const userRef = ref(database, `users/${currentUser.uid}`);
    const connectedRef = ref(database, '.info/connected');
    
    const unsubscribe = onValue(connectedRef, (snapshot) => {
        if (snapshot.val() === true) {
            update(userRef, { 
                online: true,
                lastSeen: serverTimestamp()
            }).catch(err => console.log('Update online error:', err));
        }
    });
    
    activeListeners.set('presence', unsubscribe);
    
    // Cleanup on page close
    window.addEventListener('beforeunload', () => {
        update(userRef, { 
            online: false,
            lastSeen: serverTimestamp()
        }).catch(err => console.log('Offline error:', err));
    });
}

// Setup notifications
async function setupNotifications() {
    try {
        if (messaging && currentUser) {
            const token = await getToken(messaging, { 
                vapidKey: 'BD5h6-Kq0DhkWYT0zqLnqPaY-_Bk8P8hWsNXH5wAm5w3cjLjw8XJf7NjWqYLEqF4g0T6FqR6H9sJlQ4nKkZs1w'
            });
            
            if (token) {
                set(ref(database, `users/${currentUser.uid}/fcmToken`), token)
                    .catch(err => console.log('Token save error:', err));
                
                onMessage(messaging, (payload) => {
                    if (payload.notification) {
                        showNotification(payload.notification.title || 'DARK CHAT', 
                                        payload.notification.body || 'New message');
                    }
                });
            }
        }
    } catch (error) {
        console.log('Messaging not available:', error);
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`📬 ${title}`, {
            body: body,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23000" width="192" height="192"/><text x="96" y="120" font-size="80" fill="%2300ff00" text-anchor="middle" font-family="monospace">◉</text></svg>'
        });
    }
}

// Cleanup listeners
function cleanupListeners() {
    activeListeners.forEach((unsubscribe, key) => {
        try {
            unsubscribe();
        } catch (e) {
            console.log('Cleanup error for', key, ':', e);
        }
    });
    activeListeners.clear();
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDOMElements);
} else {
    initializeDOMElements();
}

// Cleanup on page close
window.addEventListener('beforeunload', cleanupListeners);
