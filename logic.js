// ==========================================
// LOGIC.JS - GAMEPLAY, HALLWAY & TEACHER DASHBOARD
// ==========================================
import { 
    db, currentUser, currentDoorId, timerInterval, timeLeft, 
    studentsCache, teacherListeners, hallwayListeners, latestDoors, 
    hallwayInterval, gameConfig, showScreen, showToast,
    setCurrentUser, setCurrentDoorId, setHallwayInterval // <-- ADD THIS
} from './core.js';

import { ref, get, update, onValue, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getPointsForType, getTimeForType, renderGameConfig } from './config.js';

// ==========================================
// 1. TEACHER DASHBOARD LOGIC
// ==========================================

export function initTeacherDashboard() {
    // 1. Listen to students for leaderboard
    const unsubStudents = onValue(ref(db, 'students'), (snapshot) => {
        Object.assign(studentsCache, snapshot.val() || {});
        renderLeaderboard();
        renderGameConfig(); // Re-check safety lock when scores change
    });
    teacherListeners.push(unsubStudents);

    // 2. Listen to doors for grid and queue
    const unsubDoors = onValue(ref(db, 'doors'), (snapshot) => {
        const doors = snapshot.val() || {};
        renderTeacherDoorGrid(doors);
        renderGradingQueue(doors);
    });
    teacherListeners.push(unsubDoors);

    // 3. Listen to Game Config
    const unsubConfig = onValue(ref(db, 'config'), (snapshot) => {
        if (snapshot.exists()) {
            Object.assign(gameConfig, snapshot.val());
        }
        renderGameConfig();
    });
    teacherListeners.push(unsubConfig);
}

function renderTeacherDoorGrid(doors) {
    const grid = document.getElementById('teacherDoorGrid');
    grid.innerHTML = '';
    for (const [id, data] of Object.entries(doors)) {
        const el = document.createElement('div');
        el.className = `door-card ${data.status}`;
        let label = id;
        if (data.status === 'locked') label += `<br><small>${data.locked_by ? 'In Use' : 'Locked'}</small>`;
        if (data.status === 'pending') label += `<br><small>Grading...</small>`;
        if (data.status === 'sealed') label += `<br><small>Done</small>`;
        el.innerHTML = label;
        grid.appendChild(el);
    }
}

function renderGradingQueue(doors) {
    const queue = document.getElementById('gradingQueue');
    queue.innerHTML = '';
    let hasPending = false;
    for (const [doorId, data] of Object.entries(doors)) {
        if (data.status === 'pending' && data.submitted_by) {
            hasPending = true;
            const student = studentsCache[data.submitted_by] || { nama: 'Unknown', kelas: '?' };
            const pts = getPointsForType(data); // Use config points
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.innerHTML = `
                <div><strong>${student.nama}</strong> (${student.kelas})</div>
                <div style="font-size: 13px; color: #666; margin: 5px 0;">Door: ${doorId} | ${data.type.toUpperCase()}</div>
                <div style="background: #eee; padding: 10px; border-radius: 6px; font-style: italic; margin-top:5px;">"${data.submitted_answer}"</div>
                <div class="queue-actions">
                    <button class="btn-approve" onclick="gradeAnswer('${doorId}', '${data.submitted_by}', ${pts}, true)">✅ Approve (+${pts})</button>
                    <button class="btn-reject" onclick="gradeAnswer('${doorId}', '${data.submitted_by}', 0, false)">❌ Reject</button>
                </div>
            `;
            queue.appendChild(item);
        }
    }
    if (!hasPending) {
        queue.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">tidak ada jawaban siswa</div>';
    }
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';
    const sortedStudents = Object.entries(studentsCache)
        .map(([pwd, data]) => ({ pwd, ...data }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
    sortedStudents.forEach((student, index) => {
        if (!student.nama) return;
        const tr = document.createElement('tr');
        const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : '';
        tr.innerHTML = `<td class="${rankClass}">${index + 1}</td><td>${student.nama}</td><td>${student.kelas}</td><td><strong>${student.score || 0}</strong></td>`;
        tbody.appendChild(tr);
    });
}

window.gradeAnswer = async (doorId, studentPwd, points, isApproved) => {
    const updates = {};
    updates[`doors/${doorId}/submitted_by`] = null;
    updates[`doors/${doorId}/submitted_answer`] = null;
    updates[`doors/${doorId}/submitted_at`] = null;

    if (isApproved) {
        updates[`doors/${doorId}/status`] = 'sealed';
        const doorSnap = await get(ref(db, `doors/${doorId}`));
        const doorData = doorSnap.val();
        const actualPoints = getPointsForType(doorData); // Use config points
        
        const currentScore = studentsCache[studentPwd]?.score || 0;
        updates[`students/${studentPwd}/score`] = currentScore + actualPoints;
    } else {
        updates[`doors/${doorId}/status`] = 'open';
        const doorSnap = await get(ref(db, `doors/${doorId}`));
        const doorData = doorSnap.val();
        if (doorData && doorData.type === 'mc') {
            const cooldownSeconds = gameConfig.mc_lockout || 30;
            updates[`students/${studentPwd}/global_cooldown`] = Date.now() + (cooldownSeconds * 1000);
        }
    }
    updates[`students/${studentPwd}/current_door`] = null;
    await update(ref(db), updates);
};

window.purgeGame = async () => {
    if (!confirm("⚠️ ARE YOU SURE? This will reset ALL scores and open ALL doors.")) return;
    const studentsSnap = await get(ref(db, 'students'));
    const doorsSnap = await get(ref(db, 'doors'));
    const updates = {};

    if (studentsSnap.exists()) {
        for (const [pwd, data] of Object.entries(studentsSnap.val())) {
            updates[`students/${pwd}/score`] = 0;
            updates[`students/${pwd}/current_door`] = null;
            updates[`students/${pwd}/global_cooldown`] = null;
        }
    }
    if (doorsSnap.exists()) {
        for (const [doorId, data] of Object.entries(doorsSnap.val())) {
            updates[`doors/${doorId}/status`] = 'open';
            updates[`doors/${doorId}/locked_by`] = null;
            updates[`doors/${doorId}/locked_at`] = null;
            updates[`doors/${doorId}/submitted_by`] = null;
            updates[`doors/${doorId}/submitted_answer`] = null;
            updates[`doors/${doorId}/submitted_at`] = null;
        }
    }
    await update(ref(db), updates);
    showToast("✅ Game reset successfully!");
};

// ==========================================
// 2. STUDENT HALLWAY LOGIC
// ==========================================

export function listenToHallway() {
    // 1. Listen to STUDENT data in real-time
    const unsubStudent = onValue(ref(db, `students/${currentUser.password}`), (snapshot) => {
        if (snapshot.exists()) {
            setCurrentUser({ password: currentUser.password, ...snapshot.val() });
            document.getElementById('studentScore').innerText = currentUser.score || 0;
            renderDoors(); 
        }
    });
    hallwayListeners.push(unsubStudent);

    // 2. Listen to DOORS data
    const unsubDoors = onValue(ref(db, 'doors'), (snapshot) => {
        Object.assign(latestDoors, snapshot.val() || {});
        renderDoors(); 
    });
    hallwayListeners.push(unsubDoors);

    // 3. Start the 1-second UI ticker
    startCooldownTicker();
}

function renderDoors() {
    if (!currentUser) return;
    const grid = document.getElementById('doorGrid');
    grid.innerHTML = '';
    
    const globalCooldownEnd = currentUser.global_cooldown || 0;
    const isOnCooldown = Date.now() < globalCooldownEnd;
    const cooldownSec = Math.ceil((globalCooldownEnd - Date.now()) / 1000);

    for (const [doorId, data] of Object.entries(latestDoors)) {
        const el = document.createElement('div');
        let statusClass = 'open';
        let statusText = 'Open';

        if (data.status === 'sealed') { statusClass = 'sealed'; statusText = 'Sealed ✅'; } 
        else if (data.status === 'pending') { statusClass = 'pending'; statusText = 'Pending ⏳'; } 
        else if (data.status === 'locked') { statusClass = 'locked'; statusText = `Locked by ${data.locked_by === currentUser.password ? 'You' : 'Other'}`; } 
        else if (isOnCooldown) { 
            statusClass = 'locked'; 
            statusText = `🔒 Locked Out (${cooldownSec}s)`; 
            el.dataset.cooldownEnd = globalCooldownEnd; 
        }

        el.className = `door ${statusClass}`;
        el.innerHTML = `<div>${doorId}</div><div class="door-status">${statusText}</div>`;
        
        if (data.status === 'open' && !isOnCooldown) {
            el.onclick = () => enterDoor(doorId, data);
        } else {
            el.onclick = null; 
        }
        grid.appendChild(el);
    }
}

function startCooldownTicker() {
    if (hallwayInterval) clearInterval(hallwayInterval);
    
    // --- CHANGED: Use the setter instead of direct assignment ---
    setHallwayInterval(setInterval(() => {
        const doors = document.querySelectorAll('.door[data-cooldown-end]');
        let needsUnlock = false;

        doors.forEach(el => {
            const end = parseInt(el.dataset.cooldownEnd, 10);
            const sec = Math.ceil((end - Date.now()) / 1000);
            if (sec <= 0) {
                needsUnlock = true;
            } else {
                const statusDiv = el.querySelector('.door-status');
                if (statusDiv) statusDiv.innerText = `🔒 Locked Out (${sec}s)`;
            }
        });

        if (needsUnlock) {
            if (currentUser) currentUser.global_cooldown = 0;
            renderDoors();
        }
    }, 1000));
    // -------------------------------------------------------------
}

window.enterDoor = async (doorId, doorData) => {
    if (currentUser.global_cooldown && Date.now() < currentUser.global_cooldown) {
        showToast("🔒 You are locked out! Wait for the cooldown.");
        return;
    }
    if (currentUser.current_door) {
        showToast("Finish or back out of your current door first!");
        return;
    }

    const doorRef = ref(db, `doors/${doorId}`);
    const result = await runTransaction(doorRef, (currentData) => {
        if (currentData === null) return currentData;
        if (currentData.status !== 'open') return;
        currentData.status = 'locked';
        currentData.locked_by = currentUser.password;
        currentData.locked_at = serverTimestamp();
        return currentData;
    });

    if (result.committed) {
        setCurrentDoorId(doorId);
        await update(ref(db, `students/${currentUser.password}`), { current_door: doorId });
        loadQuestion(doorId, doorData);
    } else {
        showToast("Oops! Someone beat you to it.");
    }
};

function loadQuestion(doorId, data) {
    showScreen('questionScreen');
    document.getElementById('qDoorId').innerText = `${doorId} (${data.type.toUpperCase()})`;
    const content = document.getElementById('questionContent');
    const submitBtn = document.getElementById('submitBtn');
    
    let html = '';

    // --- NEW: Check if the teacher added an image URL ---
    if (data.image_url && data.image_url.trim() !== '') {
        // onerror="this.style.display='none'" hides the image if the link is broken
        html += `<img src="${data.image_url}" class="question-image" alt="Question Image" onerror="this.style.display='none'">`;
    }
    // ----------------------------------------------------

    html += `<div class="question-text">${data.question}</div>`;

    if (data.type === 'mc') {
        html += `<div class="mc-options">`;
        data.options.forEach(opt => {
            html += `<button class="mc-btn" onclick="selectMC(this, '${opt.replace(/'/g, "\\'")}')">${opt}</button>`;
        });
        html += `</div>`;
        submitBtn.style.display = 'none';
    } else {
        html += `<textarea id="textAnswer" class="text-answer" rows="4" placeholder="Type your answer here..."></textarea>`;
        submitBtn.style.display = 'block';
    }
    
    content.innerHTML = html;
    startTimer(doorId, data);
}

let selectedMCAnswer = null;
window.selectMC = (btn, answer) => {
    selectedMCAnswer = answer;
    document.querySelectorAll('.mc-btn').forEach(b => b.style.background = 'white');
    btn.style.background = '#bbdefb';
    submitAnswer();
};

function startTimer(doorId, doorData) {
    let timeLeft = getTimeForType(doorData); // Use config time
    updateTimerDisplay(timeLeft);
    
    const interval = setInterval(async () => {
        timeLeft--;
        updateTimerDisplay(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(interval);
            showToast("⏰ Time's up!");
            await handleWrongAnswer(doorId, doorData.type); 
        }
    }, 1000);
    
    // Save interval to core state so it can be cleared on logout/backout
    window.currentTimerInterval = interval; 
}

function updateTimerDisplay(time) {
    const el = document.getElementById('timerDisplay');
    el.innerText = time;
    el.className = 'timer';
    if (time <= 5) el.classList.add('danger');
    else if (time <= 15) el.classList.add('warning');
}

window.submitAnswer = async () => {
    clearInterval(window.currentTimerInterval);
    const doorRef = ref(db, `doors/${currentDoorId}`);
    const doorSnap = await get(doorRef);
    const doorData = doorSnap.val();

    // Safety check: ensure the door is still locked by this student
    if (!doorData || doorData.status !== 'locked' || doorData.locked_by !== currentUser.password) {
        showToast("Door state changed. Returning to hallway.");
        backToHallway();
        return;
    }

    // --- MULTIPLE CHOICE LOGIC ---
    if (doorData.type === 'mc') {
        // ✅ Make BOTH sides lowercase and trimmed for a fair comparison
        const studentAnswer = selectedMCAnswer ? selectedMCAnswer.toLowerCase().trim() : '';
        const correctAnswer = doorData.answer ? doorData.answer.toLowerCase().trim() : '';

        if (studentAnswer === correctAnswer) {
            await handleCorrectAnswer(currentDoorId, doorData);
        } else {
            const secs = gameConfig.mc_lockout || 30;
            await handleWrongAnswer(currentDoorId, secs, `❌ Wrong answer! Locked out for ${secs}s`);
        }
    } 
    // --- TEXT / SHORT / LONG ANSWER LOGIC ---
    else {
        const textAns = document.getElementById('textAnswer').value.trim();
        if (!textAns) {
            showToast("Please type an answer first!");
            startTimer(currentDoorId, doorData);
            return;
        }

        // --- NEW: Check if Auto-Grade is enabled in config ---
        if (gameConfig.short_auto_grade) {
            // Normalize student answer
            const studentAns = textAns.toLowerCase();
            
            // Support multiple acceptable answers separated by commas (e.g., "water, h2o, H2O")
            const acceptableAnswers = doorData.answer.split(',').map(a => a.toLowerCase().trim());
            
            if (acceptableAnswers.includes(studentAns)) {
                // Match found! Treat as correct instantly.
                await handleCorrectAnswer(currentDoorId, doorData);
            } else {
                // No match. Treat as wrong instantly.
                const secs = gameConfig.text_lockout || 10;
                await handleWrongAnswer(currentDoorId, secs, `❌ Wrong answer! Locked out for ${secs}s`);
            }
        } 
        // --- EXISTING: Manual Teacher Grading (Fallback) ---
        else {
            // 1. Submit the answer to Firebase
            await update(doorRef, {
                status: 'pending',
                submitted_by: currentUser.password,
                submitted_answer: textAns,
                submitted_at: serverTimestamp()
            });

            // 2. Apply the backout cooldown to prevent door spam while waiting for grading
            const secs = gameConfig.backout_lockout || 15;
            const cooldownTime = Date.now() + (secs * 1000);
            await update(ref(db, `students/${currentUser.password}`), {
                global_cooldown: cooldownTime,
                current_door: null
            });
            currentUser.global_cooldown = cooldownTime; // Keep local memory in sync

            // 3. Clean up local state and return to hallway
            setCurrentDoorId(null);
            selectedMCAnswer = null;
            
            showToast(`✅ Submitted! Locked out for ${secs}s while teacher grades.`);
            showScreen('hallwayScreen');
        }
    }
};

window.backToHallway = async () => {
    clearInterval(window.currentTimerInterval);
    if (!currentDoorId) return;
    
    const doorRef = ref(db, `doors/${currentDoorId}`);
    const doorSnap = await get(doorRef);
    const doorData = doorSnap.val();

    if (doorData && doorData.status === 'locked' && doorData.locked_by === currentUser.password) {
        await update(doorRef, { status: 'open', locked_by: null, locked_at: null });
        
        const secs = gameConfig.backout_lockout || 15;
        const cooldownTime = Date.now() + (secs * 1000);
        await update(ref(db, `students/${currentUser.password}`), {
            global_cooldown: cooldownTime,
            current_door: null
        });
        currentUser.global_cooldown = cooldownTime;
        showToast(`🚪 Backed out! Locked out for ${secs}s`);
    }

    setCurrentDoorId(null);
    selectedMCAnswer = null;
    await update(ref(db, `students/${currentUser.password}`), { current_door: null });
    showScreen('hallwayScreen');
};

async function handleCorrectAnswer(doorId, doorData) {
    const points = getPointsForType(doorData); // Use config points
    const updates = {};
    
    updates[`doors/${doorId}/status`] = 'sealed';
    updates[`doors/${doorId}/locked_by`] = null;
    updates[`doors/${doorId}/locked_at`] = null;
    updates[`students/${currentUser.password}/score`] = (currentUser.score || 0) + points;
    updates[`students/${currentUser.password}/current_door`] = null;

    const correctCooldown = gameConfig.correct_lockout || 0;
    if (correctCooldown > 0) {
        const cooldownTime = Date.now() + (correctCooldown * 1000);
        updates[`students/${currentUser.password}/global_cooldown`] = cooldownTime;
        currentUser.global_cooldown = cooldownTime;
    } else {
        updates[`students/${currentUser.password}/global_cooldown`] = null;
    }

    await update(ref(db), updates);
    currentUser.score += points;
    showToast(`🎉 Correct! +${points} points!`);
    setCurrentDoorId(null);
    showScreen('hallwayScreen');
}

async function handleWrongAnswer(doorId, cooldownSeconds, toastMessage) {
    const updates = {};
    updates[`doors/${doorId}/status`] = 'open';
    updates[`doors/${doorId}/locked_by`] = null;
    updates[`doors/${doorId}/locked_at`] = null;

    const cooldownTime = Date.now() + (cooldownSeconds * 1000);
    updates[`students/${currentUser.password}/global_cooldown`] = cooldownTime;
    updates[`students/${currentUser.password}/current_door`] = null;
    currentUser.global_cooldown = cooldownTime; 

    await update(ref(db), updates);
    showToast(toastMessage || `❌ Wrong/Backed out! Locked out for ${cooldownSeconds}s`);
    setCurrentDoorId(null);
    showScreen('hallwayScreen');
}