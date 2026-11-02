// Settings and work-session persistence in chrome.storage.local.
// API keys never leave this browser profile except in requests to their own provider.

export const DEFAULT_SETTINGS = {
  anthropicKey: '',
  model: 'claude-opus-5-5',
  effort: 'high',
  platform: 'google', // google | naver | both
  hashtagCount: 15,
  postLength: '공백 포함 약 1,800~3,000자',
  thumbnail: true,
  imageProvider: 'claude-svg', // claude-svg | openai | gemini
  openaiKey: '',
  openaiModel: 'gpt-image-1',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash-image',
  imagePreset: 'ask', // ask | infographic | photo | mixed
  bodyImageCount: 4,
};

const SETTINGS_KEY = 'settings';
const SESSION_KEY = 'session';

export async function loadSettings() {
  const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadSession() {
  const { [SESSION_KEY]: saved } = await chrome.storage.local.get(SESSION_KEY);
  return saved || null;
}

let pending = null;
let timer = null;
/** Debounced save so streaming updates don't hammer storage. */
export function saveSession(session, { immediate = false } = {}) {
  pending = session;
  clearTimeout(timer);
  const write = () => chrome.storage.local.set({ [SESSION_KEY]: pending }).catch((e) => console.warn('세션 저장 실패', e));
  if (immediate) return write();
  timer = setTimeout(write, 400);
  return Promise.resolve();
}

export async function clearSession() {
  clearTimeout(timer);
  pending = null;
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function takePendingInput() {
  const { pendingInput } = await chrome.storage.local.get('pendingInput');
  if (pendingInput) await chrome.storage.local.remove('pendingInput');
  return pendingInput || null;
}
