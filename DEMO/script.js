// バトル進行用の状態
let battleState = {
    mode: null, // 'battle'のときバトル進行中
    step: 0,    // 0:未開始, 1:P1性別, 2:P1測定, 3:P1名前, 4:P2性別, 5:P2測定, 6:P2名前, ...
    player1: {},
    player2: {}
};
// 画面切り替えとボタンイベント再バインド
function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(sc => sc.classList.add('hidden'));
    const el = document.getElementById('screen-' + screenName);
    if (el) el.classList.remove('hidden');

    // 効果音を全ボタンに
    document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
        btn.onclick = null;
        btn.addEventListener('click', playButtonSE);
    });

    if (screenName === 'title') {
        const btnGotoInstructions = document.getElementById('btn-goto-instructions');
        if (btnGotoInstructions) btnGotoInstructions.onclick = () => showScreen('instructions');
        const btnGotoRanking = document.getElementById('btn-goto-ranking');
        if (btnGotoRanking) btnGotoRanking.onclick = async () => { showScreen('ranking'); await fetchAndShowRanking(); };
        const btnGoto2P = document.getElementById('btn-goto-2pmeasure');
        if (btnGoto2P) btnGoto2P.onclick = () => showScreen('2pmeasure');
        // バトルボタンは非表示または無効化
        const btnGotoBattleInfo = document.getElementById('btn-goto-battle-info');
        if (btnGotoBattleInfo) btnGotoBattleInfo.style.display = 'none';
    }
    if (screenName === '2pmeasure') {
        const btnStart = document.getElementById('btn-2pmeasure-start');
        const btnExit = document.getElementById('btn-2pmeasure-exit');
        const stage = document.getElementById('2pmeasure-stage');
        battleState.mode = '2pmeasure';
        battleState.step = 201;
        battleState.player1 = { name: 'PLAYER1', battleIndex: 5000 };
        battleState.player2 = { name: 'PLAYER2', battleIndex: 5000 };

        if (stage) stage.textContent = '1人目の測定を開始してください';
        if (btnStart) {
            btnStart.classList.remove('hidden');
            btnStart.textContent = '測定スタート';
            btnStart.onclick = () => {
                if (battleState.step === 201) {
                    battleState.step = 202;
                    if (stage) stage.textContent = 'PLAYER1 測定中...';
                    showScreen('measurement');
                    startMeasurement();
                } else if (battleState.step === 203) {
                    battleState.step = 204;
                    if (stage) stage.textContent = 'PLAYER2 測定中...';
                    showScreen('measurement');
                    startMeasurement();
                }
            };
        }
        if (btnExit) btnExit.onclick = () => showScreen('title');
    }
    if (screenName === 'instructions') {
        const btnBack = document.getElementById('btn-back-to-title-1');
        if (btnBack) btnBack.onclick = () => showScreen('title');
        const btnNext = document.getElementById('btn-goto-gender');
        if (btnNext) btnNext.onclick = () => showScreen('gender');
    }
    if (screenName === 'gender') {
        const btnBack = document.getElementById('btn-back-to-instructions');
        if (btnBack) btnBack.onclick = () => showScreen('instructions');
        document.querySelectorAll('.gender-btn').forEach(btn => {
            btn.onclick = () => {
                showScreen('measurement');
                startMeasurement();
            };
        });
    }
    if (screenName === 'measurement') {
        const btnStartMeasure = document.getElementById('btn-start-measure');
        if (btnStartMeasure) btnStartMeasure.onclick = () => {
            setTimeout(() => {
                document.getElementById('name-modal').classList.remove('hidden');
            }, 10000);
        };
        const btnNameOk = document.getElementById('btn-name-ok');
        if (btnNameOk) btnNameOk.onclick = () => {
            document.getElementById('name-modal').classList.add('hidden');
            if (battleState.mode === '2pmeasure') {
                const stats = window._latestCombatStats;
                if (battleState.step === 202) {
                    battleState.player1.score = stats?.total_power || Math.floor(Math.random() * 10000 + 1000);
                    battleState.step = 203;
                    showScreen('2pmeasure');
                    document.getElementById('2pmeasure-stage').textContent = '2人目の測定を開始してください';
                } else if (battleState.step === 204) {
                    battleState.player2.score = stats?.total_power || Math.floor(Math.random() * 10000 + 1000);
                    battleState.step = 301;
                    showScreen('typing-battle');
                    startTypingBattle();
                }
            } else {
                // 通常測定
                showScreen('ranking');
                fetchAndShowRanking();
                alert('測定完了！データ保存しました');
            }
        };
    }
    if (screenName === 'typing-battle') {
        const typingStage = document.getElementById('typing-stage');
        const typingInput = document.getElementById('typing-input');
        const typingPrompt = document.getElementById('typing-prompt');
        const btnNextRound = document.getElementById('btn-next-round');
        const btnExitBattle = document.getElementById('btn-exit-battle');

        if (btnNextRound) btnNextRound.onclick = () => startTypingRound();
        if (btnExitBattle) btnExitBattle.onclick = () => showScreen('title');

        startTypingRound();
    }
    const btnNameCancel = document.getElementById('btn-name-cancel');
    if (btnNameCancel) btnNameCancel.onclick = () => {
        document.getElementById('name-modal').classList.add('hidden');
    };
    if (screenName === 'ranking') {
        const btnBack = document.getElementById('btn-back-to-title-3');
        if (btnBack) btnBack.onclick = () => showScreen('title');
    }
}

// 初期画面表示とボタンイベント再バインド
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});

function startTypingBattle() {
    battleState.mode = 'typing';
    battleState.round = 1;
    battleState.player1.time = 0;
    battleState.player2.time = 0;
    startTypingRound();
}

function startTypingRound() {
    const currentPlayer = battleState.round % 2 === 1 ? 'player1' : 'player2';
    const typingPrompt = document.getElementById('typing-prompt');
    const typingInput = document.getElementById('typing-input');

    if (!typingPrompt || !typingInput) {
        console.error('Typing elements not found. Ensure #typing-prompt and #typing-input exist.');
        return;
    }

    const promptText = generateTypingPrompt();
    typingPrompt.textContent = promptText;
    typingInput.value = '';
    typingInput.disabled = false;
    typingInput.focus();

    const startTime = Date.now();
    typingInput.oninput = () => {
        if (typingInput.value === promptText) {
            const elapsedTime = Date.now() - startTime;
            battleState[currentPlayer].time += elapsedTime;

            typingInput.disabled = true;
            battleState.round++;
            if (battleState.round > 6) {
                resolveTypingBattle();
            } else {
                startTypingRound();
            }
        }
    };
}

function resolveTypingBattle() {
    const p1Time = battleState.player1.time;
    const p2Time = battleState.player2.time;

    let resultMessage = '';
    if (p1Time < p2Time) {
        resultMessage = 'PLAYER1の勝利！';
    } else if (p1Time > p2Time) {
        resultMessage = 'PLAYER2の勝利！';
    } else {
        resultMessage = '引き分け！';
    }

    alert(resultMessage);
    showScreen('ranking');
}

function generateTypingPrompt() {
    const prompts = ['戦闘力', 'タイピング', 'バトル', 'スピード', '勝利'];
    return prompts[Math.floor(Math.random() * prompts.length)];
}

let measureTimeout = null;
let lastSnapshotDataUrl = null;
let lastCombatStats = null;

document.addEventListener('DOMContentLoaded', () => {
    const btnStartMeasure = document.getElementById('btn-start-measure');
    const nameModal = document.getElementById('name-modal');
    const inputPlayerName = document.getElementById('input-player-name');
    const btnNameOk = document.getElementById('btn-name-ok');
    const btnNameCancel = document.getElementById('btn-name-cancel');
    if (btnStartMeasure) {
        btnStartMeasure.addEventListener('click', async () => {
            btnStartMeasure.disabled = true;
            btnStartMeasure.textContent = 'MEASURING...';

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

            measureTimeout = setTimeout(async () => {
                const dataUrl = measurementElements.canvas.toDataURL('image/jpeg');
                lastSnapshotDataUrl = dataUrl;
                lastCombatStats = window._latestCombatStats || {};
                inputPlayerName.value = '';
                nameModal.classList.remove('hidden');
                inputPlayerName.focus();
            }, 10000);
        });
    }

    if (btnNameOk) {
        btnNameOk.addEventListener('click', async () => {
            const name = inputPlayerName.value.trim() || 'PLAYER';
            nameModal.classList.add('hidden');
            await saveResultToDB(lastCombatStats, lastSnapshotDataUrl, name);
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
            showScreen('ranking');
            await fetchAndShowRanking();
            alert('測定完了！データ保存しました');
        });
    }
    if (btnNameCancel) {
        btnNameCancel.addEventListener('click', () => {
            nameModal.classList.add('hidden');
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
        });
    }
    if (buttons.backToTitle2) {
        buttons.backToTitle2.addEventListener('click', () => {
            stopMeasurement();
            showScreen('title');
            if (measureTimeout) { clearTimeout(measureTimeout); measureTimeout = null; }
            if (btnStartMeasure) {
                btnStartMeasure.disabled = false;
                btnStartMeasure.textContent = 'START';
            }
        });
    }
    document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
        btn.addEventListener('click', playButtonSE);
    });

    const btnGotoRanking = document.getElementById('btn-goto-ranking');
    if (btnGotoRanking) {
        btnGotoRanking.addEventListener('click', async () => {
            showScreen('ranking');
            await fetchAndShowRanking();
        });
    }
    const btnBackToTitle3 = document.getElementById('btn-back-to-title-3');
    if (btnBackToTitle3) {
        btnBackToTitle3.addEventListener('click', () => {
            showScreen('title');
        });
    }

    const btnClearData = document.getElementById('btn-clear-data');
    if (btnClearData) {
        btnClearData.addEventListener('click', () => {
            if (confirm('保存されたデータをすべて削除しますか？この操作は元に戻せません。')) {
                localStorage.clear(); // ローカルストレージをクリア
                alert('データを削除しました。');
                fetchAndShowRanking(); // ランキングを再取得
            }
        });
    }

    const btnDeleteSelected = document.getElementById('btn-delete-selected');
    if (btnDeleteSelected) {
        btnDeleteSelected.addEventListener('click', async () => {
            const selectedCheckboxes = document.querySelectorAll('.ranking-checkbox:checked');
            if (selectedCheckboxes.length === 0) {
                alert('削除するデータを選択してください。');
                return;
            }

            if (confirm('選択したデータを削除しますか？この操作は元に戻せません。')) {
                const idsToDelete = Array.from(selectedCheckboxes).map(cb => cb.dataset.id);
                try {
                    const res = await fetch('api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete_scores', ids: idsToDelete })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert('選択したデータを削除しました。');
                        fetchAndShowRanking(); // 削除後にランキングを再取得
                    } else {
                        alert('データの削除に失敗しました。');
                    }
                } catch (e) {
                    alert('エラーが発生しました。');
                }
            }
        });
    }
});

async function fetchAndShowRanking() {
    const rankingList = document.getElementById('ranking-list');
    if (!rankingList) return;
    rankingList.innerHTML = '<div class="text-center text-gray-400">Loading...</div>';
    try {
        const res = await fetch('api.php?action=get_ranking');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            rankingList.innerHTML = data.map((row, i) =>
                `<div class="flex items-center gap-4 p-2 bg-gray-800 rounded-lg">
                    <input type="checkbox" class="ranking-checkbox" data-id="${row.id}">
                    <span class="text-2xl font-bold text-cyan-400 w-8 text-center">${i + 1}</span>
                    ${row.image ? `<img src="src/${row.image}" alt="thumb" style="width:64px;height:48px;object-fit:cover;border-radius:6px;">` : `<div style="width:64px;height:48px;background:#071116;border-radius:6px;"></div>`}
                    <span class="font-orbitron text-lg flex-1">${row.name}</span>
                    <span class="font-mono text-xl text-yellow-300">${row.score.toLocaleString()}</span>
                </div>`
            ).join('');
        } else {
            rankingList.innerHTML = '<div class="text-center text-gray-400">まだデータがありません</div>';
        }
    } catch (e) {
        rankingList.innerHTML = '<div class="text-center text-red-400">ランキング取得失敗</div>';
    }
}

function updateStats(combat_stats) {
    window._latestCombatStats = combat_stats;
    const totalPower = combat_stats.total_power;
    if (totalPower > maxBattleIndex) { maxBattleIndex = totalPower; }
    measurementElements.totalPower.textContent = totalPower.toLocaleString();
    measurementElements.basePower.textContent = combat_stats.base_power.toLocaleString();
    measurementElements.poseBonus.textContent = `+${combat_stats.pose_bonus.toLocaleString()}`;
    measurementElements.expressionBonus.textContent = `+${combat_stats.expression_bonus.toLocaleString()}`;
    measurementElements.speedBonus.textContent = `+${combat_stats.speed_bonus.toLocaleString()}`;
    measurementElements.statHeight.textContent = combat_stats.height ? combat_stats.height.toFixed(2) : '-';
    measurementElements.statReach.textContent = combat_stats.reach ? combat_stats.reach.toFixed(2) : '-';
    measurementElements.statShoulder.textContent = combat_stats.shoulder ? combat_stats.shoulder.toFixed(2) : '-';
    measurementElements.statExpression.textContent = combat_stats.expression ? combat_stats.expression.toFixed(2) : '-';
    measurementElements.statPose.textContent = combat_stats.pose ? combat_stats.pose.toFixed(2) : '-';
}

async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_score',
                name: name,
                score: combatStats.total_power || 0,
                image: imageDataUrl
            })
        });
        const json = await res.json();
        if (json && json.success && json.image) {
            try {
                const preview = document.getElementById('save-preview');
                if (preview) preview.src = `src/${json.image}`;
            } catch(e){}
        }
        return json;
    } catch (e) {
        alert('保存に失敗しました');
    }
}

const seButton = document.getElementById('se-button');
function playButtonSE() {
    if (seButton) {
        seButton.currentTime = 0;
        seButton.play();
    }
}

const screens = {
    title: document.getElementById('screen-title'),
    instructions: document.getElementById('screen-instructions'),
    gender: document.getElementById('screen-gender'),
    measurement: document.getElementById('screen-measurement'),
    ranking: document.getElementById('screen-ranking')
};
const buttons = {
    genderBtns: document.querySelectorAll('.gender-btn'),
    backToTitle2: document.getElementById('btn-back-to-title-2'),
    gotoInstructions: document.getElementById('btn-goto-instructions'),
    gotoGender: document.getElementById('btn-goto-gender'),
    backToTitle1: document.getElementById('btn-back-to-title-1'),
    backToInstructions: document.getElementById('btn-back-to-instructions')
};
const measurementElements = {
    video: document.getElementById('input-video'),
    canvas: document.getElementById('output-canvas'),
    socketStatus: document.getElementById('socket-status'),
    totalPower: document.getElementById('total-power'),
    basePower: document.getElementById('base-power'),
    poseBonus: document.getElementById('pose-bonus'),
    expressionBonus: document.getElementById('expression-bonus'),
    speedBonus: document.getElementById('speed-bonus'),
    statHeight: document.getElementById('stat-height'),
    statReach: document.getElementById('stat-reach'),
    statShoulder: document.getElementById('stat-shoulder'),
    statExpression: document.getElementById('stat-expression'),
    statPose: document.getElementById('stat-pose')
};

let socket = null, videoStream = null, sendInterval = null, maxBattleIndex = 0;
let mpCamera = null;

const canvasCtx = measurementElements.canvas.getContext('2d');
const receivedImage = new Image();

let pose = null;
let lastPoseResults = null;

let useClientLandmark = true;
let videoRenderRAF = null;

var POSE_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],
    [0,4],[4,5],[5,6],[6,8],
    [9,10],
    [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
    [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]
];

function drawLandmarksOnCanvas(results) {
    try { console.log('drawLandmarksOnCanvas called', !!results); } catch(e){}
    canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
    try {
        const w = measurementElements.canvas.width;
        const h = measurementElements.canvas.height;
        canvasCtx.drawImage(measurementElements.video, 0, 0, w, h);
    } catch (e) {}
    if (results && results.poseLandmarks) {
        try { measurementElements.socketStatus.textContent = 'DETECTED'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
        window.drawConnectors(
            canvasCtx,
            results.poseLandmarks,
            (typeof window.POSE_CONNECTIONS !== 'undefined' ? window.POSE_CONNECTIONS : POSE_CONNECTIONS),
            {color: '#00FF41', lineWidth: 6}
        );
        window.drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: '#00FF41',
            lineWidth: 0,
            radius: 10
        });
        window.drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: '#000000',
            lineWidth: 2,
            radius: 10
        });
    }
}

function stopMeasurement() {
    if (sendInterval) { clearInterval(sendInterval); sendInterval = null; }
    if (socket) { socket.close(); socket = null; }
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    measurementElements.video.srcObject = null;
    try { measurementElements.video.style.display = ''; } catch(e) {}
    if (videoRenderRAF) { cancelAnimationFrame(videoRenderRAF); videoRenderRAF = null; }
    if (mpCamera) { try { mpCamera.stop(); } catch(e){} mpCamera = null; }
    if (pose) { pose.close(); pose = null; }
}

async function startMeasurement() {
    maxBattleIndex = 0;
    let socketError = false;
    try { measurementElements.socketStatus.textContent = 'INIT'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
    try {
        socket = new WebSocket('ws://localhost:8765');
        socket.onopen = () => {
            measurementElements.socketStatus.textContent = 'SCANNING';
            measurementElements.socketStatus.className = 'text-green-400';
        };
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (!useClientLandmark) {
                receivedImage.src = data.image;
            }
            updateStats(data.combat_stats);
        };
        socket.onclose = () => {
            measurementElements.socketStatus.textContent = 'DISCONNECTED';
            measurementElements.socketStatus.className = 'text-red-500';
        };
        socket.onerror = () => {
            measurementElements.socketStatus.textContent = 'ERROR';
            measurementElements.socketStatus.className = 'text-red-500';
            socketError = true;
        };
        receivedImage.onload = () => {
            if (!useClientLandmark) {
                canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                canvasCtx.drawImage(receivedImage, 0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                try { measurementElements.socketStatus.textContent = 'SERVER IMAGE'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
            }
        };
    } catch (e) {
        socketError = true;
    }
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        measurementElements.video.srcObject = videoStream;
        try { measurementElements.socketStatus.textContent = 'VIDEO READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

        await new Promise(resolve => {
            if (measurementElements.video.readyState >= 2) return resolve();
            measurementElements.video.onloadedmetadata = resolve;
        });
        try { measurementElements.video.style.display = 'none'; } catch(e) {}
        const vw = measurementElements.video.videoWidth;
        const vh = measurementElements.video.videoHeight;
        measurementElements.canvas.width = vw;
        measurementElements.canvas.height = vh;
        measurementElements.canvas.style.width = '100%';
        measurementElements.canvas.style.height = '100%';

        if (useClientLandmark && window.Pose) {
            pose = new window.Pose({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/${file}`
            });
            pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                enableSegmentation: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            pose.onResults((results) => {
                lastPoseResults = results;
                drawLandmarksOnCanvas(results);
            });
            try { measurementElements.socketStatus.textContent = 'POSE READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

            if (window.Camera) {
                try {
                    if (mpCamera) { mpCamera.stop(); mpCamera = null; }
                    mpCamera = new window.Camera(measurementElements.video, {
                        onFrame: async () => { await pose.send({image: measurementElements.video}); },
                        width: measurementElements.canvas.width,
                        height: measurementElements.canvas.height
                    });
                    mpCamera.start();
                    try { measurementElements.socketStatus.textContent = 'MP CAMERA'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                } catch (e) {
                    async function detectFrame() {
                        if (!pose) return;
                        await pose.send({image: measurementElements.video});
                        requestAnimationFrame(detectFrame);
                    }
                    detectFrame();
                }
            } else {
                async function detectFrame() {
                    if (!pose) return;
                    await pose.send({image: measurementElements.video});
                    requestAnimationFrame(detectFrame);
                }
                detectFrame();
            }
        }

        if (!(useClientLandmark && window.Pose)) {
            function renderVideoLoop() {
                try {
                    const w = measurementElements.canvas.width;
                    const h = measurementElements.canvas.height;
                    const ctx = measurementElements.canvas.getContext('2d');
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(measurementElements.video, 0, 0, w, h);

                    if (lastPoseResults && lastPoseResults.poseLandmarks) {
                        try {
                            window.drawConnectors(
                                ctx,
                                lastPoseResults.poseLandmarks,
                                (typeof window.POSE_CONNECTIONS !== 'undefined' ? window.POSE_CONNECTIONS : POSE_CONNECTIONS),
                                {color: '#00FF41', lineWidth: 6}
                            );
                            window.drawLandmarks(ctx, lastPoseResults.poseLandmarks, { color: '#00FF41', lineWidth: 0, radius: 10 });
                            window.drawLandmarks(ctx, lastPoseResults.poseLandmarks, { color: '#000000', lineWidth: 2, radius: 10 });
                            try { measurementElements.socketStatus.textContent = 'DETECTED'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                        } catch(e) {}
                    } else {
                        try { measurementElements.socketStatus.textContent = 'VIDEO RENDER'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
                    }
                } catch (e) {}
                videoRenderRAF = requestAnimationFrame(renderVideoLoop);
            }
            if (!videoRenderRAF) videoRenderRAF = requestAnimationFrame(renderVideoLoop);
        }

        if (!socketError && socket) {
            sendInterval = setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) {
                    socket.send(getVideoFrame());
                }
            }, 1000 / 30);
        }
    } catch (err) {
        measurementElements.socketStatus.textContent = 'CAMERA ERROR';
        measurementElements.socketStatus.className = 'text-red-500';
    }
}
function getVideoFrame() {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = measurementElements.video.videoWidth;
    tmpCanvas.height = measurementElements.video.videoHeight;
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(measurementElements.video, 0, 0, tmpCanvas.width, tmpCanvas.height);
    return tmpCanvas.toDataURL('image/jpeg');
}

window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});