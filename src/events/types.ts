/**
 * Base event interface for all VSCode events
 */
export interface VSCodeEvent {
    type: 'terminal' | 'file' | 'editor' | 'debug';
    action: string;
    data: Record<string, unknown>;
}

/**
 * Terminal-specific event data
 */
export interface TerminalEvent extends VSCodeEvent {
    type: 'terminal';
    action: 'open' | 'close' | 'focus' | 'state' | 'shell' | 'command';
    data: {
        id: string;
        name?: string;
        type?: string;
        exitCode?: number;
        shellType?: string;
        lastCommand?: string;
        command?: string;
    };
}

/**
 * File system event data
 */
export interface FileEvent extends VSCodeEvent {
    type: 'file';
    action: 'create' | 'change' | 'delete';
    data: {
        path: string;
    };
}

/**
 * Editor event data
 */
export interface EditorEvent extends VSCodeEvent {
    type: 'editor';
    action: 'focus' | 'edit';
    data: {
        file: string;
        languageId?: string;
        changes?: number;
    };
}

/**
 * Debug event data
 */
export interface DebugEvent extends VSCodeEvent {
    type: 'debug';
    action: 'start' | 'stop';
    data: {
        name: string;
        type: string;
    };
}

/**
 * Type guard for terminal events
 */
export function isTerminalEvent(event: VSCodeEvent): event is TerminalEvent {
    return event.type === 'terminal';
}

/**
 * Type guard for file events
 */
export function isFileEvent(event: VSCodeEvent): event is FileEvent {
    return event.type === 'file';
}

/**
 * Type guard for editor events
 */
export function isEditorEvent(event: VSCodeEvent): event is EditorEvent {
    return event.type === 'editor';
}

/**
 * Type guard for debug events
 */
export function isDebugEvent(event: VSCodeEvent): event is DebugEvent {
    return event.type === 'debug';
}