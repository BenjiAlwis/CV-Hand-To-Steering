/**
 * The one door from the page to the hardware helper.
 *
 * The page stays sandboxed with no Node. All it gets is a way to send the
 * helper a JSON command and to hear what it reports — not a file handle, not
 * a process, nothing it could use to reach anything else.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wheelhouseHardware', {
  available: () => ipcRenderer.invoke('hw:available'),
  send: (message) => ipcRenderer.send('hw:send', message),
  onMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('hw:message', listener);
    ipcRenderer.send('hw:hello');
    return () => ipcRenderer.removeListener('hw:message', listener);
  },
});
