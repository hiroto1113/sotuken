<?php
// --- レスポンスをJSON形式に設定 ---
header('Content-Type: application/json');
// --- データベースファイル名 ---
$db_file = 'database.sqlite';
$is_new_db = !file_exists($db_file);

try {
    // --- SQLiteデータベースに接続 ---
    // PDO (PHP Data Objects) を使うことで、安全にデータベースを操作できます。
    $pdo = new PDO('sqlite:' . $db_file);
    // エラー発生時に例外をスローするように設定
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // --- もしデータベースが新規作成された場合、テーブルを作成する ---
    if ($is_new_db) {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS ranking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score INTEGER NOT NULL,
                image TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
    }

    // If DB already existed, ensure 'image' column exists
    if (!$is_new_db) {
        $cols = $pdo->query("PRAGMA table_info('ranking')")->fetchAll(PDO::FETCH_ASSOC);
        $hasImage = false;
        foreach ($cols as $c) {
            if (isset($c['name']) && $c['name'] === 'image') { $hasImage = true; break; }
        }
        if (!$hasImage) {
            try {
                $pdo->exec("ALTER TABLE ranking ADD COLUMN image TEXT");
            } catch (PDOException $e) {
                // ignore if cannot alter (older SQLite?)
            }
        }
    }

} catch (PDOException $e) {
    // 接続失敗時はエラーメッセージをJSONで返して終了
    http_response_code(500); // Internal Server Error
    echo json_encode(['error' => 'データベースに接続できませんでした: ' . $e->getMessage()]);
    exit();
}

// --- リクエストの種類を判断 ---
// GETリクエストの場合はURLのパラメータから、POSTの場合はリクエストボディからactionを取得
$action = $_GET['action'] ?? '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json_data = file_get_contents('php://input');
    $post_data = json_decode($json_data);
    $action = $post_data->action ?? '';
}

// --- アクションに応じて処理を分岐 ---
switch ($action) {
    case 'save_score':
        saveScore($pdo, $post_data);
        break;
    case 'delete_score':
        deleteScore($pdo, $post_data);
        break;
    case 'get_ranking':
        getRanking($pdo);
        break;
    default:
        http_response_code(400); // Bad Request
        echo json_encode(['error' => '無効なアクションです。']);
        break;
}

/**
 * スコアをデータベースに保存する関数
 */
function saveScore($pdo, $data) {
    // nameとscoreが空でないかチェック
    if (empty($data->name) || !isset($data->score)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => '名前またはスコアがありません。']);
        return;
    }

    // 画像があればデコードして src に保存（ファイル名は入力された name を元に png として保存）
    $imageFilename = null;
    if (!empty($data->image) && strpos($data->image, 'data:') === 0) {
        $parts = explode(',', $data->image, 2);
        if (count($parts) === 2) {
            $meta = $parts[0];
            $b64 = $parts[1];
            $decoded = base64_decode($b64);
            if ($decoded !== false) {
                // sanitize provided name to safe filename base
                $rawName = trim($data->name ?? 'player');
                // remove directory separators, null bytes, and other problematic chars
                $rawName = str_replace(["\0", "\\", "/"], '', $rawName);
                // remove control characters
                $rawName = preg_replace('/[\x00-\x1F\x7F]/u', '', $rawName);
                // allow letters, numbers, underscores, hyphens and unicode (including Japanese). Replace other problematic punctuation with underscore
                $base = preg_replace('/[\p{P}\p{S}]+/u', '_', $rawName);
                $base = trim($base, " _-\t\n\r");
                if ($base === '') $base = 'player';
                // limit byte length to avoid filesystem issues (e.g., 200 bytes)
                $base = mb_strcut($base, 0, 200, 'UTF-8');

                $targetDir = __DIR__ . DIRECTORY_SEPARATOR . 'src';
                if (!is_dir($targetDir)) mkdir($targetDir, 0755, true);

                // target filename: <base>.png, but avoid overwrite by adding suffix
                $candidate = $base . '.png';
                $i = 0;
                while (file_exists($targetDir . DIRECTORY_SEPARATOR . $candidate)) {
                    $i++;
                    $candidate = $base . '_' . $i . '.png';
                    // safety limit
                    if ($i > 1000) break;
                }
                $filePath = $targetDir . DIRECTORY_SEPARATOR . $candidate;

                // Try to convert to PNG using GD if available
                $saved = false;
                if (function_exists('imagecreatefromstring') && function_exists('imagepng')) {
                    $img = @imagecreatefromstring($decoded);
                    if ($img !== false) {
                        // ensure correct PNG saved
                        imagepng($img, $filePath);
                        imagedestroy($img);
                        $saved = true;
                    }
                }
                // fallback: write raw bytes
                if (!$saved) {
                    file_put_contents($filePath, $decoded);
                }
                $imageFilename = $candidate;
            }
        }
    }

    // SQLインジェクションを防ぐため、プリペアドステートメントを使用
    $sql = "INSERT INTO ranking (name, score, image) VALUES (:name, :score, :image)";
    $stmt = $pdo->prepare($sql);

    // パラメータをバインドしてSQLを実行
    $stmt->bindValue(':name', htmlspecialchars($data->name, ENT_QUOTES, 'UTF-8'), PDO::PARAM_STR);
    $stmt->bindValue(':score', (int)$data->score, PDO::PARAM_INT);
    $stmt->bindValue(':image', $imageFilename, PDO::PARAM_STR);

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'message' => 'スコアを保存しました！', 'image' => $imageFilename]);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'スコアの保存に失敗しました。']);
    }
}

/**
 * ランキングデータをデータベースから取得する関数
 */
function getRanking($pdo) {
    // スコアの高い順に上位10件を取得
    $sql = "SELECT id, name, score, image FROM ranking ORDER BY score DESC LIMIT 10";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    
    // 結果を連想配列として取得
    $ranking = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode($ranking);
}

/**
 * 指定された id のレコードと関連する画像ファイルを削除する
 */
function deleteScore($pdo, $data) {
    if (!isset($data->id)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'id が指定されていません']);
        return;
    }
    $id = (int)$data->id;
    // まず画像ファイル名を取得
    $stmt = $pdo->prepare("SELECT image FROM ranking WHERE id = :id");
    $stmt->bindValue(':id', $id, PDO::PARAM_INT);
    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $image = $row['image'] ?? null;

    // レコード削除
    $del = $pdo->prepare("DELETE FROM ranking WHERE id = :id");
    $del->bindValue(':id', $id, PDO::PARAM_INT);
    if ($del->execute()) {
        // 画像ファイルがあれば削除
        if ($image) {
            $path = __DIR__ . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . $image;
            if (file_exists($path)) {
                @unlink($path);
            }
        }
        echo json_encode(['success' => true, 'message' => '削除しました']);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => '削除に失敗しました']);
    }
}
?>