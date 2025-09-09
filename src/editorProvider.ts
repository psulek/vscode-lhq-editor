import * as vscode from 'vscode';
import debounce from 'lodash.debounce';
import { ITreeElement } from '@lhq/lhq-generators';

import { LhqTreeDataProvider } from './treeDataProvider';
import { isValidDocument, logger, showConfirmBox, showMessageBox, showNotificationBox } from './utils';
import { AppToPageMessage, IDocumentContext, SelectionChangedCallback, StatusBarItemUpdateInfo } from './types';
import { DocumentContext } from './documentContext';
import { AvailableCommands, Commands, ContextEvents, GlobalCommands } from './context';
import { nextTick } from 'node:process';

export class LhqEditorProvider implements vscode.CustomTextEditorProvider {
    // public static readonly viewType = 'lhq.customEditor';

    private readonly _documents = new Map<string, DocumentContext>();
    private readonly _debouncedOnSelectionChanged: SelectionChangedCallback = undefined!;

    private _statusBar: vscode.StatusBarItem;

    private _debouncedRunCodeGenerator: () => void;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly treeDataProvider: LhqTreeDataProvider
    ) {
        this._statusBar = vscode.window.createStatusBarItem('lhq.codeGeneratorStatus', vscode.StatusBarAlignment.Left, 10);

        appContext.on(ContextEvents.isEditorActiveChanged, (active: boolean) => {
            if (active) {
                this._statusBar.show();
            } else {
                this._statusBar.hide();
            }
        });

        appContext.on(ContextEvents.isReadonlyModeChanged, (readonly: boolean) => {
            const activeDoc = this.activeDocument;
            if (activeDoc) {
                activeDoc.setReadonlyMode(readonly);
            }
        });

        // TODO: Maybe unsubscribe this status bar item when extension is deactivated?
        context.subscriptions.push(this._statusBar);

        this._debouncedOnSelectionChanged = debounce(this.onSelectionChanged.bind(this), 200, { leading: false, trailing: true });
        appContext.setSelectionChangedCallback(this._debouncedOnSelectionChanged);
        appContext.setCheckAnyActiveDocumentCallback(this.hasAnyActiveDocument);

        this._debouncedRunCodeGenerator = debounce(this.runCodeGenerator.bind(this), 200, { leading: true, trailing: false });

        for (const command of Object.values(Commands)) {
            context.subscriptions.push(
                vscode.commands.registerCommand(command, args => this.handleVsCommand(command, args))
            );
        }

        context.subscriptions.push(
            vscode.commands.registerCommand(GlobalCommands.runGenerator, () => this._debouncedRunCodeGenerator()),

            vscode.commands.registerCommand(GlobalCommands.importFromFile, this.importModelFromFile.bind(this)),
            vscode.commands.registerCommand(GlobalCommands.exportToFile, this.exportModelToFile.bind(this)),
        );
    }

    private handleVsCommand(command: AvailableCommands, treeElement: ITreeElement): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', `handleVsCommand -> No active document context found. Cannot handle command '${command}'.`);
            return Promise.resolve();
        }

        return activeDoc.handleVsCommand(command, treeElement);
    }

    private get activeDocument(): DocumentContext | undefined {
        for (const editor of this._documents.values()) {
            if (editor.isActive) {
                return editor;
            }
        }
        return undefined;
    }

    hasAnyActiveDocument = (): boolean => {
        for (const editor of this._documents.values()) {
            if (editor.isActive) {
                return true;
            }
        }
        return false;
    };

    private onSelectionChanged(selectedElements: ITreeElement[]): void {
        logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> ${selectedElements ? selectedElements.length : 0} elements selected.`);
        const activeDoc = this.activeDocument;
        if (activeDoc) {
            logger().log(this, 'debug', `[LhqEditorProvider] onSelectionChanged -> updating selection on document context (${activeDoc.documentUri}).`);
            activeDoc.onSelectionChanged(selectedElements);
        } else {
            logger().log(this, 'debug', '[LhqEditorProvider] onSelectionChanged -> No active document context found. Skipping selection update.');
        }
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        const activeDoc = this.activeDocument;
        if (activeDoc) {
            logger().log(this, 'debug', `[LhqEditorProvider] sendMessageToHtmlPage -> Sending message '${message.command}' to webview for document ${activeDoc.documentUri}`);
            activeDoc.sendMessageToHtmlPage(message);
        } else {
            logger().log(this, 'warn', '[LhqEditorProvider] sendMessageToHtmlPage -> No active document context found. Cannot send message.');
        }
    }

    private async importModelFromFile(): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'importModelFromFile -> No active document context found. Cannot import from Excel.');
            return;
        }

        return activeDoc.importModelFromFile();
    }

    private async exportModelToFile(): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'exportModelToFile -> No active document context found. Cannot import from Excel.');
            return;
        }

        return activeDoc.exportModelToFile();
    }

    public async runCodeGenerator(): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'runCodeGenerator -> No active document context found. Cannot run code generator.');
            return;
        }

        if (activeDoc.isDirty) {
            await activeDoc.saveDocument();
        }

        return activeDoc.runCodeGenerator();
    }

    public resetGeneratorStatus(): void {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'resetGeneratorStatus -> No active document context found. Cannot reset generator status.');
            return;
        }

        return activeDoc.resetGeneratorStatus();
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        logger().log(this, 'debug', `resolveCustomTextEditor -> for document: ${document.fileName}`);

        const documentUri = document.uri.toString();
        if (this._documents.has(documentUri)) {
            showNotificationBox('err', `Editor for ${document.fileName} is already open.`);
            return;
        }

        const onDocContextDisposed = () => {
            if (this._documents.has(documentUri)) {
                const doc = this._documents.get(documentUri);
                this._documents.delete(documentUri);

                // NOTE: Test if needed this delay thingy at all
                setTimeout(async () => {

                    const docIsActive = doc?.isActive ?? false;

                    if (docIsActive && !doc?.isSameDocument(document)) {
                        logger().log(this, 'debug', "onDidDispose -> No active document or same document. Nothing to do.");
                    } else {
                        logger().log(this, 'debug', "onDidDispose -> Triggering treeDataProvider.updateDocument");
                        const activeDocument = vscode.window.activeTextEditor?.document;


                        // if not active document or not valid document, update tree data provider to clear/hide tree
                        if (!activeDocument || !isValidDocument(activeDocument)) {
                            const treeDoc = this.treeDataProvider.activeDocument;
                            if (!treeDoc || treeDoc.isSameDocument(document) || treeDoc === doc) {
                                await doc!.update(undefined);
                            }
                        }
                    }

                }, 100);
            }
        };

        const onStatusBarItemUpdateRequest = (docContext: IDocumentContext, updateInfo: StatusBarItemUpdateInfo, forceUpdate?: boolean) => {
            const activeDoc = this.activeDocument;

            if (!activeDoc || docContext === activeDoc) {
                logger().log(this, 'debug', `onStatusBarItemUpdateRequest -> Updating status bar item '${updateInfo.text}' for document: ${docContext.fileName}`);

                this._statusBar.text = updateInfo.text;
                this._statusBar.backgroundColor = updateInfo.backgroundColor;
                this._statusBar.color = updateInfo.color;
                this._statusBar.command = updateInfo.command;
                this._statusBar.tooltip = updateInfo.tooltip;
            } else {
                logger().log(this, 'debug', `onStatusBarItemUpdateRequest -> Ignoring status bar update for document: ${docContext.fileName} (doc is not active)`);
            }
        };

        const onNotifyDocumentActiveChanged = (docContext: IDocumentContext, isActive: boolean) => {
            logger().log(this, 'debug', `onNotifyDocumentActiveChanged -> Document ${docContext.fileName} is now ${isActive ? 'active' : 'inactive'}.`);

            if (isActive) {
                for (const doc of this._documents.values()) {
                    if (doc !== docContext) {
                        doc.isActive = false;
                    }
                }
            }
        };

        const docCtx = new DocumentContext(this.context, webviewPanel, onDocContextDisposed,
            onStatusBarItemUpdateRequest, onNotifyDocumentActiveChanged);

        this._documents.set(documentUri, docCtx);

        try {

            // 1st - set html page to 'empty' , showing msg: loading $file ...
            await docCtx.loadEmptyPage();

            // 2nd - update tree data provider with the document
            await docCtx.update(document, { forceRefresh: true });

            // 3rd - update webview content with the document
            await docCtx.updateWebviewContent();

            // 4th - select root element in the tree , this will reflect the selection to the webview
            await this.treeDataProvider.selectRootElement();

            // appContext.isEditorActive = true;
            appContext.enableEditorActive();

            this.validateOnOpen(docCtx);
        } catch (error) {
            logger().log(this, 'error', `resolveCustomTextEditor -> Error while resolving custom text editor: ${error}`);

            // clear and hide the tree if error occurs
            await docCtx.update(undefined);
        }
    }

    private validateOnOpen(docCtx: DocumentContext): void {
        setTimeout(async () => {
            try {
                if (!await docCtx.upgradeModelIfNeeded()) {
                    return;
                }

                await docCtx.validateLanguages();

            } catch (error) {
                logger().log(this, 'error', `validateOnOpen -> Error while validating languages: ${error}`);
            }
        }, 100);
    }

    public onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent) {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'onWillSaveTextDocument -> No active document context found. Cannot handle will save event.');
            return;
        }

        if (activeDoc.isSameDocument(event.document)) {
            activeDoc.validateDocument();
        }
    }

    public onDidSaveTextDocument(document: vscode.TextDocument) {
        if (isValidDocument(document)) {
            if (!appConfig.runGeneratorOnSave) {
                nextTick(async () => {
                    if (appConfig.suggestRunGeneratorOnSave) {
                        const runGeneratorOnSave = await showConfirmBox(
                            'Do you want to run code generator automatically on save?', undefined,
                            { modal: false, yesText: 'Yes', noText: 'Dont suggest again' });

                        if (runGeneratorOnSave) {
                            await appContext.updateConfig({ runGeneratorOnSave: true }, vscode.ConfigurationTarget.Workspace);

                            void this.runCodeGenerator();
                        } else {
                            await appContext.updateConfig({ suggestRunGeneratorOnSave: false }, vscode.ConfigurationTarget.Workspace);
                        }
                    }
                });

                return;
            }

            void this.runCodeGenerator().finally(async () => {
                if (appContext.getFirstTimeUsage('runGeneratorOnSave')) {
                    const runGeneratorOnSave = await showConfirmBox('Associated code generator was run automatically after save.\n' +
                        'Do you want to always run code generator on save?', undefined, { modal: false });

                    if (runGeneratorOnSave !== undefined) {
                        await appContext.updateConfig({ runGeneratorOnSave }, vscode.ConfigurationTarget.Workspace);
                    }
                }
            });
        }
    }

    public async onUndoRedo(document: vscode.TextDocument): Promise<void> {
        const activeDoc = this.activeDocument;
        if (!activeDoc) {
            logger().log(this, 'warn', 'onUndoRedo -> No active document context found. Cannot handle undo/redo event.');
            return;
        }

        if (activeDoc.isSameDocument(document)) {
            logger().log(this, 'debug', `onUndoRedo -> Document ${document.fileName} is active. Updating tree and webview.`);

            await activeDoc.update(document, { forceRefresh: true, undoRedo: true });
        } else {
            logger().log(this, 'debug', `onUndoRedo -> Document ${document.fileName} is not active. Skipping update.`);
        }
    }
}
