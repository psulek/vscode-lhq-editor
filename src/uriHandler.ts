// import * as vscode from 'vscode';
// import * as path from 'path';
// import { LhqEditorProvider_ViewType } from './constants';
// import { logger } from './utils';

// export class LhqUriHandler implements vscode.UriHandler {
//     public async handleUri(uri: vscode.Uri) {
//         //console.log(`LhqUriHandler: Received URI: ${uri.toString()}`);
//         logger().log(this, 'debug', `LhqUriHandler: Received URI: ${uri.toString()}`);

//         const { fsPath } = uri;
//         if (path.extname(fsPath) === '.lhq') {
//             try {
//                 // Create a new URI with our custom scheme.
//                 const lhqUri = vscode.Uri.parse(`lhq:${fsPath}`);
                
//                 // Use the built-in command to open the file with our custom editor.
//                 await vscode.commands.executeCommand('vscode.openWith', lhqUri, LhqEditorProvider_ViewType);
//                 logger().log(this, 'debug', `Redirected ${uri.toString()} to ${lhqUri.toString()} with editor ${LhqEditorProvider_ViewType}`);

//             } catch (error) {
//                 vscode.window.showErrorMessage(`Failed to open .lhq file: ${error}`);
//                 logger().log(this, 'error', `Error opening .lhq file: ${error}`);
//             }
//         } else {
//             logger().log(this, 'debug', `LhqUriHandler: Ignored URI for non-.lhq file: ${uri.toString()}`);
//         }
//     }
// }