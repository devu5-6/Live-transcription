const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("transcriptionAPI", {
  start: () => ipcRenderer.invoke("transcription:start"),
  stop: () => ipcRenderer.invoke("transcription:stop"),
  sendAudio: (source, audioBuffer) => ipcRenderer.send("transcription:audio", source, audioBuffer),
  onResult: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("transcription:result", listener);
    return () => ipcRenderer.removeListener("transcription:result", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:status", listener);
    return () => ipcRenderer.removeListener("app:status", listener);
  }
});