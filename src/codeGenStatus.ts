import * as vscode from 'vscode';
import { isNullOrEmpty } from '@lhq/lhq-generators';

import { CodeGeneratorStatusInfo, CodeGeneratorStatusKind, ICodeGenStatus, IDocumentContext, StatusBarItemUpdateInfo, StatusBarItemUpdateRequestCallback } from './types';
import { ContextKeys, GlobalCommands } from './context';
import { logger, showMessageBox } from './utils';
import path from 'node:path';

type LastStatusInfo = {
    kind: CodeGeneratorStatusKind;
    updateInfo: StatusBarItemUpdateInfo;
};

export class CodeGenStatus implements ICodeGenStatus {
    private _docContext: IDocumentContext;
    private _inProgress = false;
    //private _lastStatus: CodeGeneratorStatusInfo | undefined;
    private _lastStatus: LastStatusInfo | undefined;
    private _uid = '';
    // private _statusBar: vscode.StatusBarItem;
    private readonly _requestStatusBarItemUpdate: StatusBarItemUpdateRequestCallback;

    constructor(docContext: IDocumentContext, requestStatusBarItemUpdate: StatusBarItemUpdateRequestCallback) {
        if (!docContext) {
            throw new Error('Document context is required for CodeGenStatus initialization.');
        }

        this._docContext = docContext;
        this._requestStatusBarItemUpdate = requestStatusBarItemUpdate;
        this.inProgress = false;

        this.update({ kind: 'idle' });
    }

    public get lastUid(): string {
        return this._uid;
    }

    public get inProgress(): boolean {
        return this._inProgress;
    }

    public set inProgress(value: boolean) {
        this._inProgress = value;

        vscode.commands.executeCommand('setContext', ContextKeys.generatorIsRunning, value);
    }
    
    public restoreLastStatus(): void {
        if (this._lastStatus && this._lastStatus.updateInfo) {
            //this.update(this._lastStatus);
            this._requestStatusBarItemUpdate(this._docContext, this._lastStatus.updateInfo);
        }
    }

    public update(info: CodeGeneratorStatusInfo): string {
        // updateGeneratorStatus -> returns uid of this status update

        let text = '';
        let tooltip: string | undefined;
        let command: string | undefined;
        let backgroundId: string | undefined;
        let colorId: string | undefined;

        const result = crypto.randomUUID();
        //this._lastStatus = info;
        this._uid = result;

        const suffix = ' (lhq-editor)';
        let textSuffix = true;
        //const filename = this._docContext.fileName;
        const filename = path.basename(this._docContext.fileName);
        const templateId = this._docContext.codeGeneratorTemplateId;

        switch (info.kind) {
            case 'active':
                // text = `$(sync~spin) LHQ generating code for ${filename}`;
                text = `$(sync~spin) ${filename}: generating code ...`;
                tooltip = `Running code generator template **${templateId}** ...`;
                break;

            case 'idle':
                // textSuffix = false;
                // text = '$(run-all) LHQ (template: ' + templateId + ')';
                text = `$(run-all) ` + (isNullOrEmpty(filename) ? 'LHQ' : filename);
                command = GlobalCommands.runGenerator;
                tooltip = `Click to run code generator template **${templateId}**`;
                break;

            case 'error':
                // text = `$(error) ${info.message}`;
                text = `$(error) ${filename}: ${info.message}`;
                backgroundId = 'statusBarItem.errorBackground';
                colorId = 'statusBarItem.errorForeground';
                command = GlobalCommands.showOutput;
                tooltip = `Click to see error details in output panel `;

                if (info.detail) {
                    info.message += `\n${info.detail}`;
                }

                void showMessageBox('err', info.message, { modal: false, logger: false });
                break;

            case 'status':
                const icon = info.success ? 'check' : 'error';
                // text = info.success ? `$(check) ${info.message}` : `$(error) ${info.message}`;
                text = `$(${icon}) ${filename}: ${info.message}`;
                tooltip = '';
                backgroundId = info.success
                    ? 'statusBarItem.prominentBackground'
                    : 'statusBarItem.errorBackground';
                colorId = info.success
                    ? 'statusBarItem.prominentForeground'
                    : 'statusBarItem.errorForeground';
                break;
            default:
                logger().log(this, 'debug', `updateGeneratorStatus -> Unknown status kind: ${JSON.stringify(info)}`);
        }

        if ((info.kind === 'error' || info.kind === 'status') && info.timeout && info.timeout > 0) {
            const uid = this.lastUid;
            setTimeout(() => {
                if (this.lastUid === uid) {
                    this.update({ kind: 'idle' });
                }
            }, info.timeout);
        }

        const updateInfo = {
            text: text + (textSuffix ? suffix : ''),
            backgroundColor: backgroundId === undefined ? undefined : new vscode.ThemeColor(backgroundId),
            color: colorId === undefined ? undefined : new vscode.ThemeColor(colorId),
            command: command,
            tooltip: isNullOrEmpty(tooltip) ? '' : new vscode.MarkdownString(tooltip + suffix, true)
        };

        this._lastStatus = {
            kind: info.kind,
            updateInfo: updateInfo
        };

        this._requestStatusBarItemUpdate(this._docContext, updateInfo);

        return result;
    }

    public resetGeneratorStatus(): void {
        if (this._lastStatus === undefined || this._lastStatus.kind === 'error' || !this.inProgress) {
            logger().log(this, 'debug', `resetGeneratorStatus -> Resetting generator status to idle`);
            this.update({ kind: 'idle' });
        } else {
            logger().log(this, 'debug', `resetGeneratorStatus -> Not resetting generator status`);
        }
    }
}