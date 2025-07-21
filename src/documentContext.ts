import * as vscode from 'vscode';
import { findCulture, generateNonce, isValidDocument, logger, showConfirmBox, showMessageBox } from './utils';
import { AppToPageMessage, PageToAppMessage } from './types';
import { CategoryLikeTreeElementToJsonOptions, CodeGeneratorGroupSettings, Generator, HbsTemplateManager, isNullOrEmpty, ITreeElement, modelConst } from '@lhq/lhq-generators';
import { isVirtualTreeElement } from './elements';

export class DocumentContext {
    private readonly _context: vscode.ExtensionContext;
    private readonly _document: vscode.TextDocument;
    private readonly _webviewPanel: vscode.WebviewPanel;
    private readonly _onDidDispose: () => void;
    private _selectedElements: ITreeElement[] = [];

    constructor(context: vscode.ExtensionContext, document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel,
        onDidDispose: () => void
    ) {
        if (!document) {
            logger().log(this, 'error', 'ctor(), Document is undefined or null.');
            throw new Error('Document is undefined or null.');
        }

        const fileName = document.fileName ?? '-';

        if (!isValidDocument(document)) {
            logger().log(this, 'error', `Invalid document: ${fileName}`);
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
        const didReceiveMessageSubscription = this._webviewPanel!.webview.onDidReceiveMessage(this.handleClientCommands.bind(this));
        const viewStateSubscription = this._webviewPanel!.onDidChangeViewState(async e => {
            const changedPanel = e.webviewPanel;
            logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName}. Active: ${changedPanel.active}, Visible: ${changedPanel.visible}`);

            if (changedPanel.active) {
                // This specific webview panel became active
                logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName} became active. Updating tree and context.`);
                await appContext.treeContext.updateDocument(this._document);
            }
        });


        this._context.subscriptions.push(
            this._webviewPanel!.onDidDispose(() => {
                logger().log(this, 'debug', `onDidDispose -> for: ${this.fileName}`);
                viewStateSubscription.dispose();
                didReceiveMessageSubscription.dispose();
                //this._webviewPanel = undefined;
                //this._disposed = true;

                this._onDidDispose();
            })
        );
    }


    private async handleClientCommands(message: PageToAppMessage): Promise<void> {
        logger().log(this, 'debug', `webview.onDidReceiveMessage: ${message.command} for ${this.fileName}`);
        switch (message.command) {
            case 'update':
                try {
                    const element = message.data;
                    if (element) {
                        await appContext.treeContext.updateElement(element);
                    }
                } catch (e) {
                    logger().log(this, 'error', `webview.onDidReceiveMessage: Error parsing element data: ${e}`);
                    return;
                }
                break;
            case 'select':
                try {
                    await appContext.treeContext.selectElementByPath(message.elementType, message.paths);
                } catch (e) {
                    logger().log(this, 'error', `webview.onDidReceiveMessage: Error selecting element: ${e}`);
                    return;
                }
                break;
            case 'saveProperties': {
                const error = await appContext.treeContext.saveModelProperties(message.modelProperties);
                if (error) {
                    logger().log(this, 'error', `webview.onDidReceiveMessage: Error saving properties: ${error}`);
                }
                this.sendMessageToHtmlPage({ command: 'savePropertiesResult', error });
                break;
            }
            case 'resetSettings': {
                const rootModel = appContext.treeContext.currentRootModel!;
                if (!rootModel) {
                    logger().log(this, 'error', `webview.onDidReceiveMessage: No current root model found.`);
                    return;
                }

                if (await showConfirmBox('Reset Code Generator Settings?', 'Are you sure you want to reset code generator settings to default values?')) {
                    const settings = rootModel?.codeGenerator?.settings ?? {} as CodeGeneratorGroupSettings;
                    this.sendMessageToHtmlPage({ command: 'resetSettingsResult', settings });
                }
                break;
            }
        }
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

    // public runCodeGenerator() {
    //     if (!this._webviewPanel || !this._webviewPanel.webview) {
    //         logger().log('warn', `[DocumentContext] runCodeGenerator -> No webview panel o available for document: ${this.fileName}`);
    //         return;
    //     }

    //     const file = this._document.fileName;
    //     if (isNullOrEmpty(file)) {
    //         logger().log('warn', `[DocumentContext] runCodeGenerator -> Document fileName is not valid (${file}). Cannot run code generator.`);
    //         return;
    //     }


    //     logger().log('info', `[DocumentContext] runCodeGenerator -> Running code generator for document: ${file}`);

    //     const generator = new Generator();
    //     generator.generate(file, );
    // }


    public onSelectionChanged(selectedElements: ITreeElement[]): void {
        this._selectedElements = selectedElements ?? [];
        //logger().log(this, 'debug', `onSelectionChanged -> ${selectedElements ? selectedElements.length : 0} elements selected.`);
        this.reflectSelectedElementToWebview();
    }

    public async loadEmptyPage(): Promise<void> {
        //logger().log(this, 'debug', `loadEmptyPage for: ${this.fileName}`);
        this._webviewPanel.webview.html = await this.getHtmlForWebview(true);
    }

    public async updateWebviewContent(): Promise<void> {
        //logger().log('debug', `[DocumentContext] updateWebviewContent for: ${this.fileName}`);
        this._webviewPanel.webview.html = await this.getHtmlForWebview(false);

        const templatesMetadata = HbsTemplateManager.getTemplateDefinitions();

        this.sendMessageToHtmlPage({ command: 'init', templatesMetadata });
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
            modelProperties: {
                resources: rootModel.options.resources,
                categories: rootModel.options.categories,
                modelVersion: rootModel.version,
                visible: false,
                codeGenerator: rootModel.codeGenerator ?? { templateId: '', settings: {} as CodeGeneratorGroupSettings, version: modelConst.ModelVersions.codeGenerator }
            }
        };

        this.sendMessageToHtmlPage(message);
    }

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
                logger().log(this, 'error', `getHtmlForWebview: Content markers not found in page.html`);
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
                    //logger().log(this, 'debug', `sendMessage -> ${message.command} ...`);
                    this._webviewPanel.webview.postMessage(message);
                } else {
                    logger().log(this, 'debug', `sendMessage() skipped for message '${message.command}' -> WebviewPanel is not active.`);
                }
            }
        } catch (error) {
            logger().log(this, 'error', `sendMessageToHtmlPage: Error sending message '${message.command}': ${error}`);
        }
    }
}