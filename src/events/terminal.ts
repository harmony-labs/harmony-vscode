import * as vscode from 'vscode';
import type { VSCodeEvent } from './types';

interface TerminalState {
    id: string;
    name: string;
    type: string;
    shellType?: string;
    lastCommand?: string;
}

export class TerminalEventHandler {
    private terminals = new Map<string, TerminalState>();
    private writeEmitter: vscode.EventEmitter<string>;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private readonly sendEvent: (event: VSCodeEvent) => Promise<void>
    ) {
        this.writeEmitter = new vscode.EventEmitter<string>();
        this.outputChannel = vscode.window.createOutputChannel('Harmony Terminal Events');
    }

    setupListeners(): vscode.Disposable[] {
        return [
            // Terminal lifecycle events
            vscode.window.onDidOpenTerminal(async terminal => {
                // Wait for processId to be available
                const processId = await terminal.processId;
                const id = processId?.toString() || 'unknown';
                
                this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Terminal opened: ${id}`);
                
                // Store terminal state
                this.terminals.set(id, {
                    id,
                    name: terminal.name,
                    type: 'integrated'
                });

                // Send open event
                await this.sendEvent({
                    type: 'terminal',
                    action: 'open',
                    data: {
                        id,
                        name: terminal.name,
                        type: 'integrated'
                    }
                });

                // Try to detect shell type
                this.detectShellType(terminal);

                // Send initial shell info
                terminal.sendText('echo $SHELL', true);
            }),

            vscode.window.onDidCloseTerminal(async terminal => {
                const processId = await terminal.processId;
                const id = processId?.toString() || 'unknown';
                
                this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Terminal closed: ${id}`);
                
                // Send close event
                await this.sendEvent({
                    type: 'terminal',
                    action: 'close',
                    data: {
                        id,
                        exitCode: terminal.exitStatus?.code
                    }
                });

                // Clean up state
                this.terminals.delete(id);
            }),

            // Terminal state events
            vscode.window.onDidChangeActiveTerminal(async terminal => {
                if (terminal) {
                    const processId = await terminal.processId;
                    const id = processId?.toString() || 'unknown';
                    
                    this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Terminal focused: ${id}`);
                    
                    await this.sendEvent({
                        type: 'terminal',
                        action: 'focus',
                        data: {
                            id,
                            name: terminal.name
                        }
                    });
                }
            }),

            vscode.window.onDidChangeTerminalState(async terminal => {
                const processId = await terminal.processId;
                const id = processId?.toString() || 'unknown';
                const state = this.terminals.get(id);
                
                if (state) {
                    this.outputChannel.appendLine(`[${new Date().toISOString()}] [TRACE] Terminal state changed: ${id}`);
                    
                    await this.sendEvent({
                        type: 'terminal',
                        action: 'state',
                        data: {
                            id,
                            name: terminal.name,
                            shellType: state.shellType,
                            lastCommand: state.lastCommand
                        }
                    });
                }
            }),

            // Command execution
            vscode.commands.registerCommand('workbench.action.terminal.sendSequence', async args => {
                const terminal = vscode.window.activeTerminal;
                if (!terminal) return;

                const processId = await terminal.processId;
                const id = processId?.toString() || 'unknown';
                const state = this.terminals.get(id);
                if (!state) return;

                // Update last command
                state.lastCommand = args.text.trim();
                
                this.outputChannel.appendLine(
                    `[${new Date().toISOString()}] [TRACE] Terminal command: ${id} - ${state.lastCommand}`
                );

                // Send command event
                await this.sendEvent({
                    type: 'terminal',
                    action: 'command',
                    data: {
                        id,
                        command: state.lastCommand
                    }
                });
            }),

            // Cleanup
            this.writeEmitter,
            this.outputChannel
        ];
    }

    private async detectShellType(terminal: vscode.Terminal): Promise<void> {
        const processId = await terminal.processId;
        const id = processId?.toString() || 'unknown';
        const state = this.terminals.get(id);
        
        if (state) {
            // Try to detect shell type from terminal name or environment
            let shellType = 'unknown';
            if (terminal.name.toLowerCase().includes('bash')) {
                shellType = 'bash';
            } else if (terminal.name.toLowerCase().includes('zsh')) {
                shellType = 'zsh';
            } else if (terminal.name.toLowerCase().includes('powershell')) {
                shellType = 'powershell';
            } else if (terminal.name.toLowerCase().includes('cmd')) {
                shellType = 'cmd';
            }

            state.shellType = shellType;
            
            this.outputChannel.appendLine(
                `[${new Date().toISOString()}] [TRACE] Terminal shell detected: ${id} - ${shellType}`
            );
            
            await this.sendEvent({
                type: 'terminal',
                action: 'shell',
                data: {
                    id,
                    shellType
                }
            });
        }
    }

    dispose(): void {
        this.writeEmitter.dispose();
        this.outputChannel.dispose();
        this.terminals.clear();
    }
}