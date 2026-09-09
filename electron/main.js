"use strict";

/*
 * School Planner Offline – Electron-Hülle
 *
 * Die App wird über ein eigenes Protokoll app://schoolplanner/ geladen, nicht
 * über file:// und auch nicht über einen lokalen HTTP-Server.
 *
 * Warum das wichtig ist: localStorage hängt am Origin. Ein HTTP-Server auf
 * einem zufälligen Port hätte bei jedem Start einen anderen Origin – und damit
 * bei jedem Start leere Mitarbeitsdaten. file:// wiederum ist ein "opaque
 * origin" und ebenfalls nicht verlässlich. app://schoolplanner ist stabil,
 * über Neustarts und über App-Updates hinweg.
 */

const { app, BrowserWindow, protocol, screen, shell, Menu, net, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const SCHEME = "app";
const ORIGIN = "app://schoolplanner";

let mainWindow = null;

/* Das Protokoll muss vor app.whenReady() angemeldet werden. "standard" sorgt
   für einen echten Origin (und damit für dauerhaften localStorage), "secure"
   dafür, dass Chromium die Seite wie https behandelt. */
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function registerProtocol() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";

    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {                       // Pfad-Ausbruch verhindern
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* Der zweite Bildschirm, falls einer angeschlossen ist (Beamer). */
function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().filter((d) => d.id !== primary.id)[0] || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0f1622",
    title: "School Planner Offline",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Mittig in dem 38 px hohen Streifen, den die Seite oben frei laesst.
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 13 } : undefined,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [
        "--spo-version=" + app.getVersion(),
        "--spo-platform=" + process.platform
      ]
    }
  });

  mainWindow.loadURL(ORIGIN + "/index.html");

  /*
   * Das Präsentationsfenster (window.open in der App) landet automatisch auf
   * dem zweiten Bildschirm und startet dort im Vollbild. Ist nur ein Bildschirm
   * da, öffnet es als normales Fenster zum Verschieben.
   */
  mainWindow.webContents.setWindowOpenHandler(() => {
    const ext = externalDisplay();
    const b = ext ? ext.bounds : null;
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: b ? b.width : 1280,
        height: b ? b.height : 800,
        x: b ? b.x : undefined,
        y: b ? b.y : undefined,
        fullscreen: !!b,
        backgroundColor: "#0f1622",
        title: "Präsentation",
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      }
    };
  });

  /* Externe Links im richtigen Browser öffnen, nicht in der App. */
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [];
  if (isMac) template.push({ role: "appMenu" });
  template.push(
    {
      label: "Präsentation",
      submenu: [
        { label: "Vollbild umschalten", role: "togglefullscreen" },
        { type: "separator" },
        { label: "Neu laden", role: "reload" },
        { label: "Entwicklerwerkzeuge", role: "toggleDevTools" }
      ]
    },
    { role: "editMenu" },
    { role: "windowMenu" }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/*
 * Bewusst KEINE Selbstaktualisierung.
 *
 * Unter macOS installiert Squirrel nur signierte Updates – ohne Zertifikat
 * würde die Datei geladen, das Update aber nie eingespielt. Eine App, die
 * "aktualisiert" meldet und es nicht tut, ist schlimmer als eine ohne
 * Updatefunktion. Damit sich alle Plattformen gleich verhalten und testbar
 * bleiben, prüft die Seite lediglich, ob ein neueres Release vorliegt, und
 * zeigt eine Anleitung. Heruntergeladen und ersetzt wird von Hand.
 */
ipcMain.handle("open-external", (_event, url) => {
  if (typeof url === "string" && /^https:\/\//.test(url)) shell.openExternal(url);
});

/* =========================================================================
 * Zugangsdaten und Anfragen an die Nextcloud
 *
 * Beides liegt bewusst im Hauptprozess:
 *   1. Das App-Passwort wird mit safeStorage verschlüsselt (Schlüsselbund
 *      bzw. Anmeldeinformationsverwaltung) und gelangt nie in die Seite
 *      zurück – die Oberfläche erfährt nur, DASS eines hinterlegt ist.
 *   2. Die HTTP-Anfragen laufen hier und nicht im Renderer. Sonst wäre jede
 *      Anfrage an die Nextcloud ein Cross-Origin-Aufruf und würde an CORS
 *      scheitern.
 * ========================================================================= */
const CRED_FILE = () => path.join(app.getPath("userData"), "connection.bin");
let creds = null;                       // { baseUrl, user, password }

function normalizeBase(url) {
  let u = String(url || "").trim();
  if (u === "") return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

function loadCreds() {
  if (creds) return creds;
  try {
    const raw = fs.readFileSync(CRED_FILE());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    creds = JSON.parse(json);
  } catch (err) {
    creds = null;
  }
  return creds;
}

ipcMain.handle("creds:load", () => {
  const c = loadCreds();
  return c ? { baseUrl: c.baseUrl, user: c.user, hasPassword: !!c.password } : null;
});

ipcMain.handle("creds:save", (_event, data) => {
  const next = {
    baseUrl: normalizeBase(data && data.baseUrl),
    user: String((data && data.user) || "").trim(),
    password: String((data && data.password) || "")
  };
  if (!next.password && creds && creds.password) next.password = creds.password;

  const json = JSON.stringify(next);
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf8");
  fs.writeFileSync(CRED_FILE(), buf, { mode: 0o600 });
  creds = next;

  return { baseUrl: next.baseUrl, user: next.user, hasPassword: !!next.password };
});

ipcMain.handle("creds:clear", () => {
  creds = null;
  try { fs.unlinkSync(CRED_FILE()); } catch (err) { /* war nie da */ }
  return true;
});

ipcMain.handle("api:request", async (_event, req) => {
  const c = loadCreds();
  if (!c || !c.baseUrl || !c.user || !c.password) {
    return { ok: false, status: 0, error: "Keine Zugangsdaten hinterlegt." };
  }

  const method = (req && req.method) === "POST" ? "POST" : "GET";
  const query = new URLSearchParams(
    Object.entries((req && req.query) || {}).filter(([, v]) => v !== "" && v != null)
  ).toString();
  const url = c.baseUrl + "/index.php/apps/schoolplanner/api/v1"
    + String((req && req.path) || "") + (query ? "?" + query : "");

  const headers = {
    Authorization: "Basic " + Buffer.from(c.user + ":" + c.password).toString("base64"),
    Accept: "application/json",
    "OCS-APIRequest": "true"
  };
  const init = { method, headers };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify((req && req.body) || {});
  }

  try {
    const response = await net.fetch(url, init);
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }

    if (data === null) {
      // Kommt HTML zurueck, stimmt meist die Adresse nicht – oder ein
      // Anmeldeportal im Schulnetz hat sich dazwischengeschoben.
      return {
        ok: false, status: response.status,
        error: response.status === 401
          ? "Benutzername oder App-Passwort stimmt nicht."
          : "Keine gültige Antwort (Adresse prüfen: mit /index.php/apps/schoolplanner erreichbar?)."
      };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: "Server meldet " + response.status, data };
    }
    return { ok: true, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: "Server nicht erreichbar (" + (err && err.message) + ")." };
  }
});

app.whenReady().then(() => {
  registerProtocol();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
