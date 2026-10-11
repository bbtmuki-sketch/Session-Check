// fetch-daily.mjs
// Läuft in GitHub Actions (Node 20+, eingebautes fetch). Kein API-Key nötig.
// Schreibt data/daily.json. Bei Fehlern: alter Stand bleibt erhalten, Fehler wird geloggt.
//
// STATUS DER QUELLEN:
//   Forex Factory  -> VERIFIZIERT (öffentlicher, dokumentierter JSON-Feed)
//   CBOE VIX       -> VERIFIZIERT (offizielle CBOE-CSV)
//   Stooq SPX      -> weitgehend verlässlich, aber inoffiziell -> beim ersten Lauf prüfen
//   CFTC TFF       -> UNVERIFIZIERT. Feldnamen/Marktbezeichnung sind Socrata-Standardnamen,
//                     aber nicht live gegen die aktuelle API getestet. Das Skript loggt beim
//                     ersten Lauf die rohen Felder, damit du sie kontrollieren kannst, und
//                     bricht kontrolliert ab statt falsche Werte zu schreiben.

import { writeFile, readFile } from "node:fs/promises";

const OUT_PATH = new URL("../data/daily.json", import.meta.url);
const VIENNA_TZ = "Europe/Vienna";

function todayInVienna() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIENNA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

// ---------- 1. Forex Factory Kalender ----------
// Doku/Community-Konsens: https://nfs.faireconomy.media/ff_calendar_thisweek.json
// WICHTIG: laut Betreiber max. 1x/Tag abrufen, sonst IP-Sperre. Dieses Skript läuft
// per Cron genau 1x täglich — nicht öfter aufrufen.
async function fetchCalendar() {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
    headers: { "User-Agent": "session-bias-dashboard/1.0 (personal use)" },
  });
  if (!res.ok) throw new Error(`Forex Factory: HTTP ${res.status}`);
  const rows = await res.json();

  const today = todayInVienna();
  const events = rows
    .filter((r) => r.country === "USD" && r.impact === "High")
    .map((r) => {
      const d = new Date(r.date); // ISO mit Offset laut Feed
      const vienna = new Intl.DateTimeFormat("en-CA", {
        timeZone: VIENNA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
      return { title: r.title, time_vienna: vienna, day: vienna.slice(0, 10) };
    })
    .filter((e) => e.day === today)
    .map((e) => ({ title: e.title, time_vienna: e.time_vienna.slice(11) }));

  return events;
}

// ---------- 2. CBOE VIX ----------
// Offizielle CSV: http://www.cboe.com/publish/ScheduledTask/MktData/datahouse/vixcurrent.csv
async function fetchVix() {
  const res = await fetch(
    "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"
  ).catch(() => null);

  // Primäre bekannte URL zuerst versuchen, Fallback auf die klassische vixcurrent.csv
  let text;
  if (res && res.ok) {
    text = await res.text();
  } else {
    const res2 = await fetch(
      "https://www.cboe.com/publish/ScheduledTask/MktData/datahouse/vixcurrent.csv"
    );
    if (!res2.ok) throw new Error(`CBOE VIX: HTTP ${res2.status}`);
    text = await res2.text();
  }

  const lines = text.trim().split("\n").filter(Boolean);
  // Header-Zeile suchen (beginnt mit "DATE" oder "Date")
  const headerIdx = lines.findIndex((l) => /^date/i.test(l));
  if (headerIdx === -1) throw new Error("CBOE VIX: Header nicht gefunden, Format geprüft?");
  const dataLines = lines.slice(headerIdx + 1);
  const last = dataLines[dataLines.length - 1].split(",");
  const prev = dataLines[dataLines.length - 2].split(",");

  const close = parseFloat(last[4] ?? last[last.length - 1]);
  const prevClose = parseFloat(prev[4] ?? prev[prev.length - 1]);

  return {
    close,
    prev_close: prevClose,
    change_pct: Number((((close - prevClose) / prevClose) * 100).toFixed(2)),
    as_of: last[0],
  };
}

// ---------- 3. Stooq SPX ----------
async function fetchSpx() {
  const res = await fetch("https://stooq.com/q/d/l/?s=%5Espx&i=d");
  if (!res.ok) throw new Error(`Stooq SPX: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 3) throw new Error("Stooq SPX: unerwartet wenig Daten, Symbol prüfen");
  const last = lines[lines.length - 1].split(",");
  const prev = lines[lines.length - 2].split(",");
  const close = parseFloat(last[4]);
  const prevClose = parseFloat(prev[4]);
  return {
    close,
    prev_close: prevClose,
    change_pct: Number((((close - prevClose) / prevClose) * 100).toFixed(2)),
    as_of: last[0],
  };
}

// ---------- 4. CFTC TFF (unverifiziert) ----------
async function fetchCftc() {
  const params = new URLSearchParams({
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": "8",
    "$q": "E-MINI S&P 500",
  });
  const url = `https://publicreporting.cftc.gov/resource/gpe5-46if.json?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CFTC: HTTP ${res.status}`);
  const rows = await res.json();

  if (!rows.length) throw new Error("CFTC: keine Zeilen zurückgegeben, Suchbegriff prüfen");

  // Felder NICHT blind vertrauen: erst loggen, dann erst verwenden.
  console.log("CFTC — erste Zeile, rohe Felder zur Kontrolle:", JSON.stringify(rows[0], null, 2));

  const r = rows[0];
  const required = [
    "report_date_as_yyyy_mm_dd",
    "dealer_positions_long_all",
    "dealer_positions_short_all",
    "lev_money_positions_long",
    "lev_money_positions_short",
  ];
  const missing = required.filter((f) => !(f in r));
  if (missing.length) {
    throw new Error(
      `CFTC: erwartete Felder fehlen (${missing.join(", ")}). ` +
        `Feldnamen im Skript anpassen — siehe geloggte Rohdaten oben.`
    );
  }

  const reportDate = r.report_date_as_yyyy_mm_dd.slice(0, 10);
  const ageDays = Math.round(
    (Date.now() - new Date(reportDate).getTime()) / 86400000
  );
  const dealerNet =
    Number(r.dealer_positions_long_all) - Number(r.dealer_positions_short_all);
  const levNet =
    Number(r.lev_money_positions_long) - Number(r.lev_money_positions_short);

  return {
    status: "ok",
    report_date: reportDate,
    age_days: ageDays,
    dealer_net: dealerNet,
    leveraged_net: levNet,
    // Perzentil über die Historie ist bewusst NICHT enthalten — dafür bräuchte es
    // einen 52-Wochen-Abruf, das ist eine spätere Ausbaustufe, kein V1-Bestandteil.
  };
}

// ---------- Orchestrierung ----------
async function main() {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(OUT_PATH, "utf-8"));
  } catch {
    /* kein vorheriger Stand, ok */
  }

  const out = { ...previous, generated_at: new Date().toISOString() };

  try {
    out.calendar = {
      source: "Forex Factory (nfs.faireconomy.media)",
      events_today_high_impact_usd: await fetchCalendar(),
    };
  } catch (e) {
    console.error("Kalender-Fehler:", e.message);
    out.calendar = { ...previous.calendar, error: e.message };
  }

  try {
    out.vix = { source: "CBOE", ...(await fetchVix()) };
  } catch (e) {
    console.error("VIX-Fehler:", e.message);
    out.vix = { ...previous.vix, error: e.message };
  }

  try {
    out.spx = { source: "Stooq", ...(await fetchSpx()) };
  } catch (e) {
    console.error("SPX-Fehler:", e.message);
    out.spx = { ...previous.spx, error: e.message };
  }

  try {
    out.cftc_tff = {
      source: "CFTC Traders in Financial Futures",
      ...(await fetchCftc()),
    };
  } catch (e) {
    console.error("CFTC-Fehler (erwartet unverifiziert):", e.message);
    out.cftc_tff = {
      source: "CFTC Traders in Financial Futures",
      status: "unverified",
      error: e.message,
    };
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log("data/daily.json geschrieben.");
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
