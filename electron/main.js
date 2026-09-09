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

const { app, BrowserWindow, protocol, screen, shell, Menu, net, ipcMain } = require("electron");
const path = require("path");
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
