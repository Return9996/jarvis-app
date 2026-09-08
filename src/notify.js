// Achtergrond-meldingen zonder Firebase: een Notifee-foreground-service houdt een WebSocket naar de
// Jarvis-server open. Zodra Claude vastloopt (needhuman/blocked/auth-fout) komt er een native melding —
// ook als de app op de achtergrond staat. Auth gebeurt met de jarvis_device-cookie die de WebView
// na inloggen in de systeem-CookieManager zet.
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import CookieManager from '@react-native-cookies/cookies';
import { SERVER, WS_URL, COOKIE_NAME } from './config';

let ws = null;
let stopped = false;
let backoff = 2000;

async function cookieHeader() {
  try {
    const cookies = await CookieManager.get(SERVER);
    const c = cookies && cookies[COOKIE_NAME];
    return c && c.value ? `${COOKIE_NAME}=${c.value}` : null;
  } catch { return null; }
}

// Welke server-events verdienen een melding? Alleen echte blokkades — spiegelt lib/push.js op de server.
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

function scheduleReconnect() {
  if (stopped) return;
  try { ws && ws.close(); } catch {}
  ws = null;
  setTimeout(connect, backoff);
  backoff = Math.min(Math.round(backoff * 1.6), 30000);
}

async function connect() {
  if (stopped) return;
  const cookie = await cookieHeader();
  if (!cookie) { setTimeout(connect, 5000); return; } // nog niet ingelogd in de WebView
  try {
    ws = new WebSocket(WS_URL, [], { headers: { Cookie: cookie, Origin: SERVER } });
  } catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 2000; };
  ws.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    const r = reasonFor(ev);
    if (r) showAlert(r, ev.sid).catch(() => {});
  };
  ws.onerror = () => {};
  ws.onclose = () => scheduleReconnect();
}

// De runner die de foreground-service levend houdt (nooit resolven = service blijft draaien).
export function foregroundServiceRunner() {
  return new Promise(() => { stopped = false; connect(); });
}

export async function startNotifyService() {
  await notifee.requestPermission();
  await notifee.createChannel({ id: 'jarvis-alerts', name: 'Jarvis-meldingen', importance: AndroidImportance.HIGH, vibration: true });
  await notifee.createChannel({ id: 'jarvis-service', name: 'Jarvis achtergrond', importance: AndroidImportance.LOW });
  await notifee.displayNotification({
    title: 'Jarvis luistert mee',
    body: 'Je krijgt een seintje zodra Jarvis vastloopt.',
    android: {
      channelId: 'jarvis-service',
      asForegroundService: true,
      ongoing: true,
      importance: AndroidImportance.LOW,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'open', launchActivity: 'default' },
    },
  });
}

export async function stopNotifyService() {
  stopped = true;
  try { ws && ws.close(); } catch {}
  try { await notifee.stopForegroundService(); } catch {}
}
