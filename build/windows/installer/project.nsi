Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
# File names without spaces: hold-it-all.exe and hold-it-all-amd64-installer.exe.
!define INFO_PROJECTNAME "hold-it-all"
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_COMPONENTS # Lets the user opt in to file associations.
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
  !else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

# Listed in "Open with" for the supported types without becoming the default.
# Keep in sync with info.fileAssociations in wails.json.
!macro HIA_OPENWITH
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}" "FriendlyAppName" "${INFO_PRODUCTNAME}"
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXECUTABLE}" "%1"'
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".txt" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".log" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".md" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".markdown" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".json" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".yaml" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".yml" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".csv" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".tsv" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".pdf" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".png" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".jpg" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".jpeg" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".gif" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".webp" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".bmp" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".svg" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".docx" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".doc" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".xlsx" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".xls" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".zip" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".7z" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".rar" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".tar" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".gz" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".tgz" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".sha256" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".md5" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".html" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".htm" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".mp3" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".wav" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".flac" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".ogg" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".m4a" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".opus" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".mp4" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".mov" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".webm" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".mkv" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".glb" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".gltf" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".stl" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".obj" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".fbx" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".3mf" ""
    WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}\SupportedTypes" ".ply" ""
!macroend

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section "${INFO_PRODUCTNAME} (required)" SecApp
    SectionIn RO
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro HIA_OPENWITH
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller
SectionEnd

# Unchecked by default: making Hold It All the default app for text, Markdown,
# PDF, images, Office files and archives is the user's choice. Without it the
# app still appears in "Open with".
Section /o "Open supported files with ${INFO_PRODUCTNAME} by default" SecAssoc
    !insertmacro wails.setShellContext
    SetOutPath $INSTDIR
    !insertmacro wails.associateFiles
    # Marker: only undo associations on uninstall if we made them (the stock
    # macro would otherwise blank existing defaults).
    WriteRegStr SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}" "FileAssociations" "1"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)' # SHCNE_ASSOCCHANGED
SectionEnd

Section /o "Desktop shortcut" SecDesktop
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "The application."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecAssoc} "Make ${INFO_PRODUCTNAME} the default app for .md, .txt, .json, .csv, .pdf, images, Word/Excel files and archives. Previous defaults are restored on uninstall."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Put a shortcut on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    ReadRegStr $0 SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}" "FileAssociations"
    ${If} $0 == "1"
        !insertmacro wails.unassociateFiles
        System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
    ${EndIf}
    DeleteRegKey SHELL_CONTEXT "Software\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_EXECUTABLE}"
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
