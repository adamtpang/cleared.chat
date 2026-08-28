; Windows Search can treat a dotted app name as a filename extension. Keep a
; second dot-free shortcut so searching for "Cleared Chat" always finds it.
;
; Both shortcuts point at the same executable.

!macro customInstall
  CreateShortCut "$SMPROGRAMS\Cleared Chat.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Daily WhatsApp inbox triage"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Cleared Chat.lnk"
!macroend
