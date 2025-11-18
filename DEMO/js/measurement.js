// measurement page logic (camera, pose, compute stats, save, 2p flow)
// (このファイルは measurement.html 専用のスクリプトです)

// --- DOM要素の取得 ---
const videoEl = document.getElementById('input-video'); // カメラ映像を表示する <video>
const canvasEl = document.getElementById('output-canvas'); // 映像を描画・スナップショットを取得する <canvas>
const socketStatus = document.getElementById('socket-status'); // 状態表示用 (LOADING POSE... など)
const totalPowerEl = document.getElementById('total-power'); // 総合戦闘力
const basePowerEl = document.getElementById('base-power'); // 基礎戦闘力
const poseBonusEl = document.getElementById('pose-bonus'); // ポーズボーナス
const exprBonusEl = document.getElementById('expression-bonus'); // 表情ボーナス
const speedBonusEl = document.getElementById('speed-bonus'); // 速度ボーナス
const statHeight = document.getElementById('stat-height'); // 身長 (推定値)
const statReach = document.getElementById('stat-reach'); // リーチ (推定値)
const statShoulder = document.getElementById('stat-shoulder'); // 肩幅 (推定値)
const statExpression = document.getElementById('stat-expression'); // 表情 (推定値)
const statPose = document.getElementById('stat-pose'); // ポーズ (推定値)

const nameModal = document.getElementById('name-modal'); // 名前入力モーダル
const inputPlayerName = document.getElementById('input-player-name'); // 名前入力フィールド
const btnNameOk = document.getElementById('btn-name-ok'); // 名前入力OKボタン
const btnNameCancel = document.getElementById('btn-name-cancel'); // 名前入力キャンセルボタン
const btnStart = document.getElementById('btn-start-measure'); // 測定開始(START)ボタン
const btnExit = document.getElementById('btn-back-to-title-2'); // 終了(EXIT)ボタン

// --- グローバル変数 ---
let measureTimeout = null; // 測定タイマー (10秒カウントダウン用)
let lastSnapshotDataUrl = null; // 最後に撮影したスナップショット (Data URL形式)
let lastCombatStats = null; // 最後に計算された戦闘力データ

// --- ユーティリティ ---

/**
 * URLのクエリパラメータ (?player=1 など) をオブジェクトとして取得する
 * @returns {object} { player: "1" } のようなオブジェクト
 */
function getQueryParams() {
    const q = {};
    location.search.replace(/^\?/, '').split('&').forEach(p => {
        if (!p) return;
        const [k,v] = p.split('=');
        q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
}

/**
 * scriptタグを動的に読み込む (Promise版)
 * @param {string} url - 読み込むスクリプトのURL
 * @returns {Promise} 読み込み成功/失敗を返すPromise
 */
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve(); // 読み込み成功
        s.onerror = () => reject(new Error('Failed to load ' + url)); // 読み込み失敗
        document.head.appendChild(s);
    });
}
/**
 * Promiseにタイムアウトを設定する
 * @param {Promise} promise - 対象のPromise
 * @param {number} ms - タイムアウト時間 (ミリ秒)
 * @returns {Promise} タイムアウト付きのPromise
 */
function withTimeout(promise, ms) {
    // Promise.race: 複数のPromiseのうち、最初に完了したものだけを採用する
    return Promise.race([
        promise, // 元のPromise
        new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')), ms)) // タイムアウト用Promise
    ]);
}

// --- 戦闘力計算 ---

// 戦闘力計算用の定数 (script.js と互換性のある最小限のコピー)
const POWER_CONSTANTS = {
    baseline: 100000, // 基礎点
    maxTotal: 500000, // 最大値
    clipFeature: 1.6, // 身体特徴の最大値（身長比）
    clipSpeed: 2.0, // 速度の最大値
    weightBase: 0.60, // 基礎戦闘力（体格）の重み
    weightStyle: 0.25, // スタイル（ポーズ・表情）の重み
    weightMotion: 0.15, // 動作（速度）の重み
    weightPoseInStyle: 0.60, // スタイル内のポーズの重み
    weightExprInStyle: 0.40, // スタイル内の表情の重み
    weightReachInBase: 0.40, // 基礎内のリーチの重み
    weightShoulderInBase: 0.35, // 基礎内の肩幅の重み
    weightLegInBase: 0.25, // 基礎内の脚の長さの重み
    genderMultiplier: { male: 1.00, female: 1.09 }, // 性別補正（女性の場合少し高めに出る）
    speedAlpha: 0.4 // 速度の平滑化係数 (EMA)
};

// --- MediaPipe Pose 関連 ---
let pose = null; // MediaPipe Pose のインスタンス
let videoRenderRAF = null; // requestAnimationFrame ID (ビデオ描画用)
let poseRenderRAF = null; // requestAnimationFrame ID (ポーズ推定ループ用)
let _prevForSpeed = null; // 速度計算用の前フレームのランドマーク
let _prevTimeMs = null; // 速度計算用の前フレームの時間
let _speedEma = 0; // 平滑化された速度

/**
 * MediaPipeのランドマークから戦闘力を計算するコア関数
 * @param {Array} lm - MediaPipe Pose が出力したランドマーク (33点)
 * @returns {object} 計算された戦闘力・各種ステータス
 */
function computeCombatStatsFromLandmarks(lm) {
    // ランドマークが取得できていない場合は、基礎点のみを返す
    if (!lm || lm.length < 33) {
        return {
            base_power: 0, pose_bonus: 0, expression_bonus: 0, speed_bonus: 0, total_power: POWER_CONSTANTS.baseline,
            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0
        };
    }

    // --- ユーティリティ関数 (計算用) ---
    const v2 = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y)); // 2点間の距離
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1); // 平均値
    const std = (arr) => { // 標準偏差
        const m = mean(arr);
        const v = mean(arr.map(x => (x - m) ** 2));
        return Math.sqrt(v);
    };
    const clip01 = (x) => Math.max(0, Math.min(1, x)); // 0.0〜1.0の範囲に値をクリップ

    // --- 必要なランドマークを取得 ---
    const top = lm[0]; // 頭頂
    const ankleL = lm[29]; // 左足首
    const ankleR = lm[30]; // 右足首
    const wristL = lm[15]; // 左手首
    const wristR = lm[16]; // 右手首
    const shoulderL = lm[11]; // 左肩
    const shoulderR = lm[12]; // 右肩
    const hipL = lm[23]; // 左腰
    const hipR = lm[24]; // 右腰

    // --- 1. 体格 (Base) の計算 ---
    // (各値はランドマークの座標(0〜1)に基づいているため、ピクセル単位ではない)
    const height = Math.abs(top.y - ((ankleL.y + ankleR.y) / 2)); // 身長 (頭頂〜足首のY差)
    const reach = v2(wristL, wristR); // リーチ (両手首の距離)
    const shoulder = v2(shoulderL, shoulderR); // 肩幅 (両肩の距離)
    const leg = v2(hipL, ankleL) + v2(hipR, ankleR); // 両足の長さ (腰〜足首)

    // 身長比に正規化 (0〜1の範囲)
    const eps = 1e-6; // ゼロ除算防止
    const h = Math.max(height, eps);
    const maxF = POWER_CONSTANTS.clipFeature; // 補正上限
    const rN = clip01((reach / h) / maxF); // 正規化リーチ
    const sN = clip01((shoulder / h) / maxF); // 正規化肩幅
    const lN = clip01(((leg / h) / 2) / maxF); // 正規化脚長

    // --- 2. スタイル (Style) の計算 ---
    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 }; // 背骨中央（腰）
    const poseVal = v2(top, spineMid); // ポーズ値（頭頂から腰の距離 = 背筋の伸び）
    const poseN = clip01(poseVal / 0.5); // 正規化ポーズ値
    const face = lm.slice(0, 5).map(p => [p.x, p.y]).flat(); // 顔の主要5点の座標
    const exprN = clip01(std(face) / 0.05); // 表情値（顔の標準偏差 = 顔の動き）

    // --- 3. 動作 (Motion) の計算 ---
    const now = performance && performance.now ? performance.now() : Date.now();
    let vRaw = 0; // 生の速度
    if (_prevForSpeed && _prevTimeMs) { // 2フレーム目以降
        const dt = Math.max(1, now - _prevTimeMs) / 1000; // 経過時間 (秒)
        // 主要な関節のインデックス
        const idx = [0,11,12,13,14,15,16,23,24,25,26,27,28];
        // 各関節の前フレームからの移動距離
        const dists = idx.map(i => v2(lm[i], _prevForSpeed[i] || lm[i]));
        const avg = mean(dists); // 平均移動距離
        vRaw = avg / (h * dt); // 速度（身長比・時間あたり）
    }
    // 現在の値を次フレームのために保存
    _prevForSpeed = lm.map(p => ({ x: p.x, y: p.y }));
    _prevTimeMs = now;
    const vClip = POWER_CONSTANTS.clipSpeed;
    const vN = clip01(vRaw / vClip); // 正規化速度
    // EMA（指数移動平均）で速度を平滑化（急激な変動を抑える）
    _speedEma = POWER_CONSTANTS.speedAlpha * vN + (1 - POWER_CONSTANTS.speedAlpha) * _speedEma;

    // --- 4. 総合戦闘力の計算 ---
    // 各要素を重み付けして合算 (0〜1)
    const baseRaw = ( // 体格
        POWER_CONSTANTS.weightReachInBase * Math.pow(rN, 0.90) +
        POWER_CONSTANTS.weightShoulderInBase * Math.pow(sN, 0.85) +
        POWER_CONSTANTS.weightLegInBase * Math.pow(lN, 0.80)
    );
    const styleRaw = ( // スタイル
        POWER_CONSTANTS.weightPoseInStyle * poseN +
        POWER_CONSTANTS.weightExprInStyle * exprN
    );
    const motionRaw = _speedEma; // 動作

    let combined = ( // 総合値
        POWER_CONSTANTS.weightBase * baseRaw +
        POWER_CONSTANTS.weightStyle * styleRaw +
        POWER_CONSTANTS.weightMotion * motionRaw
    );

    // 性別補正 (index.html側で設定された _selectedGender を参照)
    let gender = (window && window._selectedGender) ? window._selectedGender : 'male';
    const gmul = POWER_CONSTANTS.genderMultiplier[gender] || 1.0;
    combined = Math.min(1, combined * gmul); // 補正をかけて1.0でクリップ

    // 基礎点(baseline)からの上乗せ分(span)を計算
    const span = POWER_CONSTANTS.maxTotal - POWER_CONSTANTS.baseline;
    // 各ボーナス項目を計算
    let base_amount = span * POWER_CONSTANTS.weightBase * baseRaw;
    let pose_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightPoseInStyle * poseN;
    let expr_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightExprInStyle * exprN;
    let speed_amount = span * POWER_CONSTANTS.weightMotion * motionRaw;
    
    // 性別補正を各項目にも適用
    base_amount *= gmul; pose_amount *= gmul; expr_amount *= gmul; speed_amount *= gmul;
    
    let sumParts = base_amount + pose_amount + expr_amount + speed_amount;
    if (sumParts > span) { // 合計が上乗せ分を超えた場合、スケールダウンする
        const scale = span / sumParts;
        base_amount *= scale; pose_amount *= scale; expr_amount *= scale; speed_amount *= scale;
        sumParts = span;
    }
    // 基礎点 + 上乗せ分 = 最終戦闘力
    const total = Math.round(POWER_CONSTANTS.baseline + sumParts);

    // 最終的なオブジェクトを返す
    return {
        base_power: Math.round(base_amount),
        pose_bonus: Math.round(pose_amount),
        expression_bonus: Math.round(expr_amount),
        speed_bonus: Math.round(speed_amount),
        total_power: total,
        height, reach, shoulder, expression: exprN, pose: poseN // 生データ（デバッグ表示用）
    };
}

/**
 * 計算された戦闘力(stats)をHTMLのUIに反映する
 * @param {object} stats - computeCombatStatsFromLandmarks が返したオブジェクト
 */
function updateStats(stats) {
    lastCombatStats = stats; // 常に最新の戦闘力をグローバル変数に保持
    // toLocaleString() で3桁区切りカンマを入れる
    try { totalPowerEl.textContent = stats.total_power.toLocaleString(); } catch(e){}
    try { basePowerEl.textContent = stats.base_power.toLocaleString(); } catch(e){}
    try { poseBonusEl.textContent = `+${stats.pose_bonus.toLocaleString()}`; } catch(e){}
    try { exprBonusEl.textContent = `+${stats.expression_bonus.toLocaleString()}`; } catch(e){}
    try { speedBonusEl.textContent = `+${stats.speed_bonus.toLocaleString()}`; } catch(e){}
    // toFixed(2) で小数点以下2桁表示
    try { statHeight.textContent = stats.height ? stats.height.toFixed(2) : '-'; } catch(e){}
    try { statReach.textContent = stats.reach ? stats.reach.toFixed(2) : '-'; } catch(e){}
    try { statShoulder.textContent = stats.shoulder ? stats.shoulder.toFixed(2) : '-'; } catch(e){}
    try { statExpression.textContent = stats.expression ? stats.expression.toFixed(2) : '-'; } catch(e){}
    try { statPose.textContent = stats.pose ? stats.pose.toFixed(2) : '-'; } catch(e){}
}

/**
 * MediaPipe Pose ライブラリが読み込まれているか確認し、なければ読み込む
 * 複数のURL（ローカルパス、CDN）をフォールバックしながら試行する
 */
async function ensurePoseLoaded() {
    // 既に読み込まれていれば true
    if (window.Pose || (window.pose && window.pose.Pose)) return true;

    // 試行するURLリスト
    const urls = [
        'mediapipe/pose/pose.js', // ローカルパス1
        'pose.js', // ローカルパス2
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/pose.js', // CDN1
        'https://unpkg.com/@mediapipe/pose@0.5.1675469242/pose.js' // CDN2
    ];

    for (const u of urls) { // リストを順番に試行
        try {
            if (socketStatus) { socketStatus.textContent = 'LOADING POSE...'; }
            // 8秒のタイムアウト付きでスクリプト読み込み
            await withTimeout(loadScript(u), 8000);
        } catch(_) { 
            continue; // 失敗したら次のURLへ
        }
        // 読み込み成功後、グローバルに Pose が定義されたか確認
        if (window.Pose || (window.pose && window.pose.Pose)) return true;
    }

    // すべてのURLで失敗した場合
    if (socketStatus) { socketStatus.textContent = 'POSE NOT FOUND'; }
    return false;
}

/**
 * MediaPipe Pose のインスタンスを初期化する
 */
async function initPose() {
    if (pose) return true; // 既に初期化済み
    const ok = await ensurePoseLoaded(); // ライブラリ読み込み確認
    if (!ok) return false; // 読み込み失敗

    const PoseClass = window.Pose || (window.pose && window.pose.Pose); // グローバルからPoseクラスを取得
    // .wasm などの関連ファイルの読み込みパスを設定
    const base = (window._mpPoseBase !== undefined) ? window._mpPoseBase : 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/';
    
    pose = new PoseClass({ locateFile: (file) => `${base}${file}` });
    
    // MediaPipe Pose のオプション設定
    pose.setOptions({
        selfieMode: true, // 左右反転モード (自撮り風)
        modelComplexity: 1, // モデルの複雑さ (0: fast, 1: default, 2: heavy)
        smoothLandmarks: true, // ランドマークを平滑化
        enableSegmentation: false, // セグメンテーション（背景除去）は不要
        minDetectionConfidence: 0.5, // 検出の信頼度しきい値
        minTrackingConfidence: 0.5 // 追跡の信頼度しきい値
    });

    // ポーズ推定結果が返ってきたときのコールバック
    pose.onResults((results) => {
        // ランドマークが取得できた場合
        if (results && results.poseLandmarks) {
            // 戦闘力を計算
            const stats = computeCombatStatsFromLandmarks(results.poseLandmarks);
            // UIを更新
            updateStats(stats);
        }

        // ポーズ推定結果に関わらず、カメラ映像をCanvasに描画する
        try {
            const ctx = canvasEl.getContext('2d');
            ctx.clearRect(0,0,canvasEl.width,canvasEl.height); // キャンバスをクリア
            if (videoEl && videoEl.videoWidth) {
                // ビデオの解像度にCanvasの解像度を合わせる
                if (canvasEl.width !== videoEl.videoWidth) canvasEl.width = videoEl.videoWidth;
                if (canvasEl.height !== videoEl.videoHeight) canvasEl.height = videoEl.videoHeight;
                // ビデオ映像をCanvasに描画 (これがスナップショットの元になる)
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            }
        } catch(e){}
    });
    return true;
}

/**
 * Webカメラを起動する
 */
async function openCamera() {
    try {
        const constraints = { video: true }; // ビデオのみ使用
        const stream = await navigator.mediaDevices.getUserMedia(constraints); // カメラアクセス許可を要求
        videoEl.srcObject = stream; // <video> タグにストリームを接続
        await videoEl.play(); // ビデオ再生開始
        if (socketStatus) { socketStatus.textContent = 'CAMERA READY'; }

        // ポーズ推定(pose.send)が始まる前も、ビデオ映像だけはCanvasに描画し続ける
        const startRender = () => {
            try {
                const w = videoEl.videoWidth || 640;
                const h = videoEl.videoHeight || 360;
                if (canvasEl.width !== w) canvasEl.width = w;
                if (canvasEl.height !== h) canvasEl.height = h;
                const ctx = canvasEl.getContext('2d');
                ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            } catch(e){}
            videoRenderRAF = requestAnimationFrame(startRender); // 次のフレームで再描画
        };
        startRender();

    } catch (err) {
        if (socketStatus) socketStatus.textContent = 'カメラ取得失敗';
    }
}

/**
 * ポーズ推定のループを開始する
 */
async function startPoseLoop() {
    const ok = await initPose(); // Poseライブラリの初期化
    if (!ok) {
        if (socketStatus) socketStatus.textContent = 'POSE NOT FOUND';
        return;
    }
    // 既に動いているビデオ描画ループ(videoRenderRAF)は停止
    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);

    // 毎フレーム、ビデオ映像を MediaPipe Pose に送信するループ
    const run = async () => {
        try {
            // poseインスタンスがあり、ビデオが再生準備完了(readyState >= 2)なら
            if (pose && videoEl && videoEl.readyState >= 2) {
                await pose.send({ image: videoEl }); // ビデオフレームを送信
            }
        } catch(e){}
        poseRenderRAF = requestAnimationFrame(run); // 次のフレームで再度実行
    };
    run(); // ループ開始
}

/**
 * カメラとポーズ推定をすべて停止する
 */
function stopAll() {
    // カメラストリームを停止
    if (videoEl && videoEl.srcObject) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
    }
    // 全ての requestAnimationFrame ループを停止
    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);
    if (poseRenderRAF) cancelAnimationFrame(poseRenderRAF);
    // Poseインスタンスを破棄
    if (pose) { 
        try { pose.close(); } catch(e){} 
        pose = null; 
    }
}

// --- イベントハンドラ ---

// STARTボタン: 10秒タイマーを開始し、完了後に名前入力モーダルを表示
btnStart && btnStart.addEventListener('click', () => {
    btnStart.disabled = true; // ボタンを無効化
    btnStart.textContent = 'MEASURING...';

    // ルーレット効果音（index.html と同じロジック）
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

    // 10秒後に実行
    measureTimeout = setTimeout(() => {
        try {
            // 10秒経過時点の <canvas> の内容を画像(jpeg)として取得
            const dataUrl = canvasEl.toDataURL('image/jpeg');
            lastSnapshotDataUrl = dataUrl; // グローバル変数に保存
            // 10秒経過時点の戦闘力(lastCombatStats)は、updateStats関数によって既にグローバル変数に保存されている
        } catch(e){}
        
        // 名前入力モーダルを表示
        nameModal.classList.remove('hidden');
        inputPlayerName.value = '';
        inputPlayerName.focus();
        // STARTボタンを再度有効化（キャンセルされた時用）
        btnStart.disabled = false;
        btnStart.textContent = 'START';
    }, 10000); // 10秒
});

// EXITボタン: すべて停止して index.html に戻る
btnExit && btnExit.addEventListener('click', () => {
    stopAll(); // カメラ等を停止
    window.location.href = 'index.html'; // メインページに戻る
});

// --- 保存API (サーバーへの送信) ---
/**
 * 測定結果をサーバー (/api/save_score) に送信する
 * @param {object} combatStats - 戦闘力データ
 * @param {string} imageDataUrl - スナップショット画像 (Data URL)
 * @param {string} name - プレイヤー名
 * @returns {Promise<object|null>} サーバーからの応答JSON、またはエラー時 null
 */
async function saveResultToDB(combatStats, imageDataUrl, name = 'PLAYER') {
    try {
        const res = await fetch('/api/save_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                score: combatStats && combatStats.total_power ? combatStats.total_power : 0,
                image: imageDataUrl // 画像データも一緒に送信
            })
        });
        const json = await res.json();
        // 保存成功時、プレビュー画像（あれば）を表示
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

// --- 名前入力モーダルの処理 (OK / Cancel) ---

// OKボタン: 2P対戦フローの核心
btnNameOk && btnNameOk.addEventListener('click', async () => {
    const name = inputPlayerName.value.trim() || 'PLAYER'; // 名前を取得
    nameModal.classList.add('hidden'); // モーダルを閉じる

    // データをサーバーに保存（ランキング登録）
    const saveJson = await saveResultToDB(lastCombatStats || { total_power: POWER_CONSTANTS.baseline }, lastSnapshotDataUrl || '', name);

    // --- 2人測定モード (2pmeasure) の判定 ---
    let bs = {}; // battleState
    try { 
        // index.html から引き継いだ sessionStorage を読み込む
        bs = JSON.parse(sessionStorage.getItem('battleState') || '{}'); 
    } catch(e){}
    
    const q = getQueryParams(); // URLから ?player=1 などを取得
    const playerNum = q.player ? Number(q.player) : 1; // 自分がP1かP2か

    // 2P対戦モードの場合
    if (bs && bs.mode === '2pmeasure') {
        // サーバーに保存された画像パス (src/...) があればそれ、なければDataURL
        const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;

        // --- P1 の測定が完了した場合 ---
        // (ステップが202 (P1測定中) AND 自分がP1)
        if (bs.step === 202 && playerNum === 1) {
            // P1のデータを battleState に保存
            bs.player1 = {
                name: name || 'PLAYER1',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: savedImgPath
            };
            bs.step = 203; // ステップを「P2測定中」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            
            // P2 の測定へ移動 (ページをリロードしてP2にする)
            window.location.href = 'measurement.html?player=2';
            return; // 処理終了
        }
        
        // --- P2 の測定が完了した場合 ---
        // (ステップが203 (P2測定中) AND 自分がP2)
        if (bs.step === 203 && playerNum === 2) {
            // P2のデータを battleState に保存
            bs.player2 = {
                name: name || 'PLAYER2',
                score: (lastCombatStats && lastCombatStats.total_power) || 0,
                image: (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl
            };
            bs.step = 204; // ステップを「両者測定完了」に進める
            // sessionStorage を更新
            sessionStorage.setItem('battleState', JSON.stringify(bs));
            
            // index.html に戻る (戻った先で index.html の復帰処理が走り、バトル画面が表示される)
            window.location.href = 'index.html';
            return; // 処理終了
        }
    
    } else {
        // 1P（単独）測定の場合: ランキングページへ遷移
        window.location.href = 'ranking.html';
    }
});

// Cancelボタン: モーダルを閉じるだけ
btnNameCancel && btnNameCancel.addEventListener('click', () => {
    nameModal.classList.add('hidden');
});

// --- 初期化処理 ---
// ページ読み込み完了時にカメラ起動とポーズ推定ループを開始
window.addEventListener('DOMContentLoaded', async () => {
    await openCamera(); // カメラ起動
    await startPoseLoop(); // ポーズ推定ループ開始
});

// --- グローバル公開 ---
// index.html (script.js) など他スクリプトからこのページの関数を呼び出せるように、
// window オブジェクトに関数を"エクスポート"（代入）する
// (重複定義を避けるためのラッパー関数などで使われる)
try { window.computeCombatStatsFromLandmarks = computeCombatStatsFromLandmarks; } catch(e){}
try { window.updateStats = updateStats; } catch(e){}
try { window.ensurePoseLoaded = ensurePoseLoaded; } catch(e){}
try { window.initPose = initPose; } catch(e){}
try { window.openCamera = openCamera; } catch(e){}
try { window.startPoseLoop = startPoseLoop; } catch(e){}
try { window.stopMeasurement = stopAll; } catch(e){} // エイリアス名 (script.js からの呼び出しを想定)
try { window.stopAll = stopAll; } catch(e){} // 既存名も公開
try { window.saveResultToDB = saveResultToDB; } catch(e){}
// このページ単体でテスト・実行するための簡易関数
try { window.startMeasurementPage = async function(playerNum){ await openCamera(); await startPoseLoop(); }; } catch(e){}