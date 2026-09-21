// Jarvis native wrapper: laadt de PWA in een full-screen WebView, met correcte safe-area-insets
// (edge-to-edge op Android 15+), de achtergrond-meldingsservice en de zelf-update-check.
import React, { useRef, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View, Platform, StatusBar, ActivityIndicator, Text, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { SERVER } from './src/config';
import { startNotifyService, testNotification } from './src/notify';
import { startUpdateWatcher } from './src/update';
import { ensurePermissions } from './src/permissions';
import { getFlags, setFlag } from './src/flags';

const BG = '#0a0f14';

// Vergrendelt de viewport in de WebView: geen pinch-/dubbeltik-zoom en geen overscroll, zodat de
// header en het schrijfvak niet kunnen verschuiven. Draait vóór en na het laden van de pagina.
const LOCK_JS = `
(function(){
  try {
    var apply = function(){
      var m = document.querySelector('meta[name=viewport]');
      if(!m){ m = document.createElement('meta'); m.setAttribute('name','viewport'); (document.head||document.documentElement).appendChild(m); }
      m.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover');
      var de = document.documentElement; if(de){ de.style.overscrollBehavior='none'; de.style.touchAction='pan-x pan-y'; }
      if(document.body){ document.body.style.overscrollBehavior='none'; }
    };
    apply();
    document.addEventListener('DOMContentLoaded', apply);
    document.addEventListener('gesturestart', function(e){ e.preventDefault(); }, { passive:false });
  } catch(e){}
})(); true;
`;

function JarvisApp() {
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cleanupUpdate = () => {};
    (async () => {
      const ok = await ensurePermissions();
      await startNotifyService().catch(() => {});
      if (ok) {
        const flags = await getFlags();
        if (!flags.welcomed) { await setFlag('welcomed', true); testNotification().catch(() => {}); }
      }
      cleanupUpdate = startUpdateWatcher(); // checkt nu + bij elke keer dat de app op de voorgrond komt
    })();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && webRef.current) { webRef.current.goBack(); return true; }
      return false;
    });
    return () => { sub.remove(); cleanupUpdate(); };
  }, []);

  // Dark inset-vlakken (status-/navigatiebalk) zodat de PWA-menubalk niet meer wegvalt.
  const pad = { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right };

  return (
    <View style={[styles.root, pad]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.msg}>Kon Jarvis niet laden.{'\n'}Controleer je internetverbinding.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => { setFailed(false); webRef.current && webRef.current.reload(); }}>
            <Text style={styles.btnText}>Opnieuw proberen</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: SERVER }}
          onNavigationStateChange={(s) => { canGoBack.current = s.canGoBack; }}
          onError={() => setFailed(true)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          pullToRefreshEnabled={false}
          overScrollMode="never"
          bounces={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          injectedJavaScriptBeforeContentLoaded={LOCK_JS}
          injectedJavaScript={LOCK_JS}
          originWhitelist={['https://*', 'http://*']}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => {
            // Een WebView kan downloads niet zelf afhandelen -> naar de browser sturen,
            // die het bestand netjes in Downloads zet.
            if (req.url && req.url.indexOf('download=1') !== -1) {
              Linking.openURL(req.url).catch(() => {});
              return false;
            }
            return true;
          }}
          style={styles.web}
          renderLoading={() => (<View style={styles.center}><ActivityIndicator size="large" color="#22d3ee" /></View>)}
          startInLoadingState
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <JarvisApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  msg: { color: '#d7e3ee', textAlign: 'center', fontSize: 16, marginBottom: 18 },
  btn: { backgroundColor: '#0e7490', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#eafcff', fontWeight: '600' },
});
