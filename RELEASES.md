# Release Notes

## Version 2025.3

- New UI editors
  - New `LHQ Editor` extension for `Visual Studio Code`
  - Added `Visual Studio 2026` support for `LHQ Editor` Visual Studio extension
- All UI Editors now:
  - LHQ Editor extension for `Visual Studio 2022 / 2026`
  - LHQ Editor app (Windows desktop app)
  - LHQ Editor for `VS Code`
- CLI tools
  - File `lhqcmd.exe` can be found in installation folder of **LHQ Editor App** (Windows Desktop app only)
  - NPM package `lhq-generators`
- Sanitize strings from invalid unicode characters on save
  - Added new model setting `Sanitize unsupported unicode characters`
  - This will sanitize translations on save (non-breaking spaces will be replaced with space and unsupported characters will be removed.)
- Read more about [LHQ applications](https://github.com/psulek/lhqeditor/wiki/LHQ-Editor-Applications)

## Version 2025.2

- New **modern generator** is now default generator for both v1 & v2 model versions
  - This means no T4 templates are used now for code generator
- Added upgrade hints when opened `v1` model
- Added new code generator template settings:
  - Line endings (LF or CRLF)
  - Encoding file with BOM
- Added new NET8 console app project template
- Contains **LHQ EditorApp**, an windows standalone application, which can run & generate code without VS IDE.
- Contains CLI tool **lhqcmd.exe** to generate code form `*.lhq` files from command line
  - Can be found in installation folder of **LHQ EditorApp**
  - In version `2025.1` this CLI tool was called **LHQ.Gen.Cmd.exe** , now its renamed to simpler **lhqcmd.exe** 

## Version 2025.1

- Added new feature 'Mark for export' on resources in tree
  - New 'Export marked...' from tree
- Added new standalone code generator (when LHQ.App.exe is run outside of VS)
- Added new CLI app (`LHQ.Gen.Cmd.exe`) to generate code from lhq files without VS extension / or UI App