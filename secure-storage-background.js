/* LovaBurst project-state storage compatibility layer.
 * Operational UI/project state is intentionally kept in chrome.storage.local so native
 * storage.onChanged notifications continue to work across popup/content/background.
 * License/session/device secrets remain protected by license-background.js (session storage,
 * non-exportable P-256 private key, AES-GCM device credential in IndexedDB-backed vault).
 */
const __lovaburstStorageReady = (async () => {
  const LEGACY_SECURE_KEYS = [
    "projectChatBindings",
    "projectRunStatuses",
    "pendingPrompt",
    "workspaceBindings",
    "projectIntegrations",
    "accessBootstrapConversationsV219",
    "chatgptLink",
  ];
  const PREFIX = "__lovaburstSecureV1__";
  const local = chrome.storage.local;
  const rawGet = local.get.bind(local);
  const rawSet = local.set.bind(local);
  const rawRemove = local.remove.bind(local);

  // Migrate state written by 2.2.6–2.2.9 back to ordinary extension-local storage.
  // Only the decrypted value is retained; the old ciphertext/marker is removed.
  for (const key of LEGACY_SECURE_KEYS) {
    const physical = `${PREFIX}${key}`;
    const stored = await rawGet([key, physical]);
    const blob = stored[physical];
    if (blob) {
      try {
        const value = await globalThis.LovaBurstVault.decryptJson(blob);
        await rawSet({ [key]: value });
        await rawRemove(physical);
        continue;
      } catch {
        // If legacy encrypted state is corrupt, drop the marker instead of poisoning startup.
        await rawRemove([physical, key]);
        continue;
      }
    }
    if (stored[key]?.__lovaburstEncrypted === true) await rawRemove(key);
  }

  const storage = Object.freeze({
    get: (keys) => rawGet(keys),
    set: (values) => rawSet(values),
    remove: (keys) => rawRemove(keys),
    clear: () => local.clear(),
    sensitiveKeys: new Set(),
  });
  globalThis.LovaBurstSecureStorage = storage;
  globalThis.LovaBurstStorage = storage;
  return storage;
})();

globalThis.__LOVABURST_SECURE_STORAGE_READY__ = __lovaburstStorageReady;
if (!globalThis.LovaBurstStorage) {
  globalThis.LovaBurstStorage = Object.freeze({
    get: (...args) => __lovaburstStorageReady.then((s) => s.get(...args)),
    set: (...args) => __lovaburstStorageReady.then((s) => s.set(...args)),
    remove: (...args) => __lovaburstStorageReady.then((s) => s.remove(...args)),
    clear: (...args) => __lovaburstStorageReady.then((s) => s.clear(...args)),
  });
}
