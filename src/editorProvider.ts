import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'lhq.customEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) { }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        console.log("LhqEditorProvider.resolveCustomTextEditor for:", document.fileName);

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        this.updateWebviewContent(webviewPanel, document);
        this.treeDataProvider.lhqEditorEnabled = true;
        this.treeDataProvider.updateDocument(document);

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            console.log("LhqEditorProvider.onDidChangeTextDocument for active editor:", e.document?.fileName ?? '-');
            if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
                this.updateWebviewContent(webviewPanel, e.document);
                this.treeDataProvider.updateDocument(e.document);
            }
        });

        // Listen to view state changes for this specific webview panel
        const viewStateSubscription = webviewPanel.onDidChangeViewState(e => {
            const changedPanel = e.webviewPanel;
            console.log(`LhqEditorProvider.onDidChangeViewState for ${document.fileName}. Active: ${changedPanel.active}, Visible: ${changedPanel.visible}`);

            if (changedPanel.active && document.fileName.endsWith('.lhq')) {
                // This specific webview panel became active
                console.log(`LhqEditorProvider.onDidChangeViewState for ${document.fileName} became active. Updating tree and context.`);
                this.treeDataProvider.updateDocument(document);
            }
            //  else if (!changedPanel.active && this.treeDataProvider.currentDocument?.uri.toString() === document.uri.toString()) {
            //     // This specific webview panel is no longer active.
            //     // The global onDidChangeActiveTextEditor in LhqTreeDataProvider should ideally handle
            //     // switching to another editor or clearing the tree if no editor is active.
            //     // However, if you want to be more direct when *this* panel loses focus:
            //     console.log(`  Panel for ${document.fileName} is no longer active.`);
            //     // You might want to check if another .lhq editor became active before disabling the context.
            //     // For now, let's rely on the LhqTreeDataProvider's onActiveEditorChanged to manage this globally.
            //     // If LhqTreeDataProvider.onActiveEditorChanged doesn't update correctly,
            //     // you might need to add logic here to inform it, e.g., by calling:
            //     // setTimeout(() => this.treeDataProvider.onActiveEditorChanged(vscode.window.activeTextEditor), 0);
            // }
        });

        webviewPanel.onDidDispose(() => {
            console.log("LhqEditorProvider.onDidDispose for:", document?.fileName ?? '-');
            changeDocumentSubscription.dispose();
            viewStateSubscription.dispose();

            //if (this.treeDataProvider.isSameDocument(document)) {
            setTimeout(() => {
                if (this.treeDataProvider.hasActiveDocument() && !this.treeDataProvider.isSameDocument(document)) {
                    console.log("LhqEditorProvider.onDidDispose: No active document or same document. Nothing to do.");
                } else {
                    console.log("LhqEditorProvider.onDidDispose: Triggering treeDataProvider.updateDocument");
                    this.treeDataProvider.updateDocument(vscode.window.activeTextEditor?.document);
                }

            }, 100);
            //}
        });
    }

    private updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
        const jsonContent = document.getText();
        webviewPanel.webview.html = this.getHtmlForWebview(jsonContent);
        console.log("LhqEditorProvider.updateWebviewContent for:", document.fileName ?? '-');
    }

    private getHtmlForWebview(content: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" width="device-width, initial-scale=1.0">
    <title>LHQ Editor</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        pre { background-color: #f4f4f4; padding: 10px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>
    <h1>LHQ File Content</h1>
    <p>This is a custom editor for .lhq files.</p>
    <pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    <script>
        // You can add scripts here to interact with the webview content
        // or communicate with the extension.
        // const vscode = acquireVsCodeApi();
        // vscode.postMessage({ command: 'alert', text: 'Webview loaded!' });
    </script>
</body>
</html>`;
    }
}
