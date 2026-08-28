const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clearedVoice', {
  listen: () => ipcRenderer.invoke('voice:listen'),
});
