<?php
// Demo/music-list.php: music 配下の音声ファイル一覧を返す
header('Content-Type: application/json; charset=utf-8');
$dir = __DIR__ . DIRECTORY_SEPARATOR . 'music';
$list = [];
if (is_dir($dir)) {
    $files = scandir($dir);
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $path = $dir . DIRECTORY_SEPARATOR . $f;
        if (is_file($path) && preg_match('/\.(mp3|ogg|wav)$/i', $f)) {
            $list[] = $f;
        }
    }
}
echo json_encode([ 'files' => $list ]);
