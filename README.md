# LHQ Editor for Visual Studio Code

![][demo-1]


A `vscode` extension to show and edit LHQ files, a format for localization and internationalization of software applications.


## Features

### WYSIWYG editor
LHQ files are shown in a tree view with a WYSIWYG editor for each element.
![][demo-2]

### Code generation
LHQ files can be used to generate code in various programming languages.
![][demo-3]

### Light & dark theme support (autodetect)
Theme (light or dark) is automatically detect from vscode theme.
![][demo-4]

## Commands

| Command                       | Keybinding       |
| ------------------------------| ---------------- |
| LHQ: Focus Tree View          | `F2`             |
| LHQ: Focus Editor             | `Ctrl + Enter`   |
| LHQ: Model Properties         | none             |
| LHQ: Add element              | none             |
| LHQ: Add language             | `Insert`         |
| LHQ: Add resource             | `Insert`         |
| LHQ: Add category             | `Ctrl + Insert`  |
| LHQ: Rename element           | `Ctrl + R`       |
| LHQ: Delete element           | `Delete`         |
| LHQ: Duplicate element        | `Ctrl + D`       |
| LHQ: Delete language          | `Delete`         |
| LHQ: Find in Tree             | `Ctr+F`          |
| LHQ: Advanced Find            | `Ctr +Alt + F`   |
| LHQ: Mark language as primary | none             |
| LHQ: Toggle languages (show)  | none             |
| LHQ: Toggle languages (hide)  | none             |
| LHQ: Run code generator       | none             |
| LHQ: Import from Excel        | none             |

## Install

1. Open **Extensions** sideBar panel in Visual Studio Code and choose the menu options for **View → Extensions**
1. Search for `lhq-editor`
1. Click **Install**
1. Click **Reload**, if required

### Marketplace
Marketplace extension page - [LHQ Editor][marketplace_ext]


## Configuration

This extension contributes the following settings:

| Setting                       | Description                                                | Default | Values           |
| ------------------------------| -----------------------------------------------------------| ------- | ---------------- |
| lhqeditor.runGeneratorOnSave  | Run associated code generator after `*.lhq` file is saved. | `true`  | `true` / `false` |

## Release Notes
[Have a look at CHANGELOG][changelog] to get the details of all changes.

### 1.0.0

Initial release of `LHQ Editor` extension

<!-- Links -->
[changelog]: https://github.com/psulek/vscode-lhq-editor/blob/main/CHANGELOG.md
[marketplace_ext]: https://marketplace.visualstudio.com/items?itemName=psulek-solo.lhq-editor

<!-- Demo images -->
[demo-1]: https://github.com/psulek/vscode-lhq-editor/blob/main/docs/demo/demo1.gif?raw=true