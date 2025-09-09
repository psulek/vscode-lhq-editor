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

Commands can be accessed from the Command Palette (`Ctrl+Shift+P`) and some commands can be accessed from context menu in the LHQ Tree View.

Commands available only when LHQ file is open in the editor:

| Command                         | Keybinding       | Description
| --------------------------------| ---------------- |--------------
| LHQ: Focus Tree View            | `F2`             | Focus the LHQ Tree View, only when lhq editor panel is active
| LHQ: Focus Editor               | `Ctrl+Enter`     | Focus the LHQ Editor, only when lhq tree view is active
| LHQ: Model Properties           | none             | Show model properties dialog for the current LHQ file
| LHQ: Add element                | none             | Shows 'Add Element' dialog to add new category or resource to current LHQ file
| LHQ: Add language               | `Insert`         | Shows 'Add Language' dialog to add new language to current LHQ file
| LHQ: Add category               | `Ctrl+Insert`    | Shows 'Add Category' dialog to add new category to current category
| LHQ: Add resource               | `Insert`         | Shows 'Add Resource' dialog to add new resource to current category
| LHQ: Rename element             | `Ctrl+R`         | Rename name of currently selected element (category or resource)
| LHQ: Delete element(s)          | `Delete`         | Delete currently selected element (category or resource)
| LHQ: Duplicate element          | `Ctrl+D`         | Duplicate currently selected element (category or resource)
| LHQ: Delete language(s)         | `Delete`         | Delete currently selected language
| LHQ: Find in Tree               | `Ctr+F`          | Shows simple 'Find in Tree' input box to search for text in the tree view
| LHQ: Advanced Find              | `Ctr+Alt+F`      | Shows 'Advanced Find' dialog to search for text in the tree view with more options
| LHQ: Mark language as primary   | none             | Mark currently selected language as primary language
| LHQ: Toggle languages (show)    | none             | Toggle/show all languages in the tree view
| LHQ: Toggle languages (hide)    | none             | Toggle/hide all languages in the tree view
| LHQ: Run code generator         | none             | Run associated code generator for the current LHQ file
| LHQ: Import resources from file | none             | Import translations from Excel file
| LHQ: Export resources to file   | none             | Export resources to a file (Currently only Microsoft Excel *.xlsx)

Commands available anytime from Command Palette (`Ctrl+Shift+P`):

| Command                         | Keybinding       | Description
| --------------------------------| ---------------- |--------------
| LHQ: Create strings localization file | none | Create a new LHQ file with selected code generator template and 'English' as the primary language


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