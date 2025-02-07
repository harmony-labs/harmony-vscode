import * as vscode from 'vscode';
import { UnixSocketTransport, type TransportEvent, type HarmonyMessage, type ConnectionState, createMessage } from '@harmony/core';
import { access, constants } from 'node:fs/promises';

// Get socket path from environment variable or use default
const SOCKET_PATH = process.env.SOCKET_PATH || '/tmp/harmony.sock';

// Connection status and transport for tests
const stateChangeEmitter = new vscode.EventEmitter<ConnectionState>();
const connectionStatus = {
  state: 'disconnected' as ConnectionState,
  onDidChange: stateChangeEmitter.event
};

let transport: UnixSocketTransport<unknown> | null = null;
let outputChannel: vscode.OutputChannel;
let reconnectTimer: NodeJS.Timeout | null = null;
const RECONNECT_INTERVAL = 5000; // Try reconnecting every 5 seconds

// Event emitter for test message responses
export const testMessageEvent = new vscode.EventEmitter<void>();

// Generate a unique ID for this extension instance
const instanceId = `vscode-${vscode.env.sessionId}`;

async function tryConnect(): Promise<void> {
    if (transport) {
        return;
    }

    try {
        // Check socket file access
        try {
            await access(SOCKET_PATH, constants.R_OK | constants.W_OK);
            outputChannel.appendLine(`[${new Date().toISOString()}] Socket file is accessible`);
        } catch (error) {
            outputChannel.appendLine(`[${new Date().toISOString()}] Socket file is not accessible: ${error}`);
            throw new Error(`Socket file is not accessible: ${error}`);
        }

        outputChannel.appendLine(`[${new Date().toISOString()}] Initializing transport...`);
        transport = new UnixSocketTransport<unknown>({
            id: instanceId,
            socketPath: SOCKET_PATH,
            isServer: false
        });

        transport.subscribe((event: TransportEvent<HarmonyMessage<unknown>>) => {
            switch (event.type) {
                case 'message': {
                    outputChannel.appendLine(`[${new Date().toISOString()}] Received message: ${JSON.stringify(event.message, null, 2)}`);
                    
                    // Handle test response messages
                    if (event.message.type === 'test_response') {
                        outputChannel.appendLine(`[${new Date().toISOString()}] Test message acknowledged by desktop app`);
                        vscode.window.showInformationMessage('Test message acknowledged by desktop app');
                        testMessageEvent.fire();
                    }
                    break;
                }
                case 'state': {
                    outputChannel.appendLine(`[${new Date().toISOString()}] Transport state changed: ${event.state}`);
                    connectionStatus.state = event.state;
                    stateChangeEmitter.fire(event.state);
                    if (event.state === 'connected') {
                        vscode.window.showInformationMessage('Connected to Harmony');
                        startPinging();
                        stopReconnectTimer();
                    } else if (event.state === 'disconnected' || event.state === 'error') {
                        stopPinging();
                        transport = null; // Clear transport on disconnect/error
                        startReconnectTimer();
                    }
                    break;
                }
                case 'error': {
                    outputChannel.appendLine(`[${new Date().toISOString()}] Error: ${event.error.message}`);
                    const stack = event.error.stack;
                    if (stack) {
                        outputChannel.appendLine(stack);
                    }
                    vscode.window.showErrorMessage(`Harmony error: ${event.error.message}`);
                    // Treat errors as disconnects
                    stopPinging();
                    transport = null;
                    startReconnectTimer();
                    break;
                }
            }
        });

        outputChannel.appendLine(`[${new Date().toISOString()}] Connecting to Harmony...`);
        await transport.connect();
        outputChannel.appendLine(`[${new Date().toISOString()}] Connected to Harmony`);
        vscode.window.showInformationMessage('Connected to Harmony');
    } catch (error) {
        const err = error as Error;
        outputChannel.appendLine(`[${new Date().toISOString()}] Failed to connect: ${err.message}`);
        const stack = err.stack;
        if (stack) {
            outputChannel.appendLine(stack);
        }
        transport = null;
        startReconnectTimer();
    }
}

function startReconnectTimer() {
    if (!reconnectTimer) {
        outputChannel.appendLine(`[${new Date().toISOString()}] Starting reconnect timer`);
        reconnectTimer = setInterval(async () => {
            outputChannel.appendLine(`[${new Date().toISOString()}] Attempting to reconnect...`);
            await tryConnect();
        }, RECONNECT_INTERVAL);
    }
}

function stopReconnectTimer() {
    if (reconnectTimer) {
        outputChannel.appendLine(`[${new Date().toISOString()}] Stopping reconnect timer`);
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    }
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Harmony');
    context.subscriptions.push(outputChannel);
    
    // Show output channel
    outputChannel.show(true);
    outputChannel.appendLine(`[${new Date().toISOString()}] Harmony extension is now active!`);
    outputChannel.appendLine(`[${new Date().toISOString()}] Instance ID: ${instanceId}`);

    // Try to connect immediately
    tryConnect();

    // Register connect command
    const connectCommand = vscode.commands.registerCommand('harmony.connect', tryConnect);

    // Register disconnect command
    const disconnectCommand = vscode.commands.registerCommand('harmony.disconnect', async () => {
        if (!transport) {
            outputChannel.appendLine(`[${new Date().toISOString()}] Not connected to Harmony`);
            vscode.window.showInformationMessage('Not connected to Harmony');
            return;
        }

        try {
            outputChannel.appendLine(`[${new Date().toISOString()}] Disconnecting from Harmony...`);
            stopPinging();
            stopReconnectTimer();
            await transport.disconnect();
            transport = null;
            outputChannel.appendLine(`[${new Date().toISOString()}] Disconnected from Harmony`);
            vscode.window.showInformationMessage('Disconnected from Harmony');
        } catch (error) {
            const err = error as Error;
            outputChannel.appendLine(`[${new Date().toISOString()}] Failed to disconnect: ${err.message}`);
            const stack = err.stack;
            if (stack) {
                outputChannel.appendLine(stack);
            }
            vscode.window.showErrorMessage(`Failed to disconnect: ${err.message}`);
        }
    });

    // Test command for integration testing
    const testCommand = vscode.commands.registerCommand('harmony.test', async () => {
        if (!transport) {
            outputChannel.appendLine(`[${new Date().toISOString()}] Test failed: Not connected to Harmony`);
            vscode.window.showErrorMessage('Not connected to Harmony');
            return;
        }

        try {
            const testMessage = createMessage('test', { value: 'test' }, instanceId);
            outputChannel.appendLine(`[${new Date().toISOString()}] Sending test message: ${JSON.stringify(testMessage, null, 2)}`);
            await transport.send(testMessage);
            outputChannel.appendLine(`[${new Date().toISOString()}] Test message sent successfully`);
            vscode.window.showInformationMessage('Test message sent successfully');
        } catch (error) {
            const err = error as Error;
            outputChannel.appendLine(`[${new Date().toISOString()}] Test failed: ${err.message}`);
            const stack = err.stack;
            if (stack) {
                outputChannel.appendLine(stack);
            }
            vscode.window.showErrorMessage(`Test failed: ${err.message}`);
        }
    });

    // Show output command
    const showOutputCommand = vscode.commands.registerCommand('harmony.showOutput', () => {
        outputChannel.show(true);
    });

    context.subscriptions.push(
        connectCommand,
        disconnectCommand,
        testCommand,
        showOutputCommand,
        testMessageEvent,
        stateChangeEmitter
    );

    // Export test helpers
    return {
        connectionStatus,
        transport,
        commands: {
            connect: tryConnect,
            disconnect: () => transport?.disconnect(),
            test: () => transport?.send(createMessage('test', { value: 'test' }, instanceId))
        }
    };
}

// Send periodic pings to desktop
let pingInterval: NodeJS.Timeout | null = null;

function startPinging() {
    if (pingInterval) {
        clearInterval(pingInterval);
    }

    // Send ping every 5 seconds
    pingInterval = setInterval(async () => {
        if (transport) {
            try {
                const pingMessage = createMessage('ping', { timestamp: Date.now() }, instanceId);
                await transport.send(pingMessage);
                outputChannel.appendLine(`[${new Date().toISOString()}] Ping sent`);
            } catch (error) {
                const err = error as Error;
                outputChannel.appendLine(`[${new Date().toISOString()}] Failed to send ping: ${err.message}`);
                // If ping fails, treat as disconnected
                stopPinging();
                transport = null;
                startReconnectTimer();
            }
        }
    }, 5000);
}

function stopPinging() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    stopPinging();
    stopReconnectTimer();
    if (transport) {
        outputChannel.appendLine(`[${new Date().toISOString()}] Extension deactivating, disconnecting from Harmony...`);
        transport.disconnect().catch((error: Error) => {
            outputChannel.appendLine(`[${new Date().toISOString()}] Failed to disconnect: ${error.message}`);
            const stack = error.stack;
            if (stack) {
                outputChannel.appendLine(stack);
            }
        });
        transport = null;
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] Extension deactivated`);
}
