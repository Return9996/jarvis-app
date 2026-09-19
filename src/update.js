// Zelf-update via GitHub Releases (geen Play Store). Vergelijkt de app-versionCode met de laatste
// release-tag (v<code>); bij een nieuwere versie downloaden we de APK en starten we de installer.
// Checkt bij ELKE keer dat de app op de voorgrond komt (niet alleen bij een verse start), met een
// browser-fallback als de in-app installer hapert. Vereist REQUEST_INSTALL_PACKAGES + "onbekende apps".
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { Alert, Platform, Linking, AppState } from 'react-native';
import { GH_OWNER, GH_REPO } from './config';

let lastCheck = 0;
let prompting = false;

export async function checkForUpdate(manual = false) {
  if (Platform.OS !== 'android') return;
  const now = Date.now();
  if (!manual && now - lastCheck < 4 * 60 * 1000) return; // automatisch: hooguit elke 4 min
  lastCheck = now;
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) { if (manual) Alert.alert('Update-check', `Kon niet controleren (HTTP ${res.status}).`); return; }
    const rel = await res.json();
    const latest = parseInt(String(rel.tag_name || '').replace(/[^0-9]/g, ''), 10);
    const current = parseInt(Application.nativeBuildVersion || '0', 10);
    if (!latest || latest <= current) { if (manual) Alert.alert('Up-to-date', `Je hebt de nieuwste versie (v${current}).`); return; }
    const asset = (rel.assets || []).find((a) => a.name && a.name.endsWith('.apk'));
    const dl = asset ? asset.browser_download_url : `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`;
    if (prompting) return;
    prompting = true;
    Alert.alert(
      'Update beschikbaar',
      `Er is een nieuwere Jarvis-app (v${latest}, jij hebt v${current}).`,
      [
        { text: 'Later', style: 'cancel', onPress: () => { prompting = false; } },
        { text: 'In browser', onPress: () => { prompting = false; Linking.openURL(dl).catch(() => {}); } },
        { text: 'Installeren', onPress: () => { prompting = false; downloadAndInstall(dl, latest); } },
      ],
    );
  } catch { if (manual) Alert.alert('Update-check', 'Geen verbinding met GitHub.'); }
}

async function downloadAndInstall(url, version) {
  try {
    const target = FileSystem.cacheDirectory + `jarvis-v${version}.apk`;
    const { uri } = await FileSystem.downloadAsync(url, target);
    const contentUri = await FileSystem.getContentUriAsync(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch {
    // In-app installer lukte niet -> open de download in de browser.
    Alert.alert('Installeren via browser', 'De in-app installatie lukte niet; ik open de download in je browser.', [
      { text: 'OK', onPress: () => Linking.openURL(url).catch(() => {}) },
    ]);
  }
}

// Checkt nu + telkens als de app naar de voorgrond komt. Retourneert een opruim-functie.
export function startUpdateWatcher() {
  checkForUpdate(false);
  const sub = AppState.addEventListener('change', (state) => { if (state === 'active') checkForUpdate(false); });
  return () => { try { sub.remove(); } catch {} };
}
