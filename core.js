// ==========================================
// 1. FIREBASE & APP CONFIGURATION
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export const TEACHER_PASSWORD = "admin"; // <-- CHANGE THIS TO YOUR SECRET TEACHER PASSWORD
export const firebaseConfig = {
    apiKey: "AIzaSyCXKAgQg-pyYDKSYbS5sO2tUULzIz0rSng",
    authDomain: "doorquiz.firebaseapp.com",
    databaseURL: "https://doorquiz-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "doorquiz",
    storageBucket: "doorquiz.firebasestorage.app",
    messagingSenderId: "449304432910",
    appId: "1:449304432910:web:2601e86227472ee8d5c75f"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// ==========================================
// 2. GLOBAL STATE
// ==========================================
export let currentUser = null;
export let currentDoorId = null;
export let timerInterval = null;
export let timeLeft = 30;
export let studentsCache = {};
export let teacherListeners = [];
export let hallwayListeners = [];
export let latestDoors = {};
export let hallwayInterval = null;

export let gameConfig = {
    mc_lockout: 30, text_lockout: 10, backout_lockout: 15, correct_lockout: 0,
    mc_points: 10, short_points: 15, long_points: 25,
    mc_time: 30, short_time: 45, long_time: 90,
    short_auto_grade: false // <-- NEW: Default to manual grading
};

// ==========================================
// 3. UTILITIES
// ==========================================
export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

export function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ==========================================
// 4. AUTH & NAVIGATION (LOGIN/LOGOUT)
// ==========================================
// We import these from logic.js to avoid circular dependency issues
import { initTeacherDashboard, listenToHallway } from './logic.js';

window.attemptLogin = async () => {
    const pwd = document.getElementById('passwordInput').value.trim();
    if (!pwd) return;

    // 1. Check if Teacher
    if (pwd === TEACHER_PASSWORD) {
        showScreen('teacherDashboardScreen');
        initTeacherDashboard();
        return;
    }

    // 2. Check if Student
    const userRef = ref(db, `students/${pwd}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
        currentUser = { password: pwd, ...snapshot.val() };
        document.getElementById('studentName').innerText = `${currentUser.nama} (${currentUser.kelas})`;
        document.getElementById('studentScore').innerText = currentUser.score || 0;
        showScreen('hallwayScreen');
        listenToHallway();

        // Listen to config updates in real-time
        onValue(ref(db, 'config'), (snap) => {
            if (snap.exists()) {
                // Mutate the existing object properties to keep references intact across modules
                Object.assign(gameConfig, snap.val()); 
            }
        });
    } else {
        document.getElementById('loginError').style.display = 'block';
        document.getElementById('passwordInput').value = '';
    }
};

window.logout = () => {
    currentUser = null;
    currentDoorId = null;
    clearInterval(timerInterval);

    if (hallwayInterval) clearInterval(hallwayInterval);
    hallwayInterval = null;

    hallwayListeners.forEach(unsub => unsub());
    hallwayListeners = [];

    teacherListeners.forEach(unsub => unsub());
    teacherListeners = [];

    document.getElementById('passwordInput').value = '';
    document.getElementById('loginError').style.display = 'none';
    showScreen('loginScreen');
};
// Add this to the very bottom of core.js
export function setCurrentUser(val) { currentUser = val; }
export function setCurrentDoorId(val) { currentDoorId = val; }
export function setHallwayInterval(val) { hallwayInterval = val; }