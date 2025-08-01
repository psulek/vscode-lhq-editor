import path from 'path';
import * as vscode from 'vscode';
import fse from 'fs-extra';
import { glob } from 'glob';
import { AppToPageMessage, CheckAnyActiveDocumentCallback, ExtensionConfig, IAppContext, ITreeContext, IVirtualLanguageElement, SelectionChangedCallback } from './types';
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
    duplicateElement: 'lhqTreeView.duplicateElement',
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
    hasSelectedModelRoot: 'lhqTreeHasSelectedModelRoot',
    hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
    generatorIsRunning: 'lhqGeneratorIsRunning'
};

export const ContextEvents = {
    isEditorActiveChanged: 'isEditorActiveChanged',
};

const configKeys = {
    autoFocusEditor: 'lhqeditor.autoFocusEditor'
} as const;

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

        initializeDebugMode(ctx);
        await loadCultures(ctx);

        this._ctx.subscriptions.push(
            vscode.commands.registerCommand(GlobalCommands.showOutput, () => {
                VsCodeLogger.showPanel();
                this._lhqEditorProvider.resetGeneratorStatus();
            }),

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

        // commands
        vscode.commands.registerCommand(GlobalCommands.createNewLhqFile, () => this.createNewLhqFile());
    }

    public getConfig(): ExtensionConfig {
        const cfg = vscode.workspace.getConfiguration();
        const autoFocusEditor = cfg.get(configKeys.autoFocusEditor, false);
        return {
            autoFocusEditor: autoFocusEditor
        };
    }

    public async updateConfig(newConfig: Partial<ExtensionConfig>): Promise<void> {
        const cfg = await vscode.workspace.getConfiguration();
        // if (newConfig.autoFocusEditor) {
        //     cfg.update(configKeys.autoFocusEditor, newConfig.autoFocusEditor, vscode.ConfigurationTarget.Workspace);
        // }
    }

    private async handleDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        if (!e.reason) {
            logger().log(this, 'debug', `onDidChangeTextDocument -> No reason provided, ignoring change for document: ${e.document?.fileName ?? '-'}`);
            return;
        }

        const reason = e.reason === vscode.TextDocumentChangeReason.Undo ? 'Undo' : 'Redo';
        logger().log(this, 'debug', `onDidChangeTextDocument -> document: ${e.document?.fileName ?? '-'}, reason: ${reason}`);

        const docUri = e.document?.uri.toString() ?? '';
        if (isValidDocument(e.document)) {
            await this._lhqEditorProvider.onUndoRedo(e.document);
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
        const hasSelectedResource = hasSelectedItem && selectedElements[0].elementType === 'resource';
        const hasSelectedModelRoot = hasSelectedItem && selectedElements[0].elementType === 'model';

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
        vscode.commands.executeCommand('setContext', ContextKeys.hasSelectedModelRoot, hasSelectedModelRoot);
    }

    public clearTreeContextValues() {
        for (const key of Object.values(ContextKeys)) {
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

    return folder;
}