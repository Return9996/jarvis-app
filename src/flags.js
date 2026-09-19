// Piepkleine persistente vlaggen (eenmalige prompts/tests) in een JSON-bestandje.
import * as FileSystem from 'expo-file-system/legacy';

const FILE = FileSystem.documentDirectory + 'jarvis-flags.json';

export async function getFlags() {
  try { return JSON.parse(await FileSystem.readAsStringAsync(FILE)); } catch { return {}; }
}
export async function setFlag(key, val) {
  const f = await getFlags();
  f[key] = val;
  try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(f)); } catch { /* stil */ }
}
