const fs = require('fs');

const files = [
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/app/_internal/qml/QuickPipelineCard.qml',
    'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/app/_internal/qml/QuickPipelineCard.qml'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('card.isSyncing = true;')) {
        console.log(file + ' already wrapped');
        continue;
    }
    
    const target = '    function syncSplitSettings() {';
    const checkTarget = '    function checkAdsPower()';
    const startIdx = content.indexOf(target);
    const checkIdx = content.indexOf(checkTarget, startIdx);
    
    if (startIdx !== -1 && checkIdx !== -1) {
        const funcBlock = content.slice(startIdx, checkIdx);
        let newBlock = funcBlock.replace(
            /function syncSplitSettings\(\)\s*\{(\r?\n)\s*if \(!card\.isLoaded \|\| !settings\) return;/,
            'function syncSplitSettings() {$1        if (!card.isLoaded || !settings || card.isSyncing) return;$1        card.isSyncing = true;$1        try {'
        );
        const lastBrace = newBlock.lastIndexOf('    }');
        if (lastBrace !== -1) {
            newBlock = newBlock.slice(0, lastBrace) + '        } finally {\n            card.isSyncing = false;\n        }\n    }\n\n';
            content = content.slice(0, startIdx) + newBlock + content.slice(checkIdx);
            fs.writeFileSync(file, content, 'utf8');
            console.log('Successfully updated ' + file);
        }
    }
}

