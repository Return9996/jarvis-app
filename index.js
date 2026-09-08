import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import App from './App';
import { foregroundServiceRunner } from './src/notify';

// De foreground-service-runner moet op module-niveau geregistreerd zijn, vóór de service wordt gestart.
notifee.registerForegroundService(foregroundServiceRunner);
// Tik op een melding terwijl de app op de achtergrond/afgesloten is: opent gewoon de app.
notifee.onBackgroundEvent(async () => {});

registerRootComponent(App);
