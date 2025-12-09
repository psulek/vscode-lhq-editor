import path from 'path';
import * as vscode from 'vscode';
import fse from 'fs-extra';
import { glob } from 'glob';
import {
    AppToPageMessage, CheckAnyActiveDocumentCallback, CultureInfo, FirstTimeUsage, IAppConfig,
    IAppContext, ITreeContext, IVirtualLanguageElement, LastSelectedElement, SelectionChangedCallback
} from './types';
import { Generator, GeneratorInitialization, HbsTemplateManager, ITreeElement, ModelUtils, generatorUtils, isNullOrEmpty, strCompare } from '@psulek/lhq-generators';
import { VirtualTreeElement } from './elements';
import {
    DefaultFormattingOptions, getElementFullPath, initializeDebugMode, isValidDocument,
    logger, safeReadFile, showConfirmBox,
    showNotificationBox
} from './utils';
import { LhqEditorProvider } from './editorProvider';
import { LhqTreeDataProvider } from './treeDataProvider';
import { HostEnvironmentCli } from './hostEnv';
import EventEmitter from 'events';
import { VsCodeLogger } from './logger';
import { AppConfig } from './config';

const globalStateKeys = {
    languagesExpanded: 'lhqeditor.languagesExpanded',
    firstTimeRunPrefix: 'lhqeditor.firstTimeRun.',
    lastSelectedElement: 'lhqeditor.lastSelectedElement.',
};

const maxLastSelectedElements = 20;

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
    projectProperties: 'lhqTreeView.projectProperties',
    // focusTree: 'lhqTreeView.focusTree',
    focusEditor: 'lhqTreeView.focusEditor',
} as const;

export const GlobalCommands = {
    runGenerator: 'lhqTreeView.runGenerator',
    createNewLhqFile: 'lhqTreeView.createNewLhqFile',
    importFromFile: 'lhqTreeView.importFromFile',
    exportToFile: 'lhqTreeView.exportToFile',

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

    generatorIsRunning: 'lhqGeneratorIsRunning',
    isReadonlyMode: 'lhqIsReadonlyMode',
};

export const ContextEvents = {
    isEditorActiveChanged: 'isEditorActiveChanged',
    isReadonlyModeChanged: 'isReadonlyModeChanged'
};

export const CustomEditorViewType = 'lhq.customEditor';

export const ModelV3_Info = "https://github.com/psulek/lhqeditor/wiki/LHQ-Model-v3-Changes";


export class AppContext implements IAppContext {
    private _ctx!: vscode.ExtensionContext;
    private _isEditorActive = false;
    private _isReadonlyMode = false;
    private activeTheme = ''; // not supported yet
    private _selectedElements: ITreeElement[] = [];
    private _onSelectionChanged: SelectionChangedCallback | undefined;
    private _lhqTreeDataProvider: LhqTreeDataProvider = undefined!;
    private _lhqEditorProvider: LhqEditorProvider = undefined!;
    private _pageHtml: string = '';
    private _eventEmitter = new EventEmitter();
    private _checkAnyActiveDocumentCallback: CheckAnyActiveDocumentCallback | undefined;
    private _appConfig: AppConfig = null!;
    private _cultures: CultureInfo[] = [];
    private _cacheFirstTimeUsage: Map<string, boolean> = new Map<string, boolean>();

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

    public getCurrentFolder(): vscode.Uri | undefined {
        return getCurrentFolder();
    }

    public getFirstTimeUsage(key: FirstTimeUsage): boolean {
        const cache = this._cacheFirstTimeUsage;
        if (!cache.has(key)) {
            const fullKey = globalStateKeys.firstTimeRunPrefix + key;
            const isFirstTime = this._ctx.globalState.get<boolean>(fullKey);
            if (isFirstTime === undefined) {
                cache.set(key, false);
                this._ctx.globalState.update(fullKey, false);
            }

            return isFirstTime ?? true;
        }

        return false;
    }

    public getLastSelectedElementPath(fsPath: string): LastSelectedElement | undefined {
        const key = globalStateKeys.lastSelectedElement;
        for (let i = 0; i < maxLastSelectedElements; i++) {
            const fullKey = `${key}${i}`;
            const data = this._ctx.globalState.get<LastSelectedElement>(fullKey);
            if (data && data.fileName === fsPath) {
                return data;
            }
        }

        return undefined;
    }

    public setLastSelectedElementPath(fileName: string, element: ITreeElement | undefined): void {
        if (isNullOrEmpty(fileName)) {
            return;
        }

        const key = globalStateKeys.lastSelectedElement;
        const elementPath = element ? getElementFullPath(element) : undefined;

        let updated = false;
        for (let i = 0; i < maxLastSelectedElements; i++) {
            const fullKey = `${key}${i}`;
            let data = this._ctx.globalState.get<LastSelectedElement>(fullKey);
            if (data && data.fileName === fileName) {
                if (elementPath) {
                    data = {
                        fileName: fileName,
                        elementPath,
                        elementType: element!.elementType
                    };
                    this._ctx.globalState.update(fullKey, data);
                } else {
                    this._ctx.globalState.update(fullKey, undefined);
                }
                updated = true;
                break;
            }
        }

        if (!updated && elementPath) {
            // add new
            for (let i = 0; i < maxLastSelectedElements; i++) {
                const fullKey = `${key}${i}`;
                const data = this._ctx.globalState.get<LastSelectedElement>(fullKey);
                if (!data) {
                    this._ctx.globalState.update(fullKey, { fileName, elementPath, elementType: element!.elementType });
                    break;
                }
            }
        }

        if (this._ctx.extensionMode !== vscode.ExtensionMode.Production) {
            this.dumpLastSelectedElements();
        }
    }

    private dumpLastSelectedElements(): void {
        const key = globalStateKeys.lastSelectedElement;
        const items: LastSelectedElement[] = [];
        for (let i = 0; i < maxLastSelectedElements; i++) {
            const fullKey = `${key}${i}`;
            const data = this._ctx.globalState.get<LastSelectedElement>(fullKey);
            if (data) {
                items.push(data);
            }
        }

        if (items.length === 0) {
            console.log('LastSelectedElements: <no data>');
        } else {
            console.log(`LastSelectedElements: ${items.length} items`);
            for (const item of items) {
                console.log(`  ${item.fileName} => ${item.elementPath} (${item.elementType})`);
            }
        }
    }

    public async init(ctx: vscode.ExtensionContext, reset: boolean = false): Promise<void> {
        this._ctx = ctx;

        initializeDebugMode(ctx);

        this._appConfig = new AppConfig();
        (globalThis as any).appConfig = this._appConfig;

        await this.initCultures();

        // reset global state
        if (ctx.extensionMode === vscode.ExtensionMode.Production && reset) {
            reset = false;
        }

        if (reset) {
            await this.reset();
        }

        await this.initGenerator(ctx);

        this.isEditorActive = false;
        this.setTreeSelection([]);

        this._ctx.subscriptions.push(
            vscode.commands.registerCommand(GlobalCommands.showOutput, () => {
                VsCodeLogger.showPanel();
                this._lhqEditorProvider.resetGeneratorStatus();
            }),

            vscode.workspace.onDidChangeTextDocument(this.handleDidChangeTextDocument.bind(this)),

            vscode.workspace.onWillSaveTextDocument((event: vscode.TextDocumentWillSaveEvent) => {
                this._lhqEditorProvider.onWillSaveTextDocument(event);
            }),

            vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                this._lhqEditorProvider.onDidSaveTextDocument(document);
            })
        );


        this._lhqTreeDataProvider = new LhqTreeDataProvider(this._ctx);
        this._lhqEditorProvider = new LhqEditorProvider(this._ctx, this._lhqTreeDataProvider);
        this._ctx.subscriptions.push(
            vscode.window.registerCustomEditorProvider(CustomEditorViewType, this._lhqEditorProvider, {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            })
        );

        // commands
        vscode.commands.registerCommand(GlobalCommands.createNewLhqFile, () => this.createNewLhqFile());
    }

    private async reset() {
        //const keys = Object.values(globalStateKeys);

        const keys = this._ctx.globalState.keys();
        await Promise.all(keys.map(key => this._ctx.globalState.update(key, undefined)));
    }

    private async initCultures(): Promise<void> {
        const culturesFileUri = vscode.Uri.joinPath(this._ctx.extensionUri, 'dist', 'cultures.json');

        try {
            const rawContent = await vscode.workspace.fs.readFile(culturesFileUri);
            const contentString = new TextDecoder().decode(rawContent);
            const items = JSON.parse(contentString) as CultureInfo[];
            for (const culture of items) {
                this._cultures.push(culture);
            }

        } catch (error) {
            logger().log('loadCultures', 'error', 'Failed to read or parse dist/cultures.json');
        }
    }

    public getAllCultures(): CultureInfo[] {
        return this._cultures;
    }

    public findCulture(name: string, ignoreCase: boolean = true): CultureInfo | undefined {
        if (isNullOrEmpty(name)) {
            throw new Error('Culture name cannot be null or empty');
        }

        return this._cultures.find(culture => strCompare(name, culture.name, ignoreCase));
    }

    public getCultureDesc(name: string): string {
        const culture = this.findCulture(name);
        return culture ? `${culture?.engName ?? ''} (${culture?.name ?? ''})` : name;
    }

    public async updateConfig(newConfig: Partial<IAppConfig>, target?: vscode.ConfigurationTarget): Promise<void> {
        await this._appConfig.updateConfig(newConfig, target);
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
            const hbsTemplatesDir = vscode.Uri.joinPath(context.extensionUri, 'dist', 'hbs').fsPath;

            const metadataFile = path.join(hbsTemplatesDir, 'metadata.json');
            const metadataContent = await fse.readFile(metadataFile, { encoding: 'utf-8' });
            const result = generatorUtils.validateTemplateMetadata(metadataContent);
            if (!result.success) {
                logger().log(this, 'error', `Validation of  ${metadataFile} failed: ${result.error}`);
                showNotificationBox('err', `Validation of lhq templates metadata file failed: ${result.error}`);
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
            console.log(error);
            logger().log(this, 'error', `Failed to initialize generator: ${error instanceof Error ? error.message : 'Unknown error'}`);
            showNotificationBox('err', `Failed to initialize lhq generator! Please report this issue.`);
        }
    }

    private async createNewLhqFile(): Promise<void> {
        try {
            const folder = getCurrentFolder();
            if (!folder) {
                showNotificationBox('err', 'No folder selected. Please select a folder in the Explorer view.');
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
            root.addLanguage('en', true);
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

            showNotificationBox('info', `Successfully created file: ${filePath}`);
        } catch (error) {
            logger().log(this, 'error', `Error creating new LHQ file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            showNotificationBox('err', `Error creating new LHQ file.`);
        }
    }

    public sendMessageToHtmlPage(message: AppToPageMessage): void {
        this._lhqEditorProvider.sendMessageToHtmlPage(message);
    }

    public get treeContext(): ITreeContext {
        return this._lhqTreeDataProvider;
    }

    public get languagesExpanded(): boolean {
        return this._ctx.globalState.get<boolean>(globalStateKeys.languagesExpanded, false);
    }

    public set languagesExpanded(value: boolean) {
        this._ctx.globalState.update(globalStateKeys.languagesExpanded, value);
    }

    public get readonlyMode(): boolean {
        return this._isReadonlyMode;
    }

    public set readonlyMode(value: boolean) {
        this._isReadonlyMode = value;
        vscode.commands.executeCommand('setContext', ContextKeys.isReadonlyMode, value);
        this._eventEmitter.emit(ContextEvents.isReadonlyModeChanged, value);
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