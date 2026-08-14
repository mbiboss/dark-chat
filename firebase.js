// Firebase configuration and initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, update, remove, serverTimestamp, get, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyDV6ijhrHfKihPmYhmmghKwUpjMSf3sdbk",
    authDomain: "dark-chat-ff61d.firebaseapp.com",
    databaseURL: "https://dark-chat-ff61d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "dark-chat-ff61d",
    storageBucket: "dark-chat-ff61d.firebasestorage.app",
    messagingSenderId: "284800870037",
    appId: "1:284800870037:web:6e05a14fc40ac49a615d9c",
    measurementId: "G-8QG5PSGZN6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
let messaging = null;

// Initialize messaging if supported
try {
    messaging = getMessaging(app);
} catch (error) {
    console.log('Messaging not supported');
}

export { app, auth, database, messaging };
export { ref, set, push, onValue, update, remove, serverTimestamp, get, query, orderByChild, limitToLast };
export { signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut };
export { getToken, onMessage };
