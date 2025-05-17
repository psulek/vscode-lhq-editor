import {
    modify as jsonModify, parse as jsonParse, parseTree,
    findNodeAtLocation, visit as jsonVisit, JSONVisitor, getNodePath, Node as jsonNode,
    format as jsonFormat, findNodeAtOffset,
    getNodeValue, EditResult, FormattingOptions
} from 'jsonc-parser';

// @ts-ignore
import detectIndent from 'detect-indent';

let running = false;

export function test1() {
    if (running) {
        return;
    }

    running = true;

    try {
        const documentText = '{"root": {"sub1": {"sub2": 1, "sub3": 2}, "sub4": 3}}';
        const errs: any = [];
        const opts = { allowEmptyContent: true, allowTrailingComma: true };
        const tree = parseTree(documentText, errs as any);

        const query = ['root', 'sub1'];
        const node = findNodeAtLocation(tree!, query);

        const indentation = detectIndent(documentText);

        const formattingOptions: FormattingOptions = {
            insertSpaces: (indentation.type ?? 'space') === 'space',
            tabSize: indentation.amount,
            keepLines: true
        };

        const opts2 = { formattingOptions, newPropertyName: 'xyz' } as any;
        const edits = jsonModify(documentText, query, undefined, opts2);
        console.log(edits);
    } finally {
        running = false;
    }
}