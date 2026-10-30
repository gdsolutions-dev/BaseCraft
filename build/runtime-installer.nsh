; BaseCraft Runtime (electron-builder.runtime.cjs: nsis.include). The Runtime has no fileAssociations: electron-builder's would
; always take .basecraft's default. It registers its own ProgID and lists it under "Open with"; it takes the default only when
; nobody holds it, so the full application (which always writes the default) keeps it whatever the install order.
; SHELL_CONTEXT, like electron-builder's own associations: HKCU for a per-user install, HKLM for all users.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\BaseCraftRuntime.basecraft" "" "BaseCraft database"
  WriteRegStr SHELL_CONTEXT "Software\Classes\BaseCraftRuntime.basecraft\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\BaseCraftRuntime.basecraft\shell\open\command" "" '"$appExe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.basecraft\OpenWithProgids" "BaseCraftRuntime.basecraft"
  ; The default in either hive: the full application may be installed for all users while the Runtime is per user.
  Push $R8
  Push $R9
  ReadRegStr $R8 HKCU "Software\Classes\.basecraft" ""
  ReadRegStr $R9 HKLM "Software\Classes\.basecraft" ""
  ${If} $R8 == ""
  ${OrIf} $R8 == "BaseCraftRuntime.basecraft"
    ${If} $R9 == ""
    ${OrIf} $R9 == "BaseCraftRuntime.basecraft"
      WriteRegStr SHELL_CONTEXT "Software\Classes\.basecraft" "" "BaseCraftRuntime.basecraft"
    ${EndIf}
  ${EndIf}
  Pop $R9
  Pop $R8
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)" ; SHCNE_ASSOCCHANGED
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\BaseCraftRuntime.basecraft"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.basecraft\OpenWithProgids" "BaseCraftRuntime.basecraft"
  Push $R8
  ReadRegStr $R8 SHELL_CONTEXT "Software\Classes\.basecraft" ""
  ${If} $R8 == "BaseCraftRuntime.basecraft"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.basecraft" ""
  ${EndIf}
  Pop $R8
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)" ; SHCNE_ASSOCCHANGED
!macroend
