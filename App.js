// Jarvis native wrapper: laadt de bestaande PWA in een full-screen WebView. De achtergrond-service
// (meldingen) en de zelf-update-check starten bij het opstarten.
import React, { useRef, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View, Platform, StatusBar, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { SERVER } from './src/config';
import { startNotifyService } from './src/notify';
import { checkForUpdate } from './src/update';

const BG = '#0a0f14';

export default function App() {
  const webRef = useRef(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    startNotifyService().catch(() => {});
    checkForUpdate().catch(() => {});
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && webRef.current) { webRef.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
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
          onHttpError={() => {}}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          pullToRefreshEnabled
          originWhitelist={['https://*', 'http://*']}
          setSupportMultipleWindows={false}
          style={styles.web}
          renderLoading={() => (
            <View style={styles.center}><ActivityIndicator size="large" color="#22d3ee" /></View>
          )}
          startInLoadingState
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  web: { flex: 1, backgroundColor: BG },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  msg: { color: '#d7e3ee', textAlign: 'center', fontSize: 16, marginBottom: 18 },
  btn: { backgroundColor: '#0e7490', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#eafcff', fontWeight: '600' },
});
