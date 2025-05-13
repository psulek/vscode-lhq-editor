import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'lhq.customEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) {

    }

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
            if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
                console.log("LhqEditorProvider.onDidChangeTextDocument for active editor:", e.document.fileName);
                this.updateWebviewContent(webviewPanel, e.document);
                this.treeDataProvider.updateDocument(e.document);
            }
        });

        webviewPanel.onDidDispose(() => {
            console.log("LhqEditorProvider.onDidDispose for:", document.fileName);
            changeDocumentSubscription.dispose();
            
            //if (this.treeDataProvider.isSameDocument(document)) {
                setTimeout(() => {
                    console.log("LhqEditorProvider.onDidDispose: Triggering treeDataProvider.onActiveEditorChanged");
                    this.treeDataProvider.onActiveEditorChanged(vscode.window.activeTextEditor);
                }, 100);
            //}
        });
    }

    private updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
        const jsonContent = document.getText();
        webviewPanel.webview.html = this.getHtmlForWebview(jsonContent);
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
