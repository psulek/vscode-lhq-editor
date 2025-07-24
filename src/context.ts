import path from 'path';
import * as vscode from 'vscode';
import fse from 'fs-extra';
import { glob } from 'glob';
import { AppToPageMessage, CheckAnyActiveDocumentCallback, IAppContext, ITreeContext, IVirtualLanguageElement, SelectionChangedCallback } from './types';
import { Generator, GeneratorInitialization, HbsTemplateManager, ITreeElement, ModelUtils, generatorUtils, isNullOrEmpty } from '@lhq/lhq-generators';
import { VirtualTreeElement } from './elements';
import {
    DefaultFormattingOptions, getElementFullPath, initializeDebugMode, isValidDocument, loadCultures,
    logger, safeReadFile, showConfirmBox, showMessageBox
} from './utils';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { HostEnvironmentCli } from './hostEnv';
import EventEmitter from 'events';
import { VsCodeLogger } from './logger';

const globalStateKeys = {
    languagesVisible: 'languagesVisible'
};

export const Commands = {
    addElement: 'lhqTreeView.addElement',
    renameElement: 'lhqTreeView.renameElement',
    deleteElement: 'lhqTreeView.deleteElement',
    findInTreeView: 'lhqTreeView.findInTreeView',
    advancedFind: 'lhqTreeView.advancedFind',
    addCategory: 'lhqTreeView.addCategory',
    addResource: 'lhqTreeView.addResource',
    addLanguage: 'lhqTreeView.addLanguage',
    deleteLanguage: 'lhqTreeView.deleteLanguage',
    markLanguageAsPrimary: 'lhqTreeView.markLanguageAsPrimary',
    showLanguages: 'lhqTreeView.showLanguages',
    hideLanguages: 'lhqTreeView.hideLanguages',
    projectProperties: 'lhqTreeView.projectProperties',
    focusTree: 'lhqTreeView.focusTree',
    focusEditor: 'lhqTreeView.focusEditor',
} as const;

export const GlobalCommands = {
    runGenerator: 'lhqTreeView.runGenerator',
    createNewLhqFile: 'lhqTreeView.createNewLhqFile',

    // commands not in package.json (internal)
    showOutput: 'lhqTreeView.showOutput'
};

export type AvailableCommands = typeof Commands[keyof typeof Commands];


export const ContextKeys = {
    isEditorActive: 'lhqEditorIsActive',
    hasSelectedItem: 'lhqTreeHasSelectedItem',
    hasMultiSelection: 'lhqTreeHasMultiSelection',
    hasSelectedDiffParents: 'lhqTreeHasSelectedDiffParents',
    hasLanguageSelection: 'lhqTreeHasLanguageSelection',
    hasPrimaryLanguageSelected: 'lhqTreeHasPrimaryLanguageSelected',
    hasSelectedResource: 'lhqTreeHasSelectedResource',
    hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
    generatorIsRunning: 'lhqGeneratorIsRunning'
};

export const ContextEvents = {
    isEditorActiveChanged: 'isEditorActiveChanged',
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
    private _eventEmitter = new EventEmitter();
    private _checkAnyActiveDocumentCallback: CheckAnyActiveDocumentCallback | undefined;

    public setSelectionChangedCallback(callback: SelectionChangedCallback): void {
        this._onSelectionChanged = callback;
    }

    public setCheckAnyActiveDocumentCallback(callback: CheckAnyActiveDocumentCallback): void {
        this._checkAnyActiveDocumentCallback = callback;
    }

    public on(event: string, listener: (...args: any[]) => void): this {
        this._eventEmitter.on(event, listener);
        return this;
    }

    public off(event: string, listener: (...args: any[]) => void): this {
        this._eventEmitter.off(event, listener);
        return this;
    }

    public async init(ctx: vscode.ExtensionContext): Promise<void> {
        this._ctx = ctx;

        await this.initGenerator(ctx);

        // to trigger setContext calls
        this.languagesVisible = this.languagesVisible;
        this.isEditorActive = false;
        this.setTreeSelection([]);

        initializeDebugMode(ctx.extensionMode);
        await loadCultures(ctx);

        // const lhqFs = new LhqFileSystemProvider();
        // const uriHandler = new LhqUriHandler();


        // NOTE: For testing...
        // context.subscriptions.push(vscode.commands.registerCommand('lhq-editor.open', () => {
        //     const activeEditor = vscode.window.activeTextEditor;
        //     if (activeEditor) {
        //         const docUri = activeEditor.document.uri;
        //         // This is the core logic: open the file with our custom editor's viewType.
        //         vscode.commands.executeCommand('vscode.openWith', docUri, LhqEditorProvider.viewType);
        //     }
        // }));

        this._ctx.subscriptions.push(
            vscode.commands.registerCommand(GlobalCommands.showOutput, () => {
                //vscode.commands.executeCommand('workbench.action.showOutput', 'LHQ Editor');
                VsCodeLogger.showPanel();
                //this._lhqTreeDataProvider.resetGeneratorStatus();
                this._lhqEditorProvider.resetGeneratorStatus();
            }),

            // vscode.workspace.registerFileSystemProvider('lhq', lhqFs, { isCaseSensitive: true, isReadonly: false }),
            // vscode.window.registerUriHandler(uriHandler),

            //vscode.workspace.onDidOpenTextDocument(this.handleDidOpenTextDocument.bind(this)),

            vscode.workspace.onDidChangeTextDocument(this.handleDidChangeTextDocument.bind(this)),

            vscode.workspace.onWillSaveTextDocument((event: vscode.TextDocumentWillSaveEvent) => {
                this._lhqEditorProvider.onWillSaveTextDocument(event);
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

        //this._codeGenStatus = new CodeGenStatus(ctx);

        // commands
        vscode.commands.registerCommand(GlobalCommands.createNewLhqFile, () => this.createNewLhqFile());
    }

    /* public runCodeGenerator(): void {
        this._lhqEditorProvider.runCodeGenerator();
    } */

    /* private async processBeforeSave(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
        const edits: vscode.TextEdit[] = [];

        // Get the current content
        const text = document.getText();

        // Process the content (modify as needed)
        const modifiedText = yourModificationFunction(text);

        // Create a full document replace edit
        const firstLine = document.lineAt(0);
        const lastLine = document.lineAt(document.lineCount - 1);
        const textRange = new vscode.Range(
            firstLine.range.start,
            lastLine.range.end
        );

        edits.push(vscode.TextEdit.replace(textRange, modifiedText));

        return edits;
    } */

    // private handleDidOpenTextDocument(e: vscode.TextDocument): void {
    //     if (isValidDocument(e)) {

    //     }
    // }

    private async handleDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        if (!e.reason) {
            logger().log(this, 'debug', `onDidChangeTextDocument -> No reason provided, ignoring change for document: ${e.document?.fileName ?? '-'}`);
            return;
        }

        const reason = e.reason === vscode.TextDocumentChangeReason.Undo ? 'Undo' : 'Redo';
        //const hasReason = e.reason !== undefined;
        logger().log(this, 'debug', `onDidChangeTextDocument -> document: ${e.document?.fileName ?? '-'}, reason: ${reason}`);

        const docUri = e.document?.uri.toString() ?? '';
        if (isValidDocument(e.document)) {

            await this._lhqEditorProvider.onUndoRedo(e.document);

            // const treeDocUri = this._lhqTreeDataProvider.documentUri;
            // if (treeDocUri === docUri) {
            //     // TODO: undo/redo support
            //     /* await this._lhqTreeDataProvider.updateDocument(e.document, true);
            //     this._lhqTreeDataProvider.requestPageReload(); */
            // } else {
            //     logger().log(this, 'debug', `onDidChangeTextDocument -> Document uri (${docUri}) is not same as treeview has (${treeDocUri}), ignoring change.`);
            // }
        } else {
            logger().log(this, 'debug', `onDidChangeTextDocument -> Document (${docUri}) is not valid, ignoring change.`);
        }
    }

    private async initGenerator(context: vscode.ExtensionContext): Promise<void> {
        try {
            const hbsTemplatesDir = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@lhq/lhq-generators/hbs').fsPath;

            const metadataFile = path.join(hbsTemplatesDir, 'metadata.json');
            const metadataContent = await fse.readFile(metadataFile, { encoding: 'utf-8' });
            const result = generatorUtils.validateTemplateMetadata(metadataContent);
            if (!result.success) {
                logger().log(this, 'error', `Validation of  ${metadataFile} failed: ${result.error}`);
                await showMessageBox('err', `Validation of lhq templates metadata file failed: ${result.error}`);
            }

            const generatorInit: GeneratorInitialization = {
                hbsTemplates: {},
                templatesMetadata: result.metadata!,
                hostEnvironment: new HostEnvironmentCli()
            };


            const hbsFiles = await glob('*.hbs', { cwd: hbsTemplatesDir, nodir: true });

            const templateLoaders = hbsFiles.map(async (hbsFile) => {
                const templateId = path.basename(hbsFile, path.extname(hbsFile));
                const fullFilePath = path.join(hbsTemplatesDir, hbsFile);
                generatorInit.hbsTemplates[templateId] = await safeReadFile(fullFilePath);
            });

            await Promise.all(templateLoaders);

            Generator.initialize(generatorInit);
        } catch (error) {
            logger().log(this, 'error', `Failed to initialize generator: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await showMessageBox('err', `Failed to initialize lhq generator! Please report this issue.`);
        }
    }

    private async createNewLhqFile(): Promise<void> {
        try {
            const folder = getCurrentFolder();
            if (!folder) {
                await showMessageBox('err', 'No folder selected. Please select a folder in the Explorer view.');
                return;
            }

            const defaultValue = 'Strings';
            const fileName = await vscode.window.showInputBox({
                prompt: `Enter name for new LHQ file (without .lhq extension)`,
                ignoreFocusOut: true,
                title: 'Create new LHQ file',
                placeHolder: 'File name (without .lhq extension)',
                value: defaultValue,
                valueSelection: [0, defaultValue.length],
                validateInput: value => {
                    // validate file name only a--z, A-Z, 0-9, _, - without any . or space
                    const regex = /^[a-zA-Z0-9_-]+$/;
                    if (!value) {
                        return 'File name cannot be empty.';
                    }
                    if (!regex.test(value)) {
                        return 'File name can only contain letters, numbers, underscores, and dashes.';
                    }

                    return null;
                }
            });

            if (!fileName) {
                return;
            }

            //const hbsMetadata = getHbsMetadata();
            const templates = Object.values(HbsTemplateManager.getTemplateDefinitions());

            interface TemplateQuickPickItem extends vscode.QuickPickItem {
                templateId: string;
            }

            const items: TemplateQuickPickItem[] = templates.map(template => ({
                templateId: template.id,
                label: template.displayName,
                detail: template.description,
                description: template.id,
                alwaysShow: true
            }));

            const template = await vscode.window.showQuickPick(items, {
                placeHolder: `Select generator template`,
                ignoreFocusOut: true,
                matchOnDetail: true,
                matchOnDescription: true,
                title: 'Select generator template for new LHQ file'
            });

            if (!template) {
                return;
            }

            const root = ModelUtils.createRootElement();
            root.name = path.basename(fileName, '.lhq');
            root.primaryLanguage = 'en';
            root.languages = ['en'];
            root.options = {
                categories: true,
                resources: 'All',
            };

            root.codeGenerator = ModelUtils.createCodeGeneratorElement(template.templateId);

            const fileContent = ModelUtils.serializeTreeElement(root, DefaultFormattingOptions);
            const filePath = path.join(folder.fsPath, fileName + '.lhq');

            if (await fse.pathExists(filePath)) {
                if (!await showConfirmBox(`File ${filePath} already exists. Do you want to overwrite it?`)) {
                    return;
                }
            }

            await fse.writeFile(filePath, fileContent, { encoding: 'utf8' });

            const fileUri = vscode.Uri.file(filePath);
            await vscode.commands.executeCommand('vscode.openWith', fileUri, 'lhq.customEditor');

            await showMessageBox('info', `Successfully created file: ${filePath}`);
        } catch (error) {
            logger().log(this, 'error', `Error creating new LHQ file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await showMessageBox('err', `Error creating new LHQ file.`);
        }
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
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
        vscode.commands.executeCommand('setContext', ContextKeys.hasLanguagesVisible, visible);
    }

    public get isEditorActive(): boolean {
        return this._isEditorActive;
    }

    private set isEditorActive(active: boolean) {
        if (this._isEditorActive !== active) {
            this._isEditorActive = active;
            vscode.commands.executeCommand('setContext', ContextKeys.isEditorActive, active);
            this._eventEmitter.emit(ContextEvents.isEditorActiveChanged, active);
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
            logger().log(this, 'debug', `setTreeSelection -> fire _onSelectionChanged ${selInfo} (${selectedElements.length} items selected)`);
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

        vscode.commands.executeCommand('setContext', ContextKeys.hasSelectedItem, hasSelectedItem);
        vscode.commands.executeCommand('setContext', ContextKeys.hasMultiSelection, hasMultiSelection);
        vscode.commands.executeCommand('setContext', ContextKeys.hasSelectedDiffParents, hasSelectedDiffParents);
        vscode.commands.executeCommand('setContext', ContextKeys.hasLanguageSelection, hasLanguageSelection);
        vscode.commands.executeCommand('setContext', ContextKeys.hasPrimaryLanguageSelected, hasPrimaryLanguageSelected);
        vscode.commands.executeCommand('setContext', ContextKeys.hasSelectedResource, hasSelectedResource);
    }

    public clearTreeContextValues() {
        for (const key of Object.values(ContextKeys)) {
            // if (key !== contextKeys.isEditorActive) {
            if (key.indexOf('lhqTree') === 0) {
                vscode.commands.executeCommand('setContext', key, false);
            }
        }
    }

    public enableEditorActive(): void {
        this.isEditorActive = true;
    }

    // NOTE: Sets 'isEditorActive' to false if there are no active documents in the editor.
    public disableEditorActive() {
        if (isNullOrEmpty(this._checkAnyActiveDocumentCallback)) {
            throw new Error('CheckAnyActiveDocumentCallback is not set. Please set it using setCheckAnyActiveDocumentCallback method.');
        }

        if (!this._checkAnyActiveDocumentCallback()) {
            this.isEditorActive = false;
        }
    }
}

/**
 * Returns the URI of the currently selected folder in the VS Code explorer, or undefined if none is selected.
 */
export function getCurrentFolder(): vscode.Uri | undefined {
    let folder = vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri
        : undefined;

    if (!folder) {
        const tabInput = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
        if (tabInput && (tabInput as any).uri) {
            folder = vscode.workspace.getWorkspaceFolder((tabInput as any).uri)?.uri;
        }
    }

    if (!folder) {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const uri = vscode.workspace.workspaceFolders[0].uri;
            folder = uri.scheme === 'file' ? vscode.workspace.getWorkspaceFolder(uri)?.uri : undefined;
        }
    }


    // // Try to get from the explorer context menu selection (if available)
    // const selected = vscode.window.activeTextEditor?.document.uri;
    // if (selected) {
    //     const stat = vscode.workspace.fs.stat(selected);
    //     // If it's a folder, return it
    //     if (stat && stat.then && typeof stat.then === 'function') {
    //         return stat.then(info => info.type === vscode.FileType.Directory ? selected : undefined);
    //     }
    // }

    return folder;
}