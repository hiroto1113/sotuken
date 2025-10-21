@echo off
setlocal
set "NODEDIR=%~dp0node"
if not exist "%NODEDIR%\package.json" (
  echo node\package.json が見つかりません。Demo\node に配置してください。
  pause
  goto :end
)

echo Starting POWER SCAN Node WS server...
start "POWER SCAN Node WS" cmd /c "cd /d "%NODEDIR%" && npm start"

:end
endlocal
