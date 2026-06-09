const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const tmi = require("tmi.js");
const { WebcastPushConnection } = require("tiktok-live-connector");
let EdgeTTS = null;
try {
  ({ EdgeTTS } = require("@seepine/edge-tts"));
} catch {}

let mainWindow;
let twitchClient = null;
let tiktokLive = null;
let soundCooldowns = {};
let ttsCooldowns = {};
let ttsJobQueue = Promise.resolve();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const userDataPath = app.getPath("userData");
ensureDir(userDataPath);

const configPath = path.join(userDataPath, "config.json");
const pointsPath = path.join(userDataPath, "points.json");
const soundCommandsPath = path.join(userDataPath, "soundCommands.json");
const customCommandsPath = path.join(userDataPath, "customCommands.json");
const ttsSettingsPath = path.join(userDataPath, "ttsSettings.json");

const soundsPath = app.isPackaged
  ? path.join(path.dirname(process.execPath), "sounds")
  : path.join(__dirname, "sounds");

ensureDir(soundsPath);

const piperBasePath = app.isPackaged
  ? path.join(path.dirname(process.execPath), "piper")
  : path.join(__dirname, "piper");

const piperPath = path.join(piperBasePath, "piper.exe");
const piperVoicesPath = path.join(piperBasePath, "voices");
const ttsOutputPath = app.isPackaged
  ? path.join(path.dirname(process.execPath), "tts_output")
  : path.join(__dirname, "tts_output");

ensureDir(piperBasePath);
ensureDir(piperVoicesPath);
ensureDir(ttsOutputPath);

const defaultTtsSettings = {
  enabled: true,
  platforms: "both",
  command: ".",
  voiceName: "de-DE-SeraphinaMultilingualNeural",
  speakFormat: "user_says",
  voiceFile: "de_DE-thorsten-high.onnx",
  cooldownSeconds: 10,
  maxLength: 180,
  pointsCost: 0,
  rate: 0.95,
  pitch: 1.02,
  lengthScale: 1.0,
  volume: 1
};

const defaultConfig = {
  twitch: {
    enabled: true,
    username: "DEIN_TWITCH_BOT_NAME",
    oauth: "oauth:DEIN_TWITCH_OAUTH_TOKEN",
    channel: "DEIN_TWITCH_KANAL",
    followToken: ""
  },
  tiktok: {
    enabled: true,
    username: "DEIN_TIKTOK_NAME_OHNE_@"
  },
  links: {
    discord: "https://discord.gg/DEINLINK",
    tiktok: "https://www.tiktok.com/@DEINNAME",
    youtube: "https://youtube.com/@DEINNAME"
  },
  bot: {
    name: "StreamBot",
    prefix: "!"
  }
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      writeJson(file, fallback);
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function cleanTikTokUsername(value) {
  if (!value) return "";
  let username = String(value).trim();
  username = username.replace("https://www.tiktok.com/@", "");
  username = username.replace("https://tiktok.com/@", "");
  username = username.replace("http://www.tiktok.com/@", "");
  username = username.replace("http://tiktok.com/@", "");
  username = username.replace("www.tiktok.com/@", "");
  username = username.replace("tiktok.com/@", "");
  username = username.replace(/^@+/, "");
  username = username.split("?")[0].split("/")[0].trim();
  return username;
}

function normalizeConfig(config) {
  const merged = {
    ...defaultConfig,
    ...config,
    twitch: { ...defaultConfig.twitch, ...(config.twitch || {}) },
    tiktok: { ...defaultConfig.tiktok, ...(config.tiktok || {}) },
    links: { ...defaultConfig.links, ...(config.links || {}) },
    bot: { ...defaultConfig.bot, ...(config.bot || {}) }
  };

  merged.tiktok.username = cleanTikTokUsername(merged.tiktok.username);

  if (
    merged.twitch.oauth &&
    !merged.twitch.oauth.startsWith("oauth:") &&
    !merged.twitch.oauth.includes("DEIN_TWITCH")
  ) {
    merged.twitch.oauth = "oauth:" + merged.twitch.oauth;
  }

  return merged;
}

function getConfig() {
  return normalizeConfig(readJson(configPath, defaultConfig));
}

function saveConfig(config) {
  const clean = normalizeConfig(config);
  writeJson(configPath, clean);
  return clean;
}

function getPoints() {
  return readJson(pointsPath, {});
}

function savePoints(points) {
  writeJson(pointsPath, points);
}

function getSoundCommands() {
  return readJson(soundCommandsPath, []);
}

function saveSoundCommands(commands) {
  writeJson(soundCommandsPath, commands || []);
  return true;
}

function getCustomCommands() {
  return readJson(customCommandsPath, []);
}

function saveCustomCommands(commands) {
  writeJson(customCommandsPath, commands || []);
  return true;
}

function normalizeTtsSettings(settings) {
  const clean = { ...defaultTtsSettings, ...(settings || {}) };
  clean.platforms = ["both", "twitch", "tiktok"].includes(clean.platforms) ? clean.platforms : "both";
  clean.command = String(clean.command ?? ".").trim();
  clean.voiceName = "de-DE-SeraphinaMultilingualNeural";
  clean.speakFormat = ["user_says", "user_text", "text_only"].includes(clean.speakFormat) ? clean.speakFormat : "user_says";
  return clean;
}

function getTtsSettings() {
  return normalizeTtsSettings(readJson(ttsSettingsPath, defaultTtsSettings));
}

function saveTtsSettings(settings) {
  const clean = normalizeTtsSettings(settings);
  writeJson(ttsSettingsPath, clean);
  return clean;
}

function listPiperVoices() {
  ensureDir(piperVoicesPath);
  return fs.readdirSync(piperVoicesPath)
    .filter(file => file.toLowerCase().endsWith(".onnx"))
    .map(file => ({ name: file.replace(".onnx", ""), file }));
}

function generatePiperTts(text, settings) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(piperPath)) {
      reject(new Error("piper.exe fehlt im Ordner piper."));
      return;
    }

    const voiceFile = settings.voiceFile || "de_DE-thorsten-high.onnx";
    const modelPath = path.join(piperVoicesPath, voiceFile);
    const configPath = modelPath + ".json";

    if (!fs.existsSync(modelPath)) {
      reject(new Error(`Stimme fehlt: piper/voices/${voiceFile}`));
      return;
    }

    const outputFile = path.join(ttsOutputPath, "tts.wav");

    const args = [
      "--model", modelPath,
      "--output_file", outputFile,
      "--length_scale", String(settings.lengthScale || 1.0)
    ];

    if (fs.existsSync(configPath)) {
      args.push("--config", configPath);
    }

    const child = spawn(piperPath, args, { windowsHide: true });

    let err = "";
    child.stderr.on("data", data => err += data.toString());

    child.on("error", reject);

    child.on("close", code => {
      if (code !== 0) {
        reject(new Error(err || `Piper beendet mit Code ${code}`));
        return;
      }
      resolve(outputFile);
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}

function edgeTtsRate(value) {
  const percent = Math.round((Number(value || 1) - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

function edgeTtsPitch(value) {
  const hz = Math.round((Number(value || 1) - 1) * 100);
  return `${hz >= 0 ? "+" : ""}${hz}Hz`;
}

async function generateEdgeTts(text, settings) {
  if (!EdgeTTS) {
    throw new Error("Edge TTS Modul fehlt. Bitte npm install ausführen oder die App neu bauen.");
  }

  const voice = "de-DE-SeraphinaMultilingualNeural";
  const tts = new EdgeTTS({
    voice,
    lang: "de-DE",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    rate: edgeTtsRate(settings.rate || 0.95),
    pitch: edgeTtsPitch(settings.pitch || 1.02),
    volume: "+0%",
    timeout: 30000
  });

  const result = await tts.call(String(text || "").replace(/\r?\n/g, ". "));
  const outputFile = path.join(ttsOutputPath, `tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`);
  fs.writeFileSync(outputFile, result.data);
  return outputFile;
}

async function createTtsPlayback(text, settings) {
  const volume = Number(settings.volume) || 1;
  const filePath = await generateEdgeTts(text, settings);
  return { filePath, volume };
}

function queueTtsPlayback(text, settings) {
  const job = ttsJobQueue.then(() => createTtsPlayback(text, settings));
  ttsJobQueue = job.catch(() => {});
  return job;
}

function formatTtsText(username, text, settings) {
  if (settings.speakFormat === "text_only") return text;
  if (settings.speakFormat === "user_text") return `${username} ${text}`;
  return `${username} sagt ${text}`;
}

function sendLog(type, message) {
  const time = new Date().toLocaleTimeString("de-DE");
  if (mainWindow) mainWindow.webContents.send("bot-log", { time, type, message });
}

function sendStatus(platform, status, message = "") {
  if (mainWindow) mainWindow.webContents.send("bot-status", { platform, status, message });
}

function sendChat(platform, username, message) {
  const time = new Date().toLocaleTimeString("de-DE");
  if (mainWindow) mainWindow.webContents.send("bot-chat", { time, platform, username, message });
}

function playSound(file) {
  ensureDir(soundsPath);
  const fullPath = path.join(soundsPath, file);

  if (!fs.existsSync(fullPath)) {
    sendLog("ERROR", `Sound nicht gefunden: ${file}`);
    return false;
  }

  if (mainWindow) mainWindow.webContents.send("play-sound", fullPath);
  sendLog("SOUND", `Sound abgespielt: ${file}`);
  return true;
}

function addPoints(platform, username, amount = 1) {
  const points = getPoints();
  const key = `${platform}:${username.toLowerCase()}`;
  if (!points[key]) points[key] = { username, platform, points: 0 };
  points[key].points += amount;
  savePoints(points);
  return points[key].points;
}

function removePoints(platform, username, amount = 1) {
  const points = getPoints();
  const key = `${platform}:${username.toLowerCase()}`;
  if (!points[key]) points[key] = { username, platform, points: 0 };
  if (points[key].points < amount) return false;
  points[key].points -= amount;
  savePoints(points);
  return true;
}

function userPoints(platform, username) {
  const points = getPoints();
  const key = `${platform}:${username.toLowerCase()}`;
  return points[key]?.points || 0;
}

function topPoints() {
  const points = getPoints();
  return Object.values(points)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((user, index) => `${index + 1}. ${user.username} (${user.points})`)
    .join(" | ");
}

function checkSoundCommand(platform, username, message, sendReply) {
  const msg = message.trim().toLowerCase();
  const commands = getSoundCommands();
  const soundCommand = commands.find(c => String(c.command || "").toLowerCase() === msg);
  if (!soundCommand) return false;

  const now = Date.now();
  const cooldownKey = `${platform}:${soundCommand.command.toLowerCase()}`;
  const cooldownMs = (Number(soundCommand.cooldownSeconds) || 0) * 1000;

  if (soundCooldowns[cooldownKey] && now - soundCooldowns[cooldownKey] < cooldownMs) {
    const secondsLeft = Math.ceil((cooldownMs - (now - soundCooldowns[cooldownKey])) / 1000);
    sendReply(`@${username} warte noch ${secondsLeft}s für diesen Sound.`);
    return true;
  }

  const cost = Number(soundCommand.pointsCost) || 0;
  if (cost > 0 && !removePoints(platform, username, cost)) {
    sendReply(`@${username} du brauchst ${cost} Punkte für diesen Sound.`);
    return true;
  }

  if (playSound(soundCommand.file)) {
    soundCooldowns[cooldownKey] = now;
    if (soundCommand.response) {
      sendReply(soundCommand.response.replaceAll("@USER", `@${username}`));
    }
  }

  return true;
}

async function checkTtsCommand(platform, username, message, sendReply) {
  const settings = getTtsSettings();
  if (!settings.enabled) return false;
  if (settings.platforms !== "both" && settings.platforms !== platform) return false;

  const command = String(settings.command ?? ".").trim();
  const raw = String(message || "");
  const botPrefix = getConfig().bot?.prefix || "!";

  if (command && !raw.startsWith(command)) return false;
  if (!command && raw.trim().startsWith(botPrefix)) return false;

  let text = command ? raw.slice(command.length).trim() : raw.trim();
  if (!text) return true;

  const maxLength = Number(settings.maxLength) || 180;
  if (text.length > maxLength) text = text.slice(0, maxLength);

  const key = `${platform}:${username.toLowerCase()}:tts`;
  const cooldownMs = (Number(settings.cooldownSeconds) || 0) * 1000;
  const now = Date.now();

  if (ttsCooldowns[key] && now - ttsCooldowns[key] < cooldownMs) {
    const left = Math.ceil((cooldownMs - (now - ttsCooldowns[key])) / 1000);
    sendReply(`@${username} warte noch ${left}s für TTS.`);
    return true;
  }

  const cost = Number(settings.pointsCost) || 0;
  if (cost > 0 && !removePoints(platform, username, cost)) {
    sendReply(`@${username} du brauchst ${cost} Punkte für TTS.`);
    return true;
  }

  ttsCooldowns[key] = now;

  try {
    const spokenText = formatTtsText(username, text, settings);
    const playback = await queueTtsPlayback(spokenText, settings);

    if (mainWindow) {
      mainWindow.webContents.send("play-piper-tts", playback);
    }

    sendLog("TTS", `${username}: ${text}`);
  } catch (err) {
    sendLog("ERROR", `Piper TTS Fehler: ${err.message || err}`);
    sendReply(`@${username} TTS konnte nicht abgespielt werden.`);
  }

  return true;
}

function checkCustomCommand(platform, username, message, sendReply) {
  const msg = message.trim().toLowerCase();
  const commands = getCustomCommands();
  const customCommand = commands.find(c => String(c.command || "").toLowerCase() === msg);
  if (!customCommand) return false;

  const response = String(customCommand.response || "")
    .replaceAll("@USER", `@${username}`)
    .replaceAll("{user}", username)
    .replaceAll("{platform}", platform);

  if (response.includes("$readapi(")) {
    sendReply(`@${username} dieser Command nutzt ein StreamElements-Format und wird von StreamBot nicht unterstützt.`);
    sendLog("ERROR", `${customCommand.command} enthält $readapi und wurde nicht gesendet.`);
    return true;
  }

  if (response) sendReply(response);
  sendLog("COMMAND", `${username} hat ${customCommand.command} benutzt.`);
  return true;
}

async function getFollowTime(channel, username) {
  const cleanChannel = String(channel || "").replace(/^#/, "").trim();
  const cleanUser = String(username || "").trim();
  if (!cleanChannel || !cleanUser) return null;
  const followToken = String(getConfig().twitch?.followToken || "").trim();
  if (!followToken) {
    throw new Error("DecAPI Follow Token fehlt.");
  }

  const url =
    `https://decapi.me/twitch/followage/${encodeURIComponent(cleanChannel)}/${encodeURIComponent(cleanUser)}` +
    `?precision=3&token=${encodeURIComponent(followToken)}`;
  const response = await fetch(url);
  const text = (await response.text()).trim();
  if (!response.ok || !text) throw new Error(`Follow Anfrage fehlgeschlagen: ${response.status}`);
  if (text.toLowerCase().includes("missing `token`")) throw new Error("DecAPI Follow Token fehlt.");
  if (text.toLowerCase().includes("needs to authenticate")) throw new Error("DecAPI Follow Token ist nicht für diesen Kanal berechtigt.");
  return text;
}

async function handleCommand(platform, username, message, sendReply) {
  if (!message) return;

  const config = getConfig();
  const prefix = config.bot?.prefix || "!";
  addPoints(platform, username, 1);
  sendChat(platform, username, message);

  const msg = message.trim();
  if (await checkTtsCommand(platform, username, msg, sendReply)) return;

  if (!msg.startsWith(prefix)) return;

  if (checkSoundCommand(platform, username, msg, sendReply)) return;

  const command = msg.toLowerCase().split(" ")[0];

  if (command === `${prefix}help`) sendReply(`@${username} Commands: !discord, !tiktok, !youtube, !punkte, !top, !sounds, !follow`);
  else if (command === `${prefix}sounds`) sendReply(`Sound Commands: ${getSoundCommands().map(c => c.command).join(", ") || "Keine Sounds eingetragen."}`);
  else if (command === `${prefix}discord`) sendReply(`@${username} Discord: ${config.links?.discord || "Kein Discord Link eingetragen."}`);
  else if (command === `${prefix}tiktok`) sendReply(`@${username} TikTok: ${config.links?.tiktok || "Kein TikTok Link eingetragen."}`);
  else if (command === `${prefix}youtube`) sendReply(`@${username} YouTube: ${config.links?.youtube || "Kein YouTube Link eingetragen."}`);
  else if (command === `${prefix}punkte`) sendReply(`@${username} du hast ${userPoints(platform, username)} Punkte.`);
  else if (command === `${prefix}top`) sendReply(`Top Punkte: ${topPoints() || "Noch keine Punkte vorhanden."}`);
  else if (command === `${prefix}follow`) {
    if (platform !== "twitch") {
      sendReply(`@${username} !follow funktioniert nur auf Twitch.`);
      return;
    }

    try {
      const followTime = await getFollowTime(config.twitch?.channel, username);
      sendReply(`@${username} folgt dem Kanal seit: ${followTime}`);
    } catch (err) {
      sendLog("ERROR", `Follow Fehler: ${err.message || err}`);
      sendReply(`@${username} Follow-Zeit konnte nicht geladen werden: ${err.message || err}`);
    }
  }
  else if (checkCustomCommand(platform, username, msg, sendReply)) return;
}

async function startTwitch() {
  const config = getConfig();

  if (!config.twitch?.enabled) {
    sendStatus("twitch", "disabled", "Deaktiviert");
    sendLog("TWITCH", "Twitch ist deaktiviert.");
    return;
  }

  if (
    !config.twitch.username ||
    !config.twitch.oauth ||
    !config.twitch.channel ||
    config.twitch.username.includes("DEIN_TWITCH") ||
    config.twitch.oauth.includes("DEIN_TWITCH") ||
    config.twitch.channel.includes("DEIN_TWITCH")
  ) {
    sendStatus("twitch", "error", "Daten fehlen");
    sendLog("ERROR", "Twitch Daten fehlen. Bitte Twitch Einstellungen speichern.");
    return;
  }

  if (twitchClient) {
    sendLog("TWITCH", "Twitch läuft bereits.");
    return;
  }

  twitchClient = new tmi.Client({
    options: { debug: false },
    identity: {
      username: config.twitch.username,
      password: config.twitch.oauth
    },
    channels: [config.twitch.channel]
  });

  twitchClient.on("message", (channel, tags, message, self) => {
    if (self) return;
    const username = tags.username || "unknown";
    handleCommand("twitch", username, message, (reply) => {
      twitchClient.say(channel, reply);
      sendChat("bot", "StreamBot", reply);
      sendLog("TWITCH", `Antwort: ${reply}`);
    });
  });

  await twitchClient.connect();
  sendStatus("twitch", "connected", "Verbunden");
  sendLog("TWITCH", "Twitch verbunden.");
}

async function stopTwitch() {
  if (twitchClient) {
    await twitchClient.disconnect();
    twitchClient = null;
  }
  sendStatus("twitch", "disconnected", "Getrennt");
  sendLog("TWITCH", "Twitch getrennt.");
}

async function startTikTok() {
  const config = getConfig();

  if (!config.tiktok?.enabled) {
    sendStatus("tiktok", "disabled", "Deaktiviert");
    sendLog("TIKTOK", "TikTok ist deaktiviert.");
    return;
  }

  const username = cleanTikTokUsername(config.tiktok.username);

  if (!username || username.includes("DEIN_TIKTOK")) {
    sendStatus("tiktok", "error", "Name fehlt");
    sendLog("ERROR", "TikTok Benutzername fehlt. Bitte echten TikTok Namen OHNE @ eintragen und speichern.");
    return;
  }

  if (tiktokLive) {
    sendLog("TIKTOK", "TikTok läuft bereits.");
    return;
  }

  const tiktokOptions = {
    processInitialData: true,
    enableExtendedGiftInfo: false,
    requestPollingIntervalMs: 1000
  };

  sendLog("TIKTOK", "Verbinde ohne SessionID. Gift-Liste ist deaktiviert.");

  tiktokLive = new WebcastPushConnection(username, tiktokOptions);

  function handleTikTokChat(data) {
    const user =
      data.uniqueId ||
      data.nickname ||
      data.userId ||
      data.user?.uniqueId ||
      "unknown";

    const message =
      data.comment ||
      data.text ||
      data.content ||
      data.message ||
      "";

    if (!message) {
      sendLog("TIKTOK", "Chat-Event empfangen, aber ohne Text.");
      return;
    }

    sendLog("TIKTOK", `Chat empfangen von ${user}: ${message}`);

    handleCommand("tiktok", user, message, (reply) => {
      sendChat("bot", "StreamBot", reply);
      sendLog("TIKTOK", `Antwort: ${reply}`);
    });
  }

  // Je nach TikTok-Live-Connector-Version kann das Event unterschiedlich heißen.
  tiktokLive.on("chat", handleTikTokChat);
  tiktokLive.on("comment", handleTikTokChat);

  tiktokLive.on("member", data => {
    const user = data.uniqueId || data.nickname || "unknown";
    sendLog("TIKTOK", `${user} ist dem Live beigetreten.`);
  });

  tiktokLive.on("like", data => {
    const user = data.uniqueId || data.nickname || "unknown";
    sendLog("TIKTOK", `${user} hat Likes gesendet.`);
  });

  tiktokLive.on("gift", data => {
    const user = data.uniqueId || data.nickname || "unknown";
    addPoints("tiktok", user, 10);
    sendLog("TIKTOK", `${user} hat ein Gift gesendet. +10 Punkte`);
  });

  tiktokLive.on("follow", data => {
    const user = data.uniqueId || data.nickname || "unknown";
    addPoints("tiktok", user, 5);
    sendLog("TIKTOK", `${user} folgt dir jetzt. +5 Punkte`);
  });

  tiktokLive.on("streamEnd", () => {
    sendStatus("tiktok", "disconnected", "Live beendet");
    sendLog("TIKTOK", "TikTok Live wurde beendet.");
  });

  const state = await tiktokLive.connect();
  sendStatus("tiktok", "connected", `Verbunden mit @${username}`);
  sendLog("TIKTOK", `TikTok verbunden mit @${username}.`);
  sendLog("TIKTOK", `Room-ID: ${state?.roomId || "unbekannt"}`);
}

async function stopTikTok() {
  if (tiktokLive) {
    await tiktokLive.disconnect();
    tiktokLive = null;
  }
  sendStatus("tiktok", "disconnected", "Getrennt");
  sendLog("TIKTOK", "TikTok getrennt.");
}


async function startTwitchLogin(clientId, channelName) {
  clientId = String(clientId || "").trim();
  channelName = String(channelName || "").trim();

  if (!clientId) {
    sendLog("ERROR", "Twitch Client-ID fehlt. Bitte Client-ID eintragen.");
    return null;
  }

  const redirectUri = "http://localhost";
  const scopes = ["chat:read", "chat:edit"];
  const authUrl =
    "https://id.twitch.tv/oauth2/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    "&response_type=token" +
    `&scope=${encodeURIComponent(scopes.join(" "))}` +
    "&force_verify=true";

  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 900,
      height: 760,
      title: "Twitch anmelden",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let finished = false;

    function finish(result) {
      if (finished) return;
      finished = true;

      try {
        if (!authWin.isDestroyed()) authWin.close();
      } catch {}

      resolve(result);
    }

    async function handleUrl(url) {
      if (!url || !url.startsWith(redirectUri)) return false;

      const hash = url.includes("#") ? url.split("#")[1] : "";
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");

      if (!accessToken) return false;

      let login = "";
      try {
        const res = await fetch("https://id.twitch.tv/oauth2/validate", {
          headers: { Authorization: `OAuth ${accessToken}` }
        });

        const data = await res.json();
        login = data.login || "";
      } catch {
        login = "";
      }

      const config = getConfig();
      config.twitch.oauth = `oauth:${accessToken}`;
      config.twitch.username = login || config.twitch.username;
      config.twitch.channel = channelName || config.twitch.channel || login;
      saveConfig(config);

      sendLog("TWITCH", `Twitch Anmeldung gespeichert${login ? " für " + login : ""}.`);
      finish(getConfig());
      return true;
    }

    authWin.webContents.on("will-navigate", async (event, url) => {
      if (await handleUrl(url)) event.preventDefault();
    });

    authWin.webContents.on("will-redirect", async (event, url) => {
      if (await handleUrl(url)) event.preventDefault();
    });

    authWin.on("closed", () => finish(null));
    authWin.loadURL(authUrl);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#061214",
    title: "StreamBot",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  });
  mainWindow.setMenu(null);

  mainWindow.loadFile("index.html");

  mainWindow.webContents.once("did-finish-load", () => {
    sendStatus("twitch", "disconnected", "Getrennt");
    sendStatus("tiktok", "disconnected", "Getrennt");
    sendStatus("bot", "disconnected", "Getrennt");
  });
}

app.whenReady().then(createWindow);

ipcMain.handle("get-config", () => getConfig());
ipcMain.handle("save-config", (event, config) => {
  const saved = saveConfig(config);
  sendLog("SYSTEM", "Einstellungen gespeichert.");
  return saved;
});

ipcMain.handle("get-sound-commands", () => getSoundCommands());
ipcMain.handle("save-sound-commands", (event, commands) => {
  saveSoundCommands(commands);
  sendLog("SOUND", "Sound Commands gespeichert.");
  return true;
});

ipcMain.handle("test-sound", (event, file) => playSound(file));

ipcMain.handle("get-custom-commands", () => getCustomCommands());
ipcMain.handle("get-tts-settings", () => getTtsSettings());
ipcMain.handle("save-tts-settings", (event, settings) => {
  const saved = saveTtsSettings(settings);
  sendLog("TTS", "TTS Einstellungen gespeichert.");
  return saved;
});
ipcMain.handle("list-piper-voices", () => listPiperVoices());
ipcMain.handle("open-piper-folder", () => {
  ensureDir(piperBasePath);
  ensureDir(piperVoicesPath);
  shell.openPath(piperBasePath);
  return true;
});
ipcMain.handle("test-piper-tts", async (event, settings) => {
  const saved = saveTtsSettings(settings);
  return createTtsPlayback("Das ist ein Test der Stream TTS Stimme.", saved);
});
ipcMain.handle("save-custom-commands", (event, commands) => {
  saveCustomCommands(commands);
  sendLog("COMMAND", "Eigene Commands gespeichert.");
  return true;
});

ipcMain.handle("open-sounds-folder", () => {
  ensureDir(soundsPath);
  shell.openPath(soundsPath);
  return true;
});

ipcMain.handle("open-settings-folder", () => {
  shell.openPath(userDataPath);
  return true;
});

ipcMain.handle("start-bot", async () => {
  sendStatus("bot", "connecting", "Startet...");
  let ok = true;

  try { await startTwitch(); } catch (err) { ok = false; sendStatus("twitch", "error", "Fehler"); sendLog("ERROR", `Twitch Fehler: ${err.message || err}`); }
  try { await startTikTok(); } catch (err) {
    ok = false;
    sendStatus("tiktok", "error", "Fehler");
    const msg = err.message || String(err);
    if (msg.includes("websocket upgrade") || msg.includes("sessionId")) {
      sendLog("ERROR", "TikTok Fehler: TikTok blockiert die Verbindung. Prüfe ob du wirklich LIVE bist und ob der TikTok-Name richtig ist.");
    } else {
      sendLog("ERROR", `TikTok Fehler: ${msg}`);
    }
  }

  sendStatus("bot", ok ? "connected" : "error", ok ? "Läuft" : "Fehler");
  return true;
});

ipcMain.handle("stop-bot", async () => {
  try { await stopTwitch(); } catch {}
  try { await stopTikTok(); } catch {}
  sendStatus("bot", "disconnected", "Getrennt");
  return true;
});

ipcMain.handle("get-points", () => Object.values(getPoints()).sort((a, b) => b.points - a.points));

app.on("window-all-closed", () => app.quit());
