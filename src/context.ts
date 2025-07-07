import * as vscode from 'vscode';
import { HtmlPageMessage, IAppContext, ITreeContext, IVirtualLanguageElement, SelectionChangedCallback } from './types';
import { ITreeElement } from '@lhq/lhq-generators';
import { VirtualTreeElement } from './elements';
import { getElementFullPath, initializeDebugMode, isValidDocument, loadCultures, logger, showMessageBox } from './utils';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';

const globalStateKeys = {
    languagesVisible: 'languagesVisible'
};

const contextKeys = {
    isEditorActive: 'lhqEditorIsActive',
    hasSelectedItem: 'lhqTreeHasSelectedItem',
    hasMultiSelection: 'lhqTreeHasMultiSelection',
    hasSelectedDiffParents: 'lhqTreeHasSelectedDiffParents',
    hasLanguageSelection: 'lhqTreeHasLanguageSelection',
    hasPrimaryLanguageSelected: 'lhqTreeHasPrimaryLanguageSelected',
    hasSelectedResource: 'lhqTreeHasSelectedResource',
    hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
};


export class AppContext implements IAppContext {
    private _ctx!: vscode.ExtensionContext;
    private _isEditorActive = false;
    private activeTheme = ''; // not supported yet
    private _selectedElements: ITreeElement[] = [];
    private _onSelectionChanged: SelectionChangedCallback | undefined;
    private _lhqTreeDataProvider: LhqTreeDataProvider = undefined!;
    private _lhqEditorProvider: LhqEditorProvider = undefined!;
    private _pageHtml: string = '';

    public setSelectionChangedCallback(callback: SelectionChangedCallback): void {
        this._onSelectionChanged = callback;
    }

    public async init(ctx: vscode.ExtensionContext): Promise<void> {
        this._ctx = ctx;

        // to trigger setContext calls
        this.languagesVisible = this.languagesVisible;
        this.isEditorActive = false;
        this.setTreeSelection([]);

        initializeDebugMode(ctx.extensionMode);
        await loadCultures(ctx);

        this._ctx.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async e => {
                if (!e.reason) {
                    logger().log('debug', `[AppContext] onDidChangeTextDocument -> No reason provided, ignoring change for document: ${e.document?.fileName ?? '-'}`);
                    return;
                }
                logger().log('debug', `[AppContext] onDidChangeTextDocument -> document: ${e.document?.fileName ?? '-'}, reason: ${e.reason}`);

                const docUri = e.document?.uri.toString() ?? '';
                if (isValidDocument(e.document)) {
                    const treeDocUri = this._lhqTreeDataProvider.documentUri;
                    if (treeDocUri === docUri) {
                        await this._lhqTreeDataProvider.updateDocument(e.document);
                    } else {
                        logger().log('debug', `[AppContext] onDidChangeTextDocument -> Document uri (${docUri}) is not the treeContext has (${treeDocUri}), ignoring change.`);
                    }
                } else {
                    logger().log('debug', `[AppContext] onDidChangeTextDocument -> Document (${docUri}) is not valid, ignoring change.`);
                }
            }),

            vscode.workspace.onWillSaveTextDocument(async (event: vscode.TextDocumentWillSaveEvent) => {
                // if (event.document.uri.toString() === document.uri.toString()) {
                if (event.document.uri.toString() === this._lhqTreeDataProvider.documentUri) {
                    const validationError = this._lhqTreeDataProvider.lastValidationError;

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
            })
        );


        this._lhqTreeDataProvider = new LhqTreeDataProvider(this._ctx);
        this._lhqEditorProvider = new LhqEditorProvider(this._ctx, this._lhqTreeDataProvider);
        this._ctx.subscriptions.push(
            vscode.window.registerCustomEditorProvider(LhqEditorProvider.viewType, this._lhqEditorProvider, {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            })
        );
    }

    public sendMessageToHtmlPage(message: HtmlPageMessage): void {
        this._lhqEditorProvider.sendMessageToHtmlPage(message);
    }

    public get treeContext(): ITreeContext {
        return this._lhqTreeDataProvider;
    }

    public get languagesVisible(): boolean {
        return this._ctx.globalState.get<boolean>(globalStateKeys.languagesVisible, true);
    }

    public set languagesVisible(visible: boolean) {
        this._ctx.globalState.update(globalStateKeys.languagesVisible, visible);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguagesVisible, visible);
    }

    public get isEditorActive(): boolean {
        return this._isEditorActive;
    }

    public set isEditorActive(active: boolean) {
        if (this._isEditorActive !== active) {
            this._isEditorActive = active;
            vscode.commands.executeCommand('setContext', contextKeys.isEditorActive, active);
        }
    }

    public getFileUri = (...pathParts: string[]): vscode.Uri => {
        return vscode.Uri.joinPath(this._ctx.extensionUri, ...pathParts);
    };

    public async getPageHtml(): Promise<string> {
        if (this._pageHtml === '') {
            const pageHtmlUri = this.getFileUri('media', 'page.html');
            const pageHtmlRaw = await vscode.workspace.fs.readFile(pageHtmlUri);
            this._pageHtml = new TextDecoder().decode(pageHtmlRaw);
        }
        return this._pageHtml;
    }

    public getMediaUri = (webview: vscode.Webview, filename: string, themed?: boolean): vscode.Uri => {
        themed = themed ?? false;
        const diskPath = themed
            ? vscode.Uri.joinPath(this._ctx.extensionUri, 'media', this.activeTheme, filename)
            : vscode.Uri.joinPath(this._ctx.extensionUri, 'media', filename);
        return webview.asWebviewUri(diskPath);
    };

    public get selectedElements(): ITreeElement[] {
        return this._selectedElements ?? [];
    }

    public setTreeSelection(selectedElements: ITreeElement[]): void {
        this._selectedElements = selectedElements;
        if (this._onSelectionChanged) {
            let selInfo = '';
            if (selectedElements.length === 1) {
                const elem1 = selectedElements[0];
                selInfo = `[${getElementFullPath(elem1)} (${elem1.elementType})]`;
            }
            logger().log('debug', `[AppContext] setTreeSelection -> fire _onSelectionChanged ${selInfo} (${selectedElements.length} items selected)`);
            this._onSelectionChanged(selectedElements);
        }

        const hasSelectedItem = selectedElements.length === 1;
        const hasMultiSelection = selectedElements.length > 1;
        let hasSelectedDiffParents = false;
        let hasLanguageSelection = false;
        let hasPrimaryLanguageSelected = false;
        let hasSelectedResource = hasSelectedItem && selectedElements[0].elementType === 'resource';

        if (selectedElements.length > 1) {
            const firstParent = selectedElements[0].parent;
            hasSelectedDiffParents = selectedElements.some(x => x.parent !== firstParent);
        }

        const virtualElements = selectedElements.filter(x => x instanceof VirtualTreeElement);
        if (virtualElements.length > 0) {
            hasLanguageSelection = virtualElements.some(x => x.virtualElementType === 'language' || x.virtualElementType === 'languages');
            hasPrimaryLanguageSelected = virtualElements.some(x => x.virtualElementType === 'language' && (x as unknown as IVirtualLanguageElement).isPrimary);
        }

        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedItem, hasSelectedItem);
        vscode.commands.executeCommand('setContext', contextKeys.hasMultiSelection, hasMultiSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedDiffParents, hasSelectedDiffParents);
        vscode.commands.executeCommand('setContext', contextKeys.hasLanguageSelection, hasLanguageSelection);
        vscode.commands.executeCommand('setContext', contextKeys.hasPrimaryLanguageSelected, hasPrimaryLanguageSelected);
        vscode.commands.executeCommand('setContext', contextKeys.hasSelectedResource, hasSelectedResource);
    }
}

// export const appContext = new AppContext();