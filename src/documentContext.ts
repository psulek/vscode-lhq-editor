import * as vscode from 'vscode';
import { findCulture, generateNonce, isValidDocument, logger, showMessageBox } from './utils';
import { AppToPageMessage, PageToAppMessage } from './types';
import { CategoryLikeTreeElementToJsonOptions, ITreeElement } from '@lhq/lhq-generators';
import { isVirtualTreeElement } from './elements';

export class DocumentContext /* implements IDocumentContext */ {
    private readonly _context: vscode.ExtensionContext;
    private readonly _document: vscode.TextDocument;
    private readonly _webviewPanel: vscode.WebviewPanel;// | undefined;
    private readonly _onDidDispose: () => void;
    private _selectedElements: ITreeElement[] = [];

    constructor(context: vscode.ExtensionContext, document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel,
        onDidDispose: () => void
    ) {
        if (!document) {
            logger().log('error', '[DocumentContext] Document is undefined or null.');
            throw new Error('Document is undefined or null.');
        }

        const fileName = document.fileName ?? '-';

        if (!isValidDocument(document)) {
            logger().log('error', `[DocumentContext] Invalid document: ${fileName}`);
            void showMessageBox('err', `Invalid document: ${fileName}`, { modal: true });
        }

        this._context = context;
        this._document = document;
        this._webviewPanel = webviewPanel;
        this._onDidDispose = onDidDispose;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                vscode.Uri.joinPath(context.extensionUri, 'dist'),
            ]
        };

        this.setupEvents();
    }

    private setupEvents(): void {
        const didReceiveMessageSubscription = this._webviewPanel!.webview.onDidReceiveMessage(async (message: PageToAppMessage) => {
            logger().log('debug', `[DocumentContext] webview.onDidReceiveMessage: ${message.command} for ${this.fileName}`);
            switch (message.command) {
                case 'update':
                    try {
                        const element = message.data;
                        if (element) {
                            await appContext.treeContext.updateElement(element);
                        }
                    } catch (e) {
                        logger().log('error', `[DocumentContext] webview.onDidReceiveMessage: Error parsing element data: ${e}`);
                        return;
                    }
                    break;
                case 'select':
                    try {
                        await appContext.treeContext.selectElementByPath(message.elementType, message.paths);
                    } catch (e) {
                        logger().log('error', `[DocumentContext] webview.onDidReceiveMessage: Error selecting element: ${e}`);
                        return;
                    }
                    break;
            }
        });

        const viewStateSubscription = this._webviewPanel!.onDidChangeViewState(async e => {
            const changedPanel = e.webviewPanel;
            logger().log('debug', `[DocumentContext] webviewPanel.onDidChangeViewState for ${this.fileName}. Active: ${changedPanel.active}, Visible: ${changedPanel.visible}`);

            if (changedPanel.active) {
                // This specific webview panel became active
                logger().log('debug', `[DocumentContext] webviewPanel.onDidChangeViewState for ${this.fileName} became active. Updating tree and context.`);
                await appContext.treeContext.updateDocument(this._document);
            }
        });


        this._context.subscriptions.push(
            this._webviewPanel!.onDidDispose(() => {
                logger().log('debug', `[DocumentContext] onDidDispose -> for: ${this.fileName}`);
                viewStateSubscription.dispose();
                didReceiveMessageSubscription.dispose();
                //this._webviewPanel = undefined;
                //this._disposed = true;

                this._onDidDispose();
            })
        );
    }

    public get fileName(): string {
        return this._document.fileName ?? '-';
    }

    public get documentUri(): string {
        return this._document.uri.toString();
    }

    public get isActive(): boolean {
        return this._webviewPanel?.active === true;
    }

    public onSelectionChanged(selectedElements: ITreeElement[]): void {
        this._selectedElements = selectedElements ?? [];
        logger().log('debug', `[DocumentContext] onSelectionChanged -> ${selectedElements ? selectedElements.length : 0} elements selected.`);
        this.reflectSelectedElementToWebview();
    }

    public async loadEmptyPage(): Promise<void> {
        logger().log('debug', `[DocumentContext] loadEmptyPage for: ${this.fileName}`);
        this._webviewPanel.webview.html = await this.getHtmlForWebview(true);
    }

    public async updateWebviewContent(): Promise<void> {
        logger().log('debug', `[DocumentContext] updateWebviewContent for: ${this.fileName}`);
        this._webviewPanel.webview.html = await this.getHtmlForWebview(false);
    }

    public reflectSelectedElementToWebview(): void {
        // NOTE: is this check necessary?
        if (!this._webviewPanel || !this._webviewPanel.webview || !this._document) { return; }

        const rootModel = appContext.treeContext.currentRootModel!;
        const element = this._selectedElements.length > 0 ? this._selectedElements[0] : rootModel;

        if (element === undefined || isVirtualTreeElement(element)) {
            return;
        }

        appContext.treeContext.clearPageErrors();

        const cultures = rootModel.languages.map(lang => findCulture(lang)).filter(c => !!c);
        const toJsonOptions: CategoryLikeTreeElementToJsonOptions = {
            includeCategories: false,
            includeResources: false
        };
        const message: AppToPageMessage = {
            command: 'loadPage',
            file: this.fileName,
            cultures: cultures,
            primaryLang: rootModel.primaryLanguage,
            element: element.toJson(toJsonOptions),
        };

        // this.currentWebviewPanel.webview.postMessage(message);
        this.sendMessageToHtmlPage(message);
    }

    // public sendMessageToHtmlPage(message: HtmlPageMessage): void {
    //     if (this.currentWebviewPanel && this.currentWebviewPanel.webview) {
    //         logger().log('debug', `LhqEditorProvider.sendMessage: ${message.command} ...`);
    //         this.currentWebviewPanel.webview.postMessage(message);
    //     }
    // }

    private async getHtmlForWebview(emptyPage: boolean): Promise<string> {
        // if (!this._webviewPanel) {
        //     return '';
        // }

        const webview = this._webviewPanel.webview;
        let pageHtml = await appContext.getPageHtml();

        const content_begin = `<!-- lhq_editor_content_begin -->`;
        const content_end = `<!-- lhq_editor_content_end -->`;

        if (emptyPage) {
            const startIdx = pageHtml.indexOf(content_begin);
            const endIdx = pageHtml.indexOf(content_end, startIdx + content_begin.length);
            if (startIdx > -1 && endIdx > -1) {
                pageHtml = pageHtml.substring(0, startIdx) + pageHtml.substring(endIdx + content_end.length);
            } else {
                logger().log('error', `[DocumentContext] getHtmlForWebview: Content markers not found in page.html`);
            }
        }

        pageHtml = pageHtml.replace(`<!-- lhq_loading_file_text -->`, `<span>Loading ${this.fileName} ...</span>`);

        const regex = /<script\s+nonce="([^"]*)"\s+src="([^"]*)"[^>]*><\/script>/g;

        const nonce = generateNonce();
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
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        try {
            if (this._webviewPanel && this._webviewPanel.webview) {
                if (this._webviewPanel.active) {
                    logger().log('debug', `[DocumentContext] sendMessage -> ${message.command} ...`);
                    this._webviewPanel.webview.postMessage(message);
                } else {
                    logger().log('debug', `[DocumentContext] sendMessage -> WebviewPanel is not active. Skipping message: ${message.command}`);
                }
            }
        } catch (error) {
            logger().log('error', `[DocumentContext] sendMessageToHtmlPage: Error sending message '${message.command}': ${error}`);
        }
    }
}