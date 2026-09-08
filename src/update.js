// Zelf-update via GitHub Releases (geen Play Store). We vergelijken de app-versionCode met de laatste
// release-tag (v<code>), en bij een nieuwere versie downloaden we de bijgevoegde APK en starten we de
// Android-installer. Vereist de REQUEST_INSTALL_PACKAGES-permissie + "onbekende apps installeren" aan.
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { Alert, Platform } from 'react-native';
import { GH_OWNER, GH_REPO } from './config';

export async function checkForUpdate() {
  if (Platform.OS !== 'android') return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const rel = await res.json();
    const latest = parseInt(String(rel.tag_name || '').replace(/[^0-9]/g, ''), 10);
    const current = parseInt(Application.nativeBuildVersion || '0', 10);
    if (!latest || latest <= current) return;
    const asset = (rel.assets || []).find((a) => a.name && a.name.endsWith('.apk'));
    if (!asset) return;
    Alert.alert(
      'Update beschikbaar',
      `Er is een nieuwere Jarvis-app (v${latest}, jij hebt v${current}). Nu downloaden en installeren?`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Installeren', onPress: () => downloadAndInstall(asset.browser_download_url, latest) },
      ],
    );
  } catch { /* stil — geen internet of geen release */ }
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
  } catch (e) {
    Alert.alert('Update mislukt', String((e && e.message) || e));
  }
}
