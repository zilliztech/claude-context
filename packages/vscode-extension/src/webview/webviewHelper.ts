import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WebviewHelper {

    /**
     * Read HTML template file with support for external resources
     * @param extensionUri Extension root directory URI
     * @param templatePath Template file relative path
     * @param webview webview instance
     * @returns HTML content with resolved resource URIs
     */
    static getHtmlContent(extensionUri: vscode.Uri, templatePath: string, webview: vscode.Webview): string {
        const htmlPath = path.join(extensionUri.fsPath, templatePath);

        try {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Check if template needs resource URI replacement (modular templates)
            if (htmlContent.includes('{{styleUri}}') || htmlContent.includes('{{scriptUri}}')) {
                // Create URIs for external resources
                const styleUri = webview.asWebviewUri(
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'styles', 'semanticSearch.css')
                );
                const scriptUri = webview.asWebviewUri(
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'scripts', 'semanticSearch.js')
                );

                // Replace template placeholders
                htmlContent = htmlContent
                    .replace('{{styleUri}}', styleUri.toString())
                    .replace('{{scriptUri}}', scriptUri.toString());
            }

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