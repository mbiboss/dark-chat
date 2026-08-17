import { database, ref, set, push, onValue, update, remove, serverTimestamp, get } from './firebase.js';
import crypto from './crypto.js';

const ADMIN_PASSWORD = 'Dark_Host.02';

let currentAdmin = null;
let selectedUserId = null;
let activeListeners = new Map();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

function initializePage() {
    setupDOMElements();
    setupEventListeners();
}

// Setup DOM elements
let adminLogin;
let adminDashboard;
let adminPassword;
let adminLoginBtn;
let adminLogoutBtn;
let loginError;
let usersList;
let userSearch;
let conversationHeader;
let adminMessages;
let adminMessageInput;
let adminSendBtn;

function setupDOMElements() {
    adminLogin = document.getElementById('admin-login');
    adminDashboard = document.getElementById('admin-dashboard');
    adminPassword = document.getElementById('admin-password');
    adminLoginBtn = document.getElementById('admin-login-btn');
    adminLogoutBtn = document.getElementById('admin-logout-btn');
    loginError = document.getElementById('login-error');
    usersList = document.getElementById('users-list');
    userSearch = document.getElementById('user-search');
    conversationHeader = document.getElementById('conversation-header');
    adminMessages = document.getElementById('admin-messages');
    adminMessageInput = document.getElementById('admin-message-input');
    adminSendBtn = document.getElementById('admin-send-btn');
}

function setupEventListeners() {
    if (adminLoginBtn) {
        adminLoginBtn.addEventListener('click', handleAdminLogin);
    }
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', handleAdminLogout);
    }
    if (adminSendBtn) {
        adminSendBtn.addEventListener('click', sendAdminMessage);
    }
    if (adminMessageInput) {
        adminMessageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendAdminMessage();
        });
    }
    if (userSearch) {
        userSearch.addEventListener('input', filterUsers);
    }
}

// Admin login
async function handleAdminLogin() {
    const password = adminPassword.value;
    
    if (!password) {
        loginError.textContent = 'ENTER PASSWORD';
        return;
    }
    
    if (password === ADMIN_PASSWORD) {
        currentAdmin = { id: 'admin_' + Date.now(), role: 'admin' };
        loginError.textContent = '';
        showScreen('admin-dashboard');
        initializeAdmin();
    } else {
        loginError.textContent = 'ACCESS DENIED';
        adminPassword.value = '';
    }
}

// Admin logout
function handleAdminLogout() {
    currentAdmin = null;
    adminPassword.value = '';
    loginError.textContent = '';
    cleanupAllListeners();
    showScreen('admin-login');
    selectedUserId = null;
}

// Show screen
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.add('active');
    }
}

// Initialize admin dashboard
function initializeAdmin() {
    loadUsers();
}

// Load users
function loadUsers() {
    const usersRef = ref(database, 'users');
    
    // Remove old listener if exists
    if (activeListeners.has('users')) {
        activeListeners.delete('users');
    }
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
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
    
    activeListeners.set('users', unsubscribe);
}

// Filter users
function filterUsers() {
    loadUsers();
}

// Display user
function displayUser(userId, user) {
    const userDiv = document.createElement('div');
    userDiv.className = `user-item ${userId === selectedUserId ? 'selected' : ''}`;
    userDiv.style.cursor = 'pointer';
    userDiv.onclick = () => selectUser(userId, user);
    
    const statusClass = user.online ? 'online' : 'offline';
    const statusSymbol = user.online ? '●' : '○';
    
    userDiv.innerHTML = `
        <span class="status-indicator ${statusClass}">${statusSymbol}</span>
        <span class="username">${user.username || 'Unknown'}</span>
        <span class="last-seen">${user.online ? 'ONLINE' : 'OFFLINE'}</span>
    `;
    
    usersList.appendChild(userDiv);
}

// Select user
function selectUser(userId, user) {
    selectedUserId = userId;
    conversationHeader.textContent = `>> ${user.username || 'USER'}`;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.user-item').classList.add('selected');
    
    // Load conversation
    loadConversation(userId);
}

// Load conversation
function loadConversation(userId) {
    // Remove old conversation listeners
    ['messages', 'typing'].forEach(key => {
        const listenerKey = `conv_${userId}_${key}`;
        if (activeListeners.has(listenerKey)) {
            activeListeners.delete(listenerKey);
        }
    });
    
    const messagesRef = ref(database, `conversations/${userId}/messages`);
    
    const unsubscribe = onValue(messagesRef, (snapshot) => {
        adminMessages.innerHTML = '';
        const messages = snapshot.val();
        
        if (messages) {
            Object.keys(messages).sort().forEach(key => {
                const message = messages[key];
                displayAdminMessage(message);
                
                // Mark as read
                if (message.sender === 'user') {
                    update(ref(database, `conversations/${userId}/messages/${key}`), { 
                        read: true 
                    }).catch(err => console.log('Read mark error:', err));
                }
            });
        }
        
        // Scroll to bottom
        setTimeout(() => {
            adminMessages.scrollTop = adminMessages.scrollHeight;
        }, 100);
    });
    
    activeListeners.set(`conv_${userId}_messages`, unsubscribe);
    
    // Listen for typing
    const typingRef = ref(database, `conversations/${userId}/typing`);
    const typingUnsub = onValue(typingRef, (snapshot) => {
        const isTyping = snapshot.val();
        const user = document.querySelector('.user-item.selected');
        const userName = user ? user.querySelector('.username').textContent : 'USER';
        
        if (isTyping) {
            conversationHeader.textContent = `>> ${userName} [TYPING...]`;
        } else {
            conversationHeader.textContent = `>> ${userName}`;
        }
    });
    
    activeListeners.set(`conv_${userId}_typing`, typingUnsub);
}

// Display admin message
function displayAdminMessage(message) {
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
        <div class="message-sender">${message.sender === 'admin' ? '[ADMIN]' : '[USER]'}</div>
        <div class="message-content">${decrypted}</div>
        <div class="message-timestamp">${timestamp}</div>
    `;
    
    adminMessages.appendChild(messageDiv);
}

// Send message
function sendAdminMessage() {
    const content = adminMessageInput.value.trim();
    if (!content || !selectedUserId || !currentAdmin) {
        console.log('Send error: content, user or admin missing');
        return;
    }
    
    const messagesRef = ref(database, `conversations/${selectedUserId}/messages`);
    const newMessageRef = push(messagesRef);
    
    let encrypted = content;
    try {
        encrypted = crypto.encrypt(content);
    } catch (e) {
        console.log('Encrypt error:', e);
    }
    
    set(newMessageRef, {
        content: encrypted,
        sender: 'admin',
        timestamp: serverTimestamp(),
        read: true
    }).catch(err => {
        console.error('Send message error:', err);
        alert('Failed to send message');
    });
    
    // Mark as admin replied
    update(ref(database, `conversations/${selectedUserId}`), {
        lastAdminReply: serverTimestamp()
    }).catch(err => console.log('Update error:', err));
    
    adminMessageInput.value = '';
}

// Cleanup all listeners
function cleanupAllListeners() {
    activeListeners.forEach(unsubscribe => {
        try {
            unsubscribe();
        } catch (e) {
            console.log('Cleanup error:', e);
        }
    });
    activeListeners.clear();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupAllListeners);
