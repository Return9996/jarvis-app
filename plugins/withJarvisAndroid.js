// Expo config-plugin: voegt de Android-permissies toe die de wrapper nodig heeft en zet het verplichte
// foregroundServiceType (Android 14+) op de Notifee-service. Draait tijdens `expo prebuild`.
const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

module.exports = function withJarvisAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // tools-namespace zodat we notifee's service-attribuut mogen overschrijven.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    // Permissies (idempotent).
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((u) => u.$ && u.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }

    // Notifee-foreground-service een geldig type geven (dataSync = achtergrond-synchronisatie).
    const app = manifest.application && manifest.application[0];
    if (app) {
      app.service = app.service || [];
      const NAME = 'app.notifee.core.ForegroundService';
      let svc = app.service.find((s) => s.$ && s.$['android:name'] === NAME);
      if (!svc) { svc = { $: { 'android:name': NAME } }; app.service.push(svc); }
      svc.$['android:foregroundServiceType'] = 'dataSync';
      svc.$['tools:replace'] = 'android:foregroundServiceType';
    }

    return cfg;
  });
};
