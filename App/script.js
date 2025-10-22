// バトル進行用の状態
let battleState = {
    mode: null,
    step: 0,
    player1: {},
    player2: {}
};
// 画面切り替えとボタンイベント再バインド
function showScreen(screenName) {
    // すべての画面を隠す
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
        return;
    }

    if (screenName === '2pmeasure') {
        const btnStart = document.getElementById('btn-2pmeasure-start');
        const btnExit = document.getElementById('btn-2pmeasure-exit');
        const stage = document.getElementById('2pmeasure-stage');
        // 状態初期化
        battleState.mode = '2pmeasure';
        battleState.step = 201;
        battleState.player1 = { name: 'PLAYER1', score: 0 };
        battleState.player2 = { name: 'PLAYER2', score: 0 };
        if (stage) stage.textContent = '1にんめ すたーと';
        if (btnStart) {
            btnStart.classList.remove('hidden');
            btnStart.textContent = 'そくてい かいし';
            btnStart.onclick = () => {
                battleState.step = 202;
                if (stage) stage.textContent = 'PLAYER1 そくていちゅう...';
                showScreen('measurement');
                startMeasurement();
            };
        }
        if (btnExit) btnExit.onclick = () => showScreen('title');
        return;
    }

    if (screenName === 'instructions') {
        const btnBack = document.getElementById('btn-back-to-title-1');
        if (btnBack) btnBack.onclick = () => showScreen('title');
        const btnNext = document.getElementById('btn-goto-gender');
        if (btnNext) btnNext.onclick = () => showScreen('gender');
        return;
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
        return;
    }

    if (screenName === 'ranking') {
        const btnBack = document.getElementById('btn-back-to-title-3');
        if (btnBack) btnBack.onclick = () => showScreen('title');
        return;
    }
}

// らんきんぐ ぎょう を けす
async function deleteRankingEntry(id) {
    console.log('deleteRankingEntry called', id);
    if (!confirm('このデータ を けす？ なまえ と え が きえるよ。')) return;
    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_score', id: id })
        });
        const json = await res.json();
        if (json && json.success) {
            await fetchAndShowRanking();
        } else {
            alert('さくじょ に しっぱい');
        }
    } catch (e) {
    alert('さくじょ えらー');
    }
}
// expose to global so inline onclick works when this file is loaded as module
try { window.deleteRankingEntry = deleteRankingEntry; } catch(e) {}

// 初期画面表示とボタンイベント再バインド
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
    // BGM 初期化
    setupBGM();
    // 効果音のフォールバック初期化（sfx/ が無い場合はルート直下を使用）
    initSfxFallback();
});
// 3種バトルの戦闘力逆転ロジック（雛形）
// 三種バトル用の関数は削除

let measureTimeout = null;
let lastSnapshotDataUrl = null;
let lastCombatStats = null;

document.addEventListener('DOMContentLoaded', () => {
    // 測定画面のSTART/EXITボタン
    const btnStartMeasure = document.getElementById('btn-start-measure');
    const nameModal = document.getElementById('name-modal');
    const inputPlayerName = document.getElementById('input-player-name');
    const btnNameOk = document.getElementById('btn-name-ok');
    const btnNameCancel = document.getElementById('btn-name-cancel');
    if (btnStartMeasure) {
        btnStartMeasure.addEventListener('click', async () => {
            btnStartMeasure.disabled = true;
            btnStartMeasure.textContent = 'MEASURING...';

            // ルーレットSE再生: roulette2を2回連続→roulette
            const seRoulette = document.getElementById('se-roulette');
            const seRoulette2 = document.getElementById('se-roulette2');
            if (seRoulette && seRoulette2) {
                // 1回目（roulette2）
                seRoulette2.currentTime = 0;
                seRoulette2.play();
                seRoulette2.onended = () => {
                    // 2回目（roulette2）
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

            // 10秒後に写真と戦闘力を保存
            measureTimeout = setTimeout(async () => {
                const dataUrl = measurementElements.canvas.toDataURL('image/jpeg');
                lastSnapshotDataUrl = dataUrl;
                lastCombatStats = window._latestCombatStats || {};
                // 名前入力モーダル表示
                inputPlayerName.value = '';
                nameModal.classList.remove('hidden');
                inputPlayerName.focus();
            }, 10000);
        });
    }

    // 名前入力OK
    if (btnNameOk) {
        btnNameOk.addEventListener('click', async () => {
            const name = inputPlayerName.value.trim() || 'PLAYER';
            nameModal.classList.add('hidden');
            await saveResultToDB(lastCombatStats, lastSnapshotDataUrl, name);
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
            // 2人測定モード進行
            if (battleState.mode === '2pmeasure') {
                if (battleState.step === 202) {
                    // P1終了→P2へ
                    battleState.player1.name = name || 'PLAYER1';
                    battleState.player1.score = (window._latestCombatStats && window._latestCombatStats.total_power) || 0;
                    battleState.step = 203;
                    const stage = document.getElementById('2pmeasure-stage');
                    if (stage) stage.textContent = 'PLAYER2 そくていちゅう...';
                    setTimeout(() => { showScreen('measurement'); startMeasurement(); }, 400);
                    return;
                }
                if (battleState.step === 203) {
                    // P2終了→結果
                    battleState.player2.name = name || 'PLAYER2';
                    battleState.player2.score = (window._latestCombatStats && window._latestCombatStats.total_power) || 0;
                    const p1 = battleState.player1.score || 0;
                    const p2 = battleState.player2.score || 0;
                    showBattleResult({
                        p1: { name: battleState.player1.name || 'PLAYER1', score: p1 },
                        p2: { name: battleState.player2.name || 'PLAYER2', score: p2 },
                    });
                    return;
                }
            } else {
                // 単独測定時はランキングへ
                showScreen('ranking');
                await fetchAndShowRanking();
                alert('そくてい かんりょう！ ほぞん したよ');
            }
        });
    }
    // 名前入力キャンセル
    if (btnNameCancel) {
        btnNameCancel.addEventListener('click', () => {
            nameModal.classList.add('hidden');
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
        });
    }
    // EXITでタイトルに戻る
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
    // ボタン効果音を全ボタンに付与
    document.querySelectorAll('button, .btn, .hud-button').forEach(btn => {
        btn.addEventListener('click', playButtonSE);
    });

    // ランキングボタン
    const btnGotoRanking = document.getElementById('btn-goto-ranking');
    if (btnGotoRanking) {
        btnGotoRanking.addEventListener('click', async () => {
            showScreen('ranking');
            await fetchAndShowRanking();
        });
    }
    // ランキング画面の戻るボタン
    const btnBackToTitle3 = document.getElementById('btn-back-to-title-3');
    if (btnBackToTitle3) {
        btnBackToTitle3.addEventListener('click', () => {
            showScreen('title');
        });
    }
});

// ---- BGM: music フォルダの mp3/ogg/wav を自動検出し、選択再生 ----
function setupBGM() {
    const select = document.getElementById('bgm-select');
    const btnPlay = document.getElementById('bgm-play');
    const btnStop = document.getElementById('bgm-stop');
    const player = document.getElementById('bgm-player');
    if (!select || !btnPlay || !btnStop || !player) return;

    // 初期状態: なしのみ
    select.innerHTML = '<option value="">なし</option>';
    select.disabled = true;
    btnPlay.disabled = true;
    btnStop.disabled = true;

    fetch('music-list.php')
        .then(r => r.json())
        .then(json => {
            if (!json || !Array.isArray(json.files) || json.files.length === 0) {
                // BGMファイルが見つからない場合
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'BGMがありません';
                select.appendChild(opt);
                select.disabled = true;
                btnPlay.disabled = true;
                btnStop.disabled = true;
                return;
            }
            // BGMファイルがある場合
            select.innerHTML = '<option value="">なし</option>';
            select.disabled = false;
            btnPlay.disabled = false;
            btnStop.disabled = false;
            // 数値連番（bgm1, bgm2, ...）を優先して昇順ソート
            const parsed = json.files.map((name) => {
                const m = name.match(/^bgm(\d+)\./i);
                const order = m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
                return { name, order };
            }).sort((a, b) => {
                if (a.order !== b.order) return a.order - b.order;
                return a.name.localeCompare(b.name);
            });

            parsed.forEach(({ name, order }) => {
                const opt = document.createElement('option');
                opt.value = 'music/' + name;
                opt.textContent = isFinite(order) ? `BGM ${order}` : name;
                select.appendChild(opt);
            });

            // 既定選択: bgm1.* があればそれを選択
            const preferred = parsed.find(p => isFinite(p.order) && p.order === 1);
            if (preferred) {
                select.value = 'music/' + preferred.name;
            }
        })
        .catch(() => {
            // 通信エラー時もBGM選択不可
            select.innerHTML = '<option value="">BGMがありません</option>';
            select.disabled = true;
            btnPlay.disabled = true;
            btnStop.disabled = true;
        });

    btnPlay.addEventListener('click', async () => {
        const url = select.value;
        if (!url) return;
        try {
            player.src = url;
            await player.play();
        } catch (e) {
            console.warn('BGM play error', e);
        }
    });

    btnStop.addEventListener('click', () => {
        try { player.pause(); player.currentTime = 0; } catch(e) {}
    });
}
// ===== バトル結果表示 =====
function showBattleResult({ p1, p2 }) {
    const p1NameEl = document.getElementById('battle-p1-name');
    const p2NameEl = document.getElementById('battle-p2-name');
    const p1ScoreEl = document.getElementById('battle-p1-score');
    const p2ScoreEl = document.getElementById('battle-p2-score');
    const winnerEl = document.getElementById('battle-winner-text');
    const btnRematch = document.getElementById('btn-battle-rematch');
    const btnBack = document.getElementById('btn-battle-back');

    if (p1NameEl) p1NameEl.textContent = p1.name;
    if (p2NameEl) p2NameEl.textContent = p2.name;
    if (p1ScoreEl) p1ScoreEl.textContent = (p1.score || 0).toLocaleString();
    if (p2ScoreEl) p2ScoreEl.textContent = (p2.score || 0).toLocaleString();

    let msg = '';
    if ((p1.score || 0) > (p2.score || 0)) msg = `しょうしゃ: ${p1.name}`;
    else if ((p1.score || 0) < (p2.score || 0)) msg = `しょうしゃ: ${p2.name}`;
    else msg = 'ひきわけ！';
    if (winnerEl) winnerEl.textContent = msg;

    showScreen('battle-result');

    if (btnRematch) btnRematch.onclick = () => {
        // 状態をリセットして2人測定に戻る
        battleState.mode = '2pmeasure';
        battleState.step = 201;
        battleState.player1 = { name: 'PLAYER1', score: 0 };
        battleState.player2 = { name: 'PLAYER2', score: 0 };
        showScreen('2pmeasure');
    };
    if (btnBack) btnBack.onclick = () => showScreen('title');
}

// ---- 効果音フォールバック: sfx/ が無い環境でも動くようにパスを補正 ----
function initSfxFallback() {
    const testUrl = 'sfx/button.mp3';
    // HEAD で存在確認
    fetch(testUrl, { method: 'HEAD' }).then(res => {
        if (res.ok) return; // sfx/ が使える
        // sfx/ 不在 → 既存レイアウト（ルート直下）に差し替え
        const map = [
            { id: 'se-button', file: 'button.mp3' },
            { id: 'se-roulette', file: 'roulette.mp3' },
            { id: 'se-roulette2', file: 'roulette2.mp3' },
        ];
        map.forEach(({ id, file }) => {
            const el = document.getElementById(id);
            if (el) el.src = file;
        });
    }).catch(() => {
        // ネットワークエラー時は何もしない（既定のsfx/パスで動作）
    });
}
// ランキング取得＆表示
async function fetchAndShowRanking() {
    const rankingList = document.getElementById('ranking-list');
    if (!rankingList) return;
    rankingList.innerHTML = '<div class="text-center text-gray-400">ろーでぃんぐ...</div>';
    try {
        const res = await fetch('api.php?action=get_ranking');
        const data = await res.json();
        console.log('ranking data', data);
        if (Array.isArray(data) && data.length > 0) {
            rankingList.innerHTML = data.map((row, i) =>
                `<div class="flex items-center gap-4 p-2 bg-gray-800 rounded-lg" data-id="${row.id}">
                    <span class="text-2xl font-bold text-cyan-400 w-8 text-center">${i+1}</span>
                    ${row.image ? `<img src="src/${encodeURIComponent(row.image)}" alt="thumb" style="width:64px;height:48px;object-fit:cover;border-radius:6px;">` : `<div style="width:64px;height:48px;background:#071116;border-radius:6px;"></div>`}
                    <span class="font-orbitron text-lg flex-1">${row.name}</span>
                    <span class="font-mono text-xl text-yellow-300">${row.score.toLocaleString()}</span>
                    <button type="button" class="btn btn-danger ml-4" data-id="${row.id}" onclick="deleteRankingEntry(${row.id})">けす</button>
                </div>`
            ).join('');
        } else {
            rankingList.innerHTML = '<div class="text-center text-gray-400">まだ ないよ</div>';
        }
    } catch (e) {
    rankingList.innerHTML = '<div class="text-center text-red-400">らんきんぐ しっぱい</div>';
    }
}

// 戦闘力データをwindowに保持
function updateStats(combat_stats) {
    window._latestCombatStats = combat_stats;
    const totalPower = combat_stats.total_power;
    if (totalPower > maxBattleIndex) { maxBattleIndex = totalPower; }
    measurementElements.totalPower.textContent = totalPower.toLocaleString();
    measurementElements.basePower.textContent = combat_stats.base_power.toLocaleString();
    measurementElements.poseBonus.textContent = `+${combat_stats.pose_bonus.toLocaleString()}`;
    measurementElements.expressionBonus.textContent = `+${combat_stats.expression_bonus.toLocaleString()}`;
    measurementElements.speedBonus.textContent = `+${combat_stats.speed_bonus.toLocaleString()}`;
    // 測定項目の表示
    measurementElements.statHeight.textContent = combat_stats.height ? combat_stats.height.toFixed(2) : '-';
    measurementElements.statReach.textContent = combat_stats.reach ? combat_stats.reach.toFixed(2) : '-';
    measurementElements.statShoulder.textContent = combat_stats.shoulder ? combat_stats.shoulder.toFixed(2) : '-';
    measurementElements.statExpression.textContent = combat_stats.expression ? combat_stats.expression.toFixed(2) : '-';
    measurementElements.statPose.textContent = combat_stats.pose ? combat_stats.pose.toFixed(2) : '-';
}

// DB保存API呼び出し（name引数追加）
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
        // simple preview: if image saved, show small preview in name-modal area
                if (json && json.success && json.image) {
            try {
                const preview = document.getElementById('save-preview');
                if (preview) preview.src = `src/${encodeURIComponent(json.image)}`;
            } catch(e){}
        }
        return json;
    } catch (e) {
        alert('保存に失敗しました');
    }
}
// 効果音再生
const seButton = document.getElementById('se-button');
function playButtonSE() {
    if (seButton) {
        seButton.currentTime = 0;
        seButton.play();
    }
}

// DOM取得
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


// 測定ロジック
let socket = null, videoStream = null, sendInterval = null, maxBattleIndex = 0;
let mpCamera = null;

const canvasCtx = measurementElements.canvas.getContext('2d');
const receivedImage = new Image();

// === MediaPipe Pose クライアント描画用（JSのみ運用）===
let pose = null;
let lastPoseResults = null;
// モーション由来のボーナス計算用（シンプルなフレーム間速度）
let prevPoseLm = null;
let prevPoseTs = 0;
let motionEma = 0; // 指数移動平均で安定化

// JSのみで処理するため、クライアント描画を有効化
let useClientLandmark = true; // trueでクライアント描画
let poseFailsafeTimer = null;
let videoRenderRAF = null;
// 表示モード: 'server' = サーバー画像, 'client' = クライアント映像（骨格なし）
let displayMode = 'client';
// 完全JS運用フラグ（WebSocketを使わない）
const JS_ONLY = true;
// 骨格描画トグル（既定は非表示）
const SHOW_SKELETON = false;

// MediaPipe Poseのコネクション定義（window.POSE_CONNECTIONSが未定義の場合用）
var POSE_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],
    [0,4],[4,5],[5,6],[6,8],
    [9,10],
    [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
    [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32]
];

function drawLandmarksOnCanvas(results) {
    // debug: drawLandmarksOnCanvas が呼ばれたことをログ
    try { console.log('drawLandmarksOnCanvas called', !!results); } catch(e){}
    // ビデオフレームを背景に描画（通常表示）し、その上にランドマークを重ねる
    canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
    try {
        const w = measurementElements.canvas.width;
        const h = measurementElements.canvas.height;
        canvasCtx.drawImage(measurementElements.video, 0, 0, w, h);
    } catch (e) {
        // videoが未初期化の場合は無視
    }
    if (results && results.poseLandmarks) {
        // 検出が走っていることをUIに反映
        try { measurementElements.socketStatus.textContent = 'DETECTED'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
        if (!SHOW_SKELETON) return; // 骨格描画は行わない

        // （必要なら）骨格描画を有効化できるようコードは保持
        const lm = results.poseLandmarks;
        const W = measurementElements.canvas.width;
        const H = measurementElements.canvas.height;
        const toXY = (i) => ({ x: (lm[i].x || 0) * W, y: (lm[i].y || 0) * H });
        const has = (i) => lm[i] && lm[i].visibility !== undefined ? lm[i].visibility > 0.1 : !!lm[i];
        const L_SHOULDER = 11, R_SHOULDER = 12, L_ELBOW = 13, R_ELBOW = 14,
              L_WRIST = 15, R_WRIST = 16, L_HIP = 23, R_HIP = 24,
              L_KNEE = 25, R_KNEE = 26, L_ANKLE = 27, R_ANKLE = 28;
        const line = (a, b, color = '#3BA7FF', width = 6) => {
            canvasCtx.strokeStyle = color;
            canvasCtx.lineWidth = width;
            canvasCtx.lineCap = 'round';
            canvasCtx.beginPath();
            canvasCtx.moveTo(a.x, a.y);
            canvasCtx.lineTo(b.x, b.y);
            canvasCtx.stroke();
        };
        const dot = (p, r = 6, color = '#3BA7FF', outline = '#ffffff') => {
            canvasCtx.fillStyle = color;
            canvasCtx.beginPath();
            canvasCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
            canvasCtx.fill();
            if (outline) {
                canvasCtx.strokeStyle = outline;
                canvasCtx.lineWidth = 2;
                canvasCtx.beginPath();
                canvasCtx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
                canvasCtx.stroke();
            }
        };
        if (has(L_SHOULDER) && has(R_SHOULDER) && has(L_HIP) && has(R_HIP)) {
            const ls = toXY(L_SHOULDER), rs = toXY(R_SHOULDER);
            const lh = toXY(L_HIP), rh = toXY(R_HIP);
            line(ls, rs);
            line(rs, rh);
            line(rh, lh);
            line(lh, ls);
            [ls, rs, lh, rh].forEach(p => dot(p));
        }
        if (has(L_SHOULDER) && has(L_ELBOW)) line(toXY(L_SHOULDER), toXY(L_ELBOW));
        if (has(L_ELBOW) && has(L_WRIST))     line(toXY(L_ELBOW),     toXY(L_WRIST));
        if (has(R_SHOULDER) && has(R_ELBOW)) line(toXY(R_SHOULDER), toXY(R_ELBOW));
        if (has(R_ELBOW) && has(R_WRIST))     line(toXY(R_ELBOW),     toXY(R_WRIST));
        [L_ELBOW, L_WRIST, R_ELBOW, R_WRIST].forEach(i => { if (has(i)) dot(toXY(i)); });
        if (has(L_HIP) && has(L_KNEE))   line(toXY(L_HIP),  toXY(L_KNEE));
        if (has(L_KNEE) && has(L_ANKLE)) line(toXY(L_KNEE), toXY(L_ANKLE));
        if (has(R_HIP) && has(R_KNEE))   line(toXY(R_HIP),  toXY(R_KNEE));
        if (has(R_KNEE) && has(R_ANKLE)) line(toXY(R_KNEE), toXY(R_ANKLE));
        [L_KNEE, L_ANKLE, R_KNEE, R_ANKLE].forEach(i => { if (has(i)) dot(toXY(i)); });
    }
}

// JS側スコア計算（サーバーのフェアモードに追従）
function computeCombatStatsFromLandmarks(lm) {
    // lm: Array of {x,y,z,visibility}
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, speed_bonus: 0, total_power: 0,
            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0
        };
    }
    const v2 = (a, b) => {
        const dx = (a.x - b.x);
        const dy = (a.y - b.y);
        return Math.hypot(dx, dy);
    };
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const std = (arr) => {
        const m = mean(arr);
        const v = mean(arr.map(x => (x - m) ** 2));
        return Math.sqrt(v);
    };
    // メトリクス
    const top = lm[0];
    // MediaPipe Pose のインデックスに合わせて足首を修正: 左=27, 右=28
    const ankleL = lm[27];
    const ankleR = lm[28];
    const wristL = lm[15];
    const wristR = lm[16];
    const shoulderL = lm[11];
    const shoulderR = lm[12];
    const hipL = lm[23];
    const hipR = lm[24];
    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const height = Math.abs(top.y - ((ankleL.y + ankleR.y) / 2));
    const reach = v2(wristL, wristR);
    const shoulder = v2(shoulderL, shoulderR);
    const pose = v2(top, spineMid);
    const face = lm.slice(0, 5).map(p => [p.x, p.y]).flat();
    const expression = std(face);
    // スコア（フェアモード）
    const FAIR_CLIP_MAX = 1.2;
    const eps = 1e-6;
    const h = Math.max(height, eps);
    let reach_norm = reach / h;
    let shoulder_norm = shoulder / h;
    reach_norm = Math.max(0, Math.min(FAIR_CLIP_MAX, reach_norm));
    shoulder_norm = Math.max(0, Math.min(FAIR_CLIP_MAX, shoulder_norm));
    const reach_score = Math.sqrt(reach_norm) * 120000;
    const shoulder_score = Math.sqrt(shoulder_norm) * 80000;
    const height_score = 0;
    const pose_bonus = pose * 50000;
    const expression_bonus = expression * 30000;
    const speed_bonus = 0;
    const base_power = height_score + reach_score + shoulder_score;
    const total_power = base_power + pose_bonus + expression_bonus + speed_bonus;
    return {
        base_power: Math.round(base_power),
        pose_bonus: Math.round(pose_bonus),
        expression_bonus: Math.round(expression_bonus),
        speed_bonus: Math.round(speed_bonus),
        total_power: Math.round(total_power),
        height, reach, shoulder, expression, pose
    };
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
    if (!JS_ONLY) {
        try {
            socket = new WebSocket('ws://localhost:8765');
            socket.onopen = () => {
                measurementElements.socketStatus.textContent = 'SERVER WAIT';
                measurementElements.socketStatus.className = 'text-yellow-400';
            };
            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (displayMode === 'server') {
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
                if (displayMode === 'server') {
                    canvasCtx.clearRect(0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                    canvasCtx.drawImage(receivedImage, 0, 0, measurementElements.canvas.width, measurementElements.canvas.height);
                    try { measurementElements.socketStatus.textContent = 'SERVER IMAGE'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                }
            };
        } catch (e) {
            socketError = true;
        }
    }
    // カメラ・MediaPipe初期化は必ず実行
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        measurementElements.video.srcObject = videoStream;
        try { measurementElements.socketStatus.textContent = 'VIDEO READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

        await new Promise(resolve => {
            if (measurementElements.video.readyState >= 2) return resolve();
            measurementElements.video.onloadedmetadata = resolve;
        });
        // video 要素は canvas に描画するので画面上から隠す（MediaPipe Camera は非表示videoでも動作）
        try { measurementElements.video.style.display = 'none'; } catch(e) {}
        // レスポンシブなcanvasサイズ
        const vw = measurementElements.video.videoWidth;
        const vh = measurementElements.video.videoHeight;
        measurementElements.canvas.width = vw;
        measurementElements.canvas.height = vh;
        measurementElements.canvas.style.width = '100%';
        measurementElements.canvas.style.height = '100%';

    // === MediaPipe Poseセットアップ ===
        if (useClientLandmark && window.Pose) {
            pose = new window.Pose({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/${file}`
            });
            pose.setOptions({
                modelComplexity: 0,
                smoothLandmarks: true,
                enableSegmentation: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            // 保存用ラッパー: onResultsでlastPoseResultsを更新して描画
            pose.onResults((results) => {
                lastPoseResults = results;
                // スコアをJS側で計算
                if (results && results.poseLandmarks) {
                    const lm = results.poseLandmarks;
                    const stats = computeCombatStatsFromLandmarks(lm);

                    // 速度ボーナス: 前フレームとの移動量を高さで正規化し、時間で割って速度に相当する値を算出
                    try {
                        const now = performance.now();
                        const dt = prevPoseTs ? Math.max(0.016, (now - prevPoseTs) / 1000) : 0.033; // 秒
                        const idxs = [11, 12, 15, 16, 27, 28]; // 両肩・両手首・両足首
                        if (prevPoseLm && Array.isArray(prevPoseLm) && stats.height > 1e-6) {
                            let sum = 0, n = 0;
                            for (const i of idxs) {
                                const a = lm[i], b = prevPoseLm[i];
                                if (a && b) {
                                    const dx = (a.x - b.x);
                                    const dy = (a.y - b.y);
                                    const dist = Math.hypot(dx, dy);
                                    sum += dist; n++;
                                }
                            }
                            if (n > 0) {
                                const meanMove = (sum / n);            // 画面正規化座標での平均移動量
                                const normByHeight = meanMove / Math.max(stats.height, 1e-6);
                                const speedLike = normByHeight / dt;   // 時間で割って「速度」らしさ
                                // クリップしてEMA
                                const clipped = Math.max(0, Math.min(3.0, speedLike));
                                motionEma = motionEma * 0.85 + clipped * 0.15;
                                const SPEED_GAIN = 120000; // 調整係数（体感で程よい値）
                                const speed_bonus = motionEma * SPEED_GAIN;
                                stats.speed_bonus = Math.round(speed_bonus);
                                stats.total_power = Math.max(0, Math.round(stats.base_power + stats.pose_bonus + stats.expression_bonus + stats.speed_bonus));
                            }
                        }
                        prevPoseLm = lm.map(p => ({ x: p.x, y: p.y }));
                        prevPoseTs = now;
                    } catch (e) {
                        // 計算失敗時は無視（速度ボーナス0）
                    }
                    updateStats(stats);
                }
                // 表示はビデオのみ（骨格は非表示）
                drawLandmarksOnCanvas(results);
                // ランドマークが得られない場合は明確な表示
                if (!results || !results.poseLandmarks) {
                    try { measurementElements.socketStatus.textContent = 'NO TARGET'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
                }
            });
            try { measurementElements.socketStatus.textContent = 'POSE READY'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}

            // MediaPipe Camera util が利用可能なら Camera を使って確実に onResults を発火させる
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
                    // fall back to manual loop
                    async function detectFrame() {
                        if (!pose) return;
                        await pose.send({image: measurementElements.video});
                        requestAnimationFrame(detectFrame);
                    }
                    detectFrame();
                }
            } else {
                // videoフレームをMediaPipeに送るループ
                async function detectFrame() {
                    if (!pose) return;
                    await pose.send({image: measurementElements.video});
                    requestAnimationFrame(detectFrame);
                }
                detectFrame();
            }

            // フェイルセーフ: 一定時間ポーズ結果が得られなければサーバ画像に切替
            if (poseFailsafeTimer) { clearTimeout(poseFailsafeTimer); }
            poseFailsafeTimer = setTimeout(() => {
                if (useClientLandmark && !lastPoseResults) {
                    useClientLandmark = false; // サーバ描画に切替
                    try {
                        measurementElements.socketStatus.textContent = 'SERVER IMAGE';
                        measurementElements.socketStatus.className = 'text-yellow-400';
                    } catch(e){}
                }
            }, 3500);
        } else if (useClientLandmark && !window.Pose) {
            // Poseスクリプト未読み込み（CDNブロック等）
            try {
                measurementElements.socketStatus.textContent = 'POSE SCRIPT MISSING';
                measurementElements.socketStatus.className = 'text-red-500';
            } catch(e){}
        }

        // フォールバック: Pose が利用できない場合は video を canvas に直接描画するループを開始
        if (!(useClientLandmark && window.Pose)) {
            function renderVideoLoop() {
                try {
                    const w = measurementElements.canvas.width;
                    const h = measurementElements.canvas.height;
                    const ctx = measurementElements.canvas.getContext('2d');
                    ctx.clearRect(0, 0, w, h);

                    if (!JS_ONLY && displayMode === 'server') {
                        // サーバ画像モード: 受信済みならそれを優先表示
                        if (receivedImage && receivedImage.complete && receivedImage.naturalWidth > 0) {
                            ctx.drawImage(receivedImage, 0, 0, w, h);
                            try { measurementElements.socketStatus.textContent = 'SERVER IMAGE'; measurementElements.socketStatus.className = 'text-green-400'; } catch(e){}
                        } else {
                            // まだ来ない間は通常ビデオを仮表示
                            ctx.drawImage(measurementElements.video, 0, 0, w, h);
                            try { measurementElements.socketStatus.textContent = 'SERVER WAIT'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
                        }
                        // サーバ画像時はランドマーク描画は行わない
                        videoRenderRAF = requestAnimationFrame(renderVideoLoop);
                        return;
                    }

                    // クライアントPoseモード: まずはビデオを背景に描画
                    ctx.drawImage(measurementElements.video, 0, 0, w, h);

                    // もし最後に得られたランドマーク結果があれば上書きで描画
                    if (lastPoseResults && lastPoseResults.poseLandmarks) {
                        // drawLandmarksOnCanvas は内部で video 描画を行うので、ここはランドマークのみ描く
                        // 代わりに直接ランドマーク描画ロジックを呼ぶ
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
                        } catch(e) {
                            // 描画APIがない場合は何もしない
                        }
                    } else {
                        // クライアント映像のみ
                        try { measurementElements.socketStatus.textContent = 'VIDEO RENDER'; measurementElements.socketStatus.className = 'text-yellow-400'; } catch(e){}
                    }
                } catch (e) {
                    // video未準備時は無視
                }
                videoRenderRAF = requestAnimationFrame(renderVideoLoop);
            }
            if (!videoRenderRAF) videoRenderRAF = requestAnimationFrame(renderVideoLoop);
        }

        // サーバー送信は常に行う（サーバー接続時のみ）
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
    // videoの内容をcanvasにdrawしてbase64
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = measurementElements.video.videoWidth;
    tmpCanvas.height = measurementElements.video.videoHeight;
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(measurementElements.video, 0, 0, tmpCanvas.width, tmpCanvas.height);
    return tmpCanvas.toDataURL('image/jpeg');
}

// 初期画面表示
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});