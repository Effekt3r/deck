; Deck — NSIS customisation (included by electron-builder)
!macro customHeader
  BrandingText "Deck · Effekt Studios"
!macroend

!macro customInstall
  ; Register "Open in Deck" on folders and folder backgrounds (current user)
  WriteRegStr HKCU "Software\Classes\Directory\shell\Deck" "" "Open in Deck"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Deck" "Icon" "$INSTDIR\Deck.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Deck\command" "" '"$INSTDIR\Deck.exe" --open "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Deck" "" "Open in Deck"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Deck" "Icon" "$INSTDIR\Deck.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Deck\command" "" '"$INSTDIR\Deck.exe" --open "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Deck"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Deck"
!macroend
