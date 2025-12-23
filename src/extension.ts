import * as vscode from 'vscode';
import { ResxEditorProvider } from './resxEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        ResxEditorProvider.register(context)
    );
}

export function deactivate() {}
