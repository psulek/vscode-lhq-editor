import * as vscode from 'vscode';
import { LhqTreeDataProvider } from './treeDataProvider';
import { findCulture, logger, showMessageBox } from './utils';
import { appContext } from './context';
import { HtmlPageMessage, IMessageSender } from './types';
import debounce from 'lodash.debounce';
import { CategoryLikeTreeElementToJsonOptions, ITreeElement } from '@lhq/lhq-generators';
import { isVirtualTreeElement } from './elements';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider, IMessageSender {
    public static readonly viewType = 'lhq.customEditor';

    private currentDocument: vscode.TextDocument | undefined;
    private currentWebviewPanel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) { }

    private onSelectionChanged(): void {
        logger().log('debug', 'LhqEditorProvider.onSelectionChanged called');
        this.reflectSelectedElementToWebview();
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {

        logger().log('debug', `LhqEditorProvider.resolveCustomTextEditor for: ${document.fileName}`);
        this.currentDocument = document;
        this.currentWebviewPanel = webviewPanel;

        this.treeDataProvider.setMessageSender(this);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
            ]
        };

        const debouncedOnSelectionChanged = debounce(this.onSelectionChanged.bind(this), 200, { leading: false, trailing: true });
        appContext.setSelectionChangedCallback(debouncedOnSelectionChanged);

        this.treeDataProvider.updateDocument(document);
        // await this.treeDataProvider.selectRootElement();
        // await this.updateWebviewContent(webviewPanel, document);
        await this.updateWebviewContent(webviewPanel, document, false);
        await this.treeDataProvider.selectRootElement();
        appContext.isEditorActive = true;

        const didReceiveMessageSubscription = webviewPanel.webview.onDidReceiveMessage(async message => {
            //debugger;
            switch (message.command) {
                case 'update':
                    try {
                        const element = message.data as Record<string, unknown>;
                        if (element) {
                            await this.treeDataProvider.updateElement(element);
                        }
                    } catch (e) {
                        logger().log('error', `LhqEditorProvider.onDidReceiveMessage: Error parsing element data: ${e}`);
                        return;
                    }
                    break;
            }
        });


        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async e => {
            logger().log('debug', `LhqEditorProvider.onDidChangeTextDocument for active editor: ${e.document?.fileName ?? '-'}`);
            if (e.document.uri.toString() === document.uri.toString() && document.fileName.endsWith('.lhq')) {
                this.currentDocument = e.document;
                const hasChanges = e.contentChanges?.length > 0;
                // this.treeDataProvider.updateDocument(e.document, hasChanges);
                this.treeDataProvider.updateDocument(e.document);

                if (hasChanges) {
                    // this.reflectSelectedElementToWebview();
                }
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
            didReceiveMessageSubscription.dispose();

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

    private async updateWebviewContent(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument,
        reflectSelection: boolean = true
    ): Promise<void> {
        if (!webviewPanel || !webviewPanel.webview || !document) { return; }
        logger().log('debug', `LhqEditorProvider.updateWebviewContent for: ${document.fileName ?? '-'}`);

        webviewPanel.webview.html = await this.getHtmlForWebview(webviewPanel.webview);

        if (reflectSelection) {
            this.reflectSelectedElementToWebview();
        }
    }

    // public reflectSelectedElementToWebview(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): void {
    public reflectSelectedElementToWebview(): void {
        if (!this.currentWebviewPanel || !this.currentWebviewPanel.webview || !this.currentDocument) { return; }

        const rootModel = this.treeDataProvider.currentRootModel!;
        // const element = (appContext.selectedElements.length > 0 ? appContext.selectedElements[0] : undefined) ?? rootModel;
        const element = appContext.selectedElements.length > 0 ? appContext.selectedElements[0] : undefined;

        if (element === undefined || isVirtualTreeElement(element)) {
            return;
        }

        const cultures = rootModel.languages.map(lang => findCulture(lang)).filter(c => !!c);
        const toJsonOptions: CategoryLikeTreeElementToJsonOptions = {
            includeCategories: false,
            includeResources: false
        };
        const message: HtmlPageMessage = {
            command: 'loadPage',
            file: this.currentDocument.fileName ?? '',
            cultures: cultures,
            primaryLang: rootModel.primaryLanguage,
            element: element.toJson(toJsonOptions),
        };

        // this.currentWebviewPanel.webview.postMessage(message);
        this.sendMessage(message);
    }

    public sendMessage(message: HtmlPageMessage): void {
        if (this.currentWebviewPanel && this.currentWebviewPanel.webview) {
            logger().log('debug', `LhqEditorProvider.sendMessage: ${message.command} ...`);
            this.currentWebviewPanel.webview.postMessage(message);
        }
    }

    private async getHtmlForWebview(webview: vscode.Webview): Promise<string> {
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
