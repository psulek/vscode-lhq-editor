import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

// import {
//     modify as jsonModify, parse as jsonParse, parseTree,
//     findNodeAtLocation, visit as jsonVisit, JSONVisitor, getNodePath, Node as jsonNode,
//     format as jsonFormat, findNodeAtOffset,
//     getNodeValue, EditResult, FormattingOptions
// } from 'jsonc-parser';

// @ts-ignore
import detectIndent from 'detect-indent';


suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    // test('Sample test', () => {
    // 	assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    // 	assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    // });

    // const documentText = '{root: {sub1: {sub2: 1, sub3: 2}, sub4: 3}}';
    // const errs: any = [];
    // const opts = { allowEmptyContent: true, allowTrailingComma: true };
    // const tree = parseTree(documentText, errs as any);

    // const query = ['root', 'sub1'];
    // const node = findNodeAtLocation(tree!, query);

    // const indentation = detectIndent(documentText);

    // const formattingOptions: FormattingOptions = {
    //     insertSpaces: indentation.type === 'space',
    //     tabSize: indentation.amount,
    //     keepLines: true
    // };

    // const edits = jsonModify(documentText, query, undefined, { formattingOptions });
    // assert.notEqual(edits, undefined);

});
