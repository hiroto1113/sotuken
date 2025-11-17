// ランキング取得・表示・削除の最小モジュール

const rankingListEl = document.getElementById('ranking-list');

async function fetchAndShowRanking() {
	if (!rankingListEl) return;
	rankingListEl.innerHTML = '<div class="text-center text-gray-400">ろーでぃんぐ...</div>';
	try {
		const res = await fetch('/api/get_ranking');
		const data = await res.json();
		const rankingData = Array.isArray(data) ? data : [];
		renderRanking(rankingData);
	} catch (e) {
		rankingListEl.innerHTML = '<div class="text-center text-red-400">らんきんぐ しっぱい</div>';
	}
}

function renderRanking(rows) {
	if (!rankingListEl) return;
	if (!rows || rows.length === 0) {
		rankingListEl.innerHTML = '<div class="text-center text-gray-400">まだ ないよ</div>';
		return;
	}
	const html = rows.map((row, idx) => {
		// 画像が data URL かファイル名かに対応
		let imgHtml = '<div class="ranking-thumb"></div>';
		if (row.image) {
			const imgSrc = String(row.image).startsWith('data:') ? row.image : `src/${encodeURIComponent(row.image)}`;
			imgHtml = `<img class="ranking-thumb" src="${imgSrc}" alt="thumb" style="cursor:pointer">`;
		}
		const name = row.name || 'PLAYER';
		const score = (typeof row.score === 'number') ? row.score.toLocaleString() : (row.score || '0');
		return `<div class="ranking-row" data-id="${row.id}">
					<span class="ranking-rank">${idx + 1}</span>
					${imgHtml}
					<span class="ranking-name">${escapeHtml(name)}</span>
					<span class="ranking-score">${score}</span>
					<div class="ranking-delete"><button type="button" class="btn btn-danger" data-id="${row.id}" onclick="deleteRankingEntry(${row.id})">Delete</button></div>
				</div>`;
	}).join('');
	rankingListEl.innerHTML = html;
}

// 簡易 HTML エスケープ（名前表示に使用）
function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

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

// インライン onclick 用に公開
try { window.deleteRankingEntry = deleteRankingEntry; } catch(e) {}

// DOM 準備ができたら読み込み
window.addEventListener('DOMContentLoaded', () => {
	fetchAndShowRanking();
});
