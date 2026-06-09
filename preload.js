const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("botAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  startBot: () => ipcRenderer.invoke("start-bot"),
  stopBot: () => ipcRenderer.invoke("stop-bot"),
  getPoints: () => ipcRenderer.invoke("get-points"),
  getSoundCommands: () => ipcRenderer.invoke("get-sound-commands"),
  getCustomCommands: () => ipcRenderer.invoke("get-custom-commands"),
  getTtsSettings: () => ipcRenderer.invoke("get-tts-settings"),
  saveTtsSettings: (settings) => ipcRenderer.invoke("save-tts-settings", settings),
  listPiperVoices: () => ipcRenderer.invoke("list-piper-voices"),
  openPiperFolder: () => ipcRenderer.invoke("open-piper-folder"),
  testPiperTts: (settings) => ipcRenderer.invoke("test-piper-tts", settings),
  saveSoundCommands: (commands) => ipcRenderer.invoke("save-sound-commands", commands),
  saveCustomCommands: (commands) => ipcRenderer.invoke("save-custom-commands", commands),
  testSound: (file) => ipcRenderer.invoke("test-sound", file),
  openSoundsFolder: () => ipcRenderer.invoke("open-sounds-folder"),
  openSettingsFolder: () => ipcRenderer.invoke("open-settings-folder"),
  onLog: (callback) => ipcRenderer.on("bot-log", (event, data) => callback(data)),
  onChat: (callback) => ipcRenderer.on("bot-chat", (event, data) => callback(data)),
  onStatus: (callback) => ipcRenderer.on("bot-status", (event, data) => callback(data)),
  onPlaySound: (callback) => ipcRenderer.on("play-sound", (event, filePath) => callback(filePath)),
  onPlayPiperTts: (callback) => ipcRenderer.on("play-piper-tts", (event, data) => callback(data))
});
