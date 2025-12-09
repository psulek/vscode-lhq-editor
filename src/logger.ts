import { AppError, isNullOrEmpty } from '@psulek/lhq-generators';
import * as vscode from 'vscode';

export type LogType = 'debug' | 'info' | 'warn' | 'error';

export type ILogger = {
    log: (ctx: string | object, level: LogType, msg: string, err?: Error) => void;
};

export class ConsoleLogger implements ILogger {
    log(ctx: string | object, level: LogType, msg: string, err?: Error | undefined): void {
        console[level](getFormattedMsg(ctx, msg), err);
    }
}

function getFormattedMsg(ctx: string | object, message: string): string {
    let prefix = '';
    if (typeof ctx === 'string') {
        prefix = ctx ?? '';
    }
    else if (ctx) {
        if (typeof ctx === 'object' && ctx.constructor && ctx.constructor.name) {
            prefix = ctx.constructor.name ?? '';
        } else {
            prefix = ctx.toString();
        }
    }

    return isNullOrEmpty(prefix) ? message : `[${prefix}] ${message}`;
}

export class VsCodeLogger implements ILogger {
    private static panel: vscode.OutputChannel | undefined;
    private _debugMode = true;

    constructor(ctx: vscode.ExtensionContext) {
        VsCodeLogger.panel = vscode.window.createOutputChannel('LHQ Editor', 'lhq-log');
        ctx.subscriptions.push(VsCodeLogger.panel);
    }

    public updateDebugMode(debug: boolean) {
        this._debugMode = debug;
    }

    public static showPanel() {
        if (VsCodeLogger.panel) {
            VsCodeLogger.panel.show();
        }
    }

    log(ctx: string | object, level: LogType, msg: string, err?: Error | undefined): void {
        //const toConsole = this._debugMode || level === 'debug';
        const toConsole = level === 'debug';
        const date = new Date().toISOString().replace('T', ' ').replace('Z', '');

        let errInfo = '';
        if (err) {
            if (err instanceof AppError) {
                errInfo = `${err.kind}|${err.code}|${err.cause} ${err.message}`;
            } else {
                errInfo = `[${err.name}] ${err.message} ${err.stack}`;
            }
        }

        msg = `${msg} ${errInfo}`;
        let text = (toConsole ? getFormattedMsg(ctx, msg) : msg);

        const lines = text.split(/\r?\n/);
        if (lines.length > 0) {
            const prefix = `${date} [${level}]`;
            text = `${prefix} ${lines[0]}`;
            if (lines.length > 1) {
                for (let i = 1; i < lines.length; i++) {
                    // text += `\n${' '.repeat(prefix.length)} ${lines[i]}`;
                    text += `\n${' '.repeat(5)} ${lines[i]}`;
                }
            }
        }

        if (toConsole) {
            if (err) {
                console.log(text, err);
            } else {
                console.log(text);
            }
            return;
        }

        VsCodeLogger.panel!.appendLine(text);
    }
}