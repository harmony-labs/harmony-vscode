#!/bin/bash

# Exit on error
set -e

# Default socket path
export SOCKET_PATH="/tmp/harmony.sock"

# Log file for desktop app output
DESKTOP_LOG="desktop-test.log"

# Flag to track if we're in cleanup
CLEANING_UP=0

cleanup() {
    # Prevent recursive cleanup
    if [ "$CLEANING_UP" = "1" ]; then
        return
    fi
    CLEANING_UP=1

    echo "Cleaning up..."

    # Find and kill all related processes
    local pids=(
        # Find electron processes for our app
        $(pgrep -f "electron.*harmony-desktop" || true)
        # Find node processes running vite dev server
        $(pgrep -f "node.*vite.*harmony-desktop" || true)
        # Include the main desktop PID if we have it
        ${DESKTOP_PID:+"$DESKTOP_PID"}
    )

    if [ ${#pids[@]} -gt 0 ]; then
        echo "Found processes to clean up: ${pids[*]}"
        
        # Try graceful shutdown first
        for pid in "${pids[@]}"; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                echo "Sending SIGTERM to $pid..."
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done

        # Give processes time to shut down gracefully
        for i in {1..5}; do
            local all_dead=true
            for pid in "${pids[@]}"; do
                if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                    all_dead=false
                    break
                fi
            done
            if [ "$all_dead" = true ]; then
                break
            fi
            sleep 1
        done

        # Force kill any remaining processes
        for pid in "${pids[@]}"; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                echo "Force killing $pid..."
                kill -9 "$pid" 2>/dev/null || true
                # Wait for process to fully exit
                wait "$pid" 2>/dev/null || true
            fi
        done
    else
        echo "No processes found to clean up"
    fi

    # Clean up socket file
    if [ -e "$SOCKET_PATH" ]; then
        echo "Removing socket file: $SOCKET_PATH"
        rm -f "$SOCKET_PATH"
    fi

    # Show desktop app logs
    if [ -f "$DESKTOP_LOG" ]; then
        echo "Desktop app logs:"
        echo "----------------"
        cat "$DESKTOP_LOG"
        echo "----------------"
        rm "$DESKTOP_LOG"
    fi

    CLEANING_UP=0
}

# Set up signal handlers
trap cleanup EXIT INT TERM

echo "Building harmony-core..."
cd harmony-core
pnpm build
cd ..

echo "Building harmony-desktop..."
cd harmony-desktop
pnpm build
cd ..

echo "Building harmony-vscode..."
cd harmony-vscode
make build
pnpm run package
cd ..

echo "Installing VS Code extension..."
cd harmony-vscode

# Uninstall existing extension if present
echo "Uninstalling existing Harmony extension..."
code-insiders --uninstall-extension harmony-dev.harmony-vscode || true

# Wait a moment for uninstall to complete
sleep 2

echo "Installing new extension..."
code-insiders --install-extension "$(pwd)/harmony-vscode-0.1.0.vsix"

# Wait a moment for install to complete
sleep 2

echo "Running integration tests..."
# Run VS Code tests in a new window
TEST_EXIT_CODE=0
code-insiders \
    --extensionDevelopmentPath="$(pwd)" \
    --extensionTestsPath="$(pwd)/dist/test/integration.test.js" \
    --disable-extensions \
    --new-window || TEST_EXIT_CODE=$?

# Wait for extension to initialize
echo "Waiting for extension to initialize..."
TIMEOUT=30
while [ $TIMEOUT -gt 0 ]; do
    if grep -q "Harmony extension is now active" "$DESKTOP_LOG" 2>/dev/null; then
        echo "Extension initialized"
        break
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for extension to initialize"
    exit 1
fi

# Start desktop app after extension is running
echo "Starting harmony-desktop in background..."
cd ../harmony-desktop
export NODE_ENV=development
pnpm dev > "../$DESKTOP_LOG" 2>&1 &
DESKTOP_PID=$!
cd ..

# Wait for desktop app to initialize and socket to be ready
echo "Waiting for desktop app to initialize..."
TIMEOUT=30
while [ $TIMEOUT -gt 0 ] && ! grep -q "Transport state changed: connecting" "$DESKTOP_LOG" 2>/dev/null; do
    if ! kill -0 "$DESKTOP_PID" 2>/dev/null; then
        echo "Desktop app died during initialization"
        exit 1
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for desktop app to initialize"
    exit 1
fi

echo "Desktop app initialized"

# Wait for extension to connect
echo "Waiting for extension to connect..."
TIMEOUT=30
while [ $TIMEOUT -gt 0 ]; do
    if grep -q "Extension vscode-" "$DESKTOP_LOG" 2>/dev/null; then
        echo "Extension connected"
        break
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for extension to connect"
    exit 1
fi

# Test connection recovery
echo "Testing connection recovery..."

# Kill desktop app
echo "Killing desktop app..."
kill -TERM $DESKTOP_PID
wait $DESKTOP_PID 2>/dev/null || true

# Wait a moment
sleep 2

# Restart desktop app
echo "Restarting desktop app..."
cd harmony-desktop
pnpm dev > "../$DESKTOP_LOG" 2>&1 &
DESKTOP_PID=$!
cd ..

# Wait for extension to reconnect
echo "Waiting for extension to reconnect..."
TIMEOUT=30
while [ $TIMEOUT -gt 0 ]; do
    if grep -q "Extension vscode-" "$DESKTOP_LOG" 2>/dev/null; then
        echo "Extension reconnected"
        break
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for extension to reconnect"
    exit 1
fi

# Test message exchange
echo "Testing message exchange..."
TIMEOUT=30
while [ $TIMEOUT -gt 0 ]; do
    if grep -q "Test message acknowledged" "$DESKTOP_LOG" 2>/dev/null; then
        echo "Test completed successfully"
        break
    fi
    if [ $TEST_EXIT_CODE -ne 0 ] && [ $TEST_EXIT_CODE -ne 143 ]; then
        echo "Test failed with exit code $TEST_EXIT_CODE"
        exit $TEST_EXIT_CODE
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for test completion"
    exit 1
fi

echo "Integration test complete!"
exit 0