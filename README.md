# School Planner Offline

Begleiter fürs Klassenzimmer zur Nextcloud-App
[School Planner](https://github.com/holger-dev/schoolplanner): Unterricht
durchführen, Anwesenheit und Mitarbeit erfassen – **ohne Netz**. Abends wird
alles zurück in die Nextcloud gespielt.

> **Status: Prototyp.** Die App kann sich mit einer echten Nextcloud verbinden
> (benötigt **School Planner 1.3.0**) – ohne Zugangsdaten läuft sie gegen einen
> simulierten Server, damit sich der Ablauf inklusive Konflikten auch ohne
> Cloud durchspielen lässt.

## Mit der Nextcloud verbinden

Nur in der Desktop-App: *Abgleich → Verbindung*. Nötig sind die Adresse der
Cloud, der Benutzername und ein **App-Passwort** (Nextcloud → Einstellungen →
Sicherheit → Geräte & Sitzungen → *Neues App-Passwort erstellen*). Ausführlich
beschrieben in
[`docs/api-sync.md`](https://github.com/holger-dev/schoolplanner/blob/main/docs/api-sync.md)
im Hauptrepo.

Das App-Passwort wird über `safeStorage` verschlüsselt im Schlüsselbund bzw. der
Anmeldeinformationsverwaltung abgelegt und gelangt **nie zurück in die
Oberfläche** – die weiß nur, dass eines hinterlegt ist. Die HTTP-Anfragen laufen
im Hauptprozess, nicht in der Seite; im Browser wäre jede Anfrage an die
Nextcloud ein seitenübergreifender Aufruf und würde blockiert.

Beim Abgleich gilt: **erst senden, dann holen.** Sonst überschreibt ein Abruf
eigene Änderungen, die der Server noch gar nicht kennt.

## Ausprobieren

**Im Browser** – `index.html` öffnen genügt. Damit auch Service Worker und
Installation funktionieren, besser kurz einen Server starten:

```bash
npm run serve      # oder: python3 -m http.server 8080
```

Auf dem Tablet über „Zum Home-Bildschirm hinzufügen" installieren.

**Als Desktop-App** – fertige Pakete liegen unter
[Releases](https://github.com/holger-dev/schoolplanneroffline/releases).

**macOS: die richtige Architektur wählen.** Die Dateinamen tragen sie am Ende:

| Datei                  | Für                                              |
|------------------------|--------------------------------------------------|
| `…-arm64.dmg`          | Apple Silicon (M1 und neuer) – der Normalfall     |
| `…-x64.dmg`            | Intel-Macs (bis 2020)                             |

Welchen Mac du hast, steht unter  → *Über diesen Mac*. Die Intel-Fassung
liefe auf Apple Silicon zwar über Rosetta, aber langsamer – und macOS warnt
bereits, dass die Unterstützung dafür ausläuft.

Windows und Linux gibt es nur als 64-Bit-Fassung, dort ist nichts zu wählen.

Selbst bauen:

```bash
npm install
npm start          # App direkt starten
npm run dist:mac   # .dmg für Apple Silicon und Intel nach dist/
```

`dist:win` und `dist:linux` bauen NSIS-Installer bzw. AppImage – jeweils **auf
dem Zielsystem**. Genau das macht die GitHub-Action automatisch.

### macOS: Signatur und Gatekeeper

Die App wird beim Bauen **ad-hoc signiert** (`codesign --sign -`, siehe
`electron/afterPack.js`). Das ist keine Signatur mit Zertifikat, aber ohne sie
verweigert Apple Silicon den Start komplett: macOS verlangt dort für jeden
ausführbaren Code eine gültige Signatur. Electron liefert seine Binärdateien
signiert aus, electron-builder baut das Paket jedoch um und macht die Signatur
damit ungültig – die App gilt dann als „beschädigt".

Was die Ad-hoc-Signatur **nicht** löst: den Gatekeeper-Hinweis beim ersten
Start. Dafür bräuchte es einen Apple-Developer-Account (99 $/Jahr) und
Notarisierung.

#### Hinweis von Gatekeeper beim ersten Start

Die App ist **nicht signiert und nicht notarisiert** – ein
Apple-Developer-Account kostet 99 $ im Jahr, und für ein Werkzeug im eigenen
Kollegium lohnt das erst einmal nicht. Beim ersten Start meldet macOS deshalb,
die App stamme von einem unbekannten Entwickler.

So geht es trotzdem:

1. App in den Ordner *Programme* ziehen.
2. **Rechtsklick** (oder Ctrl + Klick) auf die App → **Öffnen** → im Dialog noch
   einmal **Öffnen**. Nur beim ersten Mal nötig.

Falls macOS die App ganz ohne Öffnen-Option blockiert („beschädigt"), einmalig
im Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/School Planner Offline.app"
```

Windows SmartScreen meldet aus demselben Grund „Unbekannter Herausgeber" →
*Weitere Informationen* → *Trotzdem ausführen*.

## Updates

**Es gibt bewusst keine Selbstaktualisierung.** Unter macOS installiert Squirrel
nur signierte Updates – ohne Zertifikat würde die Datei geladen, das Update aber
nie eingespielt. Eine App, die „aktualisiert" meldet und es nicht tut, ist
schlimmer als eine ohne Updatefunktion. Damit sich alle drei Plattformen gleich
verhalten und testbar bleiben, aktualisiert keine von ihnen automatisch.

Stattdessen sieht die App beim Start nach, ob im GitHub-Release etwas Neueres
liegt, und zeigt einen Hinweis **mit der passenden Anleitung** – unter macOS
inklusive des Gatekeeper-Schritts, unter Windows ohne. „Diese Version
überspringen" blendet den Hinweis bis zur nächsten Fassung aus. Schlägt der
Abruf fehl – im Unterricht der Normalfall – passiert schlicht nichts.

### Neue Fassung einspielen

1. Neue Datei vom Release herunterladen.
2. App **beenden**.
3. macOS: App nach *Programme* ziehen, Ersetzen bestätigen. Windows/Linux:
   Installation ausführen bzw. AppImage austauschen.
4. macOS beim ersten Start: **Rechtsklick auf die App → Öffnen** (die
   Quarantäne-Markierung hängt am frischen Download, nicht an der App).

### Was passiert dabei mit den erfassten Daten?

Nichts. Die Daten liegen im `localStorage` des Nutzerprofils
(`~/Library/Application Support/School Planner Offline` bzw. `%APPDATA%`), nicht
im Programmpaket. Ein Update tauscht nur das Paket aus.

Zwei Voraussetzungen dafür, beide festgeschrieben:

- Der **Origin muss stabil bleiben** – siehe nächster Abschnitt. Genau daran
  wäre es beinahe gescheitert.
- `appId` und `productName` in der `package.json` dürfen sich **nicht ändern**.
  Daraus leitet Electron den Profilordner ab; ein umbenanntes Produkt stünde vor
  leeren Daten.

### Warum ein eigenes Protokoll statt file:// oder localhost

`localStorage` hängt am Origin. Ein lokaler HTTP-Server mit zufälligem Port
hätte bei **jedem Start einen anderen Origin** – und damit jedes Mal leere
Mitarbeitsdaten. `file://` wiederum ist ein *opaque origin* und ebenfalls nicht
verlässlich.

Die App wird deshalb über ein eigenes, als `standard` und `secure` angemeldetes
Protokoll geladen: `app://schoolplanner/`. Der Origin ist über Neustarts **und
über Updates hinweg** derselbe.

Der Nebeneffekt der Desktop-Hülle ist praktisch: Das **Präsentationsfenster
landet automatisch auf dem zweiten Bildschirm und startet dort im Vollbild**,
sobald ein Beamer angeschlossen ist. Im Browser muss man es hinüberziehen.

## Release bauen

Die Action `.github/workflows/release.yml` baut auf drei Läufern parallel
(macOS, Windows, Ubuntu) und hängt die Pakete ans Release:

1. Auf GitHub ein Release mit Tag `v0.2.0` anlegen und **veröffentlichen**.
2. Die Action übernimmt die Version aus dem Tag in die `package.json`, baut und
   hängt `.dmg`, `.exe` und `.AppImage` ans Release.

Die Versionsnummer im Tag ist zugleich das, womit die App ihren Hinweis
vergleicht – ein Release ohne Tag-Version bleibt also unbemerkt.

**Wichtig:** In der `package.json` steht unter `build.publish` der Eintrag
`"releaseType": "release"`. Ohne ihn will electron-builder in einen **Entwurf**
veröffentlichen, findet ein bereits veröffentlichtes Release vor und
überspringt das Anhängen – mit der Meldung `skipped publishing … existingType=release
publishingType=draft`. Der Job bleibt dabei **grün**, es hängt nur nichts am
Release. Genau dieser Fall hat bei v0.2.2 zugeschlagen.

Über *Actions → Run workflow* lässt sich der Build auch ohne Release testen; die
Pakete landen dann als Artefakte statt am Release.

## Der Workflow

1. **Morgens synchronisieren** – *Abgleich → Von Nextcloud laden.* Kurse,
   Stunden, Schüler:innen und Ablaufelemente liegen danach lokal vor.
### Was „fertig" bedeutet

Wie in der Nextcloud: Die Stunde ist durch, wenn der **aktuelle Schritt der
letzte** ist und alles freigegeben wurde – es gibt dann schlicht kein weiteres
Element mehr. Einen eigenen Endzustand „fertig ohne aktuellen Schritt" gibt es
bewusst **nicht**; sonst würden beide Seiten dieselben Daten verschieden lesen.
Ganz schließen lässt sich eine Stunde über *Zurücksetzen*.

2. **Unterrichten** – *Heute* zeigt alle Stunden des Tages. Die laufende Stunde
   erscheint als Cockpit: links **Für die Klasse** (was projiziert wird), rechts
   **Nur für dich** (Lehrerhinweis zum aktuellen Schritt und Vorschau auf den
   nächsten). **Weiter** führt Schritt für Schritt durch den Ablauf und gibt das
   jeweilige Element automatisch für die Schüler:innen frei.
3. **Mitarbeit erfassen** – Reiter *Mitarbeit*: eine Zeile je Person mit
   Anwesenheit, Bewertung in der Skala des Kurses und Notiz.
4. **Abends zurückspielen** – *Abgleich → Übertragen.* Mitarbeit, Anwesenheit,
   Stundenstatus und Freigaben gehen zurück in die Nextcloud.

Alles dazwischen funktioniert vollständig offline. Die Zahl offener Änderungen
steht dauerhaft oben rechts.

## Projizieren

Zwei Wege, je nach Aufbau im Raum:

- **Präsentationsfenster** – öffnet ein zweites Browserfenster, das auf den
  Beamer-Bildschirm gezogen wird. Es zeigt ausschließlich die Schüleransicht und
  folgt automatisch jedem **Weiter**. Die Aktualisierung läuft direkt über das
  DOM des Fensters, also ohne Netz und ohne BroadcastChannel – das funktioniert
  auch, wenn die Datei nur lokal geöffnet wurde.
- **Vollbild** – dieselbe Ansicht als Overlay auf dem eigenen Gerät, für ein
  gespiegeltes Tablet. Steuerleiste unten, Escape beendet.

**Lehrerhinweise erscheinen in keiner der beiden Ansichten** – sie wären sonst
an die Wand projiziert. Sie stehen ausschließlich im Cockpit auf dem Gerät der
Lehrkraft.

Pfeiltasten, Leertaste und Bild auf/ab steuern die Schritte, damit auch
Presenter-Fernbedienungen funktionieren.

## Bewertungsskalen

Die Skala ist eine Kurseinstellung und wird **eins zu eins von der Nextcloud-App
übernommen** – gleiche Bezeichner, gleiche Symbole, sonst würden die Daten beim
Abgleich verworfen:

| Kurseinstellung | Bezeichner | Bedienung                      |
|-----------------|------------|--------------------------------|
| Keine Note      | `''`       | nur Anwesenheit, keine Noten   |
| Skala 1–3       | `scale3`   | `+` `+/-` `-`                  |
| Skala 1–5       | `scale5`   | `++` `+` `+/-` `-` `--`        |
| Note 1–6        | `note`     | Auswahlfeld 1 bis 6            |

Anwesenheit kennt dieselben drei Werte wie die Nextcloud-App: `present`,
`excused`, `unexcused`. Bei Abwesenheit wird die Bewertung ausgeblendet.

Die Demodaten enthalten bewusst **alle vier Varianten** (Informatik 9b, 7a,
Info-LK Q1, Vertretung 8c), damit jede Einstellung geprüft werden kann.

## Oberfläche

Gebaut für Laptop und Desktop: kompakte Bedienelemente, Reiter oben in der
Kopfzeile, Werkzeugleisten statt vollbreiter Knöpfe. Zeigt das Gerät einen
groben Zeiger (`@media (pointer: coarse)`), werden die Ziele automatisch
größer – das kostet am Rechner nichts.

**Erscheinungsbild** über den Umschalter oben rechts: *System → Hell → Dunkel →
System*. Die Wahl wird gemerkt; auf „System" folgt die App der
Betriebssystemeinstellung, auch wenn diese im laufenden Betrieb wechselt. Das
Präsentationsfenster zieht mit.

**Kursansicht** als Zweispalter: links die Kurse, rechts die Stunden nach Monat
gruppiert. Voreingestellt sind die **kommenden** Stunden, dazu Filter *Offen*
und *Alle* sowie eine Suche – eine Reihe mit 30 Terminen wäre als vollständige
Liste unbrauchbar.

## Konflikte

Wenn derselbe Datensatz auf beiden Seiten geändert wurde, wird **nicht
stillschweigend überschrieben**. Der Abgleich zeigt beide Versionen
nebeneinander, die Lehrkraft entscheidet pro Fall.

Zum Ausprobieren gibt es unter *Abgleich → Demo-Werkzeuge* den Knopf
**„Änderung in der Nextcloud simulieren"**: er ändert einen Datensatz auf der
simulierten Serverseite. Wird derselbe Eintrag danach lokal bearbeitet und
übertragen, erscheint der Konfliktdialog.

## Entwurfsentscheidungen

**Die App schreibt nur Zustände, keine Inhalte.** Übertragen werden Mitarbeit,
Anwesenheit, Stundenstatus und Freigaben – alles kleine, aufzählbare Felder.
Stunden und Texte werden hier nur gelesen; geplant wird weiter am Rechner. Damit
legt die App nie Datensätze mit unbekannter ID an, und der Abgleich braucht
weder UUID-Zuordnung noch Tombstones noch Merging von Markdown.

**„Muss übertragen werden" ist ein Flag, kein Zeitstempelvergleich.** Ginge die
Uhr des Servers vor, würden lokale Änderungen sonst als älter gelten und still
nie gesendet. Zeitstempel dienen ausschließlich der Konflikterkennung – und dort
werden nur Serverzeiten miteinander verglichen (`syncedAt` ist die Serverzeit des
letzten Abgleichs), also ohne Bezug zur Geräteuhr.

**Zero-Build als Prototyp.** Eine einzige `index.html` ohne Framework läuft sofort
auf Laptop, Tablet und Telefon – ohne Toolchain, bevor überhaupt klar ist, ob der
Workflow trägt. Für die produktive Fassung ist das noch nicht die Antwort: Unter
iOS kann Safari den Speicher einer Web-App verwerfen, und Mitarbeitsdaten dürfen
nicht verloren gehen. Dann entweder Flutter mit SQLite oder diese Oberfläche mit
robusterer Speicherung.

## Nächste Schritte

1. Sync-Endpunkte in der Nextcloud-App (`SyncController`, `/api/v1/sync` und
   `/api/v1/participation/batch`) – siehe
   [`docs/offline-app-konzept.md`](https://github.com/holger-dev/schoolplanner/blob/main/docs/offline-app-konzept.md)
   im Hauptrepo.
2. Anmeldung über Nextcloud Login Flow v2 statt Demodaten.
3. Feldtest über zwei Wochen im echten Unterricht.

## Aufbau

```
index.html              komplette App (Stil, Markup, Logik)
manifest.webmanifest    Installierbarkeit als PWA
sw.js                   App-Shell offline halten
icon.svg                Symbol für Web und PWA
electron/main.js        Desktop-Hülle: lokaler Server, Fenster, zweiter Bildschirm
build/icon.png          Symbol für die Desktop-Builds
package.json            Skripte und electron-builder-Konfiguration
```

Alle Daten liegen unter dem localStorage-Schlüssel `spo.proto.v1`. *Abgleich →
Demodaten zurücksetzen* stellt den Auslieferungszustand wieder her.
