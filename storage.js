export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  lovableEnabled: true,
  chatgptEnabled: true,
});

export async function getConfig() {
  const stored = await (globalThis.LovaBurstStorage || chrome.storage.local).get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config ?? {}) };
}

export async function setConfig(nextConfig) {
  const config = { ...DEFAULT_CONFIG, ...nextConfig };
  await (globalThis.LovaBurstStorage || chrome.storage.local).set({ config });
  return config;
}
