const fs = require('fs');
const path = require('path');

const targetFiles = [
  'D:/HyperClip/HyperClip-TestCustomer-20260616-224538/HyperClip-Data/.hyperclip/tiktok.json',
  'D:/HyperClip/HyperClip-Data/.hyperclip/tiktok.json'
];

const idMap = {
  'tt1794147924820': {
    id: 'adspower_k1ir7low',
    profileId: 'k1ir7low',
    label: '@us nhuan 4 us'
  },
  'tt1794147924826': {
    id: 'adspower_k1ir7liq',
    profileId: 'k1ir7liq',
    label: '@us nhuan 3 us'
  },
  'tt1794147978334': {
    id: 'adspower_k1ir7lv0',
    profileId: 'k1ir7lv0',
    label: '@us nhuan 5 us'
  }
};

for (const filePath of targetFiles) {
  if (!fs.existsSync(filePath)) {
    console.log('Skipping missing file:', filePath);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const backupPath = filePath + '.bak-' + Date.now();
  fs.writeFileSync(backupPath, raw, 'utf8');
  console.log('Backed up', filePath, '->', backupPath);

  const data = JSON.parse(raw);

  if (Array.isArray(data.accounts)) {
    data.accounts = data.accounts.map(acc => {
      const match = idMap[acc.id];
      if (match) {
        console.log(`Updating account ${acc.id} (${acc.label}) -> ${match.id} (profileId: ${match.profileId})`);
        return {
          ...acc,
          id: match.id,
          profileId: match.profileId,
          status: 'connected'
        };
      }
      return acc;
    });
  }

  if (data.mappings && typeof data.mappings === 'object') {
    for (const [chId, accId] of Object.entries(data.mappings)) {
      if (idMap[accId]) {
        console.log(`Updating mapping ${chId}: ${accId} -> ${idMap[accId].id}`);
        data.mappings[chId] = idMap[accId].id;
      }
    }
  }

  if (Array.isArray(data.history)) {
    data.history = data.history.map(item => {
      if (idMap[item.accountId]) {
        return {
          ...item,
          accountId: idMap[item.accountId].id
        };
      }
      return item;
    });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Successfully updated:', filePath);
}

