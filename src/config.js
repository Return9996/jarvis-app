// Centrale configuratie voor de Jarvis-wrapper-app.
export const SERVER = 'https://jarvis.bytehost.nl';
// Achtergrond-verbinding voor meldingen (zelfde /ws als de PWA; auth via de jarvis_device-cookie).
export const WS_URL = 'wss://jarvis.bytehost.nl/ws';
export const COOKIE_NAME = 'jarvis_device';
// Zelf-update via GitHub Releases. Repo is publiek zodat de APK zonder token te downloaden is;
// de Jarvis-server zelf blijft privé achter device-auth + Cloudflare-tunnel.
export const GH_OWNER = 'Return9996';
export const GH_REPO = 'jarvis-app';
