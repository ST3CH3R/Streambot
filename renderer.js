const $ = (id) => document.getElementById(id);

let configCache = {};
let soundCommands = [];
let customCommands = [];
let ttsSettings = {};
let logs = [];
let chats = [];
let ttsQueue = [];
let ttsPlaying = false;

function platformIcon(platform) {
  if (platform === "twitch") return "▣";
  if (platform === "tiktok") return "♪";
  if (platform === "bot") return "🤖";
  return "•";
}

function page(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav").forEach(n => n.classList.remove("active"));
  $(`page-${name}`).classList.add("active");
  document.querySelector(`[data-page="${name}"]`).classList.add("active");
}

function enhanceNavigation() {
  const labels = {
    dashboard: ["⌂", "Dashboard"],
    twitch: ["▣", "Twitch"],
    tiktok: ["♪", "TikTok"],
    sounds: ["◖", "Sound Commands"],
    commands: ["▤", "Commands TTS"],
    logs: ["≡", "Logs"],
    chat: ["▥", "Chat"],
    points: ["☆", "Punkte"],
    bot: ["◉", "Bot"],
    settings: ["⚙", "Einstellungen"]
  };

  document.querySelectorAll(".nav").forEach(button => {
    const item = labels[button.dataset.page];
    if (!item) return;
    button.innerHTML = `<span class="navIcon">${item[0]}</span><span class="navLabel">${item[1]}</span>`;
  });
}

document.querySelectorAll(".nav").forEach(btn => {
  btn.addEventListener("click", () => page(btn.dataset.page));
});

async function loadConfig() {
  const config = await window.botAPI.getConfig();
  configCache = config;

  $("twitchEnabled").checked = !!config.twitch?.enabled;
  $("twitchUser").value = config.twitch?.username || "";
  $("twitchOAuth").value = config.twitch?.oauth || "";
  $("twitchChannel").value = config.twitch?.channel || "";
  if ($("twitchFollowToken")) $("twitchFollowToken").value = config.twitch?.followToken || "";

  $("tiktokEnabled").checked = !!config.tiktok?.enabled;
  $("tiktokUser").value = config.tiktok?.username || "";

  $("discordLink").value = config.links?.discord || "";
  $("tiktokLink").value = config.links?.tiktok || "";
  $("youtubeLink").value = config.links?.youtube || "";

  $("botName").value = config.bot?.name || "StreamBot";
  $("prefix").value = config.bot?.prefix || "!";

  $("dashTwitchBot").textContent = config.twitch?.username || "-";
  $("dashTwitchChannel").textContent = config.twitch?.channel || "-";
  $("dashTikTokUser").textContent = config.tiktok?.username || "-";
  $("dashDiscord").textContent = config.links?.discord || "-";
  $("dashTikTokLink").textContent = config.links?.tiktok || "-";
  $("dashYoutube").textContent = config.links?.youtube || "-";
  $("dashBotName").textContent = config.bot?.name || "StreamBot";
  $("dashPrefix").textContent = config.bot?.prefix || "!";
}

function collectConfig() {
  return {
    twitch: {
      enabled: $("twitchEnabled").checked,
      username: $("twitchUser").value.trim(),
      oauth: $("twitchOAuth").value.trim(),
      channel: $("twitchChannel").value.trim(),
      followToken: $("twitchFollowToken") ? $("twitchFollowToken").value.trim() : ""
    },
    tiktok: {
      enabled: $("tiktokEnabled").checked,
      username: $("tiktokUser").value.trim()
    },
    links: {
      discord: $("discordLink").value.trim(),
      tiktok: $("tiktokLink").value.trim(),
      youtube: $("youtubeLink").value.trim()
    },
    bot: {
      name: $("botName").value.trim() || "StreamBot",
      prefix: $("prefix").value.trim() || "!"
    }
  };
}

async function saveConfig() {
  const saved = await window.botAPI.saveConfig(collectConfig());
  configCache = saved;
  await loadConfig();
  addLog({
    time: new Date().toLocaleTimeString("de-DE"),
    type: "SYSTEM",
    message: "Einstellungen gespeichert."
  });
}

async function loadSoundCommands() {
  soundCommands = await window.botAPI.getSoundCommands();
  renderSoundCommands();
}

async function autoSaveSounds() {
  await window.botAPI.saveSoundCommands(soundCommands);
}

function renderSoundCommands() {
  const render = (targetId) => {
    const target = $(targetId);
    if (!target) return;

    target.innerHTML = "";

    if (!soundCommands.length) {
      target.innerHTML = "<div class='logLine'>Keine Sound Commands vorhanden.</div>";
      return;
    }

    soundCommands.forEach((cmd, index) => {
      const div = document.createElement("div");
      div.className = "soundItem";
      div.innerHTML = `
        <span>${escapeHtml(cmd.command)}</span>
        <span>${escapeHtml(cmd.file)}</span>
        <span>${Number(cmd.cooldownSeconds || 0)}s</span>
        <span>${Number(cmd.pointsCost || 0)}</span>
        <button data-test="${index}">Test</button>
        <button class="deleteBtn" data-delete="${index}">🗑</button>
      `;
      target.appendChild(div);
    });

    target.querySelectorAll("[data-test]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await window.botAPI.testSound(soundCommands[Number(btn.dataset.test)].file);
      });
    });

    target.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", async () => {
        soundCommands.splice(Number(btn.dataset.delete), 1);
        renderSoundCommands();
        await autoSaveSounds();
        addLog({
          time: new Date().toLocaleTimeString("de-DE"),
          type: "SOUND",
          message: "Sound gelöscht und gespeichert."
        });
      });
    });
  };

  render("soundList");
  render("soundList2");
}

async function addSoundFromFields(suffix = "") {
  const command = $(`soundCommand${suffix}`).value.trim();
  const file = $(`soundFile${suffix}`).value.trim();

  if (!command || !file) {
    addLog({
      time: new Date().toLocaleTimeString("de-DE"),
      type: "ERROR",
      message: "Bitte Command und Datei eintragen."
    });
    return;
  }

  soundCommands.push({
    command,
    file,
    cooldownSeconds: Number($(`soundCooldown${suffix}`).value || 0),
    pointsCost: Number($(`soundCost${suffix}`).value || 0),
    response: suffix === "2" && $("soundResponse2")
      ? ($("soundResponse2").value.trim() || "@USER hat Sound gestartet!")
      : "@USER hat Sound gestartet!"
  });

  ["soundCommand", "soundFile", "soundCooldown", "soundCost", "soundResponse"].forEach(id => {
    const el = $(id + suffix);
    if (el) el.value = "";
  });

  renderSoundCommands();
  await autoSaveSounds();

  addLog({
    time: new Date().toLocaleTimeString("de-DE"),
    type: "SOUND",
    message: "Sound hinzugefügt und gespeichert."
  });
}



async function loadPiperVoices(selectedVoice = "") {
  const voices = await window.botAPI.listPiperVoices();
  const select = $("piperVoice");
  if (!select) return;

  select.innerHTML = "";

  if (!voices.length) {
    const opt = document.createElement("option");
    opt.value = "de_DE-thorsten-high.onnx";
    opt.textContent = "Keine Stimmen gefunden";
    select.appendChild(opt);
    return;
  }

  voices.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.file;
    opt.textContent = v.name;
    select.appendChild(opt);
  });

  if (selectedVoice) select.value = selectedVoice;
}

async function loadTtsSettings() {
  ttsSettings = await window.botAPI.getTtsSettings();
  await loadPiperVoices(ttsSettings.voiceFile);

  if ($("ttsEnabled")) $("ttsEnabled").checked = !!ttsSettings.enabled;
  if ($("ttsPlatforms")) $("ttsPlatforms").value = ttsSettings.platforms || "both";
  if ($("ttsCommand")) $("ttsCommand").value = ttsSettings.command ?? ".";
  if ($("ttsSpeakFormat")) $("ttsSpeakFormat").value = ttsSettings.speakFormat || "user_says";
  if ($("ttsCooldown")) $("ttsCooldown").value = ttsSettings.cooldownSeconds ?? 10;
  if ($("ttsMaxLength")) $("ttsMaxLength").value = ttsSettings.maxLength ?? 180;
  if ($("ttsPointsCost")) $("ttsPointsCost").value = ttsSettings.pointsCost ?? 0;
  if ($("ttsLengthScale")) $("ttsLengthScale").value = ttsSettings.rate ?? 0.95;
  if ($("ttsVolume")) $("ttsVolume").value = ttsSettings.volume ?? 1;
  syncTtsProviderUi();
}

function collectTtsSettings() {
  return {
    enabled: $("ttsEnabled") ? $("ttsEnabled").checked : true,
    platforms: $("ttsPlatforms") ? $("ttsPlatforms").value : "both",
    command: $("ttsCommand") ? $("ttsCommand").value.trim() : ".",
    speakFormat: $("ttsSpeakFormat") ? $("ttsSpeakFormat").value : "user_says",
    voiceFile: $("piperVoice") ? $("piperVoice").value : "de_DE-thorsten-high.onnx",
    cooldownSeconds: Number($("ttsCooldown") ? $("ttsCooldown").value || 10 : 10),
    maxLength: Number($("ttsMaxLength") ? $("ttsMaxLength").value || 180 : 180),
    pointsCost: Number($("ttsPointsCost") ? $("ttsPointsCost").value || 0 : 0),
    voiceName: "de-DE-SeraphinaMultilingualNeural",
    rate: Number($("ttsLengthScale") ? $("ttsLengthScale").value || 0.95 : 0.95),
    pitch: 1.02,
    lengthScale: 1.0,
    volume: Number($("ttsVolume") ? $("ttsVolume").value || 1 : 1)
  };
}

function wrapTtsField(id, label, extraClass = "") {
  const element = $(id);
  if (!element || element.closest(".field")) return;

  const wrapper = document.createElement("label");
  wrapper.className = `field ${extraClass}`.trim();
  const caption = document.createElement("span");
  caption.textContent = label;

  element.parentNode.insertBefore(wrapper, element);
  wrapper.appendChild(caption);
  wrapper.appendChild(element);
}

function enhanceTtsLayout() {
  const box = document.querySelector(".ttsBox");
  if (!box) return;

  const heading = box.querySelector("h3");
  if (heading) heading.textContent = "Eigene Zuschauer-Stimme";

  const activeLabel = $("ttsEnabled")?.closest("label");
  if (activeLabel) activeLabel.className = "ttsToggle";

  wrapTtsField("ttsPlatforms", "Plattform");
  wrapTtsField("ttsCommand", "Startzeichen (optional)");
  wrapTtsField("ttsSpeakFormat", "Vorlesen als");
  wrapTtsField("piperVoice", "Stimme");
  wrapTtsField("ttsCooldown", "Cooldown");
  wrapTtsField("ttsMaxLength", "Max. Textlänge");
  wrapTtsField("ttsPointsCost", "Punkte Kosten");
  wrapTtsField("ttsLengthScale", "Tempo");
  wrapTtsField("ttsVolume", "Lautstärke");
}

function syncTtsProviderUi() {
  if ($("piperVoice")) {
    $("piperVoice").innerHTML = "<option value='de-DE-SeraphinaMultilingualNeural'>de-DE-SeraphinaMultilingualNeural</option>";
    $("piperVoice").value = "de-DE-SeraphinaMultilingualNeural";
  }
  if ($("openPiperBtn")) $("openPiperBtn").classList.add("hiddenField");
}

async function saveTtsSettings() {
  ttsSettings = await window.botAPI.saveTtsSettings(collectTtsSettings());
  await loadTtsSettings();
  syncTtsProviderUi();
  addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "TTS", message: "Stimme gespeichert." });
}

function playNextTts() {
  if (ttsPlaying) return;
  const data = ttsQueue.shift();
  if (!data) return;

  ttsPlaying = true;
  const audio = new Audio(data.filePath);
  audio.volume = Number(data.volume || 1);

  const finish = () => {
    ttsPlaying = false;
    playNextTts();
  };

  audio.onended = finish;
  audio.onerror = finish;
  audio.play().catch(err => {
    addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "ERROR", message: "TTS Audio Fehler: " + err.message });
    finish();
  });
}

function playPiperTts(data) {
  ttsQueue.push(data);
  playNextTts();
}

async function testPiperTts() {
  try {
    const result = await window.botAPI.testPiperTts(collectTtsSettings());
    playPiperTts(result);
  } catch (err) {
    addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "ERROR", message: "Stimmen-Test Fehler: " + err.message });
  }
}


async function loadCustomCommands() {
  customCommands = await window.botAPI.getCustomCommands();
  renderCustomCommands();
}

async function autoSaveCustomCommands() {
  await window.botAPI.saveCustomCommands(customCommands);
}

function renderCustomCommands() {
  const target = $("customCommandList");
  if (!target) return;
  target.innerHTML = "";

  if (!customCommands.length) {
    target.innerHTML = "<div class='logLine'>Keine eigenen Commands vorhanden.</div>";
    return;
  }

  customCommands.forEach((cmd, index) => {
    const div = document.createElement("div");
    div.className = "customCommandItem";
    div.innerHTML = `
      <span>${escapeHtml(cmd.command)}</span>
      <span>${escapeHtml(cmd.response)}</span>
      <button class="deleteBtn" data-custom-delete="${index}">🗑</button>
    `;
    target.appendChild(div);
  });

  target.querySelectorAll("[data-custom-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      customCommands.splice(Number(btn.dataset.customDelete), 1);
      renderCustomCommands();
      await autoSaveCustomCommands();
      addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "COMMAND", message: "Command gelöscht und gespeichert." });
    });
  });
}

async function addCustomCommand() {
  const command = $("customCommand").value.trim();
  const response = $("customResponse").value.trim();
  if (!command || !response) {
    addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "ERROR", message: "Bitte Command und Antwort eintragen." });
    return;
  }
  customCommands.push({ command, response });
  $("customCommand").value = "";
  $("customResponse").value = "";
  renderCustomCommands();
  await autoSaveCustomCommands();
  addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "COMMAND", message: "Command hinzugefügt und gespeichert." });
}

function addChat(data) {
  chats.push(data);
  renderChat();
}

function renderChat() {
  const html = chats.slice(-200).reverse().map(data => `
    <div class="chatLine">
      <span class="time">[${data.time}]</span>
      <span class="platformIcon">${platformIcon(data.platform)}</span>
      <span class="name ${data.platform}">${escapeHtml(data.username)}:</span>
      <span>${escapeHtml(data.message)}</span>
    </div>
  `).join("");

  if ($("chat")) $("chat").innerHTML = html;
  if ($("chatFull")) $("chatFull").innerHTML = html;
}

function addLog(data) {
  logs.push(data);
  renderLogs();
}

function renderLogs() {
  const render = (targetId, filterId) => {
    if (!$(targetId) || !$(filterId)) return;
    const filter = $(filterId).value;
    const filtered = logs.filter(l => filter === "ALL" || l.type === filter);

    $(targetId).innerHTML = filtered.slice(-300).reverse().map(log => `
      <div class="logLine">
        <span class="time">[${log.time}]</span>
        <span class="type${log.type}">[${log.type}]</span>
        <span>${escapeHtml(log.message)}</span>
      </div>
    `).join("");
  };

  render("logs", "logFilter");
  render("logsFull", "logFilter2");
}

async function refreshPoints() {
  const points = await window.botAPI.getPoints();
  if (!$("points")) return;

  $("points").innerHTML = points.slice(0, 100).map((user, index) => `
    <div class="pointLine">
      <span>${index + 1}.</span>
      <span>${escapeHtml(user.platform)}</span>
      <span>${escapeHtml(user.username)}</span>
      <span>${Number(user.points || 0)} Punkte</span>
    </div>
  `).join("");
}

function updateStatus(data) {
  let el = null;

  if (data.platform === "twitch") el = $("twitchStatus");
  if (data.platform === "tiktok") el = $("tiktokStatus");
  if (data.platform === "bot") el = $("botStatus");

  if (!el) return;

  el.classList.remove("good", "bad", "warn");

  if (data.status === "connected") {
    el.classList.add("good");
    el.textContent = "● " + (data.message || "Verbunden");
  } else if (data.status === "connecting") {
    el.classList.add("warn");
    el.textContent = "● " + (data.message || "Startet...");
  } else if (data.status === "disabled") {
    el.classList.add("warn");
    el.textContent = "● Deaktiviert";
  } else if (data.status === "error") {
    el.classList.add("bad");
    el.textContent = "● " + (data.message || "Fehler");
  } else {
    el.classList.add("bad");
    el.textContent = "● Getrennt";
  }
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function updateLiveStatus(data) {
  let el = null;
  let badge = null;

  if (data.platform === "twitch") {
    el = $("twitchStatus");
    badge = $("twitchBadge");
  }
  if (data.platform === "tiktok") {
    el = $("tiktokStatus");
    badge = $("tiktokBadge");
  }
  if (data.platform === "bot") el = $("botStatus");

  if (!el) return;

  el.classList.remove("good", "bad", "warn");
  if (badge) badge.classList.remove("good", "bad", "warn");

  const setBadge = (state, text) => {
    if (!badge) return;
    badge.classList.add(state);
    badge.textContent = text;
  };

  if (data.status === "connected") {
    el.classList.add("good");
    el.textContent = "● " + (data.message || "Verbunden");
    setBadge("good", "Aktiv");
  } else if (data.status === "connecting") {
    el.classList.add("warn");
    el.textContent = "● " + (data.message || "Startet...");
    setBadge("warn", "Startet");
  } else if (data.status === "error") {
    el.classList.add("bad");
    el.textContent = "● " + (data.message || "Fehler");
    setBadge("bad", "Fehler");
  } else if (data.status === "disabled") {
    el.classList.add("bad");
    el.textContent = "● Deaktiviert";
    setBadge("bad", "Deaktiviert");
  } else {
    el.classList.add("bad");
    el.textContent = "● Getrennt";
    setBadge("bad", "Deaktiviert");
  }
}

$("startBtn").addEventListener("click", () => window.botAPI.startBot());
$("stopBtn").addEventListener("click", () => window.botAPI.stopBot());

["saveTwitchBtn", "saveTikTokBtn", "saveBotBtn", "saveSettingsBtn"].forEach(id => {
  if ($(id)) $(id).addEventListener("click", saveConfig);
});

if ($("addSoundBtn")) $("addSoundBtn").addEventListener("click", () => addSoundFromFields(""));
if ($("addSoundBtn2")) $("addSoundBtn2").addEventListener("click", () => addSoundFromFields("2"));

if ($("saveSoundsBtn")) {
  $("saveSoundsBtn").addEventListener("click", async () => {
    await autoSaveSounds();
    addLog({
      time: new Date().toLocaleTimeString("de-DE"),
      type: "SOUND",
      message: "Sound Commands gespeichert."
    });
  });
}

if ($("refreshPoints")) $("refreshPoints").addEventListener("click", refreshPoints);
if ($("openSoundsBtn")) $("openSoundsBtn").addEventListener("click", () => window.botAPI.openSoundsFolder());
if ($("openSoundsBtn2")) $("openSoundsBtn2").addEventListener("click", () => window.botAPI.openSoundsFolder());
if ($("settingsFolderBtn")) $("settingsFolderBtn").addEventListener("click", () => window.botAPI.openSettingsFolder());

if ($("logFilter")) $("logFilter").addEventListener("change", renderLogs);
if ($("logFilter2")) $("logFilter2").addEventListener("change", renderLogs);

if ($("clearChatBtn")) $("clearChatBtn").addEventListener("click", () => { chats = []; renderChat(); });
if ($("clearChatBtn2")) $("clearChatBtn2").addEventListener("click", () => { chats = []; renderChat(); });

if ($("sendManualBtn")) {
  $("sendManualBtn").addEventListener("click", () => {
    const msg = $("manualMessage").value.trim();
    if (!msg) return;
    addChat({ time: new Date().toLocaleTimeString("de-DE"), platform: "bot", username: "StreamBot", message: msg });
    $("manualMessage").value = "";
  });
}

window.botAPI.onLog((data) => addLog(data));
window.botAPI.onChat((data) => addChat(data));
window.botAPI.onStatus((data) => updateLiveStatus(data));

window.botAPI.onPlaySound((filePath) => {
  const audio = new Audio(filePath);
  audio.volume = 1.0;
  audio.play().catch(err => {
    addLog({
      time: new Date().toLocaleTimeString("de-DE"),
      type: "ERROR",
      message: `Sound Fehler: ${err.message}`
    });
  });
});

enhanceNavigation();
loadConfig();
enhanceTtsLayout();
loadTtsSettings();
loadSoundCommands();
loadCustomCommands();
refreshPoints();




// Bot-Karte Start/Stop Buttons
document.getElementById("startBotCardBtn")
?.addEventListener("click", () => window.botAPI.startBot());

document.getElementById("stopBotCardBtn")
?.addEventListener("click", () => window.botAPI.stopBot());


if ($("addCustomCommandBtn")) $("addCustomCommandBtn").addEventListener("click", addCustomCommand);
if ($("saveCustomCommandsBtn")) $("saveCustomCommandsBtn").addEventListener("click", async () => {
  await autoSaveCustomCommands();
  addLog({ time: new Date().toLocaleTimeString("de-DE"), type: "COMMAND", message: "Commands gespeichert." });
});

if ($("saveTtsBtn")) $("saveTtsBtn").addEventListener("click", saveTtsSettings);
if ($("testTtsBtn")) $("testTtsBtn").addEventListener("click", testPiperTts);
if ($("openPiperBtn")) $("openPiperBtn").addEventListener("click", () => window.botAPI.openPiperFolder());
window.botAPI.onPlayPiperTts((data) => playPiperTts(data));
