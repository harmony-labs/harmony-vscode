AZURE_DEVOPS_ORG ?= HarmonyLabs
# VS Code Extension Makefile

.PHONY: help install build test clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the extension
	@echo "Building extension..."
	pnpm run build

clean: ## Clean build artifacts
	rm -rf dist release node_modules out *.vsix

install: ## Install dependencies
	pnpm install

login:
	npx @vscode/vsce login MattWalters

package:
	npx @vscode/vsce package

publish:
	npx @vscode/vsce publish

test: ## Run tests
	@echo "Running tests..."
	pnpm run test

clean: ## Clean build artifacts

.DEFAULT_GOAL := help
