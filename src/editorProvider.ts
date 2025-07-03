import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';
import { logger, showMessageBox, treeElementToObject } from './utils';
import { appContext } from './context';
import { HtmlPageMessage } from './types';

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
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
            ]
        };

        this.treeDataProvider.updateDocument(document);
        await this.updateWebviewContent(webviewPanel, document);
        appContext.isEditorActive = true;
        // this.treeDataProvider.updateDocument(document);

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async e => {
            logger().log('debug', `LhqEditorProvider.onDidChangeTextDocument for active editor: ${e.document?.fileName ?? '-'}`);
            if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
                this.treeDataProvider.updateDocument(e.document, e.contentChanges?.length > 0);
                await this.updateWebviewContent(webviewPanel, e.document);
                //this.treeDataProvider.updateDocument(e.document, e.contentChanges?.length > 0);
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

        const willSaveTextSubscription = vscode.workspace.onWillSaveTextDocument(async (event: vscode.TextDocumentWillSaveEvent) => {
            if (event.document.uri.toString() === document.uri.toString()) {
                const validationError = this.treeDataProvider.lastValidationError;

                if (validationError) {
                    await showMessageBox('warn', validationError.message, { detail: validationError.detail, modal: true });

                    // event.waitUntil(
                    //     new Promise<vscode.TextEdit[]>((_resolve, reject) => {
                    //         throw new Error(validationError.message);
                    //         //reject(new Error(validationError.message));
                    //     })
                    // );

                } else {
                    //event.waitUntil(Promise.resolve([] as vscode.TextEdit[]));
                }
            }
        });

        webviewPanel.onDidDispose(() => {
            logger().log('debug', `LhqEditorProvider.onDidDispose for: ${document?.fileName ?? '-'}`);
            changeDocumentSubscription.dispose();
            viewStateSubscription.dispose();
            willSaveTextSubscription.dispose();

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

    private async updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
        if (!webviewPanel || !webviewPanel.webview) { return; }

        //const jsonContent = document.getText();
        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview);
        const element = (appContext.selectedElements.length > 0 ? appContext.selectedElements[0] : undefined) ?? this.treeDataProvider.currentRootModel;
        const message: HtmlPageMessage = {
            command: 'loadPage',
            file: document.fileName,
            element: treeElementToObject(element!),
        };
        webviewPanel.webview.postMessage(message);
        logger().log('debug', `LhqEditorProvider.updateWebviewContent for: ${document.fileName ?? '-'}`);

        //console.log(replacedHtml);

    }

    private async getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        // const pageHtmlUri = appContext.getMediaUri(webview, 'page.html');
        const pageHtmlUri = appContext.getFileUri('media', 'page.html');
        const pageHtmlRaw = await vscode.workspace.fs.readFile(pageHtmlUri);
        let pageHtml = new TextDecoder().decode(pageHtmlRaw);

        const regex = /<script\s+nonce="([^"]*)"\s+src="([^"]*)"[^>]*><\/script>/g;

        const nonce = appContext.getNonce();
        pageHtml = pageHtml.replace(regex, (match, _, src) => {
            const newSrc = appContext.getMediaUri(webview, src);
            return `<script nonce="${nonce}" src="${newSrc}"></script>`;
        });

        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src vscode-resource:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`;
        pageHtml = pageHtml.replace('<!-- <meta http-equiv="Content-Security-Policy" content=""> -->', csp);

        const pagejs = appContext.getMediaUri(webview, 'page.js');
        const pageimport = `<script nonce="${nonce}" src="${pagejs}"></script>`;
        pageHtml = pageHtml.replace(`<script src="page.js"></script>`, pageimport);

        const regex_css = /<link\s+href="([^"]*)"\s+rel="stylesheet"[^>]*>/g;

        pageHtml = pageHtml.replace(regex_css, (match, href) => {
            const newHref = appContext.getMediaUri(webview, href);
            return `<link href="${newHref}" rel="stylesheet">`;
        });

        return pageHtml;


        //         return `<!DOCTYPE html>
        // <html lang="en">
        // <head>
        //     <meta charset="UTF-8">
        //     <meta name="viewport" width="device-width, initial-scale=1.0">
        //     <title>LHQ Editor</title>
        //     <style>
        //         body { font-family: sans-serif; padding: 20px; }
        //         pre { background-color: #f4f4f4; padding: 10px; border: 1px solid #ddd; white-space: pre-wrap; word-wrap: break-word; }
        //     </style>
        // </head>
        // <body>
        //     <h1>LHQ File Content</h1>
        //     <p>This is a custom editor for .lhq files.</p>
        //     <pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        //     <script>
        //         // You can add scripts here to interact with the webview content
        //         // or communicate with the extension.
        //         // const vscode = acquireVsCodeApi();
        //         // vscode.postMessage({ command: 'alert', text: 'Webview loaded!' });
        //     </script>
        // </body>
        // </html>`;
    }
}
