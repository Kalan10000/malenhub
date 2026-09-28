const fs = require('fs');
const path = require('path');

const jeuxDir = path.join(__dirname, 'jeux');

if (!fs.existsSync(jeuxDir)) {
    fs.mkdirSync(jeuxDir, { recursive: true });
}

const files = fs.readdirSync(jeuxDir);
const htmlFiles = files.filter(file => file.endsWith('.html'));

const games = htmlFiles.map(file => {
    const nameWithoutExt = path.basename(file, '.html');
    // Transforme "super-mario" en "Super Mario"
    const niceName = nameWithoutExt
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    return {
        filename: file,
        name: niceName
    };
});

fs.writeFileSync(path.join(__dirname, 'games.json'), JSON.stringify(games, null, 2));
console.log('Jeux détectés avec succès :', games);