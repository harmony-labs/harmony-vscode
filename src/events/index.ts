import * as vscode from 'vscode';
import { createVSCodeEventMessage } from '@harmony/core';
import type { VSCodeEventMessage } from '@harmony/core';
import { TerminalEventHandler } from './terminal';
import type { VSCodeEvent } from './types';

/**
 * Manages VSCode event capture and streaming to the desktop app.
 * Handles terminal, file system, editor, and other VSCode events.
 */
export class EventManager {
    private disposables: vscode.Disposable[] = [];
    private terminalHandler: TerminalEventHandler;
    private lastEditTime = 0;
    private readonly EDIT_DEBOUNCE = 1000; // 1 second debounce for edit events

    constructor(
        private readonly transport: { send: (message: VSCodeEventMessage) => Promise<void> },
        private readonly instanceId: string,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.terminalHandler = new TerminalEventHandler(this.sendEvent.bind(this));
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Terminal events via dedicated handler
        this.disposables.push(...this.terminalHandler.setupListeners());

        // File events
        const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.disposables.push(
            fileSystemWatcher,

            fileSystemWatcher.onDidCreate(uri => {
                // Skip extension output files
                if (!uri.fsPath.includes('extension-output-harmony')) {
                    this.sendEvent({
                        type: 'file',
                        action: 'create',
                        data: {
                            path: uri.fsPath
                        }
                    });
                }
            }),

            fileSystemWatcher.onDidChange(uri => {
                // Skip extension output files
                if (!uri.fsPath.includes('extension-output-harmony')) {
                    this.sendEvent({
                        type: 'file',
                        action: 'change',
                        data: {
                            path: uri.fsPath
                        }
                    });
                }
            }),

            fileSystemWatcher.onDidDelete(uri => {
                // Skip extension output files
                if (!uri.fsPath.includes('extension-output-harmony')) {
                    this.sendEvent({
                        type: 'file',
                        action: 'delete',
                        data: {
                            path: uri.fsPath
                        }
                    });
                }
            })
        );

        // Editor events
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && !editor.document.uri.fsPath.includes('extension-output-harmony')) {
                    this.sendEvent({
                        type: 'editor',
                        action: 'focus',
                        data: {
                            file: editor.document.uri.fsPath,
                            languageId: editor.document.languageId
                        }
                    });
                }
            }),

            vscode.workspace.onDidChangeTextDocument(e => {
                // Skip extension output and debounce edits
                if (!e.document.uri.fsPath.includes('extension-output-harmony')) {
                    const now = Date.now();
                    if (now - this.lastEditTime >= this.EDIT_DEBOUNCE) {
                        this.lastEditTime = now;
                        this.sendEvent({
                            type: 'editor',
                            action: 'edit',
                            data: {
                                file: e.document.uri.fsPath,
                                changes: e.contentChanges.length
                            }
                        });
                    }
                }
            })
        );

        // Debug events
        this.disposables.push(
            vscode.debug.onDidStartDebugSession(session => {
                this.sendEvent({
                    type: 'debug',
                    action: 'start',
                    data: {
                        name: session.name,
                        type: session.type
                    }
                });
            }),

            vscode.debug.onDidTerminateDebugSession(session => {
                this.sendEvent({
                    type: 'debug',
                    action: 'stop',
                    data: {
                        name: session.name,
                        type: session.type
                    }
                });
            })
        );

        this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Event listeners setup complete`);
    }

    private async sendEvent(event: VSCodeEvent): Promise<void> {
        try {
            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] [TRACE] Preparing VSCode event: ${JSON.stringify({ type: event.type, action: event.action })}`
            );

            const message = createVSCodeEventMessage(
                event.type,
                {
                    action: event.action,
                    data: event.data,
                    timestamp: Date.now()
                },
                this.instanceId
            );
            
            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] [TRACE] Sending message: ${JSON.stringify({ correlationId: message.correlationId, type: message.type })}`
            );

            await this.transport.send(message);
            
            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] [TRACE] Message sent successfully: ${message.correlationId}`
            );

            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] Sent VSCode event: ${JSON.stringify(event)}`
            );
        } catch (error) {
            const err = error as Error;
            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] Failed to send VSCode event: ${err.message}`
            );
            if (err.stack) {
                this.outputChannel.appendLine(err.stack);
            }
        }
    }

    dispose(): void {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Disposing event manager`);
        this.terminalHandler.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}