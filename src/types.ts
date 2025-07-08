import type { IRootModelElement, ITreeElement, TreeElementType } from '@lhq/lhq-generators';
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

// export const ContextKeys = {
//     isEditorActive: 'lhqEditorIsActive',
//     hasSelectedItem: 'lhqTreeHasSelectedItem',
//     hasMultiSelection: 'lhqTreeHasMultiSelection',
//     hasSelectedDiffParents: 'lhqTreeHasSelectedDiffParents',
//     hasLanguageSelection: 'lhqTreeHasLanguageSelection',
//     hasPrimaryLanguageSelected: 'lhqTreeHasPrimaryLanguageSelected',
//     hasLanguagesVisible: 'lhqTreeHasLanguagesVisible',
// };

//export type CulturesMap = Map<string, CultureInfo>;
export type CulturesMap = Record<string, CultureInfo>;

export type ValidationError = { message: string, detail?: string };

export type AppToPageMessage = {
    command: 'loadPage';
    element: Object;
    file: string;
    cultures: CultureInfo[];
    primaryLang: string;
} | {
    command: 'invalidData';
    fullPath: string;
    message: string;
    field: string;
} | {
    command: 'updatePaths'
    paths: string[];
}

export type PageToAppMessage = {
    command: 'update',
    data: Record<string, unknown>;
} | {
    command: 'select',
    paths: string[];
    elementType: TreeElementType
}


export interface IAppContext {
    get treeContext(): ITreeContext;

    get isEditorActive(): boolean;
    set isEditorActive(active: boolean);

    get languagesVisible(): boolean;
    set languagesVisible(visible: boolean);

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
}

export type SelectionChangedCallback = (selectedElements: ITreeElement[]) => void;