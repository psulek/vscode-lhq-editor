import * as vscode from 'vscode';
import { isNullOrEmpty } from '@lhq/lhq-generators';

import { CodeGeneratorStatusInfo, ICodeGenStatus, LastLhqStatus } from './types';
import { Commands, ContextEvents, ContextKeys, GlobalCommands } from './context';
import { getGeneratorAppErrorMessage, logger, showMessageBox } from './utils';

export class CodeGenStatus implements ICodeGenStatus {
    private _lastLhqStatus: LastLhqStatus | undefined;
    private _inProgress = false;
    private _codeGeneratorStatus: vscode.StatusBarItem;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.inProgress = false;

        this._codeGeneratorStatus = vscode.window.createStatusBarItem('lhq.codeGeneratorStatus', vscode.StatusBarAlignment.Left, 10);
        this.updateGeneratorStatus('', { kind: 'idle' });

        // TODO: Maybe unsubscribe this status bar item when extension is deactivated?
        context.subscriptions.push(this._codeGeneratorStatus);

        appContext.on(ContextEvents.isEditorActiveChanged, (active: boolean) => {
            if (active) {
                this._codeGeneratorStatus.show();
            } else {
                this._codeGeneratorStatus.hide();
            }
        });

    }

    public get inProgress(): boolean {
        return this._inProgress;
    }

    public set inProgress(value: boolean) {
        this._inProgress = value;

        vscode.commands.executeCommand('setContext', ContextKeys.generatorIsRunning, value);
    }

    public get lastStatus(): LastLhqStatus | undefined {
        return this._lastLhqStatus;
    }

    public set lastStatus(value: LastLhqStatus | undefined) {
        this._lastLhqStatus = value;
    }

    public updateGeneratorStatus(templateId: string, info: CodeGeneratorStatusInfo): string {
        // updateGeneratorStatus -> returns uid of this status update

        templateId = templateId ?? '';
        if (isNullOrEmpty(info.kind)) {
            templateId = '';
        }

        let text = '';
        let tooltip: string | undefined;
        let command: string | undefined;
        let backgroundId: string | undefined;
        let colorId: string | undefined;
        const result = crypto.randomUUID();

        this._lastLhqStatus = {
            kind: info.kind,
            uid: result
        };

        const suffix = ' (lhq-editor)';
        let textSuffix = true;

        switch (info.kind) {
            case 'active':
                text = `$(sync~spin) LHQ generating code for ${info.filename}`;
                tooltip = `Running code generator template **${templateId}** ...`;
                break;

            case 'idle':
                textSuffix = false;
                text = '$(run-all) LHQ (template: ' + templateId + ')';
                command = GlobalCommands.runGenerator;
                tooltip = `Click to run code generator template **${templateId}**`;
                break;

            case 'error':
                text = `$(error) ${info.message}`;
                backgroundId = 'statusBarItem.errorBackground';
                colorId = 'statusBarItem.errorForeground';
                command = GlobalCommands.showOutput;
                tooltip = `Click to see error details in output panel `;

                if (info.error) {
                    info.message += `\n${getGeneratorAppErrorMessage(info.error as Error)}`;
                }

                void showMessageBox('err', info.message, { modal: false, logger: false });
                break;

            case 'status':
                text = info.success ? `$(check) ${info.message}` : `$(error) ${info.message}`;
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
            const uid = this._lastLhqStatus!.uid;
            setTimeout(() => {
                if (this._lastLhqStatus!.uid === uid) {
                    this.updateGeneratorStatus(templateId, { kind: 'idle' });
                }
            }, info.timeout);
        }

        this._codeGeneratorStatus.text = text + (textSuffix ? suffix : '');
        this._codeGeneratorStatus.backgroundColor = backgroundId === undefined ? undefined : new vscode.ThemeColor(backgroundId);
        this._codeGeneratorStatus.color = colorId === undefined ? undefined : new vscode.ThemeColor(colorId);
        this._codeGeneratorStatus.command = command;
        this._codeGeneratorStatus.tooltip = isNullOrEmpty(tooltip) ? '' : new vscode.MarkdownString(tooltip + suffix, true);

        return result;
    }
}