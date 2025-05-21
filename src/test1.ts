import {
    modify as jsonModify, parse as jsonParse, parseTree,
    findNodeAtLocation, visit as jsonVisit, JSONVisitor, getNodePath, Node as jsonNode,
    format as jsonFormat, findNodeAtOffset,
    getNodeValue, EditResult, FormattingOptions,
    ParseError,
    JSONPath
} from 'jsonc-parser';

// @ts-ignore
import detectIndent from 'detect-indent';
import { getElementJsonPathInModel, IndentationType } from './utils';
import { detectLineEndings, getLineEndingsRaw } from '@lhq/lhq-generators';

let running = false;

export function test1() {
    if (running) {
        return;
    }

    running = true;

    try {
        const documentText = '{"model":{"uid":"123"},"categories":{"Category1":{"description":"This is the first category.","resources":{"Resource1":{"state":"Edited","description":"This is the first resource in Category1."},"Resource2":{"description":"This is the second resource in Category1."}}}},"resources":{"RootResource1":{"description":"This is the first resource in Root."}}}';

        const edits = moveOrDeleteJsonProperty('delete', ['resources', 'RootResource1'], undefined, documentText);
        console.log(edits);
    }
    catch (e) {
        console.error('Error:', e);
    }
    finally {
        running = false;
    }
}

function renameJsonProperty(query: JSONPath, newPropertyName: string,
    jsonText: string, indentation: IndentationType): EditResult | undefined {
    const errs: ParseError[] = [];
    const tree = parseTree(jsonText, errs, { allowEmptyContent: true, allowTrailingComma: true });

    if (tree && errs?.length === 0) {
        indentation = indentation ?? detectIndent(jsonText);

        const le = detectLineEndings(jsonText, undefined);
        const eol = le ? getLineEndingsRaw(le) : undefined;
        const formattingOptions = {
            insertSpaces: (indentation.type ?? 'space') === 'space',
            tabSize: indentation.amount,
            keepLines: true,
            eol
        } as unknown as FormattingOptions;

        return jsonModify(jsonText, query, undefined, { formattingOptions, newPropertyName } as any);
    }

    if (errs?.length > 0) {
        throw new Error('Parsing model failed: ' + errs.map(e => e.error).join(', '));
    }

    return undefined;
}

function moveOrDeleteJsonProperty(action: 'move' | 'delete', sourceQuery: JSONPath,
    targetQuery: JSONPath | undefined, jsonText: string, indentation?: IndentationType): EditResult | undefined {
    const errs: ParseError[] = [];
    const tree = parseTree(jsonText, errs, { allowEmptyContent: true, allowTrailingComma: true });

    if (tree && errs?.length === 0) {
        indentation = indentation ?? detectIndent(jsonText);

        const le = detectLineEndings(jsonText, undefined);
        const eol = le ? getLineEndingsRaw(le) : undefined;
        const formattingOptions = {
            insertSpaces: (indentation.type ?? 'space') === 'space',
            tabSize: indentation.amount,
            keepLines: true,
            eol
        } as unknown as FormattingOptions;

        // remove property from its parent
        //const sourceQuery = getElementJsonPathInModel(sourceElement);


        return jsonModify(jsonText, sourceQuery, undefined, { formattingOptions } as any);
    }

    if (errs?.length > 0) {
        throw new Error('Parsing model failed: ' + errs.map(e => e.error).join(', '));
    }

    return undefined;
}