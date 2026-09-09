"use strict";

/*
 * Schmale Brücke in die Seite. Bewusst minimal: Versionsnummer, Plattform und
 * das Öffnen externer Links. Kein Dateizugriff, kein Node in der Seite.
 */

const { contextBridge, ipcRenderer } = require("electron");

function argValue(prefix) {
  const hit = process.argv.filter((a) => a.startsWith(prefix))[0];
  return hit ? hit.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("spo", {
  isDesktop: true,
  version: argValue("--spo-version="),
  platform: argValue("--spo-platform="),
  openExternal: (url) => ipcRenderer.invoke("open-external", url)
});
