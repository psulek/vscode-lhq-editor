import * as vscode from 'vscode';
import { nextTick } from 'node:process';
import { createTreeElementPaths, delay, findCulture, generateNonce, getCultureDesc, getElementFullPath, getGeneratorAppErrorMessage, isValidDocument, loadCultures, logger, showConfirmBox, showMessageBox } from './utils';
import { AppToPageMessage, ClientPageError, ClientPageModelProperties, ClientPageSettingsError, CultureInfo, ICodeGenStatus, IDocumentContext, IVirtualLanguageElement, IVirtualRootElement, NotifyDocumentActiveChangedCallback, PageToAppMessage, StatusBarItemUpdateRequestCallback, ValidationError } from './types';
import { CategoryLikeTreeElementToJsonOptions, CategoryOrResourceType, CodeGeneratorGroupSettings, detectFormatting, FormattingOptions, Generator, generatorUtils, HbsTemplateManager, ICategoryLikeTreeElement, IResourceElement, IResourceParameterElement, IResourceValueElement, IRootModelElement, isNullOrEmpty, ITreeElement, LhqModel, LhqModelResourceTranslationState, LhqValidationResult, modelConst, ModelUtils, TreeElementType } from '@lhq/lhq-generators';
import { filterTreeElements, filterVirtualTreeElements, isVirtualTreeElement, validateTreeElementName, VirtualRootElement } from './elements';
import { AvailableCommands, Commands } from './context';
import { CodeGenStatus } from './codeGenStatus';
import path from 'node:path';

type LangTypeMode = 'all' | 'neutral' | 'country';

interface LanguageQuickPickItem extends vscode.QuickPickItem {
    culture: CultureInfo;
}

interface LangTypeQuickPickItem extends vscode.QuickPickItem {
    mode: LangTypeMode;
}

const LanguageTypeModes = [
    {
        label: 'All languages',
        description: 'Select from all available languages',
        mode: 'all',
    },
    {
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        label: 'Neutral languages',
        detail: `Example: en, de, ...`,
        mode: 'neutral'
    },
    {
        label: 'Country-specific languages',
        detail: `Example: en-US , de-DE, ...`,
        mode: 'country'
    }
] as LangTypeQuickPickItem[];

type UpdateOptions = {
    forceRefresh?: boolean;
    undoRedo?: boolean;
};

export class DocumentContext implements IDocumentContext {
    private readonly _context: vscode.ExtensionContext;
    private readonly _webviewPanel: vscode.WebviewPanel;
    private readonly _codeGenStatus: CodeGenStatus;
    private readonly _onDidDispose: () => void;
    private readonly _notifyDocumentActiveChangedCallback: NotifyDocumentActiveChangedCallback;

    private _textDocument: vscode.TextDocument | undefined;
    private _selectedElements: ITreeElement[] = [];
    private _disposed = false;
    private _fileName: string | undefined;
    private _documentUri: vscode.Uri | undefined;
    private _documentText: string | undefined;
    private _jsonModel: LhqModel | undefined;
    private _documentFormatting!: FormattingOptions;
    private _rootModel!: IRootModelElement | undefined;
    private _virtualRootElement: IVirtualRootElement | undefined;
    private _pageErrors: ClientPageError[] = [];
    private _isActive = false;
    private _lastRequestPageReload = '';

    constructor(context: vscode.ExtensionContext, webviewPanel: vscode.WebviewPanel, onDidDispose: () => void,
        requestStatusBarItemUpdate: StatusBarItemUpdateRequestCallback,
        notifyDocumentActiveChangedCallback: NotifyDocumentActiveChangedCallback
    ) {
        this._context = context;
        this._webviewPanel = webviewPanel;
        this._onDidDispose = onDidDispose;
        this._notifyDocumentActiveChangedCallback = notifyDocumentActiveChangedCallback;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media'),
                vscode.Uri.joinPath(context.extensionUri, 'dist'),
            ]
        };

        this.isActive = true;
        this._codeGenStatus = new CodeGenStatus(this, requestStatusBarItemUpdate);

        this.setupEvents();
    }

    public get jsonModel(): LhqModel | undefined {
        return this._jsonModel;
    }

    public get documentFormatting(): FormattingOptions {
        return this._documentFormatting;
    }

    public get fileName(): string {
        return this._fileName ?? '';
    }

    public get documentUri(): vscode.Uri | undefined {
        return this._documentUri;
    }

    public get isActive(): boolean {
        if (this._disposed) {
            return false;
        }

        return this._isActive;

        // try {
        //     return this._webviewPanel?.active === true;
        // } catch (error) {
        //     return false;
        // }
    }

    public set isActive(value: boolean) {
        if (this._disposed) {
            logger().log(this, 'debug', `set isActive -> DocumentContext is disposed. Ignoring active state change.`);
            return;
        }

        // this is here only to trigger the error if webviewPanel is not available
        try {
            const panelActive = this._webviewPanel?.active === true;
        } catch (error) {
            return;
        }

        if (this._isActive !== value) {
            this._isActive = value;
            logger().log(this, 'debug', `set isActive -> DocumentContext(${this.fileName}) is now ${value ? 'active' : 'inactive'}.`);
            this._notifyDocumentActiveChangedCallback(this, value);
        }
    }

    public get rootModel(): IRootModelElement | undefined {
        return this._rootModel;
    }

    public get virtualRootElement(): IVirtualRootElement | undefined {
        return this._virtualRootElement;
    }

    public get resourcesUnderRoot(): boolean {
        return this._rootModel?.options.resources === 'All';
    }

    public get isTreeStructure(): boolean {
        return this._rootModel?.options.categories === true;
    }

    public get codeGeneratorTemplateId(): string {
        return this._rootModel?.codeGenerator?.templateId ?? '';
    }

    private get treeContext() {
        return appContext.treeContext;
    }

    public isSameDocument(document: vscode.TextDocument): boolean {
        if (this._disposed) {
            logger().log(this, 'debug', `isSameDocument -> DocumentContext is disposed. Ignoring document check.`);
            return false;
        }
        return !isNullOrEmpty(this._documentUri) && this._documentUri.toString() === document.uri.toString();
    }

    private getCategoryLikeParent(element: ITreeElement): ICategoryLikeTreeElement | undefined {
        if (!element) {
            return undefined;
        }

        if (element.elementType === 'resource') {
            return element.parent ?? this.rootModel;
        }

        return element.parent;
    }

    private async updateElement(element: Record<string, unknown>): Promise<void> {
        if (!element || !this._rootModel) {
            return;
        }

        const path = element.paths as string[];
        const elementType = element.elementType as TreeElementType;
        const paths = createTreeElementPaths('/' + path.join('/'), true);
        const elem = elementType === 'model'
            ? this._rootModel
            : this._rootModel.getElementByPath(paths, elementType as CategoryOrResourceType);

        interface ITranslationItem {
            valueRef: Partial<IResourceValueElement>;
            culture: CultureInfo;
            isPrimary: boolean;
        }

        if (elem && !isVirtualTreeElement(elem)) {
            const newName = (element.name as string ?? '').trim();

            const elemFullPath = getElementFullPath(elem);
            // always validate name
            const validationError = validateTreeElementName(elementType, newName, elem.parent, elemFullPath);
            if (validationError) {
                this.setPageError(elem, 'name', validationError);

                this.sendMessageToHtmlPage({
                    command: 'invalidData',
                    fullPath: elemFullPath,
                    message: validationError,
                    action: 'add',
                    field: 'name'
                });
                return;
            } else {
                if (this.removePageError(elem, 'name')) {
                    this.sendMessageToHtmlPage({
                        command: 'invalidData',
                        fullPath: elemFullPath,
                        message: '',
                        action: 'remove',
                        field: 'name'
                    });
                }
            }

            let changed = false;
            if (newName !== elem.name) {
                elem.name = newName;
                changed = true;
            }

            const newDescription = element.description as string | undefined;
            if (newDescription !== elem.description) {
                elem.description = newDescription;
                changed = true;
            }

            if (elementType === 'resource') {
                const res = elem as IResourceElement;

                const newState = element.state as LhqModelResourceTranslationState ?? 'New';
                if (res.state !== newState) {
                    res.state = newState;
                    changed = true;
                }

                // parameters
                const oldParams = res.parameters.map(x => `${x.name}:${x.order}`).join(',');
                const params = element.parameters as Array<Partial<IResourceParameterElement>>;
                const newParams = params.map(x => `${x.name}:${x.order}`).join(',');

                if (newParams !== oldParams) {
                    changed = true;
                    res.removeParameters();
                    res.addParameters(params, { existing: 'skip' });
                }

                // values
                const oldValues = res.values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');
                const values: Array<Partial<IResourceValueElement>> = (element.translations as Array<ITranslationItem>)
                    .map(x => ({
                        languageName: x.valueRef.languageName,
                        value: x.valueRef.value,
                        locked: x.valueRef.locked
                    }));
                const newValues = values.map(x => `${x.languageName}:${x.value}:${x.locked}`).join(',');

                if (newValues !== oldValues) {
                    changed = true;
                    res.removeValues();
                    res.addValues(values, { existing: 'skip' });
                }
            }

            if (changed) {
                const elemPath = getElementFullPath(elem);
                const pathChanged = elemPath !== elemFullPath;

                await this.commitChanges(`updateElement (${elemPath})`);

                if (pathChanged) {
                    await appContext.treeContext.showLoading('Renaming ...');

                    await appContext.treeContext.selectElementByPath(elem.elementType, elem.paths.getPaths(true));
                }
                else {
                    appContext.treeContext.refreshTree([elem]);
                }

                // if (pathChanged) {
                //     this.sendMessageToHtmlPage({
                //         command: 'updatePaths',
                //         paths: elem.paths.getPaths(true)
                //     });
                // }
            } else {
                logger().log(this, 'debug', `updateElement -> No changes for element '${getElementFullPath(elem)}'.`);
            }
        } else {
            logger().log(this, 'debug', `updateElement -> Element not found or is virtual: ${path.join('/')}`);
        }
    }

    public commitChanges(message: string): Promise<boolean> {
        return this.internalCommitChanges(message);
    }

    private async internalCommitChanges(message: string /* rootFix?: boolean */): Promise<boolean> {
        if (this._disposed) {
            logger().log(this, 'debug', `commitChanges [${message}] -> DocumentContext is disposed. Ignoring changes.`);
            return false;
        }

        if (!this._rootModel) {
            logger().log(this, 'debug', `commitChanges [${message}] -> No root model available.`);
            return false;
        }

        if (!this._textDocument) {
            logger().log(this, 'debug', `commitChanges [${message}] -> No text document available.`);
            return false;
        }

        this.validateDocument();
        // if (!validationResult.success) {
        //     logger().log(this, 'warn', `commitChanges [${message}] -> Validation failed: ${validationResult.error?.message}`);
        //     return false;
        // }

        // const newModel = ModelUtils.elementToModel<LhqModel>(this._rootModel!, { keepData: true, keepDataKeys: ['uid', 'undoredo'] });
        const newModel = ModelUtils.elementToModel<LhqModel>(this._rootModel!);
        const serializedRoot = ModelUtils.serializeModel(newModel, this._documentFormatting);

        const edit = new vscode.WorkspaceEdit();
        const doc = this._textDocument;
        edit.replace(
            doc.uri,
            new vscode.Range(0, 0, doc.lineCount, 0),
            serializedRoot);

        const res = await vscode.workspace.applyEdit(edit);
        if (res) {
            this._jsonModel = newModel;
        }

        logger().log(this, 'debug', `commitChanges [${message}] -> Changes applied: ${res ? 'successfully' : 'failed'}.`);

        return res;
    }

    public async update(document: vscode.TextDocument | undefined, options?: UpdateOptions): Promise<void> {
        const newFileName = document?.fileName ?? '';
        if (document && isValidDocument(document)) {
            const sameDoc = this.isSameDocument(document);

            options = Object.assign({}, { forceRefresh: false, undoRedo: false } as UpdateOptions, options);

            this._textDocument = document;
            this._fileName = newFileName;
            this._documentUri = document.uri;
            appContext.enableEditorActive();

            let requestPageReload = false;
            if (sameDoc || !this._rootModel || options.forceRefresh) {
                logger().log(this, 'debug', `update() for: ${this.fileName}, forceRefresh: ${options.forceRefresh}, undoRedo: ${options.undoRedo}`);

                let oldLangData: { primaryLang: string, langCount: number } | undefined;
                // if selected elem is resource, check if count of languages changed after undo/redo
                if (this._rootModel && this._selectedElements.length > 0 &&
                    this._selectedElements[0].elementType === 'resource' && options.undoRedo) {
                    oldLangData = {
                        primaryLang: this._rootModel.primaryLanguage,
                        langCount: this._rootModel.languages.length
                    };
                }

                this.refresh(document);

                if (oldLangData && this._rootModel) {
                    // if primary language changed, reload page
                    if (this._rootModel.primaryLanguage !== oldLangData.primaryLang ||
                        this._rootModel.languages.length !== oldLangData.langCount) {
                        requestPageReload = true;
                    }
                }
            }

            const lastRPRuid = this._lastRequestPageReload;

            appContext.treeContext.updateDocument(this);

            if (lastRPRuid === this._lastRequestPageReload && requestPageReload) {
                logger().log(this, 'debug', `update() -> Requesting page reload for: ${this.fileName} (for undoRedo)`);
                //this.sendMessageToHtmlPage({ command: 'requestPageReload' });
                this.reflectSelectedElementToWebview();
            } 

        } else if (appContext.isEditorActive) {
            //this._validationError = undefined;
            this._textDocument = undefined;
            this.refresh();

            appContext.treeContext.updateDocument(undefined);

            // NOTE: needs to be next tick to ensure treeview refresh is done before we hide it (via isEditorActive = false)
            nextTick(() => {
                appContext.disableEditorActive();
            });
        }
    }

    private refresh(document?: vscode.TextDocument): void {
        this.clearPageErrors();
        this._codeGenStatus.inProgress = false;

        if (document) {
            this._jsonModel = undefined;
            this._rootModel = undefined;
            this._virtualRootElement = undefined;

            try {
                this._documentText = document.getText();
                this._jsonModel = this._documentText?.length > 0 ? JSON.parse(this._documentText) as LhqModel : undefined;
                this._documentFormatting = detectFormatting(this._documentText);
            } catch (ex) {
                const error = `Error parsing LHQ file '${this._fileName}'`;
                logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                this._jsonModel = undefined;
                void showMessageBox('err', error);
            }

            if (this._jsonModel) {
                let validateResult: LhqValidationResult | undefined;
                const jsonModel = this._jsonModel!;

                try {
                    validateResult = generatorUtils.validateLhqModel(jsonModel);
                    if (validateResult.success && validateResult.model) {
                        this._rootModel = ModelUtils.createRootElement(validateResult.model);
                        this._virtualRootElement = new VirtualRootElement(this._rootModel);

                    } else {
                        this._jsonModel = undefined;
                    }
                } catch (ex) {
                    this._jsonModel = undefined;
                    const error = `Error validating LHQ file '${this.fileName}': ${ex}`;
                    logger().log(this, 'error', `refresh failed -> ${error}`, ex as Error);
                    void showMessageBox('err', error);
                }

                if (this._rootModel === undefined) {
                    const error = validateResult
                        ? `Validation errors while parsing LHQ file '${this.fileName}': \n${validateResult.error}`
                        : `Error validating LHQ file '${this.fileName}'`;
                    logger().log(this, 'error', `refresh failed -> ${error}`);
                    void showMessageBox('err', error);
                } else {
                    this._codeGenStatus.update({ kind: 'idle' });
                }

                this.validateDocument();
            }
        } else {
            this._jsonModel = undefined;
            this._rootModel = undefined;
            this._virtualRootElement = undefined;
        }
    }

    public resetGeneratorStatus(): void {
        this._codeGenStatus.resetGeneratorStatus();
    }

    public async runCodeGenerator(): Promise<void> {
        if (!this.jsonModel) {
            logger().log(this, 'debug', 'runCodeGenerator -> No current document or model found.');
            return;
        }

        if (this._codeGenStatus.inProgress) {
            logger().log(this, 'debug', 'runCodeGenerator -> Code generator is already in progress.');
            void showMessageBox('info', 'Code generator is already running ...');
            return;
        }

        logger().log(this, 'debug', `runCodeGenerator -> Running code generator for document ${this.documentUri}`);

        const filename = this.fileName;
        if (isNullOrEmpty(filename)) {
            logger().log(this, 'debug', `runCodeGenerator -> Document fileName is not valid (${filename}). Cannot run code generator.`);
            return;
        }

        const templateId = this.codeGeneratorTemplateId;
        logger().log(this, 'info', `Running code generator template '${templateId}' for: ${filename}`);

        this._codeGenStatus.inProgress = true;

        let beginStatusUid = '';
        let idleStatusOnEnd = true;

        try {
            beginStatusUid = this._codeGenStatus.update({ kind: 'active' });

            const validationErr = this.validateDocument(false);
            if (validationErr) {
                let msg = `Code generator failed.`;
                const detail = `${validationErr.message}\n${validationErr.detail ?? ''} for: ${filename}`;
                this._codeGenStatus.update({
                    kind: 'error',
                    message: msg,
                    detail: detail,
                });

                msg = `Code generator template '${templateId}' failed.${detail}`;
                logger().log('this', 'error', msg);
                return;
            }


            const startTime = Date.now();
            const generator = new Generator();
            const result = generator.generate(filename, this.jsonModel, {});
            const generationTime = Date.now() - startTime;

            // artificially delay the status update to show the spinner ...
            if (generationTime < 500) {
                await delay(500 - generationTime);
            }

            if (result.generatedFiles) {
                const lhqFileFolder = path.dirname(filename);
                const fileNames = result.generatedFiles.map(f => path.join(lhqFileFolder, f.fileName));
                logger().log(this, 'info', `Code generator template '${templateId}' for: ${filename} successfully generated ${fileNames.length} files:\n` +
                    `${fileNames.join('\n')}`);

                this._codeGenStatus.update({
                    kind: 'status',
                    message: `Generated ${result.generatedFiles.length} files.`,
                    success: true,
                    timeout: 2000
                });
            } else {
                this._codeGenStatus.update({
                    kind: 'error',
                    message: 'Error generating files.',
                    timeout: 5000
                });
            }
        }
        catch (error) {
            logger().log(this, 'error', `Code generator template '${templateId}' failed for: ${filename}.`, error as Error);

            this._codeGenStatus.update({
                kind: 'error',
                message: 'Code generator failed.',
                detail: getGeneratorAppErrorMessage(error as Error) + `\n For file: ${filename}.`
            });
        } finally {
            this._codeGenStatus.inProgress = false;

            if (idleStatusOnEnd) {
                setTimeout(() => {
                    if (beginStatusUid === this._codeGenStatus.lastUid) {
                        this._codeGenStatus.update({ kind: 'idle' });
                    }
                }, 2000);
            }
        }
    }

    public validateDocument(showError: boolean = true): ValidationError | undefined {
        let error = undefined;

        if (this._rootModel) {
            if (!this.resourcesUnderRoot && this._rootModel.resources.length > 0) {
                error = {
                    message: `Resources are not allowed under root!`,
                    detail: `Please change project properties to 'Allow resources under root' or move resources to categories.`
                };
            } else if (!this.isTreeStructure && this._rootModel.categories.length > 0) {
                error = {
                    message: `Categories are not allowed in flat structure!`,
                    detail: `Please change project properties 'Layout' to 'Hierarchical tree structure' or remove categories from the root.`
                };
            }
        }

        if (error) {
            if (showError === true) {
                void showMessageBox('warn', error.message, { detail: error.detail, modal: false, showDetail: 'always' });
            } else {
                // let msg = error.message;
                // if (!isNullOrEmpty(error.detail)) {
                //     msg += `\n${error.detail}`;
                // }
                // logger().log('this', 'error', msg);
            }
        }

        return error;
    }

    private setupEvents(): void {
        const didReceiveMessageSubscription = this._webviewPanel!.webview.onDidReceiveMessage(this.handleClientCommands.bind(this));
        const viewStateSubscription = this._webviewPanel!.onDidChangeViewState(this.handleChangeViewState.bind(this));

        this._context.subscriptions.push(
            this._webviewPanel!.onDidDispose(() => {
                this._disposed = true;
                logger().log(this, 'debug', `onDidDispose -> for: ${this.fileName}`);
                viewStateSubscription.dispose();
                didReceiveMessageSubscription.dispose();

                this._onDidDispose();
            })
        );
    }

    private async handleChangeViewState(e: vscode.WebviewPanelOnDidChangeViewStateEvent): Promise<void> {
        const changedPanel = e.webviewPanel;
        logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName}. Active: ${changedPanel.active}, Visible: ${changedPanel.visible}`);

        //this._notifyDocumentActiveChangedCallback(this, changedPanel.active);
        this.isActive = changedPanel.active;

        if (changedPanel.active) {
            logger().log(this, 'debug', `webviewPanel.onDidChangeViewState for ${this.fileName} became active. Updating tree and context.`);
            appContext.enableEditorActive();

            this._codeGenStatus.restoreLastStatus();

            appContext.treeContext.updateDocument(this);

            if (this._selectedElements.length > 0) {
                void appContext.treeContext.setSelectedItems(this._selectedElements);
            }
        } else {
            nextTick(() => {
                appContext.disableEditorActive();
            });
        }
    }

    private async handleClientCommands(message: PageToAppMessage): Promise<void> {
        let header = `handleClientCommand '${message.command}'`;
        if (message.command === 'select') {
            header += ` [elementType: ${message.elementType}, paths: ${message.paths.join('/')}]`;
        }

        logger().log(this, 'debug', `${header} for ${this.fileName}`);

        if (this._disposed) {
            logger().log(this, 'debug', `${header} -> DocumentContext is disposed. Ignoring message.`);
            return;
        }

        if (!this.rootModel) {
            logger().log(this, 'error', `${header} No current root model found.`);
            return;
        }

        switch (message.command) {
            case 'update':
                try {
                    const element = message.data;
                    if (element) {
                        await this.updateElement(element);
                    }
                } catch (e) {
                    logger().log(this, 'error', `${header} - error parsing element data: ${e}`);
                    return;
                }
                break;
            case 'select':
                try {
                    const reload = message.reload ?? false;
                    if (reload) {
                        await appContext.treeContext.clearSelection();
                    }

                    await appContext.treeContext.selectElementByPath(message.elementType, message.paths, true);
                } catch (e) {
                    logger().log(this, 'error', `${header} - error selecting element: ${e}`);
                    return;
                }
                break;
            case 'saveProperties': {
                const error = await this.saveModelProperties(message.modelProperties);
                if (error) {
                    logger().log(this, 'error', `${header} - error saving properties: ${error.message}`);
                }
                this.sendMessageToHtmlPage({ command: 'savePropertiesResult', error });
                break;
            }
            case 'confirmQuestion': {
                const text = message.message;
                const detail = message.detail;
                const warn = message.warning ?? false;

                await delay(100);
                const confirmed = await showConfirmBox(text, detail, warn);

                let result: unknown | undefined;
                switch (message.id) {
                    case 'resetSettings':
                        result = this.rootModel?.codeGenerator?.settings ?? {} as CodeGeneratorGroupSettings;
                        break;
                }

                this.sendMessageToHtmlPage({ command: 'confirmQuestionResult', id: message.id, confirmed, result });
                break;
            }
            case 'showInputBox': {
                const result = await vscode.window.showInputBox({
                    prompt: message.prompt,
                    placeHolder: message.placeHolder,
                    title: message.title,
                    value: message.value,
                    ignoreFocusOut: true,
                    validateInput: value => {
                        if (message.id === 'editElementName') {
                            const data = message.data as { elementType: TreeElementType, paths: string[] };
                            const elem = appContext.treeContext.getElementByPath(data.elementType, data.paths);
                            if (elem) {
                                return validateTreeElementName(elem.elementType, value, elem.parent);
                            }
                        }

                        return undefined;
                    }
                });

                this.sendMessageToHtmlPage({ command: 'showInputBoxResult', id: message.id, result });
                break;
            }
        }
    }

    public onSelectionChanged(selectedElements: ITreeElement[]): void {
        if (this._disposed) {
            logger().log(this, 'debug', `onSelectionChanged -> DocumentContext is disposed. Ignoring selection change.`);
            return;
        }

        this._selectedElements = selectedElements ?? [];
        this.reflectSelectedElementToWebview();
    }

    public async loadEmptyPage(): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `loadEmptyPage -> DocumentContext is disposed. Ignoring load request.`);
            return;
        }

        this._webviewPanel.webview.html = await this.getHtmlForWebview(true);
    }

    public async updateWebviewContent(): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `updateWebviewContent -> DocumentContext is disposed. Ignoring update request.`);
            return;
        }

        this._webviewPanel.webview.html = await this.getHtmlForWebview(false);

        const templatesMetadata = HbsTemplateManager.getTemplateDefinitions();
        this.sendMessageToHtmlPage({ command: 'init', templatesMetadata });
    }

    public reflectSelectedElementToWebview(): void {
        if (this._disposed) {
            logger().log(this, 'debug', `reflectSelectedElementToWebview -> DocumentContext is disposed. Ignoring selection change.`);
            return;
        }

        if (!this._webviewPanel || !this._webviewPanel.webview || !this.rootModel) {
            return;
        }

        const rootModel = this.rootModel;
        const element = this._selectedElements.length > 0 ? this._selectedElements[0] : rootModel;

        if (element === undefined || isVirtualTreeElement(element)) {
            return;
        }

        this.clearPageErrors();

        const cultures = rootModel.languages.map(lang => findCulture(lang)).filter(c => !!c);
        const toJsonOptions: CategoryLikeTreeElementToJsonOptions = {
            includeCategories: false,
            includeResources: false
        };

        const autoFocus = appContext.getConfig().autoFocusEditor;

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
            },
            autoFocus
        };

        this.sendMessageToHtmlPage(message);
    }

    private async getHtmlForWebview(emptyPage: boolean): Promise<string> {
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
        if (this._disposed) {
            logger().log(this, 'debug', `sendMessageToHtmlPage -> DocumentContext is disposed. Ignoring message '${message.command}'.`);
            return;
        }

        try {
            if (this._webviewPanel && this._webviewPanel.webview) {
                if (this._webviewPanel.active) {
                    this._webviewPanel.webview.postMessage(message);
                } else {
                    logger().log(this, 'debug', `sendMessage() skipped for message '${message.command}' -> WebviewPanel is not active.`);
                }
            }
        } catch (error) {
            logger().log(this, 'error', `sendMessageToHtmlPage: Error sending message '${message.command}': ${error}`);
        }
    }

    public clearPageErrors(): void {
        this._pageErrors = [];
    }

    private setPageError(element: ITreeElement, field: string, message: string): void {
        const elemFullPath = getElementFullPath(element);
        const item = this._pageErrors.find(x => x.fullPath === elemFullPath && x.field === field);
        if (item) {
            item.message = message;
        } else {
            this._pageErrors.push({
                fullPath: elemFullPath,
                field,
                message
            });
        }
    }

    private hasPageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        return this._pageErrors.some(x => x.fullPath === elemFullPath && x.field === field);
    }

    private removePageError(element: ITreeElement, field: string): boolean {
        const elemFullPath = getElementFullPath(element);
        const index = this._pageErrors.findIndex(x => x.fullPath === elemFullPath && x.field === field);
        if (index >= 0) {
            this._pageErrors.splice(index, 1);
        }

        return index >= 0;
    }

    public async saveModelProperties(modelProperties: ClientPageModelProperties): Promise<ClientPageSettingsError | undefined> {
        if (!this._rootModel || !modelProperties) {
            return;
        }

        let result: ClientPageSettingsError | undefined;

        try {
            const root = this._rootModel;

            root.options.categories = modelProperties.categories;
            root.options.resources = modelProperties.categories ? modelProperties.resources : 'All';

            const templateId = modelProperties.codeGenerator.templateId;

            const validateResult = ModelUtils
                .getCodeGeneratorSettingsConvertor()
                .validateSettings(templateId, modelProperties.codeGenerator.settings);

            if (isNullOrEmpty(validateResult.error)) {
                const codeGenerator = ModelUtils.createCodeGeneratorElement(templateId, modelProperties.codeGenerator.settings);
                root.codeGenerator = codeGenerator;

                const success = await this.commitChanges('saveModelProperties');

                if (success) {
                    void showMessageBox('info', 'Project properties was successfully changed.');
                }
            } else {
                result = {
                    group: validateResult.group,
                    name: validateResult.property,
                    message: validateResult.error
                };
            }
        } catch (error) {
            result = {
                group: '',
                name: '',
                message: 'Unknown error occurred while saving model properties.'
            };
            logger().log(this, 'error', `saveModelProperties -> Error saving model properties: ${result.message}`, error as Error);
        }

        return result;
    }

    public handleVsCommand(command: AvailableCommands, treeElement: ITreeElement): Promise<void> {
        if (this._disposed) {
            logger().log(this, 'debug', `deleteElement -> DocumentContext is disposed. Ignoring delete request.`);
            return Promise.resolve();
        }

        switch (command) {
            case Commands.addElement:
                return this.addItem(treeElement);
            case Commands.renameElement:
                return this.renameItem(treeElement);
            case Commands.deleteElement:
                return this.deleteElement(treeElement);
            case Commands.findInTreeView:
                return this.findInTreeView();
            case Commands.advancedFind:
                return this.advancedFind();
            case Commands.addCategory:
                return this.addCategory(treeElement);
            case Commands.addResource:
                return this.addResource(treeElement);
            case Commands.addLanguage:
                return this.addLanguage(treeElement);
            case Commands.deleteLanguage:
                return this.deleteLanguage(treeElement);
            case Commands.markLanguageAsPrimary:
                return this.markLanguageAsPrimary(treeElement);
            case Commands.showLanguages:
                return this.toggleLanguages(true);
            case Commands.hideLanguages:
                return this.toggleLanguages(false);
            case Commands.projectProperties:
                return this.showProjectProperties();
            case Commands.focusTree:
                return this.focusTree();
            case Commands.focusEditor:
                return this.focusEditor();
        }

        return Promise.resolve();
    }

    private requestPageReload(): void {
        if (this._disposed) {
            logger().log(this, 'debug', `requestPageReload -> DocumentContext is disposed. Ignoring reload page request.`);
            return;
        }

        if (!this._rootModel) {
            return;
        }

        this._lastRequestPageReload = crypto.randomUUID();

        // reload actual page with element data
        this.sendMessageToHtmlPage({ command: 'requestPageReload' });
    }


    // ========================== 
    // Commands for VS Code
    // ==========================

    private async addItem(element: ITreeElement, newItemType?: CategoryOrResourceType): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selectedCount = this._selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        const rootModel = this._rootModel;

        function canCreateCategory(): boolean {
            if (!rootModel.options.categories) {
                void showMessageBox('info', `Cannot add new category!`, {
                    detail: `Categories are disabled in project properties. \nPlease enable 'Categories' in project properties to add new categories.`,
                    modal: true
                });
                return false;
            }

            return true;
        }

        if (newItemType === 'category' && !canCreateCategory()) {
            return;
        }

        if (element && selectedCount === 1 && element !== this._selectedElements[0]) {
            await this.treeContext.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this._selectedElements.length > 0 ? this._selectedElements[0] : undefined);
        element = element ?? rootModel!;

        if (!this._rootModel || !element) {
            return;
        }

        if (element.elementType === 'resource') {
            element = element.parent || element.root;
        }

        function canCreateResource(): boolean {
            if (rootModel.options.resources === 'Categories' && element.isRoot) {
                void showMessageBox('info', `Cannot add new resource!`, {
                    detail: `Resources are under root are not allowed (only under category).\n` +
                        `Please enable 'Resources under root' in project properties.`,
                    modal: true
                });

                return false;
            }

            return true;
        }

        if (newItemType === 'resource' && !canCreateResource()) {
            return;
        }

        const elemPath = getElementFullPath(element);
        const showSelector = isNullOrEmpty(newItemType);

        const itemType = showSelector
            ? await vscode.window.showQuickPick([
                {
                    label: 'Category',
                    elementType: 'category' as TreeElementType
                },
                {
                    label: 'Resource',
                    elementType: 'resource' as TreeElementType
                }
            ], { placeHolder: `Select element type to add under ${elemPath}` })
            : { elementType: newItemType };

        if (!itemType) {
            return;
        }

        if (showSelector && (
            (itemType.elementType === 'category' && !canCreateCategory()) ||
            (itemType.elementType === 'resource' && !canCreateResource())
        )) {
            return;
        }

        setTimeout(() => {
            void this.addItemComplete(element, itemType.elementType);
        }, 100);
    }

    private async addItemComplete(parent: ITreeElement, elementType: TreeElementType) {
        try {
            const isResource = elementType === 'resource';
            const parentCategory = parent as ICategoryLikeTreeElement;
            const elemPath = getElementFullPath(parent);
            const itemName = await vscode.window.showInputBox({
                prompt: `Enter new ${elementType} name (${elemPath})`,
                ignoreFocusOut: true,
                validateInput: value => validateTreeElementName(elementType, value, parentCategory)
            });

            if (!itemName) {
                return;
            }

            // after previous await, document can be closed now...
            if (!this._rootModel) {
                return;
            }

            const validationError = validateTreeElementName(elementType, itemName, parentCategory);
            if (validationError) {
                return await showMessageBox('warn', validationError);
            }

            // do not allow resources under root if not enabled in project properties
            if (!this.resourcesUnderRoot && isResource && parentCategory.elementType === 'model') {
                return await showMessageBox('warn', `Resources are not allowed under root!`,
                    {
                        detail: `Cannot add resource '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                            `NOTE: 'Resources under root' can be enabled in project properties.`, modal: true
                    });
            }
            // do not allow categories in flat structure
            if (!this.isTreeStructure && !isResource && parentCategory.elementType === 'model') {
                return await showMessageBox('warn', `Categories are not allowed in flat structure!`,
                    {
                        detail: `Cannot add category '${itemName}' under root element '${getElementFullPath(parent)}'.\n\n` +
                            `NOTE: 'Hierarchical tree structure' can be enabled in project properties.`, modal: true
                    });
            }

            let newElement: ITreeElement;
            if (isResource) {
                newElement = parentCategory.addResource(itemName);
            } else {
                newElement = parentCategory.addCategory(itemName);
            }

            //setTreeElementUid(newElement);

            await this.commitChanges('addItemComplete');

            this.treeContext.refreshTree([parent]);
            await this.treeContext.revealElement(newElement, { expand: true, select: true, focus: true });

            return await showMessageBox('info', `Added new ${elementType} '${itemName}' under '${getElementFullPath(parent)}'`);
        } catch (error) {
            logger().log(this, 'error', `addItemComplete -> Failed to add new ${elementType} under '${getElementFullPath(parent)}'`, error as Error);
        }
    }

    private async renameItem(element: ITreeElement): Promise<void> {
        const selectedCount = this._selectedElements.length;
        if (selectedCount > 1) {
            return;
        }

        if (element && selectedCount === 1 && element !== this._selectedElements[0]) {
            await this.treeContext.setSelectedItems([element], { focus: true, expand: false });
        }

        element = element || (this._selectedElements.length > 0 ? this._selectedElements[0] : undefined);
        if (!this._rootModel || !element) {
            return;
        }

        this.sendMessageToHtmlPage({ command: 'requestRename' });

        // const originalName = element.name;
        // const elemPath = getElementFullPath(element);

        // const elementType = element.elementType;
        // const parentElement = this.getCategoryLikeParent(element);
        // const newName = await vscode.window.showInputBox({
        //     prompt: `Enter new name for ${elementType} '${originalName}' (${elemPath})`,
        //     value: originalName,
        //     ignoreFocusOut: true,
        //     validateInput: value => validateTreeElementName(elementType, value, parentElement, elemPath)
        // });

        // if (!newName || newName === originalName) {
        //     return;
        // }

        // const validationError = validateTreeElementName(elementType, newName, parentElement, elemPath);
        // if (validationError) {
        //     return showMessageBox('warn', validationError);
        // }

        // // after previous await, document can be closed now...
        // if (!this._rootModel) {
        //     return;
        // }

        // element.name = newName;
        // const success = await this.commitChanges('renameItem');

        // await appContext.treeContext.showLoading('Renaming ...');
        // this.treeContext.refreshTree([element]);
        // await this.treeContext.revealElement(element, { expand: true, select: true, focus: true });


        // if (!success) {
        //     const err = `Failed to rename ${elementType} '${originalName}' to '${newName}' (${elemPath})`;
        //     logger().log(this, 'error', err);
        //     return await showMessageBox('err', err);
        // }
    }

    private async deleteElement(element: ITreeElement): Promise<void> {
        if (!this.rootModel) {
            return;
        }

        const elemsToDelete = filterTreeElements(element && this._selectedElements.length <= 1 ? [element] : this._selectedElements);
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const firstSelected = elemsToDelete[0];
        if (firstSelected.isRoot) {
            return await showMessageBox('warn', `Cannot delete root element '${getElementFullPath(firstSelected)}'.`, { modal: true });
        }

        const elemIdent = selectedCount === 1
            ? `${firstSelected.elementType} '${getElementFullPath(firstSelected)}'`
            : `${selectedCount} selected elements`;

        if (selectedCount > 1) {
            const firstParent = firstSelected.parent;
            if (!elemsToDelete.every(item => item.parent === firstParent)) {
                return await showMessageBox('warn', `Cannot delete ${elemIdent} with different parents.`, { modal: true });
            }
        }

        if (!(await showConfirmBox(`Delete ${elemIdent} ?`))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        logger().log(this, 'info', `Deleting ${elemIdent} ...`);

        let parentToSelect: ICategoryLikeTreeElement | undefined;
        let deletedCount = 0;
        let notDeletedCount = 0;
        elemsToDelete.forEach(elem => {
            const parent = this.getCategoryLikeParent(elem);
            if (parent) {
                if (elemsToDelete.length === 1) {
                    parentToSelect = parent;
                }
                parent.removeElement(elem);
                deletedCount++;
            } else {
                notDeletedCount++;
            }
        });

        const success = await this.commitChanges('deleteElement');

        logger().log(this, 'debug', `Deleting ${elemIdent} ${success ? 'suceed' : 'failed'} where ${deletedCount} element(s) was deleted` +
            (notDeletedCount > 0 ? ` and failed to delete ${notDeletedCount} elements (no parent found).` : '.'));

        this.treeContext.refreshTree(parentToSelect ? [parentToSelect] : undefined);
        if (parentToSelect) {
            await this.treeContext.revealElement(parentToSelect, { expand: true, select: true });
        }

        await showMessageBox(success ? 'info' : 'err', success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`);
    }

    private async findInTreeView(): Promise<void> {
        // await vscode.commands.executeCommand('lhqTreeView.focus');
        await vscode.commands.executeCommand(Commands.focusTree);
        await vscode.commands.executeCommand('list.find', 'lhqTreeView');
    }

    private advancedFind(): Promise<void> {
        return this.treeContext.advancedFind();
    }

    private async addCategory(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'category');
    }

    private async addResource(element: ITreeElement): Promise<void> {
        return await this.addItem(element, 'resource');
    }

    private async addLanguage(element: ITreeElement): Promise<void> {
        const selected = await vscode.window.showQuickPick(LanguageTypeModes, {
            placeHolder: `Select type of languages to select from`,
            ignoreFocusOut: true
        });

        if (!selected) {
            return;
        }

        setTimeout(() => {
            void this.addLanguageComplete(selected.mode);
        }, 100);
    }

    private async addLanguageComplete(langTypeMode: LangTypeMode): Promise<void> {
        const cultures = await loadCultures();
        const langRoot = this.virtualRootElement!.languagesRoot;

        const languagesQuickPickItems = Object.values(cultures)
            .filter(culture => {
                if (langRoot.contains(culture.name)) {
                    return false;
                }

                if (langTypeMode === 'all') {
                    return true;
                }

                return langTypeMode === 'neutral' ? culture.isNeutral : !culture.isNeutral;
            })
            .map(culture => ({
                label: culture.name + (culture.isNeutral ? ' (neutral)' : ''),
                description: culture.engName,
                detail: culture.nativeName,
                culture
            }) as LanguageQuickPickItem);

        const result = await vscode.window.showQuickPick(languagesQuickPickItems, {
            canPickMany: true, ignoreFocusOut: true,
            matchOnDescription: true, matchOnDetail: true, placeHolder: 'Select languages to add'
        });

        if (!result || result.length === 0) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const added: string[] = [];
        result.map(item => item.culture.name).forEach(cultureName => {
            if (this.rootModel?.addLanguage(cultureName)) {
                const culture = cultures[cultureName];
                if (culture) {
                    added.push(`${culture.engName} (${culture.name})`);
                }
            }
        });

        await this.commitChanges('addLanguageComplete');

        await this.treeContext.clearSelection(true);
        langRoot.refresh();

        this.treeContext.refreshTree([langRoot]);
        await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

        // reload actual page with element data to show new primary language
        this.requestPageReload();

        if (added.length > 0) {
            const maxDisplayCount = 5;
            const addedStr = added.length === 1
                ? `language: ${added[0]}`
                : added.length <= maxDisplayCount
                    ? `${added.length} languages: ` + added.slice(0, maxDisplayCount).join(', ')
                    : `${added.length} languages`;
            await showMessageBox('info', `Succesfully added ${addedStr} .`);
        } else {
            await showMessageBox('warn', `No languages were added as they already exist in the model.`);
        }
    }

    private async deleteLanguage(element: ITreeElement): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selectedElems = element && this._selectedElements.length <= 1 ? [element] : this._selectedElements;
        const elemsToDelete = filterVirtualTreeElements<IVirtualLanguageElement>(selectedElems, 'language');
        const selectedCount = elemsToDelete.length;
        if (selectedCount === 0) { return; }

        const restCount = Math.max(0, this.rootModel!.languages.length - selectedCount);
        if (restCount === 0) {
            return await showMessageBox('warn', `Cannot delete all languages. At least one language must remain.`, { modal: true });
        }

        const primaryLang = elemsToDelete.find(x => x.isPrimary);
        if (primaryLang) {
            const msg = selectedCount === 1
                ? `Primary language '${getCultureDesc(primaryLang.name)}' cannot be deleted.`
                : `Selected languages contain primary language '${getCultureDesc(primaryLang.name)}' which cannot be deleted.`;
            return await showMessageBox('warn', msg, { modal: true });
        }

        const maxDisplayCount = 10;

        const elemIdent = selectedCount === 1
            ? getCultureDesc(elemsToDelete[0].name)
            : selectedCount <= maxDisplayCount
                ? elemsToDelete.slice(0, maxDisplayCount).map(x => `'${getCultureDesc(x.name)}'`).join(', ')
                : '';


        const detail = selectedCount > maxDisplayCount ? '' : `Selected languages to delete: \n${elemIdent}\n\n` + 'This will remove all translations for those languages!';
        if (!(await showConfirmBox(`Delete ${selectedCount} languages ?`, detail, true))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const root = this._rootModel!;
        elemsToDelete.forEach(elem => {
            if (!root.removeLanguage(elem.name)) {
                logger().log(this, 'error', `deleteLanguage -> Cannot delete language '${elem.name}' - not found in model.`);
            }
        });

        const success = await this.commitChanges('deleteLanguage');

        const langRoot = this._virtualRootElement!.languagesRoot;

        await this.treeContext.clearSelection(true);
        langRoot.refresh();

        this.treeContext.refreshTree([langRoot]);
        await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

        // reload actual page with element data to show new primary language
        this.requestPageReload();

        await showMessageBox(success ? 'info' : 'err',
            success ? `Successfully deleted ${elemIdent}.` : `Failed to delete ${elemIdent}.`, { modal: !success });
    }

    private async markLanguageAsPrimary(element: ITreeElement): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        const selElems = element && this._selectedElements.length <= 1 ? [element] : this._selectedElements;
        const selectedElements = filterVirtualTreeElements<IVirtualLanguageElement>(selElems, 'language');
        const selectedCount = selectedElements.length;
        if (selectedCount === 0) { return; }

        if (selectedCount > 1) {
            return await showMessageBox('warn', `Cannot mark multiple languages as primary. Please select only one language.`, { modal: true });
        }

        const langElement = selectedElements[0];

        if (this._rootModel!.primaryLanguage === langElement.name) {
            return await showMessageBox('info', `Language '${getCultureDesc(langElement.name)}' is already marked as primary.`);
        }

        if (!(await showConfirmBox(`Mark language '${getCultureDesc(langElement.name)}' as primary ?`))) {
            return;
        }

        // after previous await, document can be closed now...
        if (!this._rootModel) {
            return;
        }

        const langRoot = this._virtualRootElement!.languagesRoot;

        this._rootModel!.primaryLanguage = langElement.name;
        const success = await this.commitChanges('markLanguageAsPrimary');

        if (success) {
            await this.treeContext.clearSelection(true);

            this.treeContext.refreshTree([langRoot]);
            await this.treeContext.revealElement(langRoot, { expand: true, select: true, focus: true });

            // reload actual page with element data to show new primary language
            this.requestPageReload();
        }

        await showMessageBox(success ? 'info' : 'err', success
            ? `Successfully marked '${getCultureDesc(langElement.name)}' as primary language.`
            : `Failed to mark '${getCultureDesc(langElement.name)}' as primary language.`, { modal: !success });
    }

    private async toggleLanguages(visible: boolean): Promise<void> {
        appContext.languagesVisible = visible;

        if (!this._virtualRootElement) {
            return;
        }

        this.treeContext.refreshTree(undefined);
        this._virtualRootElement.refresh();

        const langRoot = this._virtualRootElement!.languagesRoot;
        await this.treeContext.revealElement(langRoot, { select: true, focus: false, expand: true });
    }

    private async showProjectProperties(): Promise<void> {
        if (!this._rootModel) {
            return;
        }

        appContext.sendMessageToHtmlPage({ command: 'showProperties' });
    }

    private async focusTree(): Promise<void> {
        await this.treeContext.clearSelection(true);
    }

    private focusEditor(): Promise<void> {
        if (this._webviewPanel && this._webviewPanel.webview) {
            this.sendMessageToHtmlPage({ command: 'focus' });
        }

        return Promise.resolve();
    }
}