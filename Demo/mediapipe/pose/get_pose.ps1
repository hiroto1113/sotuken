# Downloads MediaPipe Pose script locally into this folder.
param()

$ErrorActionPreference = 'Stop'
$base = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469242/'
$targetDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Downloading pose.js to" $targetDir

# Ensure directory exists
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

# Files required by MediaPipe Pose (JS + assets)
$files = @(
    'pose.js',
    'pose_solution_packed_assets_loader.js',
    'pose_solution_packed_assets.data',
    'pose_solution_simd_wasm_bin.wasm',
    'pose_solution_wasm_bin.js',
    'pose_solution_simd_wasm_bin.js'
)

foreach ($f in $files) {
    $src = $base + $f
    $dst = Join-Path $targetDir $f
    Write-Host "GET  " $src
    try {
        Invoke-WebRequest -Uri $src -OutFile $dst -UseBasicParsing
    } catch {
        Write-Warning "Failed: $src"
    }
}

Write-Host "Done. If the app still shows POSE NOT FOUND, check for additional asset files (.wasm/.data) in the browser console and copy them from the npm package if needed."
