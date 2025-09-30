# LHQ Editor for Visual Studio Code

![][demo-1]


A `vscode` extension to show and edit LHQ files, a format for localizing software applications.


## Features

### WYSIWYG editor
LHQ files are displayed in a tree view with a WYSIWYG editor for each element.
![][demo-2]

### Code generation
LHQ files can be used to generate code in various programming languages.
![][demo-3]

> Currently only C#/.NET related code generators are built-in.

### Light & dark theme support (autodetect)
The theme (light or dark) is automatically detected from the VS Code theme.
![][demo-4]

## Commands

Commands can be accessed from the Command Palette (`Ctrl+Shift+P`), and some commands can be accessed from the context menu in the LHQ Tree View.

Commands available only when LHQ file is open in the editor:

| Command                         | Keybinding       | Description
| --------------------------------| ---------------- |--------------
| LHQ: Focus Tree View            | `F2`             | Focuses the LHQ Tree View, only when the lhq editor panel is active.
| LHQ: Focus Editor               | `Ctrl+Enter`     | Focuses the LHQ Editor, only when the lhq tree view is active.
| LHQ: Model Properties           | none             | Shows the model properties dialog for the current LHQ file.
| LHQ: Add element                | none             | Shows the 'Add Element' dialog to add a new category or resource to the current LHQ file.
| LHQ: Add language               | `Insert`         | Shows the 'Add Language' dialog to add a new language to the current LHQ file.
| LHQ: Add category               | `Ctrl+Insert`    | Shows the 'Add Category' dialog to add a new category to the current category.
| LHQ: Add resource               | `Insert`         | Shows the 'Add Resource' dialog to add a new resource to the current category.
| LHQ: Rename element             | `Ctrl+R`         | Renames the name of the currently selected element (category or resource).
| LHQ: Delete element(s)          | `Delete`         | Deletes the currently selected element (category or resource).
| LHQ: Duplicate element          | `Ctrl+D`         | Duplicates the currently selected element (category or resource).
| LHQ: Delete language(s)         | `Delete`         | Deletes the currently selected language.
| LHQ: Find in Tree               | `Ctr+F`          | Shows a simple 'Find in Tree' input box to search for text in the tree view.
| LHQ: Advanced Find              | `Ctr+Alt+F`      | Shows the 'Advanced Find' dialog to search for text in the tree view with more options.
| LHQ: Mark language as primary   | none             | Marks the currently selected language as the primary language.
| LHQ: Run code generator         | none             | Runs the associated code generator for the current LHQ file.
| LHQ: Import resources from file | none             | Imports translations from an Excel file.
| LHQ: Export resources to file   | none             | Exports resources to a file. Currently, only Microsoft Excel (*.xlsx) is supported.

Commands available anytime from Command Palette (`Ctrl+Shift+P`):

| Command                         | Keybinding       | Description
| --------------------------------| ---------------- |--------------
| LHQ: Create strings localization file | none | Creates a new LHQ file with a selected code generator template and 'English' as the primary language.


## Install

1. Open the **Extensions** sidebar panel in Visual Studio Code (**View → Extensions**).
1. Search for `lhq-editor`.
1. Click **Install**.
1. Click **Reload**, if required.

### Marketplace
Marketplace extension page - [LHQ Editor][marketplace_ext]


## Configuration

This extension contributes the following settings:

| Setting                       | Description                                                | Default | Values           |
| ------------------------------| -----------------------------------------------------------| ------- | ---------------- |
| lhqeditor.runGeneratorOnSave  | Runs the associated code generator after a `*.lhq` file is saved. | `true`  | `true` / `false` |

## Release Notes
[Take a look at the CHANGELOG][changelog] to see the details of all changes.

### 1.0.0

Initial release of `LHQ Editor` extension

<!-- Links -->
[changelog]: https://github.com/psulek/vscode-lhq-editor/blob/main/CHANGELOG.md
[marketplace_ext]: https://marketplace.visualstudio.com/items?itemName=psulek-solo.lhq-editor

<!-- Demo images -->
[demo-1]: https://github.com/psulek/vscode-lhq-editor/blob/main/docs/demo/demo1.gif?raw=true
[demo-2]: https://github.com/psulek/vscode-lhq-editor/blob/main/docs/demo/demo2.gif?raw=true
[demo-3]: https://github.com/psulek/vscode-lhq-editor/blob/main/docs/demo/demo3.gif?raw=true
[demo-4]: https://github.com/psulek/vscode-lhq-editor/blob/main/docs/demo/demo4.gif?raw=true