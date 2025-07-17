import type { CodeGeneratorGroupSettings, ICodeGeneratorElement, IRootModelElement, ITreeElement, LhqModelOptionsResources, TemplateMetadataDefinition, TreeElementType } from '@lhq/lhq-generators';
import type { TextDocument, Uri, Webview } from 'vscode';

export type SearchTreeKind = 'path' | 'name' | 'translation' | 'language';

export type SearchTreeOptionsBase = {
    uid: string;
    searchText: string;
    filter?: string;
    elems: Array<MatchingElement>;
    elemIdx?: number;
};

export type MatchForSubstringResult = {
    match: 'equal' | 'contains' | 'none';
    highlights?: [number, number][];
}

export type MatchingElement = {
    element: ITreeElement; match: MatchForSubstringResult; leaf: boolean;
};

export type SearchTreeOptions =
    SearchTreeOptionsBase & { type: Exclude<SearchTreeKind, 'path'> } |
    SearchTreeOptionsBase & {
        type: 'path';
        paths: string[];
    };


export type VirtualElementType = 'treeRoot' | 'languages' | 'language';

export interface IVirtualTreeElement extends ITreeElement {
    get virtualElementType(): VirtualElementType;
}

export interface IVirtualLanguageElement extends IVirtualTreeElement {
    //get culture(): CultureInfo;
    get isPrimary(): boolean;
}

export type AppTreeElementType = TreeElementType | VirtualElementType;

export type CultureInfo = {
    name: string;
    engName: string;
    nativeName: string;
    lcid: number;
    isNeutral: boolean;
}

export type CulturesMap = Record<string, CultureInfo>;

export type ValidationError = { message: string, detail?: string };

export type ClientPageError = {
    field: string;
    fullPath: string;
    message: string;
};

export type ClientPageModelProperties = {
    resources: LhqModelOptionsResources;
    categories: boolean;
    modelVersion: number;
    visible: boolean;
    codeGenerator: ICodeGeneratorElement;
}

export type ClientPageSettingsError = {
    group: string;
    name: string;
    message: string;
}

export type AppToPageMessage = {
    command: 'init';
    templatesMetadata: Record<string, TemplateMetadataDefinition>;
} | {
    command: 'loadPage';
    element: Object;
    file: string;
    cultures: CultureInfo[];
    primaryLang: string;
    modelProperties: ClientPageModelProperties;
} | {
    command: 'invalidData';
    action: 'add' | 'remove';
} & ClientPageError |
{
    command: 'updatePaths'
    paths: string[];
} |
{
    command: 'showProperties';
} |
{
    command: 'savePropertiesResult';
    error?: ClientPageSettingsError | undefined;
};

export type PageToAppMessage = {
    command: 'update',
    data: Record<string, unknown>;
} | {
    command: 'select',
    paths: string[];
    elementType: TreeElementType
} | {
    command: 'saveProperties',
    modelProperties: ClientPageModelProperties;
};


export interface IAppContext {
    get treeContext(): ITreeContext;

    get isEditorActive(): boolean;
    set isEditorActive(active: boolean);

    get languagesVisible(): boolean;
    set languagesVisible(visible: boolean);

    clearContextValues(): void;
    getFileUri(...pathParts: string[]): Uri;
    getPageHtml(): Promise<string>;
    getMediaUri(webview: Webview, filename: string, themed?: boolean): Uri
    setSelectionChangedCallback(callback: SelectionChangedCallback): void;
    setTreeSelection(selectedElements: ITreeElement[]): void;
    sendMessageToHtmlPage(message: AppToPageMessage): void;
}

export interface ITreeContext {
    get currentRootModel(): IRootModelElement | undefined;

    updateElement(element: Record<string, unknown>): Promise<void>;

    updateDocument(document: TextDocument | undefined): Promise<void>;

    selectElementByPath(elementType: TreeElementType, path: string[]): Promise<void>;

    saveModelProperties(modelProperties: ClientPageModelProperties): Promise<ClientPageSettingsError | undefined>;

    clearPageErrors(): void;
}

export type SelectionChangedCallback = (selectedElements: ITreeElement[]) => void;

export type SelectionBackup = Array<{
    type: TreeElementType;
    fullPath: string;
}>;