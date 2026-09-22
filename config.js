// ==========================================
// CONFIG.JS - GAME SETTINGS & RULES
// ==========================================
import { db, gameConfig, studentsCache, showToast } from './core.js';
import { ref, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==========================================
// 1. HELPER FUNCTIONS (Used by Logic.js)
// ==========================================

/**
 * Calculates points for a door based on its type and the current game config.
 */
export function getPointsForType(doorData) {
    if (!doorData) return gameConfig.mc_points || 10;
    if (doorData.type === 'mc') return gameConfig.mc_points || 10;
    if (doorData.type === 'long') return gameConfig.long_points || 25;
    // Default: all 'text' type doors use short_points
    return gameConfig.short_points || 15; 
}

/**
 * Calculates time limit for a door based on its type and the current game config.
 */
export function getTimeForType(doorData) {
    if (!doorData) return gameConfig.mc_time || 30;
    if (doorData.type === 'mc') return gameConfig.mc_time || 30;
    if (doorData.type === 'long') return gameConfig.long_time || 90;
    // Default: all 'text' type doors use short_time
    return gameConfig.short_time || 45; 
}

// ==========================================
// 2. TEACHER DASHBOARD UI & LOGIC
// ==========================================

/**
 * Renders the Game Settings panel and applies the safety lock if scores exist.
 */
export function renderGameConfig() {
    const mcInput = document.getElementById('mcLockoutInput');
    const textInput = document.getElementById('textLockoutInput');
    const backoutInput = document.getElementById('backoutLockoutInput');
    const correctInput = document.getElementById('correctLockoutInput');
    const mcPtsInput = document.getElementById('mcPointsInput');
    const shortPtsInput = document.getElementById('shortPointsInput');
    const longPtsInput = document.getElementById('longPointsInput');
    const mcTimeInput = document.getElementById('mcTimeInput');
    const shortTimeInput = document.getElementById('shortTimeInput');
    const longTimeInput = document.getElementById('longTimeInput');
    const shortAutoGradeInput = document.getElementById('shortAutoGradeInput'); 
    const saveBtn = document.getElementById('saveConfigBtn');
    const warning = document.getElementById('configWarning');

    // Only run if we are actually on the teacher screen
    if (!mcInput) return; 
if (shortAutoGradeInput) {
        shortAutoGradeInput.checked = gameConfig.short_auto_grade || false; // NEW
    }
    // 1. Populate inputs with current config values
    mcInput.value = gameConfig.mc_lockout || 30;
    textInput.value = gameConfig.text_lockout || 10;
    backoutInput.value = gameConfig.backout_lockout || 15;
    correctInput.value = gameConfig.correct_lockout || 0;
    mcPtsInput.value = gameConfig.mc_points || 10;
    shortPtsInput.value = gameConfig.short_points || 15;
    longPtsInput.value = gameConfig.long_points || 25;
    mcTimeInput.value = gameConfig.mc_time || 30;
    shortTimeInput.value = gameConfig.short_time || 45;
    longTimeInput.value = gameConfig.long_time || 90;

    // 2. SAFETY CHECK: Lock settings if any student has a score > 0
    const hasScores = Object.values(studentsCache).some(s => (s.score || 0) > 0);

    const allInputs = [
        mcInput, textInput, backoutInput, correctInput, 
        mcPtsInput, shortPtsInput, longPtsInput, 
        mcTimeInput, shortTimeInput, longTimeInput,shortAutoGradeInput
    ];

    if (hasScores) {
        allInputs.forEach(i => i.disabled = true);
        saveBtn.disabled = true;
        warning.style.display = 'block';
    } else {
        allInputs.forEach(i => i.disabled = false);
        saveBtn.disabled = false;
        warning.style.display = 'none';
    }
}

/**
 * Saves the teacher's new settings to Firebase.
 */
window.saveGameConfig = async () => {
    const mc = parseInt(document.getElementById('mcLockoutInput').value) || 30;
    const text = parseInt(document.getElementById('textLockoutInput').value) || 10;
    const backout = parseInt(document.getElementById('backoutLockoutInput').value) || 15;
    const correct = parseInt(document.getElementById('correctLockoutInput').value) || 0;
    const mcPts = parseInt(document.getElementById('mcPointsInput').value) || 10;
    const shortPts = parseInt(document.getElementById('shortPointsInput').value) || 15;
    const longPts = parseInt(document.getElementById('longPointsInput').value) || 25;
    const mcTime = parseInt(document.getElementById('mcTimeInput').value) || 30;
    const shortTime = parseInt(document.getElementById('shortTimeInput').value) || 45;
    const longTime = parseInt(document.getElementById('longTimeInput').value) || 90;
     const shortAutoGrade = document.getElementById('shortAutoGradeInput').checked; // NEW

    // Double safety check on the backend
    const hasScores = Object.values(studentsCache).some(s => (s.score || 0) > 0);
    if (hasScores) {
        showToast("⚠️ Cannot change settings while scores exist!");
        return;
    }

    // Push to Firebase
    await update(ref(db, 'config'), {
        mc_lockout: mc, text_lockout: text, backout_lockout: backout, correct_lockout: correct,
        mc_points: mcPts, short_points: shortPts, long_points: longPts,
        mc_time: mcTime, short_time: shortTime, long_time: longTime,short_auto_grade: shortAutoGrade
    });
    
    showToast("✅ Game settings saved!");
};