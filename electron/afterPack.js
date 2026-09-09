"use strict";

/*
 * Ad-hoc-Signatur für macOS.
 *
 * Auf Apple Silicon verlangt macOS, dass jeder ausführbare Code eine Signatur
 * trägt – auch eine leere. Electron liefert seine Binärdateien signiert aus,
 * aber electron-builder baut das Paket um (umbenennen, Dateien ergänzen) und
 * macht die Signatur damit ungültig. Ohne Entwicklerzertifikat entsteht keine
 * neue, und macOS meldet die App als "beschädigt".
 *
 * "codesign --sign -" erzeugt eine Ad-hoc-Signatur: kein Zertifikat, keine
 * Notarisierung, aber gültig genug, damit die App startet. Der
 * Gatekeeper-Hinweis beim ersten Öffnen bleibt – dafür bräuchte es einen
 * Apple-Developer-Account.
 */

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, appName + ".app");

  console.log("  • Ad-hoc-Signatur wird gesetzt: " + appPath);
  try {
    execFileSync("codesign", [
      "--force",
      "--deep",
      "--sign", "-",
      "--timestamp=none",
      appPath
    ], { stdio: "inherit" });

    // Gegenprüfen – eine stillschweigend fehlgeschlagene Signatur waere
    // schlimmer als ein Abbruch, weil sie erst beim Nutzer auffaellt.
    execFileSync("codesign", ["--verify", "--verbose=2", appPath], { stdio: "inherit" });
    console.log("  • Signatur geprüft.");
  } catch (err) {
    throw new Error("Ad-hoc-Signatur fehlgeschlagen: " + (err && err.message));
  }
};
