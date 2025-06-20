const fs = require('fs');
const path = require('path');

const ICON_SIZES = [16, 32, 48, 128];
const ICONS_DIR = path.join(__dirname, '../src/icons');

// Create base icon - a simple colored square with text
function generateBaseIcon() {
    // Ensure icons directory exists
    if (!fs.existsSync(ICONS_DIR)) {
        fs.mkdirSync(ICONS_DIR, { recursive: true });
    }

    // Simple SVG icon for all sizes
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
            <rect width="128" height="128" fill="#4A90E2"/>
            <text x="64" y="64" font-family="Arial" font-size="40" 
                  fill="white" text-anchor="middle" dominant-baseline="middle">
                CS
            </text>
        </svg>
    `;

    // Save SVG file for each size (browsers will scale it automatically)
    for (const size of ICON_SIZES) {
        const iconPath = path.join(ICONS_DIR, `icon${size}.svg`);
        fs.writeFileSync(iconPath, svg, 'utf8');
        console.log(`Generated icon: ${iconPath}`);
    }
}

generateBaseIcon(); 