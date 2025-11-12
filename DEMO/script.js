// バトル進行用の状態
let battleState = {
    mode: null,
    step: 0,
    player1: {},
    player2: {}
};

// 画面切り替え（共通）
function showScreen(screenName) {
    // すべて非表示
    document.querySelectorAll('.screen').forEach(sc => sc.classList.add('hidden'));
    // 対象を表示
    const el = document.getElementById('screen-' + screenName);
    if (el) el.classList.remove('hidden');
}

// ランキング削除（インラインonclick対応）
async function deleteRankingEntry(id) {
    if (!confirm('このデータ を けす？ なまえ と え が きえるよ。')) return;
    try {
        const res = await fetch('/api/delete_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
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
try { window.deleteRankingEntry = deleteRankingEntry; } catch(e) {}
// expose to global so inline onclick works when this file is loaded as module
try { window.deleteRankingEntry = deleteRankingEntry; } catch(e) {}

// 初期画面表示とボタンイベント再バインド
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
    // スタート画面ボタンイベントバインド（onclickで毎回上書き）
    const btnGotoInstructions = document.getElementById('btn-goto-instructions');
    if (btnGotoInstructions) {
        btnGotoInstructions.onclick = () => showScreen('instructions');
    }
    const btnGotoRanking = document.getElementById('btn-goto-ranking');
    if (btnGotoRanking) {
        btnGotoRanking.onclick = () => showScreen('ranking');
    }
    const btnGoto2P = document.getElementById('btn-goto-2pmeasure');
    if (btnGoto2P) {
        btnGoto2P.onclick = () => showScreen('2pmeasure');
    }
    // BGM 初期化
    setupBGM();
    // 効果音のフォールバック初期化（sfx/ が無い場合はルート直下を使用）
    initSfxFallback();

    // --- グローバルクリック委譲（他画面のボタン反応を保証） ---
    document.addEventListener('click', (ev) => {
        const target = ev.target.closest('button, a');
        if (!target) return;
        switch (target.id) {
            case 'btn-back-to-title-1': // instructions -> title
            case 'btn-back-to-title-3': // ranking -> title
                showScreen('title');
                break;
            case 'btn-goto-gender': // instructions -> gender
                showScreen('gender');
                break;
            case 'btn-back-to-instructions': // gender -> instructions
                showScreen('instructions');
                break;
            case 'btn-2pmeasure-start': // 2人測定開始
                try { startMeasurementFlow(); } catch (e) { showScreen('measurement'); }
                break;
            case 'btn-2pmeasure-exit': // 2人測定やめる
                showScreen('title');
                break;
        }
        // 性別選択（gender-btn）
        if (target.classList && target.classList.contains('gender-btn')) {
            // 選択した性別をグローバルに記録
            try { window._selectedGender = target.dataset.gender || 'male'; } catch(e) {}
            // 必要なら選択値: target.dataset.gender
            showScreen('measurement');
            // 単独測定開始（1P）
            try { showMeasurementUI(1); } catch(e) {}
        }
    });
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
            const saveJson = await saveResultToDB(lastCombatStats, lastSnapshotDataUrl, name);
            btnStartMeasure.disabled = false;
            btnStartMeasure.textContent = 'START';
            // 2人測定モード進行
            if (battleState.mode === '2pmeasure') {
                const savedImgPath = (saveJson && saveJson.success && saveJson.image) ? `src/${saveJson.image}` : lastSnapshotDataUrl;
                if (battleState.step === 202) {
                    // P1終了→P2へ
                    battleState.player1 = {
                        name: name || 'PLAYER1',
                        score: (window._latestCombatStats && window._latestCombatStats.total_power) || 0,
                        image: savedImgPath
                    };
                    battleState.step = 203;
                    setTimeout(() => { showScreen('measurement'); startMeasurement(2); }, 400);
                    return;
                }
                if (battleState.step === 203) {
                    // P2終了→バトルへ
                    battleState.player2 = {
                        name: name || 'PLAYER2',
                        score: (window._latestCombatStats && window._latestCombatStats.total_power) || 0,
                        image: savedImgPath
                    };
                    const p1 = battleState.player1.score || 0;
                    const p2 = battleState.player2.score || 0;
                    showScreen('battle');
                    showBattleScreen({
                        image: battleState.player1.image || 'img/player1.jpg',
                        name: battleState.player1.name || 'PLAYER1',
                        score: p1,
                        maxScore: p1
                    }, {
                        image: battleState.player2.image || 'img/player2.jpg',
                        name: battleState.player2.name || 'PLAYER2',
                        score: p2,
                        maxScore: p2
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
        // 既存onclickは消さず、効果音だけaddEventListenerで追加
        btn.removeEventListener('click', playButtonSE); // 重複防止
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

    fetch('/api/music-list')
        .then(r => r.json())
        .then(json => {
            if (!json || !Array.isArray(json.files)) return;
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
        .catch(() => {});

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

// ===== バトル画面ロジック（スタートボタン→連打開始） =====
function showBattleScreen(player1, player2) {
    // 初期化
    let timeLimit = 10; // 秒
    let timer = timeLimit;
    let phase = 1; // 1:1P連打, 2:2P連打, 3:結果
    let clickCount1 = 0;
    let clickCount2 = 0;
    let intervalId = null;
    let isBattleActive = false;
    // UI初期化
    document.getElementById('battle-img1').src = player1.image;
    document.getElementById('battle-img2').src = player2.image;
    document.getElementById('battle-name1').textContent = player1.name;
    document.getElementById('battle-name2').textContent = player2.name;
    document.getElementById('battle-score1').textContent = `${player1.score}/${player1.maxScore}`;
    document.getElementById('battle-score2').textContent = `${player2.score}/${player2.maxScore}`;
    document.getElementById('battle-gauge1').style.width = '100%';
    document.getElementById('battle-gauge2').style.width = '100%';
    document.getElementById('battle-timer').textContent = `00:${String(timeLimit).padStart(2,'0')}`;
    document.getElementById('battle-instruct').textContent = 'バトル開始ボタンを押してください';
    document.getElementById('battle-mouse').classList.add('hidden');
    document.getElementById('battle-start-btn').classList.remove('hidden');
    // スタートボタン
    document.getElementById('battle-start-btn').onclick = () => {
        document.getElementById('battle-start-btn').classList.add('hidden');
        document.getElementById('battle-mouse').classList.remove('hidden');
        document.getElementById('battle-instruct').textContent = '1Pは連打！';
        isBattleActive = true;
        phase = 1;
        timer = timeLimit;
        document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;
        intervalId = setInterval(() => {
            timer--;
            document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;
            if (timer <= 0) {
                clearInterval(intervalId);
                isBattleActive = false;
                document.getElementById('battle-mouse').classList.add('hidden');
                if (phase === 1) {
                    // 2P連打へ
                    phase = 2;
                    timer = timeLimit;
                    document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;
                    document.getElementById('battle-instruct').textContent = '2Pは連打！';
                    document.getElementById('battle-mouse').classList.remove('hidden');
                    isBattleActive = true;
                    intervalId = setInterval(() => {
                        timer--;
                        document.getElementById('battle-timer').textContent = `00:${String(timer).padStart(2,'0')}`;
                        if (timer <= 0) {
                            clearInterval(intervalId);
                            isBattleActive = false;
                            document.getElementById('battle-mouse').classList.add('hidden');
                            // 勝敗判定
                            let damage1 = clickCount2 * 1000;
                            let damage2 = clickCount1 * 1000;
                            let final1 = Math.max(0, player1.score - damage1);
                            let final2 = Math.max(0, player2.score - damage2);
                            document.getElementById('battle-score1').textContent = `${final1}/${player1.maxScore}`;
                            document.getElementById('battle-score2').textContent = `${final2}/${player2.maxScore}`;
                            document.getElementById('battle-gauge1').style.width = `${final1/player1.maxScore*100}%`;
                            document.getElementById('battle-gauge2').style.width = `${final2/player2.maxScore*100}%`;
                            if (final1 > final2) {
                                document.getElementById('battle-instruct').textContent = '1Pの勝ち！';
                            } else if (final2 > final1) {
                                document.getElementById('battle-instruct').textContent = '2Pの勝ち！';
                            } else {
                                document.getElementById('battle-instruct').textContent = '引き分け！';
                            }
                        }
                    }, 1000);
                }
            }
        }, 1000);
    };
    // クリックイベント
    document.getElementById('battle-mouse').onclick = function() {
        if (!isBattleActive) return;
        if (phase === 1) {
            clickCount1++;
        } else if (phase === 2) {
            clickCount2++;
        }
    };
    // exitボタン
    document.getElementById('battle-exit').onclick = () => {
        clearInterval(intervalId);
        showScreen('title');
    };
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
let rankingData = [];
let rankingPage = 0;
const RANKING_PAGE_SIZE = 5;

async function fetchAndShowRanking() {
    // 矢印ボタンのイベントを毎回再バインド
    setTimeout(() => {
        const btnPrev = document.getElementById('ranking-prev');
        const btnNext = document.getElementById('ranking-next');
        if (btnPrev) {
            btnPrev.onclick = () => {
                if (rankingPage > 0) {
                    rankingPage--;
                    renderRankingPage();
                }
            };
        }
        if (btnNext) {
            btnNext.onclick = () => {
                if ((rankingPage + 1) * RANKING_PAGE_SIZE < rankingData.length) {
                    rankingPage++;
                    renderRankingPage();
                }
            };
        }
    }, 100);
    const rankingList = document.getElementById('ranking-list');
    if (!rankingList) return;
    rankingList.innerHTML = '<div class="text-center text-gray-400">ろーでぃんぐ...</div>';
    try {
    const res = await fetch('/api/get_ranking');
        const data = await res.json();
        rankingData = Array.isArray(data) ? data : [];
        rankingPage = 0;
        renderRankingPage();
    } catch (e) {
        rankingList.innerHTML = '<div class="text-center text-red-400">らんきんぐ しっぱい</div>';
    }
}

function renderRankingPage() {
    const rankingList = document.getElementById('ranking-list');
    if (!rankingList) return;
    const btnPrev = document.getElementById('ranking-prev');
    const btnNext = document.getElementById('ranking-next');
    const start = rankingPage * RANKING_PAGE_SIZE;
    const end = start + RANKING_PAGE_SIZE;
    const pageData = rankingData.slice(start, end);
    if (pageData.length > 0) {
        rankingList.innerHTML = pageData.map((row, i) =>
            `<div class="ranking-row" data-id="${row.id}">
                <span class="ranking-rank">${start + i + 1}</span>
                ${row.image ? `<img class="ranking-thumb" src="src/${encodeURIComponent(row.image)}" alt="thumb" style="cursor:pointer" onclick="showImageModal('src/${encodeURIComponent(row.image)}')">` : `<div class="ranking-thumb"></div>`}
                <span class="ranking-name">${row.name}</span>
                <span class="ranking-score">${row.score.toLocaleString()}</span>
                <div class="ranking-delete"><button type="button" class="btn btn-danger" data-id="${row.id}" onclick="deleteRankingEntry(${row.id})">Delete</button></div>
            </div>`
        ).join('');
        // バツボタンのイベントを毎回バインド
        setTimeout(() => {
            const closeBtn = document.getElementById('image-modal-close');
            const modal = document.getElementById('image-modal');
            if (closeBtn && modal) {
                closeBtn.onclick = function(e) {
                    e.stopPropagation();
                    modal.style.display = 'none';
                };
            }
        }, 100);
    } else {
        rankingList.innerHTML = '<div class="text-center text-gray-400">まだ ないよ</div>';
    }
    if (btnPrev) btnPrev.disabled = rankingPage === 0;
    if (btnNext) btnNext.disabled = (rankingPage + 1) * RANKING_PAGE_SIZE >= rankingData.length;
    // ナビゲーションのclass切り替え
    const nav = document.querySelector('.ranking-nav');
    if (nav) {
        if (rankingPage === 0) {
            nav.classList.add('page-1');
        } else {
            nav.classList.remove('page-1');
        }
    }
}

// ===== 本番用測定フロー（カメラ→API→結果） =====
function startMeasurement(playerNum) {
    // 測定画面UIを表示
    showMeasurementUI(playerNum);
}

let currentMeasureStream = null;

function showMeasurementUI(playerNum) {
    // 測定画面UIを表示（SCAUTERデザイン）
    showScreen('measurement');
    // DOM生成を待ってから初期化処理
    setTimeout(() => {
        const videoEl = measurementElements.video;
        const canvasEl = measurementElements.canvas;
        // 前回のstreamがあれば停止
        if (currentMeasureStream) {
            try { currentMeasureStream.getTracks().forEach(t => t.stop()); } catch(e){}
            currentMeasureStream = null;
        }
        // カメラ起動
        const getCameras = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                return devices.filter(d => d.kind === 'videoinput');
            } catch(e) { return []; }
        };
        const openCamera = async (deviceId) => {
            const errBox = document.getElementById('measure-error');
            if (errBox) errBox.textContent = '';
            const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (location.protocol !== 'https:' && !isLocalhost) {
                if (errBox) errBox.textContent = 'httpsでアクセスしてください（localhostはOK）';
                return;
            }
            try {
                const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: true };
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                videoEl.srcObject = stream;
                currentMeasureStream = stream;
                try {
                    measurementElements.socketStatus.textContent = 'CAMERA READY';
                    measurementElements.socketStatus.className = 'text-green-400';
                } catch(e) {}
                // 再生開始
                try { await videoEl.play(); } catch(e) {}
                // キャンバスにビデオを描画（常時）
                const canvas = measurementElements.canvas;
                const startRender = () => {
                    if (!canvas || !videoEl) return;
                    const w = videoEl.videoWidth || 640;
                    const h = videoEl.videoHeight || 360;
                    if (canvas.width !== w) canvas.width = w;
                    if (canvas.height !== h) canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    const loop = () => {
                        if (!videoEl.srcObject) return; // 停止されたら終了
                        try { ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height); } catch(e) {}
                        videoRenderRAF = requestAnimationFrame(loop);
                    };
                    if (videoRenderRAF) cancelAnimationFrame(videoRenderRAF);
                    videoRenderRAF = requestAnimationFrame(loop);
                };
                if (videoEl.readyState >= 2) startRender();
                else videoEl.onloadedmetadata = startRender;

                // MediaPipe Pose で戦闘力をリアルタイム算出（動的ロード＋フォールバック）
                const poseOk = await initPoseIfNeeded();
                if (poseOk) {
                    const runPose = async () => {
                        if (!videoEl || !videoEl.srcObject) return; // 停止で終了
                        try {
                            if (pose && videoEl.readyState >= 2) {
                                await pose.send({ image: videoEl });
                            }
                        } catch (e) { /* ignore per-frame errors */ }
                        poseRenderRAF = requestAnimationFrame(runPose);
                    };
                    if (poseRenderRAF) cancelAnimationFrame(poseRenderRAF);
                    poseRenderRAF = requestAnimationFrame(runPose);
                } else {
                    // フォールバック: ポーズ無しでもベースラインを表示
                    try {
                        measurementElements.socketStatus.textContent = 'POSE NOT FOUND';
                        measurementElements.socketStatus.className = 'text-yellow-400';
                    } catch(e) {}
                    const tick = () => {
                        const stats = {
                            base_power: 0,
                            pose_bonus: 0,
                            expression_bonus: 0,
                            speed_bonus: 0,
                            total_power: POWER_CONSTANTS.baseline,
                            height: 0, reach: 0, shoulder: 0, expression: 0, pose: 0
                        };
                        updateStats(stats);
                    };
                    if (_fallbackStatsTimer) clearInterval(_fallbackStatsTimer);
                    _fallbackStatsTimer = setInterval(tick, 300);
                    tick();
                }
            } catch (err) {
                if (errBox) errBox.textContent = 'カメラ取得失敗: ' + (err.message || err.name);
            }
        };
        // カメラ一覧→オープン
        getCameras().then(cams => {
            if (cams.length) {
                openCamera(cams[0].deviceId);
            } else {
                const errBox = document.getElementById('measure-error');
                if (errBox) errBox.textContent = 'カメラが見つかりません';
            }
        });
        // WebSocket接続
        if (!window._measureSocket || window._measureSocket.readyState !== 1) {
            const wsProto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
            const host = location.hostname; // 現在アクセスしているホストを利用
            const port = 8765; // Nodeサーバーポート
            window._measureSocket = new WebSocket(`${wsProto}${host}:${port}`);
        }
        let ws = window._measureSocket;
        ws.onopen = () => {
            measurementElements.socketStatus.textContent = 'READY (SERVER)';
            measurementElements.socketStatus.className = 'text-green-400';
        };
        ws.onerror = () => {
            measurementElements.socketStatus.textContent = 'ERROR';
            measurementElements.socketStatus.className = 'text-red-500';
        };
        ws.onclose = () => {
            measurementElements.socketStatus.textContent = 'DISCONNECTED';
            measurementElements.socketStatus.className = 'text-yellow-400';
        };
        ws.onmessage = (event) => {
            try {
                // ...既存のメッセージ処理...
            } catch(e) {}
        };
        // STARTボタン
        const btnStart = document.getElementById('btn-start-measure');
        if (btnStart) {
            btnStart.removeEventListener('click', handleStartMeasure);
            btnStart.addEventListener('click', handleStartMeasure);
        }
        function handleStartMeasure() {
            // 測定開始処理（例: WebSocketで画像送信や測定開始）
            if (videoEl && ws && ws.readyState === 1) {
                measurementElements.socketStatus.textContent = 'MEASURING...';
                // ここに測定処理を追加
            }
        }
        // EXITボタン
        const btnExit = document.getElementById('btn-back-to-title-2');
        if (btnExit) {
            btnExit.removeEventListener('click', handleExitMeasure);
            btnExit.addEventListener('click', handleExitMeasure);
        }
        function handleExitMeasure() {
            stopMeasurement();
            showScreen('title');
        }
    }, 50);
}


// getUserMediaエラー説明
function explainGetUserMediaError(err) {
    if (!err) return '不明なエラーです。カメラ権限やデバイス接続を確認してください。';
    const name = err.name || '';
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'カメラの利用がブロックされました。ブラウザのURLバー付近のカメラアイコンから許可してください。';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'カメラデバイスが見つかりません。Webカメラ接続や他アプリの使用状況を確認してください。';
        case 'NotReadableError':
            return 'カメラを使用できません。他のアプリが使用中の可能性があります。';
        case 'OverconstrainedError':
            return '指定した解像度などの条件に合うカメラがありません。別の条件で再試行してください。';
        default:
            return `カメラ起動に失敗しました (${name}). 設定や接続を確認し、再試行してください。`;
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
        const res = await fetch('/api/save_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
// スコア設計（100k〜500k）
const POWER_CONSTANTS = {
    baseline: 100000,
    maxTotal: 500000,
    // クリップ
    clipFeature: 1.6,   // s', r', l' の上限
    clipSpeed: 2.0,     // v の上限（h正規化済）
    // 混合比（合計1.0）
    weightBase: 0.60,
    weightStyle: 0.25,
    weightMotion: 0.15,
    // style 内訳
    weightPoseInStyle: 0.60,
    weightExprInStyle: 0.40,
    // base 内訳（合計1.0）
    weightReachInBase: 0.40,
    weightShoulderInBase: 0.35,
    weightLegInBase: 0.25,
    // 性別係数
    genderMultiplier: { male: 1.00, female: 1.09 },
    // 平滑化
    speedAlpha: 0.4
};

let pose = null;
let lastPoseResults = null;
let _prevForSpeed = null; // 直前ランドマーク
let _prevTimeMs = null;   // 直前時刻
let _speedEma = 0;        // 速度EMA

async function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
}

function withTimeout(promise, ms, urlForMsg = '') {
    let to;
    const timeout = new Promise((_, reject) => {
        to = setTimeout(() => reject(new Error('Timeout loading ' + urlForMsg)), ms);
    });
    return Promise.race([
        promise.finally(() => clearTimeout(to)),
        timeout
    ]);
}

async function ensurePoseLoaded() {
    if (window.Pose || (window.pose && window.pose.Pose)) return true;
    const urls = [
        // まずローカル配置を優先（オフライン/学内ネット対策）
        'mediapipe/pose/pose.js',
        'pose.js',
        // 次にCDN（オンライン時）
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/pose.js',
        'https://unpkg.com/@mediapipe/pose@0.5.1675469242/pose.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
        'https://unpkg.com/@mediapipe/pose/pose.js'
    ];
    for (const u of urls) {
        try {
            if (measurementElements && measurementElements.socketStatus) {
                measurementElements.socketStatus.textContent = 'LOADING POSE... (' + u + ')';
                measurementElements.socketStatus.className = 'text-yellow-400';
            }
            await withTimeout(loadScript(u), 8000, u);
        } catch(_) { continue; }
        // ローカルに置いた場合はアセット参照先ベースを設定
        try {
            if (u.indexOf('mediapipe/pose/pose.js') !== -1) {
                window._mpPoseBase = 'mediapipe/pose/';
            } else if (u === 'pose.js') {
                window._mpPoseBase = '';
            }
        } catch(e) {}
        if (window.Pose || (window.pose && window.pose.Pose)) return true;
    }
    // すべて失敗
    try {
        measurementElements.socketStatus.textContent = 'POSE NOT FOUND';
        measurementElements.socketStatus.className = 'text-yellow-400';
        console.warn('[POSE] all sources failed. Place pose.js under Demo/mediapipe/pose/ or check network.');
    } catch(e) {}
    return false;
}

async function initPoseIfNeeded() {
    if (pose) return true;
    try {
        const ok = await ensurePoseLoaded();
        if (!ok) { console.warn('MediaPipe Pose class not found on window'); return false; }
        const PoseClass = window.Pose || (window.pose && window.pose.Pose);
        const base = (typeof window !== 'undefined' && window._mpPoseBase !== undefined)
            ? window._mpPoseBase
            : 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/';
        pose = new PoseClass({
            locateFile: (file) => `${base}${file}`
        });
        pose.setOptions({
            selfieMode: true,
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        try {
            measurementElements.socketStatus.textContent = 'POSE INITIALIZED';
            measurementElements.socketStatus.className = 'text-green-400';
        } catch(e) {}
        pose.onResults((results) => {
            lastPoseResults = results;
            drawLandmarksOnCanvas(results);
            if (results && results.poseLandmarks) {
                const stats = computeCombatStatsFromLandmarks(results.poseLandmarks);
                updateStats(stats);
                try {
                    measurementElements.socketStatus.textContent = 'POSE READY';
                    measurementElements.socketStatus.className = 'text-green-400';
                } catch(e) {}
            }
        });
        return true;
    } catch (e) {
        console.warn('Failed to init MediaPipe Pose:', e);
        return false;
    }
}

// JSのみで処理するため、クライアント描画を有効化
let useClientLandmark = true; // trueでクライアント描画
let poseFailsafeTimer = null;
let videoRenderRAF = null;
let poseRenderRAF = null;
let _fallbackStatsTimer = null; // Pose不在時のベース表示用
// 表示モード: 'server' = サーバー画像, 'client' = クライアント映像（骨格なし）
let displayMode = 'client';
// 完全JS運用フラグ（WebSocketを使わない）
const JS_ONLY = false; // サーバー連携で測定
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

// JS側スコア計算（100k〜500k、性別ブースト適用）
function computeCombatStatsFromLandmarks(lm) {
    // lm: Array of {x,y,z,visibility}
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

    // メトリクス抽出
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

    // 正規化（サイズ依存を減らしつつ、今回は身長自体はスコアに直接使わない）
    const eps = 1e-6;
    const h = Math.max(height, eps);
    const maxF = POWER_CONSTANTS.clipFeature;
    const rN = clip01((reach / h) / maxF);     // 0..1
    const sN = clip01((shoulder / h) / maxF);  // 0..1
    const lN = clip01(((leg / h) / 2) / maxF); // 0..1 （左右平均相当）

    // ポーズ・表情（簡易）
    const spineMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const poseVal = v2(top, spineMid); // 0..おおむね0.5程度
    const poseN = clip01(poseVal / 0.5); // 正規化
    const face = lm.slice(0, 5).map(p => [p.x, p.y]).flat();
    const exprN = clip01(std(face) / 0.05); // ざっくり正規化

    // 速度 v（EMA）
    const now = performance && performance.now ? performance.now() : Date.now();
    let vRaw = 0;
    if (_prevForSpeed && _prevTimeMs) {
        const dt = Math.max(1, now - _prevTimeMs) / 1000; // 秒
        const idx = [0,11,12,13,14,15,16,23,24,25,26,27,28]; // 主要点
        const dists = idx.map(i => v2(lm[i], _prevForSpeed[i] || lm[i]));
        const avg = mean(dists);
        vRaw = avg / (h * dt); // 身長・時間で正規化
    }
    _prevForSpeed = lm.map(p => ({ x: p.x, y: p.y }));
    _prevTimeMs = now;
    const vClip = POWER_CONSTANTS.clipSpeed;
    const vN = clip01(vRaw / vClip);
    _speedEma = POWER_CONSTANTS.speedAlpha * vN + (1 - POWER_CONSTANTS.speedAlpha) * _speedEma;

    // 合成（0..1）
    const baseRaw = (
        POWER_CONSTANTS.weightReachInBase * Math.pow(rN, 0.90) +
        POWER_CONSTANTS.weightShoulderInBase * Math.pow(sN, 0.85) +
        POWER_CONSTANTS.weightLegInBase * Math.pow(lN, 0.80)
    ); // 0..1 近似
    const styleRaw = (
        POWER_CONSTANTS.weightPoseInStyle * poseN +
        POWER_CONSTANTS.weightExprInStyle * exprN
    ); // 0..1
    const motionRaw = _speedEma; // 0..1

    let combined = (
        POWER_CONSTANTS.weightBase * baseRaw +
        POWER_CONSTANTS.weightStyle * styleRaw +
        POWER_CONSTANTS.weightMotion * motionRaw
    ); // 0..1

    // 性別ブースト
    let gender = (window && window._selectedGender) ? window._selectedGender : 'male';
    const gmul = POWER_CONSTANTS.genderMultiplier[gender] || 1.0;
    combined = Math.min(1, combined * gmul);

    // スコアへマップ
    const span = POWER_CONSTANTS.maxTotal - POWER_CONSTANTS.baseline; // 400k
    // 各成分をスコア寄与に変換（合計が span を超えないように）
    let base_amount = span * POWER_CONSTANTS.weightBase * baseRaw;
    let pose_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightPoseInStyle * poseN;
    let expr_amount = span * POWER_CONSTANTS.weightStyle * POWER_CONSTANTS.weightExprInStyle * exprN;
    let speed_amount = span * POWER_CONSTANTS.weightMotion * motionRaw;
    // 性別ブーストを各成分に適用
    base_amount *= gmul; pose_amount *= gmul; expr_amount *= gmul; speed_amount *= gmul;
    // 合算し、上限を超える場合はスケール
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
    if (poseRenderRAF) { cancelAnimationFrame(poseRenderRAF); poseRenderRAF = null; }
    if (_fallbackStatsTimer) { clearInterval(_fallbackStatsTimer); _fallbackStatsTimer = null; }
    if (mpCamera) { try { mpCamera.stop(); } catch(e){} mpCamera = null; }
    if (pose) { pose.close(); pose = null; }
}

async function startMeasurementFlow() {
    // 1P測定開始
    measuredPower1 = null;
    measuredPower2 = null;
    measuredName1 = '1P';
    measuredName2 = '2P';
    // 2人測定モードを明示
    battleState.mode = '2pmeasure';
    battleState.step = 202; // P1計測中
    showScreen('measurement');
    startMeasurement(1);
}

// ===== 測定値グローバル変数定義 =====
let measuredPower1 = null;
let measuredPower2 = null;
let measuredName1 = '';
let measuredName2 = '';
let measuredImg1 = 'img/player1.jpg';
let measuredImg2 = 'img/player2.jpg';

// ===== グローバル公開 =====
try { window.startMeasurementFlow = startMeasurementFlow; } catch(e) {}

// 初期画面表示
window.addEventListener('DOMContentLoaded', () => {
    showScreen('title');
});