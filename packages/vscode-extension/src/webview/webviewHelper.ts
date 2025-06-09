import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WebviewHelper {

    /**
     * Read HTML template file
     * @param extensionUri Extension root directory URI
     * @param templatePath Template file relative path
     * @param webview webview instance
     * @returns HTML content
     */
    static getHtmlContent(extensionUri: vscode.Uri, templatePath: string, webview: vscode.Webview): string {
        const htmlPath = path.join(extensionUri.fsPath, templatePath);

        try {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Here we can do some template replacements, such as replacing resource paths
            // For now, return the original content directly

            return htmlContent;
        } catch (error) {
            console.error('Failed to read HTML template:', error);
            return this.getFallbackHtml();
        }
    }

    /**
     * Get fallback HTML content (used when file reading fails)
     */
    private static getFallbackHtml(): string {
        return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Semantic Search</title>
			</head>
			<body>
				<h3>Semantic Search</h3>
				<p>Error loading template. Please check console for details.</p>
			</body>
			</html>
		`;
    }
} 