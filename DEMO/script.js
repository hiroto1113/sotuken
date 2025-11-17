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

    // --- 測定結果（2人）から戻ってきたときの復帰処理 ---
    // ページ読み込み時に sessionStorage を確認し、両者のデータが揃っていればバトル画面へ遷移して表示します。
    try {
        const raw = sessionStorage.getItem('battleState');
        if (raw) {
            const bs = JSON.parse(raw);
            if (bs && bs.mode === '2pmeasure' && bs.step === 204 && bs.player1 && bs.player2) {
                // 表示用にデータを整えてバトル画面を表示
                const p1 = bs.player1;
                const p2 = bs.player2;
                showScreen('battle');
                showBattleScreen({
                    image: p1.image || 'img/player1.jpg',
                    name: p1.name || 'PLAYER1',
                    score: p1.score || 0,
                    maxScore: p1.score || 0
                }, {
                    image: p2.image || 'img/player2.jpg',
                    name: p2.name || 'PLAYER2',
                    score: p2.score || 0,
                    maxScore: p2.score || 0
                });
                // 使い終わったらクリア
                sessionStorage.removeItem('battleState');
            }
        }
    } catch(e){}
});

// --- ここから測定関連の大きな実装を measurement.js に分離しました ---
// 以前このファイルにあった showMeasurementUI / initPose / computeCombatStats などは measurement.js に移動しています。
// 代わりに簡易なリダイレクト処理を実装します。

function showMeasurementUI(playerNum) {
    // 測定画面を同一ページで表示する代わりに measurement.html を開く
    try {
        // 保存することで measurement.html でモードを参照可能にする
        const bs = window.battleState || { mode: null, step: 0 };
        sessionStorage.setItem('battleState', JSON.stringify(bs));
        window.location.href = `measurement.html?player=${encodeURIComponent(playerNum || 1)}`;
    } catch (e) {
        window.location.href = `measurement.html?player=${encodeURIComponent(playerNum || 1)}`;
    }
}

function startMeasurement(playerNum) {
    // 同上
    showMeasurementUI(playerNum);
}

// 2人測定フローを開始する場合は sessionStorage に状態を書き込んで遷移
async function startMeasurementFlow() {
    // 2人測定モードを明示
    battleState.mode = '2pmeasure';
    battleState.step = 202; // P1計測中
    // 保存して measurement.html へ
    try {
        sessionStorage.setItem('battleState', JSON.stringify(battleState));
    } catch(e){}
    window.location.href = 'measurement.html?player=1';
}

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
                // 単独測定時はランキングページへ遷移（ranking.html を読み込み）
                try {
                    if (saveJson && saveJson.success) {
                        // 保存成功 → ランキングページへ遷移
                        window.location.href = 'ranking.html';
                    } else {
                        // 保存失敗でもランキングを表示する（必要ならエラーメッセージを出してから遷移）
                        window.location.href = 'ranking.html';
                    }
                } catch (e) {
                    // 例外時も遷移を試みる
                    window.location.href = 'ranking.html';
                }
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
    if ((p1.score || 0) > (p2.score || 0)) msg = `Winner: ${p1.name}`;
    else if ((p1.score || 0) < (p2.score || 0)) msg = `Winner ${p2.name}`;
    else msg = 'Drrow！';
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
    rankingList.innerHTML = '<div class="text-center text-gray-400">ローディング...</div>';
    try {
    const res = await fetch('/api/get_ranking');
        const data = await res.json();
        rankingData = Array.isArray(data) ? data : [];
        rankingPage = 0;
        renderRankingPage();
    } catch (e) {
        rankingList.innerHTML = '<div class="text-center text-red-400">ランキング 失敗</div>';
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