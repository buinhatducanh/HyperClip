// Test: check electron module in Electron main process
const { app, shell, dialog } = require('electron');
console.log('typeof app:', typeof app);
console.log('isPackaged:', app?.isPackaged);
console.log('typeof shell:', typeof shell);
console.log('versions.electron:', process.versions.electron);
