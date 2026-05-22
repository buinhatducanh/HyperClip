// Test electron in main process context
const { app, shell, dialog, BrowserWindow } = require('electron');
console.log('app type:', typeof app);
console.log('isPackaged:', app && app.isPackaged ? 'yes' : 'no/undefined');
console.log('shell type:', typeof shell);
console.log('OK:', !!app && !!shell);
