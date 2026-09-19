// Controleert + vraagt de Android-rechten die de app nodig heeft voor betrouwbare meldingen.
// Prompt alleen als er echt iets ontbreekt. Retourneert of meldingen zijn toegestaan.
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Alert, Platform } from 'react-native';
import { getFlags, setFlag } from './flags';

export async function ensurePermissions() {
  if (Platform.OS !== 'android') return true;

  // 1. Meldingsrecht (Android 13+). requestPermission toont het systeemdialoog als er nog niet is beslist.
  const settings = await notifee.requestPermission();
  const granted = settings.authorizationStatus === AuthorizationStatus.AUTHORIZED
    || settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
  if (!granted) {
    Alert.alert(
      'Meldingen staan uit',
      'Zonder meldingsrecht kan Jarvis je niet waarschuwen als hij vastloopt. Zet meldingen aan bij "Jarvis" in de instellingen.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open instellingen', onPress: () => notifee.openNotificationSettings().catch(() => {}) },
      ],
    );
    return false;
  }

  // 2. Batterij-optimalisatie kan de achtergrond-verbinding doden -> eenmalig vragen om uitzondering.
  try {
    const optimized = await notifee.isBatteryOptimizationEnabled();
    const flags = await getFlags();
    if (optimized && !flags.batteryAsked) {
      await setFlag('batteryAsked', true);
      Alert.alert(
        'Batterij-optimalisatie uitzetten',
        'Voor betrouwbare meldingen (ook als de app dicht is) moet Jarvis uitgezonderd worden van de batterij-optimalisatie. Kies bij "Jarvis" voor "Niet optimaliseren" / "Onbeperkt".',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Instellen', onPress: () => notifee.openBatteryOptimizationSettings().catch(() => {}) },
        ],
      );
    }
  } catch { /* niet alle toestellen ondersteunen dit */ }

  return true;
}
