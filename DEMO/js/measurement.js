// measurement page logic (camera, pose, compute stats, save, 2p flow)

// DOM
const videoEl = document.getElementById('input-video');
const canvasEl = document.getElementById('output-canvas');
const socketStatus = document.getElementById('socket-status');
const totalPowerEl = document.getElementById('total-power');
const basePowerEl = document.getElementById('base-power');
const poseBonusEl = document.getElementById('pose-bonus');
const exprBonusEl = document.getElementById('expression-bonus');
const speedBonusEl = document.getElementById('speed-bonus');
const statHeight = document.getElementById('stat-height');
const statReach = document.getElementById('stat-reach');
const statShoulder = document.getElementById('stat-shoulder');
const statExpression = document.getElementById('stat-expression');
const statPose = document.getElementById('stat-pose');

const nameModal = document.getElementById('name-modal');
const inputPlayerName = document.getElementById('input-player-name');
const btnNameOk = document.getElementById('btn-name-ok');
const btnNameCancel = document.getElementById('btn-name-cancel');
const btnStart = document.getElementById('btn-start-measure');
const btnExit = document.getElementById('btn-back-to-title-2');

let measureTimeout = null;
let lastSnapshotDataUrl = null;
let lastCombatStats = null;

// utility: query param
function getQueryParams() {
    const q = {};
    location.search.replace(/^\?/, '').split('&').forEach(p => {
        if (!p) return;
        const [k,v] = p.split('=');
        q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
}

// simple script loader with timeout
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
}
function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')), ms))]);
}

// minimal POWER constants (copied/compatible)
const POWER_CONSTANTS = {
    baseline: 100000,
    maxTotal: 500000,
    clipFeature: 1.6,
    clipSpeed: 2.0,
    weightBase: 0.60,
    weightStyle: 0.25,
    weightMotion: 0.15,
    weightPoseInStyle: 0.60,
    weightExprInStyle: 0.40,
    weightReachInBase: 0.40,
    weightShoulderInBase: 0.35,
    weightLegInBase: 0.25,
    genderMultiplier: { male: 1.00, female: 1.09 },
    speedAlpha: 0.4
};

let pose = null, videoRenderRAF = null, poseRenderRAF = null;
let _prevForSpeed = null, _prevTimeMs = null, _speedEma = 0;

// computeCombatStatsFromLandmarks (copied and slightly trimmed)
function computeCombatStatsFromLandmarks(lm) {
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, speed_bonus: 0, total_power: POWER_CONSTANTS.baseline,
            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0
        };
    }
    const v2 = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y));
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const std = (arr) => {
        const m = mean(arr);
        const v = mean(arr.map(x => (x - m) ** 2));
        return Math.sqrt(v);
    };
    const clip01 = (x) => Math.max(0, Math.min(1, x));

    const top = lm[0];
    const ankleL = lm[29];
    const ankleR = lm[30];
    const wristL = lm[15];
    const wristR = lm[16];
    const shoulderL = lm[11];
    const shoulderR = lm[12];
    const hipL = lm[23];
    const hipR = lm[24];

    const height = Math.abs(top.y - ((ankleL.y + ankleR.y) / 2));
    const reach = v2(wristL, wristR);
    const shoulder = v2(shoulderL, shoulderR);
    const leg = v2(hipL, ankleL) + v2(hipR, ankleR);

    const eps = 1e-6;
    const h = Math.max(height, eps);
    const maxF = POWER_CONSTANTS.clipFeature;
    const rN = clip01((reach / h) / maxF);
    const sN = clip01((shoulder / h) / maxF);
    const lN = clip01(((leg / h) / 2) / maxF);

    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const poseVal = v2(top, spineMid);
    const poseN = clip01(poseVal / 0.5);
    const face = lm.slice(0, 5).map(p => [p.x, p.y]).flat();
    const exprN = clip01(std(face) / 0.05);

    const now = performance && performance.now ? performance.now() : Date.now();
    let vRaw = 0;
    if (_prevForSpeed && _prevTimeMs) {
        const dt = Math.max(1, now - _prevTimeMs) / 1000;
        const idx = [0,11,12,13,14,15,16,23,24,25,26,27,28];
        const dists = idx.map(i => v2(lm[i], _prevForSpeed[i] || lm[i]));
        const avg = mean(dists);
        vRaw = avg / (h * dt);
    }
    _prevForSpeed = lm.map(p => ({ x: p.x, y: p.y }));
    _prevTimeMs = now;
    const vClip = POWER_CONSTANTS.clipSpeed;
    const vN = clip01(vRaw / vClip);
    _speedEma = POWER_CONSTANTS.speedAlpha * vN + (1 - POWER_CONSTANTS.speedAlpha) * _speedEma;

    const baseRaw = (
        POWER_CONSTANTS.weightReachInBase * Math.pow(rN, 0.90) +
        POWER_CONSTANTS.weightShoulderInBase * Math.pow(sN, 0.85) +
        POWER_CONSTANTS.weightLegInBase * Math.pow(lN, 0.80)
    );
    const styleRaw = (
        POWER_CONSTANTS.weightPoseInStyle * poseN +
        POWER_CONSTANTS.weightExprInStyle * exprN
    );
    const motionRaw = _speedEma;

    let combined = (
        POWER_CONSTANTS.weightBase * baseRaw +
        POWER_CONSTANTS.weightStyle * styleRaw +
        POWER_CONSTANTS.weightMotion * motionRaw
    );

    let gender = (window && window._selectedGender) ? window._selectedGender : 'male';
    const gmul = POWER_CONSTANTS.genderMultiplier[gender] || 1.0;
    combined = Math.min(1, combined * gmul);

    const span = POWER_CONSTANTS.maxTotal - POWER_CONSTANTS.baseline;
    let base_amount = span * POWER_CONSTANTS.weightBase * baseRaw;
    let pose_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightPoseInStyle * poseN;
    let expr_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightExprInStyle * exprN;
    let speed_amount = span * POWER_CONSTANTS.weightMotion * motionRaw;
    base_amount *= gmul; pose_amount *= gmul; expr_amount *= gmul; speed_amount *= gmul;
    let sumParts = base_amount + pose_amount + expr_amount + speed_amount;
    if (sumParts > span) {
        const scale = span / sumParts;
        base_amount *= scale; pose_amount *= scale; expr_amount *= scale; speed_amount *= scale;
        sumParts = span;
    }
    const total = Math.round(POWER_CONSTANTS.baseline + sumParts);

    return {
        base_power: Math.round(base_amount),
        pose_bonus: Math.round(pose_amount),
        expression_bonus: Math.round(expr_amount),
        speed_bonus: Math.round(speed_amount),
        total_power: total,
        height, reach, shoulder, expression: exprN, pose: poseN
    };
}

function updateStats(stats) {
    lastCombatStats = stats;
    try { totalPowerEl.textContent = stats.total_power.toLocaleString(); } catch(e){}
    try { basePowerEl.textContent = stats.base_power.toLocaleString(); } catch(e){}
    try { poseBonusEl.textContent = `+${stats.pose_bonus.toLocaleString()}`; } catch(e){}
    try { exprBonusEl.textContent = `+${stats.expression_bonus.toLocaleString()}`; } catch(e){}
    try { speedBonusEl.textContent = `+${stats.speed_bonus.toLocaleString()}`; } catch(e){}
    try { statHeight.textContent = stats.height ? stats.height.toFixed(2) : '-'; } catch(e){}
    try { statReach.textContent = stats.reach ? stats.reach.toFixed(2) : '-'; } catch(e){}
    try { statShoulder.textContent = stats.shoulder ? stats.shoulder.toFixed(2) : '-'; } catch(e){}
    try { statExpression.textContent = stats.expression ? stats.expression.toFixed(2) : '-'; } catch(e){}
    try { statPose.textContent = stats.pose ? stats.pose.toFixed(2) : '-'; } catch(e){}
}

async function ensurePoseLoaded() {
    if (window.Pose || (window.pose && window.pose.Pose)) return true;
    const urls = [
        'mediapipe/pose/pose.js',
        'pose.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/pose.js',
        'https://unpkg.com/@mediapipe/pose@0.5.1675469242/pose.js'
    ];
    for (const u of urls) {
        try {
            if (socketStatus) { socketStatus.textContent = 'LOADING POSE...'; }
            await withTimeout(loadScript(u), 8000);
        } catch(_) { continue; }
        if (window.Pose || (window.pose && window.pose.Pose)) return true;
    }
    if (socketStatus) { socketStatus.textContent = 'POSE NOT FOUND'; }
    return false;
}

async function initPose() {
    if (pose) return true;
    const ok = await ensurePoseLoaded();
    if (!ok) return false;
    const PoseClass = window.Pose || (window.pose && window.pose.Pose);
    const base = (window._mpPoseBase !== undefined) ? window._mpPoseBase : 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/';
    pose = new PoseClass({ locateFile: (file) => `${base}${file}` });
    pose.setOptions({
        selfieMode: true,
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    pose.onResults((results) => {
        if (results && results.poseLandmarks) {
            const stats = computeCombatStatsFromLandmarks(results.poseLandmarks);
            updateStats(stats);
        }
        // draw simple video->canvas background
        try {
            const ctx = canvasEl.getContext('2d');
            ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
            if (videoEl && videoEl.videoWidth) {
                if (canvasEl.width !== videoEl.videoWidth) canvasEl.width = videoEl.videoWidth;
                if (canvasEl.height !== videoEl.videoHeight) canvasEl.height = videoEl.videoHeight;
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            }
        } catch(e){}
    });
    return true;
}

async function openCamera() {
    try {
        const constraints = { video: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = stream;
        await videoEl.play();
        if (socketStatus) { socketStatus.textContent = 'CAMERA READY'; }
        const startRender = () => {
            try {
                const w = videoEl.videoWidth || 640;
                const h = videoEl.videoHeight || 360;
                if (canvasEl.width !== w) canvasEl.width = w;
                if (canvasEl.height !== h) canvasEl.height = h;
                const ctx = canvasEl.getContext('2d');
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            } catch(e){}
            videoRenderRAF = requestAnimationFrame(startRender);
        };
        startRender();
    } catch (err) {
        if (socketStatus) socketStatus.textContent = 'カメラ取得失敗';
    }
}

async function startPoseLoop() {
    const ok = await initPose();
    if (!ok) {
        if (socketStatus) socketStatus.textContent = 'POSE NOT FOUND';
        return;
    }
    // per-frame: send current frame to pose
    const run = async () => {
        try {
            if (pose && videoEl && videoEl.readyState >= 2) {
                await pose.send({ image: videoEl });
            }
        } catch(e){}
        poseRenderRAF = requestAnimationFrame(run);
    };
    run();
}

function stopAll() {
    if (videoEl && videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
    }
    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);
    if (poseRenderRAF) cancelAnimationFrame(poseRenderRAF);
    if (pose) { try { pose.close(); } catch(e){} pose = null; }
}

// START button: start 10s timer then show name modal
btnStart && btnStart.addEventListener('click', () => {
    btnStart.disabled = true;
    btnStart.textContent = 'MEASURING...';
    const seRoulette = document.getElementById('se-roulette');
    const seRoulette2 = document.getElementById('se-roulette2');
    if (seRoulette && seRoulette2) {
        seRoulette2.currentTime = 0;
        seRoulette2.play();
        seRoulette2.onended = () => {
            seRoulette2.onended = null;
            seRoulette2.currentTime = 0;
            seRoulette2.play();
            seRoulette2.onended = () => {
                seRoulette2.onended = null;
                seRoulette.currentTime = 0;
                seRoulette.play();
            };
        };
    }
    measureTimeout = setTimeout(() => {
        try {
            const dataUrl = canvasEl.toDataURL('image/jpeg');
            lastSnapshotDataUrl = dataUrl;
            // lastCombatStats は updateStats によりリアルタイム更新される
        } catch(e){}
        nameModal.classList.remove('hidden');
        inputPlayerName.value = '';
        inputPlayerName.focus();
        btnStart.disabled = false;
        btnStart.textContent = 'START';
    }, 10000);
});

// EXIT button
btnExit && btnExit.addEventListener('click', () => {
    stopAll();
    // 戻るは index.html
    window.location.href = 'index.html';
});

// 保存API
async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
    try {
        const res = await fetch('/api/save_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                score: combatStats && combatStats.total_power ? combatStats.total_power : 0,
                image: imageDataUrl
            })
        });
        const json = await res.json();
        if (json && json.success && json.image) {
            try {
                const preview = document.getElementById('save-preview');
                if (preview) preview.src = `src/${encodeURIComponent(json.image)}`;
            } catch(e){}
        }
        return json;
    } catch (e) {
        alert('保存に失敗しました');
        return null;
    }
}

// 名前入力OK/Cancel
btnNameOk && btnNameOk.addEventListener('click', async () => {
    const name = inputPlayerName.value.trim() || 'PLAYER';
    nameModal.classList.add('hidden');
    const saveJson = await saveResultToDB(lastCombatStats || { total_power: POWER_CONSTANTS.baseline }, lastSnapshotDataUrl || '', name);
    // 2人測定判定: sessionStorage の battleState を参照
    let bs = {};
    try { bs = JSON.parse(sessionStorage.getItem('battleState') || '{}'); } catch(e){}
    const q = getQueryParams();
    const playerNum = q.player ? Number(q.player) : 1;
    if (bs && bs.mode === '2pmeasure') {
        // P1 -> P2, P2 -> 戻ってバトル
        const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;
        if ((bs.step === 202 && playerNum === 1) || (!bs.step && playerNum === 1)) {
            bs.player1 = {
                name: name || 'PLAYER1',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: savedImgPath
            };
            bs.step = 203;
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            // P2 の測定へ移動
            window.location.href = 'measurement.html?player=2';
            return;
        }
        if ((bs.step === 203 && playerNum === 2) || (bs.step === 203 && playerNum === 2)) {
            bs.player2 = {
                name: name || 'PLAYER2',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl
            };
            bs.step = 204; // 両者揃った
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            // index.html に戻ってバトル表示
            window.location.href = 'index.html';
            return;
        }
    } else {
        // 単独測定: ランキングページへ
        window.location.href = 'ranking.html';
    }
});

btnNameCancel && btnNameCancel.addEventListener('click', () => {
    nameModal.classList.add('hidden');
});

// 初期化
window.addEventListener('DOMContentLoaded', async () => {
    await openCamera();
    await startPoseLoop();
});

// --- 公開: script.js など他スクリプトから呼べるようにする（重複回避のためのエクスポート） ---
try { window.computeCombatStatsFromLandmarks = computeCombatStatsFromLandmarks; } catch(e){}
try { window.updateStats = updateStats; } catch(e){}
try { window.ensurePoseLoaded = ensurePoseLoaded; } catch(e){}
try { window.initPose = initPose; } catch(e){}
try { window.openCamera = openCamera; } catch(e){}
try { window.startPoseLoop = startPoseLoop; } catch(e){}
try { window.stopMeasurement = stopAll; } catch(e){}            // エイリアス名 (script.js からの呼び出しを想定)
try { window.stopAll = stopAll; } catch(e){}                    // 既存名も公開
try { window.saveResultToDB = saveResultToDB; } catch(e){}
// 測定ページ単体で start/stop を呼びたい場合の簡易公開
try { window.startMeasurementPage = async function(playerNum){ await openCamera(); await startPoseLoop(); }; } catch(e){}
