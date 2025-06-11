const fs = require('fs');
const path = require('path');

// Ensure dist/webview directory exists
const webviewDistDir = path.join(__dirname, 'dist', 'webview');
if (!fs.existsSync(webviewDistDir)) {
    fs.mkdirSync(webviewDistDir, { recursive: true });
}

// Copy CSS files
const stylesDir = path.join(__dirname, 'src', 'webview', 'styles');
if (fs.existsSync(stylesDir)) {
    const destStylesDir = path.join(webviewDistDir, 'styles');
    if (!fs.existsSync(destStylesDir)) {
        fs.mkdirSync(destStylesDir, { recursive: true });
    }

    const styleFiles = fs.readdirSync(stylesDir);
    styleFiles.forEach(file => {
        if (file.endsWith('.css')) {
            const srcPath = path.join(stylesDir, file);
            const destPath = path.join(destStylesDir, file);
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied ${file} to webview styles`);
        }
    });
}

// Copy JavaScript files
const scriptsDir = path.join(__dirname, 'src', 'webview', 'scripts');
if (fs.existsSync(scriptsDir)) {
    const destScriptsDir = path.join(webviewDistDir, 'scripts');
    if (!fs.existsSync(destScriptsDir)) {
        fs.mkdirSync(destScriptsDir, { recursive: true });
    }

    const scriptFiles = fs.readdirSync(scriptsDir);
    scriptFiles.forEach(file => {
        if (file.endsWith('.js')) {
            const srcPath = path.join(scriptsDir, file);
            const destPath = path.join(destScriptsDir, file);
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied ${file} to webview scripts`);
        }
    });
}

console.log('Webview assets copied successfully!'); 