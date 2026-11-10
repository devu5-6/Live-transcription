import { app, BrowserWindow, desktopCapturer, ipcMain, session, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DeepgramClient } from "@deepgram/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

let mainWindow;
let deepgramClient;
const connections = new Map();

function sendStatus(message, type = "info") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:status", { message, type });
  }
}

async function openDeepgramConnection(source) {
  const connection = await deepgramClient.listen.v1.connect({
    model: "nova-3",
    language: "en",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    interim_results: "true",
    punctuate: "true",
    smart_format: "true"
  });

  connection.on("message", (data) => {
    if (data?.type !== "Results") return;

    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript) return;

    const isFinal = Boolean(data.is_final || data.speech_final);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("transcription:result", {
        source,
        text: transcript,
        isFinal
      });
    }
  });

  connection.on("error", (error) => {
    sendStatus(`${source} transcription error: ${error?.message || "Unknown error"}`, "error");
  });

  connection.connect();
  await connection.waitForOpen();
  return connection;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: "#0a0c10",
    title: "Live Call Transcription",
    autoHideMenuBar: true, // Hide default File/Edit/View menu strip
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // Windows loopback capture is provided when the renderer calls getDisplayMedia().
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
      });

      if (!sources.length) {
        callback(null);
        return;
      }

      callback({ video: sources[0], audio: "loopback" });
    } catch {
      callback(null);
    }
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  ipcMain.handle("transcription:start", async () => {
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error("DEEPGRAM_API_KEY is missing. Add it to the .env file and restart the app.");
    }
    if (process.platform !== "win32") {
      throw new Error("This starter currently configures system-audio loopback for Windows.");
    }

    deepgramClient = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

    const [micConnection, systemConnection] = await Promise.all([
      openDeepgramConnection("microphone"),
      openDeepgramConnection("system")
    ]);

    connections.set("microphone", micConnection);
    connections.set("system", systemConnection);
    sendStatus("Connected to live transcription.", "success");
    return true;
  });

  ipcMain.on("transcription:audio", (_event, source, audioBuffer) => {
    const connection = connections.get(source);
    if (!connection || !audioBuffer) return;

    try {
      connection.sendMedia(Buffer.from(audioBuffer));
    } catch (error) {
      sendStatus(`Could not send ${source} audio: ${error.message}`, "error");
    }
  });

  ipcMain.handle("transcription:stop", async () => {
    for (const connection of connections.values()) {
      try {
        connection.sendFinalize({ type: "Finalize" });
        connection.sendCloseStream();
      } catch {
        // Ignore errors while shutting down a stream.
      }
    }
    connections.clear();
    sendStatus("Transcription stopped.", "info");
    return true;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});