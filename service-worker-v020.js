/*
 * LovaBurst 3.0.14 — Chrome MV3 compatible service-worker bootstrap.
 * IMPORTANT: use static module imports only in extension service workers.
 * Keep these as static imports.
 */
import "./startup-shell.js";
import "./integrity-guard.js";
import "../shared/tab-safety.js";
import "./license-operation-gate.js";
import "./license-background.js";
import "./prompt-execution-policy.js";
import "./secure-storage-background.js";
import "./chatgpt-visibility.js";
import "./update-refresh.js";
import "./project-chat-lock-background.js";
import "./intelligence-background.js";
import "./service-worker.js";
import "./composer-background.js";
import "./result-refresh-background-v0304.js";
import "./attachment-background.js";
