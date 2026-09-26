// Achtergrond-meldingen zonder Firebase: een Notifee-foreground-service houdt een WebSocket naar de
// Jarvis-server open. De blijvende "Jarvis luistert mee"-melding toont de verbindingsstatus MET het
// tijdstip van het laatste contact, zodat een door Android bevroren service zichtbaar wordt (de tijd
// loopt dan niet meer op). Welke gebeurtenissen een melding verdienen staat in reasonFor() hieronder
// en is gelijkgetrokken met lib/push.js op de server.
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import CookieManager from '@react-native-cookies/cookies';
import { AppState } from 'react-native';
import { SERVER, WS_URL, COOKIE_NAME } from './config';

const FGS_ID = 'jarvis-fgs';
// Android-meldingskanalen zijn ONVERANDERLIJK: is een kanaal eenmaal door de gebruiker (of door een
// "Blokkeren"-knop op een melding) uitgezet, dan krijgt de app het nooit meer aan — createChannel doet
// dan niets en displayNotification verdwijnt geruisloos. Het kanaal-id draagt daarom een versienummer;
// bij twijfel verhogen we dat, dan is het kanaal weer vers en actief.
const ALERT_CHANNEL = 'jarvis-alerts-v2';
const SERVICE_CHANNEL = 'jarvis-service';
const HEARTBEAT_MS = 30000;   // hoe vaak we de verbinding aftasten én de status-tijd verversen
const THROTTLE_MS = 60000;    // max 1 melding per sessie+type (zelfde regel als lib/push.js)
let ws = null;
let stopped = false;
let backoff = 2000;
let runnerStarted = false;
let heartbeat = null;
let appStateSub = null;
let lastStatusAt = 0;
let lastAlertNote = '';  // uitleg in de statusregel als een melding niet getoond kon worden
let alertCount = 0;  // hoeveel meldingen de dienst heeft proberen te tonen (staat in de statusregel)
const lastAlert = new Map(); // throttle-sleutel -> tijdstip

async function cookieHeader() {
  try {
    const cookies = await CookieManager.get(SERVER);
    const c = cookies && cookies[COOKIE_NAME];
    return c && c.value ? `${COOKIE_NAME}=${c.value}` : null;
  } catch { return null; }
}

// Werk de blijvende foreground-melding bij (zelfde id) zodat de status zichtbaar is.
async function setStatus(body) {
  try {
    await notifee.displayNotification({
      id: FGS_ID,
      title: 'Jarvis luistert mee',
      body,
      android: {
        channelId: SERVICE_CHANNEL,
        asForegroundService: true,
        ongoing: true,
        importance: AndroidImportance.LOW,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'open', launchActivity: 'default' },
      },
    });
  } catch { /* stil */ }
}

// Welke gebeurtenis verdient een melding — spiegelt `reasonFor` in lib/push.js op de server, zodat
// de app en de web-push-kant dezelfde dingen melden. Alles wat hier niet in staat (gewone tool-uitvoer,
// tussenteksten) blijft stil.
function reasonFor(ev) {
  if (!ev || !ev.sid) return null;
  if (ev.t === 'needhuman') return { title: '🙋 Jarvis heeft je nodig', body: ev.text || 'Jarvis kan niet verder zonder jou.' };
  if (ev.t === 'blocked') return { title: '⛔ Jarvis werd geblokkeerd', body: `Geen toestemming voor: ${ev.text || 'een actie'}` };
  if (ev.t === 'error') {
    return ev.kind === 'auth'
      ? { title: '🔑 Jarvis-token verlopen', body: 'Herregistreer het Claude-token in de app.' }
      : { title: '⚠️ Jarvis stopte met een fout', body: String(ev.message || 'Onbekende fout').slice(0, 160) };
  }
  if (ev.t === 'stuck') return { title: '🌀 Jarvis lijkt vast te lopen', body: String(ev.message || 'Al een tijd geen activiteit.').slice(0, 160) };
  if (ev.t === 'taskdone') return { title: '✅ Taak afgerond', body: ev.text ? String(ev.text).slice(0, 160) : 'Een taak is afgerond.' };
  if (ev.t === 'result') {
    // Max-turns is geen eindpunt meer: de server stuurt zichzelf tot 5 automatische vervolgbeurten.
    // Pas als die op zijn, stuurt hij een 'needhuman' — dáár melden we op, niet hier.
    if (ev.maxTurnsHit) return null;
    // Echte fouten komen al als 'error' langs (met volledige uitleg) — hier niet dubbelen.
    if (ev.isError) return null;
    // Onbemande achtergrondruns melden zichzelf al via een taak/Slack-alert als er iets mis is.
    if (String(ev.title || '').startsWith('[auto-')) return null;
    const wat = String(ev.title || '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 90);
    return { title: '✅ Jarvis is klaar', body: wat || 'Je opdracht is afgerond.' };
  }
  return null;
}

// Waarom deze omweg: notifee kan een melding zonder klagen accepteren terwijl Android hem daarna
// gewoon niet toont (geblokkeerd/gedempt kanaal). Daarom controleren we NA het tonen of de melding
// echt in het meldingenscherm staat, en vallen we anders terug op het service-kanaal — dat kanaal
// hoort bij de foreground-service en wordt door Android altijd weergegeven.
async function displayOn(channelId, id, reason, sid, importance) {
  await notifee.displayNotification({
    id,
    title: reason.title,
    body: reason.body,
    data: { url: sid ? `/?sid=${sid}` : '/' },
    android: {
      channelId,
      importance,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'open', launchActivity: 'default' },
      // LET OP: notifee eist een EVEN aantal waarden (paren van wachten/trillen), elk groter dan 0.
      // Een oneven reeks laat displayNotification falen en dan verdwijnt de melding zonder dat je
      // er iets van ziet — dat was maandenlang de reden dat app-meldingen nooit aankwamen.
      vibrationPattern: [300, 500],
    },
  });
}

async function isDisplayed(id) {
  try {
    const shown = await notifee.getDisplayedNotifications();
    return shown.some((n) => n.id === id || (n.notification && n.notification.id === id));
  } catch { return true; } // kunnen we het niet nagaan, dan niet nodeloos dubbel melden
}

async function showAlert(reason, sid) {
  const id = `jarvis-alert-${Date.now()}`;
  await displayOn(ALERT_CHANNEL, id, reason, sid, AndroidImportance.HIGH);
  if (await isDisplayed(id)) { lastAlertNote = ''; return; }
  // Melding is stil verdwenen -> nog eens via het kanaal dat aantoonbaar wel doorkomt.
  await displayOn(SERVICE_CHANNEL, `${id}-fb`, reason, sid, AndroidImportance.DEFAULT);
  const ok = await isDisplayed(`${id}-fb`);
  let blocked = '?';
  try { const ch = await notifee.getChannel(ALERT_CHANNEL); blocked = ch ? String(!!ch.blocked) : 'ontbreekt'; } catch {}
  lastAlertNote = ok
    ? ` · meldingskanaal geweigerd (blocked=${blocked}), via achtergrondkanaal getoond`
    : ` · Android weigert beide kanalen (blocked=${blocked})`;
}

// Losse testmelding (via de alerts-kanaal) om te bevestigen dat meldingen aankomen.
export async function testNotification() {
  await showAlert({ title: '🔔 Testmelding', body: 'Meldingen werken op dit toestel. Je krijgt zo ook echte Jarvis-waarschuwingen.' }, null);
}

// De status-melding toont de tijd van het laatste echte contact. Wordt die tijd oud terwijl er
// "Verbonden" staat, dan is de service door Android bevroren of gekild — precies het geval dat
// vroeger onzichtbaar was (de melding bleef "Verbonden" tonen terwijl er niets meer binnenkwam).
function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function markAlive(force = false) {
  const now = Date.now();
  // Tijdens een drukke sessie stromen er tientallen events per minuut binnen; de blijvende melding
  // hoeft niet bij elk event herschreven te worden.
  if (!force && now - lastStatusAt < 20000) return;
  lastStatusAt = now;
  // De teller maakt zichtbaar of de dienst een melding WILDE tonen. Blijft hij op 0 terwijl je in de
  // app wel iets ziet, dan bereikt het event de dienst niet; loopt hij op zonder dat je een melding
  // krijgt, dan blokkeert Android de weergave.
  const extra = alertCount ? ` · ${alertCount} melding${alertCount === 1 ? '' : 'en'}` : '';
  setStatus(`Verbonden — laatste contact ${hhmm(now)}${extra}${lastAlertNote}`);
}

// Hartslag: tast elke 30s de verbinding af. Een socket die op een telefoon stilletjes is gestorven
// meldt dat vaak niet vanzelf; een mislukte send levert wel meteen een close/foutmelding op.
function startHeartbeat() {
  if (heartbeat || stopped) return;
  heartbeat = setInterval(() => {
    if (stopped) return;
    if (!ws || ws.readyState !== 1) { scheduleReconnect(); return; }
    try { ws.send('{"t":"ping"}'); markAlive(); } catch { scheduleReconnect(); }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}

function scheduleReconnect() {
  if (stopped) return;
  stopHeartbeat();
  try { ws && ws.close(); } catch {}
  ws = null;
  setStatus('Verbinding verbroken — opnieuw proberen…');
  setTimeout(connect, backoff);
  backoff = Math.min(Math.round(backoff * 1.6), 30000);
}

async function connect() {
  if (stopped) return;
  const cookie = await cookieHeader();
  if (!cookie) {
    setStatus('Nog niet ingelogd — open Jarvis en log in.');
    setTimeout(connect, 5000);
    return;
  }
  setStatus('Verbinden met Jarvis…');
  try {
    ws = new WebSocket(WS_URL, [], { headers: { Cookie: cookie, Origin: SERVER } });
  } catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 2000; markAlive(true); startHeartbeat(); };
  ws.onmessage = (e) => {
    markAlive();
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    const r = reasonFor(ev);
    if (!r) return;
    // Zelfde throttle als de server: hooguit één melding per sessie+type per minuut, zodat een
    // reeks weigeringen of een snel herhaald event niet je scherm volgooit.
    const key = `${ev.sid}:${ev.t}:${ev.kind || ''}`;
    const now = Date.now();
    if (now - (lastAlert.get(key) || 0) < THROTTLE_MS) return;
    lastAlert.set(key, now);
    alertCount += 1;
    markAlive(true);
    // Een mislukte melding (geblokkeerd kanaal, ontbrekend icoon) verdween vroeger geruisloos in een
    // lege catch. Nu schrijven we de reden in de blijvende statusmelding, want die is altijd zichtbaar.
    showAlert(r, ev.sid).catch((err) => {
      setStatus(`Melding kon niet getoond worden: ${(err && err.message) || err}`);
    });
  };
  ws.onerror = () => {};
  ws.onclose = () => scheduleReconnect();
}

// Runner die de foreground-service levend houdt (nooit resolven). Guard tegen dubbel starten.
export function foregroundServiceRunner() {
  return new Promise(() => {
    if (runnerStarted) return;
    runnerStarted = true;
    stopped = false;
    // Zodra de app weer op de voorgrond komt is het proces sowieso wakker: meteen controleren of de
    // verbinding nog leeft in plaats van op de volgende hartslag wachten.
    if (!appStateSub) {
      appStateSub = AppState.addEventListener('change', (s) => {
        if (s !== 'active' || stopped) return;
        if (!ws || ws.readyState !== 1) { backoff = 2000; scheduleReconnect(); }
      });
    }
    connect();
  });
}

export async function startNotifyService() {
  // Het oude kanaal kan door de gebruiker geblokkeerd zijn; dat is niet meer te herstellen, dus
  // ruimen we het op zodat het niet als dode regel in de Android-instellingen blijft staan.
  try { await notifee.deleteChannel('jarvis-alerts'); } catch { /* bestond niet */ }
  await notifee.createChannel({ id: ALERT_CHANNEL, name: 'Jarvis-meldingen', importance: AndroidImportance.HIGH, vibration: true });
  await notifee.createChannel({ id: SERVICE_CHANNEL, name: 'Jarvis achtergrond', importance: AndroidImportance.LOW });
  await setStatus('Verbinden met Jarvis…'); // start de foreground-service -> runner draait de WS-loop
}

export async function stopNotifyService() {
  stopped = true;
  stopHeartbeat();
  if (appStateSub) { try { appStateSub.remove(); } catch {} appStateSub = null; }
  try { ws && ws.close(); } catch {}
  try { await notifee.stopForegroundService(); } catch {}
}
