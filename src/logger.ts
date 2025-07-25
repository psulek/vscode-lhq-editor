import { AppError, isNullOrEmpty } from '@lhq/lhq-generators';
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
        const toConsole = this._debugMode || level === 'debug';

        let errInfo = '';
        if (err) {
            if (err instanceof AppError) {
                errInfo = `${err.kind}|${err.code}|${err.cause} ${err.message}`;
            } else {
                errInfo = `[${err.name}] ${err.message} ${err.stack}`;
            }
        }

        msg = `${msg} ${errInfo}`;
        const text = `[${level}] ` + (toConsole ? getFormattedMsg(ctx, msg) : msg);

        if (toConsole) {
            if (err) {
                console.log(text, err);
            } else {
                console.log(text);
            }
            return;
        }

        // if (!VsCodeLogger.panel) {
        //     VsCodeLogger.panel = vscode.window.createOutputChannel('LHQ Editor', 'lhq-log');
        // }

        VsCodeLogger.panel!.appendLine(text);
    }
}