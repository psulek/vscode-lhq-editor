import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';
import { logger, setEditorActive } from './utils';

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

        logger().log('debug', `LhqEditorProvider.resolveCustomTextEditor for: ${document.fileName}`);

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        this.updateWebviewContent(webviewPanel, document);
        setEditorActive(true);
        this.treeDataProvider.updateDocument(document);

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            logger().log('debug', `LhqEditorProvider.onDidChangeTextDocument for active editor: ${e.document?.fileName ?? '-'}`);
            if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
                this.updateWebviewContent(webviewPanel, e.document);
                this.treeDataProvider.updateDocument(e.document);
            }
        });

        const viewStateSubscription = webviewPanel.onDidChangeViewState(e => {
            const changedPanel = e.webviewPanel;
            logger().log('debug', `LhqEditorProvider.onDidChangeViewState for ${document.fileName}. Active: ${changedPanel.active}, Visible: ${changedPanel.visible}`);

            if (changedPanel.active && document.fileName.endsWith('.lhq')) {
                // This specific webview panel became active
                logger().log('debug', `LhqEditorProvider.onDidChangeViewState for ${document.fileName} became active. Updating tree and context.`);
                this.treeDataProvider.updateDocument(document);
            }
        });

        webviewPanel.onDidDispose(() => {
            logger().log('debug', `LhqEditorProvider.onDidDispose for: ${document?.fileName ?? '-'}`);
            changeDocumentSubscription.dispose();
            viewStateSubscription.dispose();

            // delayed a little..
            setTimeout(() => {
                if (this.treeDataProvider.hasActiveDocument() && !this.treeDataProvider.isSameDocument(document)) {
                    logger().log('debug', "LhqEditorProvider.onDidDispose: No active document or same document. Nothing to do.");
                } else {
                    logger().log('debug', "LhqEditorProvider.onDidDispose: Triggering treeDataProvider.updateDocument");
                    this.treeDataProvider.updateDocument(vscode.window.activeTextEditor?.document);
                }

            }, 100);
        });
    }

    private updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
        const jsonContent = document.getText();
        webviewPanel.webview.html = this.getHtmlForWebview(jsonContent);
        logger().log('debug', `LhqEditorProvider.updateWebviewContent for: ${document.fileName ?? '-'}`);
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
