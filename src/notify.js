// Achtergrond-meldingen zonder Firebase: een Notifee-foreground-service houdt een WebSocket naar de
// Jarvis-server open. De blijvende "Jarvis luistert mee"-melding toont LIVE de verbindingsstatus, zodat
// zichtbaar is of de app echt meeluistert. Bij needhuman/blocked/auth-fout komt er een aparte melding.
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import CookieManager from '@react-native-cookies/cookies';
import { SERVER, WS_URL, COOKIE_NAME } from './config';

const FGS_ID = 'jarvis-fgs';
let ws = null;
let stopped = false;
let backoff = 2000;
let runnerStarted = false;

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
        channelId: 'jarvis-service',
        asForegroundService: true,
        ongoing: true,
        importance: AndroidImportance.LOW,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'open', launchActivity: 'default' },
      },
    });
  } catch { /* stil */ }
}

// Alleen echte blokkades verdienen een melding — spiegelt lib/push.js op de server.
function reasonFor(ev) {
  if (!ev || !ev.sid) return null;
  if (ev.t === 'needhuman') return { title: '🙋 Jarvis heeft je nodig', body: ev.text || 'Jarvis kan niet verder zonder jou.' };
  if (ev.t === 'blocked') return { title: '⛔ Jarvis werd geblokkeerd', body: `Geen toestemming voor: ${ev.text || 'een actie'}` };
  if (ev.t === 'error') {
    return ev.kind === 'auth'
      ? { title: '🔑 Jarvis-token verlopen', body: 'Herregistreer het Claude-token in de app.' }
      : { title: '⚠️ Jarvis stopte met een fout', body: String(ev.message || 'Onbekende fout').slice(0, 160) };
  }
  return null;
}

async function showAlert(reason, sid) {
  await notifee.displayNotification({
    title: reason.title,
    body: reason.body,
    data: { url: sid ? `/?sid=${sid}` : '/' },
    android: {
      channelId: 'jarvis-alerts',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'open', launchActivity: 'default' },
      vibrationPattern: [200, 150, 200],
    },
  });
}

// Losse testmelding (via de alerts-kanaal) om te bevestigen dat meldingen aankomen.
export async function testNotification() {
  await showAlert({ title: '🔔 Testmelding', body: 'Meldingen werken op dit toestel. Je krijgt zo ook echte Jarvis-waarschuwingen.' }, null);
}

function scheduleReconnect() {
  if (stopped) return;
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
  ws.onopen = () => { backoff = 2000; setStatus('Verbonden — je krijgt een seintje als Jarvis vastloopt.'); };
  ws.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    const r = reasonFor(ev);
    if (r) showAlert(r, ev.sid).catch(() => {});
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
    connect();
  });
}

export async function startNotifyService() {
  await notifee.createChannel({ id: 'jarvis-alerts', name: 'Jarvis-meldingen', importance: AndroidImportance.HIGH, vibration: true });
  await notifee.createChannel({ id: 'jarvis-service', name: 'Jarvis achtergrond', importance: AndroidImportance.LOW });
  await setStatus('Verbinden met Jarvis…'); // start de foreground-service -> runner draait de WS-loop
}

export async function stopNotifyService() {
  stopped = true;
  try { ws && ws.close(); } catch {}
  try { await notifee.stopForegroundService(); } catch {}
}
