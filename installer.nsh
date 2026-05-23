; HyperClip NSIS Post-Install Script
;
; IMPORTANT: All user data (workspaces, channels, downloads, renders) lives in:
;   D:\HyperClip-Data\ (or E:/F: depending on largest free space)
; This is OUTSIDE the install directory — safe from uninstall/upgrade.
;
; NSIS only manages: shortcuts + uninstaller entry.

!macro customInstall
  ; No-op: electron-builder handles running-instance detection automatically.
  ; Data dir is managed by the app at D:\HyperClip-Data\ on first launch.
!macroend

!macro customUnInstall
  ; Shortcuts only — data at D:\HyperClip-Data\ is untouched by uninstall.
  Delete "$DESKTOP\HyperClip.lnk"
  RMDir /r "$SMPROGRAMS\HyperClip"
!macroend

; ─── Auto-update support ──────────────────────────────────────────────────────────
; When electron-builder detects a running app, it generates code to:
; 1. Ask user to close the app
; 2. Wait up to 60 seconds for graceful shutdown
; 3. Force-kill if user ignores
; This ensures quitAll() in main.ts gets called → FFmpeg workers cancelled cleanly.
