import type { ITreeElement, TreeElementType } from '@lhq/lhq-generators';

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