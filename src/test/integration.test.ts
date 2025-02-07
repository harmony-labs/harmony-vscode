import * as vscode from 'vscode';
import * as assert from 'node:assert';
import { before, after } from 'mocha';
import { testMessageEvent } from '../extension';

suite('Integration Test Suite', () => {
    const ext: vscode.Extension<unknown> | undefined = vscode.extensions.getExtension('harmony-dev.harmony-vscode');
    let outputChannel: vscode.OutputChannel;

    before(async () => {
        // Wait for extension to be available
        assert.ok(ext, 'Extension should be present');
        await ext.activate();
        
        // Create test output channel
        outputChannel = vscode.window.createOutputChannel('Harmony Test');
        outputChannel.appendLine(`[${new Date().toISOString()}] Test suite starting...`);
        outputChannel.appendLine(`[${new Date().toISOString()}] SOCKET_PATH=${process.env.SOCKET_PATH}`);
        
        // Give time for extension to fully activate
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    after(async () => {
        // Log final state
        outputChannel.appendLine(`[${new Date().toISOString()}] Test suite ending, disconnecting...`);
        
        // Ensure we disconnect before exiting
        await vscode.commands.executeCommand('harmony.disconnect');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Clean up output channel
        outputChannel.dispose();
    });

    test('Connection and message flow', async () => {
        try {
            outputChannel.appendLine(`[${new Date().toISOString()}] Attempting to connect to Harmony...`);
            
            // Set up message listener
            const messagePromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for test response')), 10000);
                
                // Listen for test message response
                const disposable = testMessageEvent.event(() => {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve();
                });
            });

            // Connect to Harmony
            await vscode.commands.executeCommand('harmony.connect');
            outputChannel.appendLine(`[${new Date().toISOString()}] Connect command executed`);
            
            // Give time for connection to establish
            await new Promise(resolve => setTimeout(resolve, 2000));
            outputChannel.appendLine(`[${new Date().toISOString()}] Waited for connection`);

            // Send test message
            outputChannel.appendLine(`[${new Date().toISOString()}] Sending test message...`);
            await vscode.commands.executeCommand('harmony.test');
            outputChannel.appendLine(`[${new Date().toISOString()}] Test message command executed`);
            
            // Wait for test message acknowledgment
            await messagePromise;
            outputChannel.appendLine(`[${new Date().toISOString()}] Test message acknowledged`);

            // Test passed if we got here without errors
            assert.ok(true, 'Test completed successfully');
            outputChannel.appendLine(`[${new Date().toISOString()}] Test completed successfully`);
        } catch (error) {
            outputChannel.appendLine(`[${new Date().toISOString()}] Test failed: ${(error as Error).message}`);
            if (error instanceof Error && error.stack) {
                outputChannel.appendLine(error.stack);
            }
            assert.fail(`Test failed: ${(error as Error).message}`);
        }
    }).timeout(20000); // Increase timeout for the longer waits
});