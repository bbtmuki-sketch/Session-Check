# Session-Check

Statisches Pre-Session-Dashboard. Kein Server, kein API-Key, kein Modell,
keine laufenden Kosten. Läuft über GitHub Pages, die Daten holt einmal
täglich eine kostenlose GitHub Action.

## Setup (einmalig, ca. 10 Minuten)

1. Neues **öffentliches** GitHub-Repo anlegen (kostenloses GitHub-Konto reicht).
   Wichtig: Auf dem kostenlosen Tarif funktioniert GitHub Pages nur mit
   öffentlichen Repos. Öffentlich sind nur Code und Marktdaten — deine
   Eingaben (Stimmung, Trade, Flow-Read) verlassen nie den Browser.
2. Diese Dateien in das Repo pushen, Ordnerstruktur beibehalten:
   ```
   index.html
   data/daily.json
   scripts/fetch-daily.mjs
   .github/workflows/daily-data.yml
   ```
3. In den Repo-Einstellungen **Settings → Pages** aktivieren, Branch `main`,
   Ordner `/ (root)`.
4. In **Settings → Actions → General → Workflow permissions**:
   „Read and write permissions" aktivieren — sonst darf die Action
   `data/daily.json` nicht zurückschreiben.
5. Unter **Actions** den Workflow „Tägliche Marktdaten" einmal manuell über
   „Run workflow" starten, um ihn zu testen (siehe unten).
6. Die Seite ist danach unter `https://<dein-github-name>.github.io/<repo-name>/`
   erreichbar. Als Lesezeichen/Home-Screen-Icon auf dem Handy speichern.

## Status jeder Datenquelle

| Quelle | Status | Anmerkung |
|---|---|---|
| Forex Factory Kalender | **verifiziert** | Öffentlicher, dokumentierter Feed. Läuft 1x/Tag per Cron — nicht öfter triggern, sonst Sperre. |
| CBOE VIX | **verifiziert** | Offizielle CSV, zwei URL-Varianten im Skript als Fallback. |
| Stooq SPX | **wahrscheinlich funktionsfähig, nicht live getestet** | Inoffizielle, aber verbreitete Quelle. Nach dem ersten Lauf `data/daily.json` prüfen. |
| CFTC TFF (Banken/Fonds-Positionierung) | **unverifiziert** | Feldnamen sind Socrata-Standardbezeichnungen, aber nicht live gegen die aktuelle API getestet. Das Skript loggt beim ersten Lauf die rohen Felder in den Actions-Log. Schlägt die Abfrage fehl, zeigt das Dashboard „nicht verfügbar" statt falscher Werte — nichts wird stillschweigend erfunden. |

**Nach dem ersten manuellen „Run workflow"-Lauf:** unter Actions → den Lauf
öffnen → Log von „Daten abrufen" ansehen. Dort steht, welche Quellen
funktioniert haben und welche nicht. Bei CFTC-Fehlern die geloggten Rohdaten
mit den im Skript erwarteten Feldnamen (`fetchCftc()` in
`scripts/fetch-daily.mjs`) abgleichen und ggf. anpassen.

## Bekannte Unsicherheiten (nicht getestet)

- Ob die Seite nach dem Daten-Commit der Action automatisch neu veröffentlicht
  wird, ist nicht geprüft. Nach dem ersten manuellen Lauf kontrollieren, ob die
  Seite neue Daten zeigt (ggf. Strg+F5).
- GitHub kann geplante Workflows in Repos ohne Aktivität nach längerer Zeit
  deaktivieren. Gelegentlich unter Actions prüfen, ob der Lauf noch aktiv ist.

## Was die App bewusst NICHT macht

- Keine „institutionelle Bias-Richtung" oder Pfeil-Anzeige. Die CFTC-Daten
  sind bis zu 8 Tage alt (wöchentliche Veröffentlichung freitags, Stand
  Dienstag) — daraus lässt sich keine Aussage für die laufende Session
  ableiten. Sie erscheinen nur als Wochenkontext mit sichtbarem Alter.
- Kein Sprachmodell. Die Checkliste entsteht aus festen, nachvollziehbaren
  Regeln in `index.html` (Funktion `buildChecklist()`) — kein API-Call,
  kein Ausfallrisiko, keine Kosten.
- Kein ES/NQ-Direktfeed. SPX und VIX dienen als kostenloser Näherungswert
  für Marktkontext, nicht als Ersatz für den eigenen ATAS/Rithmic-Blick.

## Regeln anpassen

Alle Regeln stehen in `buildChecklist()` in `index.html`, in Klartext,
keine versteckte Logik. Neue Regel hinzufügen: neues Objekt
`{ severity, tag, text }` ins `items`-Array pushen.

## Nächste mögliche Ausbaustufe (nicht in V1)

- 52-Wochen-Perzentil für die CFTC-Positionierung (zusätzlicher Abruf nötig)
- Kostenloses LLM-Tier statt reiner Regel-Logik, sobald gewünscht
- Lokale Historie der letzten Checklisten (localStorage)
