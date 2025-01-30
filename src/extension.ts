import * as vscode from 'vscode';
import { UnixSocketTransport, type TransportEvent, type HarmonyMessage, createMessage } from '@harmony/core';

let transport: UnixSocketTransport<unknown> | null = null;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Harmony extension is now active!');

	// Register connect command
	const connectCommand = vscode.commands.registerCommand('harmony.connect', async () => {
		if (transport) {
			vscode.window.showInformationMessage('Already connected to Harmony');
			return;
		}

		try {
			transport = new UnixSocketTransport<unknown>({
			  id: 'harmony-vscode',
			  socketPath: '/tmp/harmony.sock',
			  isServer: false
			});

			transport.subscribe((event: TransportEvent<HarmonyMessage<unknown>>) => {
				switch (event.type) {
					case 'message':
						vscode.window.showInformationMessage(`Received: ${JSON.stringify(event.message)}`);
						break;
					case 'state':
						vscode.window.setStatusBarMessage(`Harmony: ${event.state}`);
						break;
					case 'error':
						vscode.window.showErrorMessage(`Harmony error: ${event.error.message}`);
						break;
				}
			});

			await transport.connect();
			vscode.window.showInformationMessage('Connected to Harmony');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to connect: ${(error as Error).message}`);
		}
	});

	// Register disconnect command
	const disconnectCommand = vscode.commands.registerCommand('harmony.disconnect', async () => {
		if (!transport) {
			vscode.window.showInformationMessage('Not connected to Harmony');
			return;
		}

		try {
			await transport.disconnect();
			transport = null;
			vscode.window.showInformationMessage('Disconnected from Harmony');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to disconnect: ${(error as Error).message}`);
		}
	});

	// Test command for integration testing
	const testCommand = vscode.commands.registerCommand('harmony.test', async () => {
		if (!transport) {
			vscode.window.showErrorMessage('Not connected to Harmony');
			process.exit(1);
			return;
		}

		try {
			const testMessage = createMessage('test', { value: 'test' }, 'harmony-vscode');
			await transport.send(testMessage);
			vscode.window.showInformationMessage('Test message sent successfully');
			process.exit(0);
		} catch (error) {
			vscode.window.showErrorMessage(`Test failed: ${(error as Error).message}`);
			process.exit(1);
		}
	});

	context.subscriptions.push(connectCommand, disconnectCommand, testCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (transport) {
		transport.disconnect().catch((error: Error) => {
			console.error('Failed to disconnect:', error);
		});
		transport = null;
	}
}
