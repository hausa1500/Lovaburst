(() => {
  const DB = "lovaburst-secure-v1";
  const STORE = "crypto";
  const KEY = "device-credential-aes";
  const SIGNING_PRIVATE = "device-signing-private-p256";
  const SIGNING_PUBLIC = "device-signing-public-jwk-p256";
  const INSTALLATION_MIRROR = "device-installation-id-v1";
  const INSTALLATION_KEY = "lovaburstInstallationId";
  const SESSION_KEY = "lovaburstLicenseSession";
  const SESSION_ENCRYPTED_KEY = "lovaburstLicenseSessionEncrypted";
  const DEVICE_KEY = "lovaburstDeviceCredential";
  const DEVICE_ENCRYPTED_KEY = "lovaburstDeviceCredentialEncrypted";
  const SNAPSHOT_KEY = "lovaburstLicenseSnapshot";
  const te = new TextEncoder();
  const AUTH_SITE_PUBLISHABLE_KEY = "sb_publishable_ZYyE2tYMXim09_B-mz8w8A_2VxSKlCE";
  const AUTH_SITE_APP_CLIENT_KEY = "LVBAPP-JA7N8BG9-N5LK9ZZM-VRLMUTXQ-X97RWZQR";

  function version() { return chrome.runtime.getManifest().version || ""; }
  function backendOrigin() {
    return String(chrome.runtime.getManifest().host_permissions?.find((v) => /^https:\/\/[a-z0-9-]+\.supabase\.co\/\*$/i.test(String(v))) || "").replace(/\/\*$/g, "");
  }
  function gateway() { const origin=backendOrigin(); return origin ? `${origin}/functions/v1/lovaburst-gateway-314?route=auth` : ""; }
  function b64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
  function unb64(s) { const x = atob(s), a = new Uint8Array(x.length); for (let i=0;i<x.length;i++) a[i]=x.charCodeAt(i); return a; }
  function b64url(bytes) { return b64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
  function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; const out={}; for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key]=stable(value[key]); return out; }
  function canonical(value) { return JSON.stringify(stable(value)); }
  function validPublicJwk(value) { return Boolean(value && typeof value === "object" && value.kty === "EC" && value.crv === "P-256" && typeof value.x === "string" && value.x.length >= 40 && typeof value.y === "string" && value.y.length >= 40); }
  function normalizePublicJwk(value) { if (!validPublicJwk(value)) return null; return {kty:"EC",crv:"P-256",x:String(value.x),y:String(value.y),ext:true,key_ops:["verify"]}; }
  function blocked(code,message) { return {valid:false,code:String(code||"license_required"),message:String(message||"Não foi possível validar a licença."),grace:false,checkedAt:Date.now()}; }
  function activeSnapshot(data) { return {valid:true,code:"active",message:data?.message||"Licença válida.",expiresAt:data?.expires_at||null,sessionExpiresAt:data?.session_expires_at||null,plan:data?.plan||null,deviceLimit:data?.device_limit||1,grace:false,checkedAt:Date.now()}; }

  function openDb() {
    return new Promise((resolve,reject) => {
      const q = indexedDB.open(DB,1);
      q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains(STORE)) q.result.createObjectStore(STORE); };
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  }
  async function dbGet(key) { const db=await openDb(); try { return await new Promise((resolve,reject)=>{ const q=db.transaction(STORE,"readonly").objectStore(STORE).get(key); q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error); }); } finally { db.close(); } }
  async function dbPut(key,value) { const db=await openDb(); try { await new Promise((resolve,reject)=>{ const q=db.transaction(STORE,"readwrite").objectStore(STORE).put(value,key); q.onsuccess=()=>resolve(); q.onerror=()=>reject(q.error); }); } finally { db.close(); } }
  async function dbPutMany(entries) { const db=await openDb(); try { await new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE); for (const [key,value] of entries) store.put(value,key); tx.oncomplete=()=>resolve(); tx.onabort=()=>reject(tx.error||new Error("indexeddb_transaction_aborted")); tx.onerror=()=>reject(tx.error||new Error("indexeddb_transaction_failed")); }); } finally { db.close(); } }
  function sleep(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }
  function storageError(cause,code="secure_storage_unavailable",message="O armazenamento seguro do navegador está temporariamente indisponível. Reinicie o navegador e tente novamente.") { const e=new Error(message); e.code=code; e.cause=cause; return e; }
  function isStorageError(error) { return ["secure_storage_unavailable","secure_identity_incomplete","secure_key_missing","secure_storage_verify_failed"].includes(String(error?.code||"")); }
  async function withStorageRetry(task) { let last=null; for (let attempt=0;attempt<3;attempt++) { try { return await task(); } catch (error) { last=error; if (attempt<2) await sleep(60*(attempt+1)); } } throw storageError(last); }
  async function strictDbGet(key) { return withStorageRetry(()=>dbGet(key)); }
  async function strictDbPut(key,value) { return withStorageRetry(()=>dbPut(key,value)); }
  async function strictDbPutMany(entries) { return withStorageRetry(()=>dbPutMany(entries)); }

  let cryptoKeyReadPromise=null,cryptoKeyCreatePromise=null;
  async function readCryptoKey() {
    if (cryptoKeyReadPromise) return cryptoKeyReadPromise;
    cryptoKeyReadPromise=strictDbGet(KEY);
    try { return await cryptoKeyReadPromise; } finally { cryptoKeyReadPromise=null; }
  }
  async function cryptoKey({createIfMissing=true}={}) {
    const found=await readCryptoKey();
    if (found) return found;
    if (!createIfMissing) throw storageError(null,"secure_key_missing","A chave segura deste navegador não está disponível. Reative a licença após liberar este dispositivo no painel.");
    if (cryptoKeyCreatePromise) return cryptoKeyCreatePromise;
    cryptoKeyCreatePromise=(async()=>{ const second=await strictDbGet(KEY); if (second) return second; const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]); await strictDbPut(KEY,key); const verified=await strictDbGet(KEY); if (!verified) throw storageError(null,"secure_storage_verify_failed"); return verified; })();
    try { return await cryptoKeyCreatePromise; } finally { cryptoKeyCreatePromise=null; }
  }
  async function encryptJson(value) {
    const key=await cryptoKey(), iv=crypto.getRandomValues(new Uint8Array(12)), plain=te.encode(JSON.stringify(value));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode("lovaburst-secure-state-v1")},key,plain));
    return {v:1,iv:b64(iv),ct:b64(ct)};
  }
  async function decryptJson(blob) {
    if (!blob || blob.v !== 1) throw new Error("secure_blob_invalid");
    const key=await cryptoKey({createIfMissing:false}), pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(blob.iv),additionalData:te.encode("lovaburst-secure-state-v1")},key,unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function saveCredential(value) {
    const v=String(value||"");
    if (!v) { await chrome.storage.local.remove([DEVICE_KEY,DEVICE_ENCRYPTED_KEY]); return; }
    const key=await cryptoKey(),iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,te.encode(v)));
    await chrome.storage.local.set({[DEVICE_ENCRYPTED_KEY]:{v:1,iv:b64(iv),ct:b64(ct)}});
    await chrome.storage.local.remove(DEVICE_KEY);
  }
  async function loadCredential() {
    const st=await chrome.storage.local.get([DEVICE_ENCRYPTED_KEY,DEVICE_KEY]);
    if (st[DEVICE_ENCRYPTED_KEY]?.v===1) {
      try {
        const key=await cryptoKey({createIfMissing:false});
        const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(st[DEVICE_ENCRYPTED_KEY].iv)},key,unb64(st[DEVICE_ENCRYPTED_KEY].ct));
        return new TextDecoder().decode(pt);
      } catch (error) { if (isStorageError(error)) throw error; await chrome.storage.local.remove(DEVICE_ENCRYPTED_KEY); }
    }
    const legacy=String(st[DEVICE_KEY]||"");
    if (legacy) { await saveCredential(legacy); return legacy; }
    return "";
  }
  function hasSessionStorage() { return Boolean(chrome.storage?.session?.get && chrome.storage?.session?.set && chrome.storage?.session?.remove); }
  async function setSession(value) {
    const v=String(value||"");
    if (hasSessionStorage()) {
      try { if (v) await chrome.storage.session.set({[SESSION_KEY]:v}); else await chrome.storage.session.remove(SESSION_KEY); } catch {}
    }
    if (v) await chrome.storage.local.set({[SESSION_ENCRYPTED_KEY]:await encryptJson({value:v})});
    else await chrome.storage.local.remove(SESSION_ENCRYPTED_KEY);
    await chrome.storage.local.remove(SESSION_KEY);
  }
  async function getSession() {
    if (hasSessionStorage()) {
      try { const x=await chrome.storage.session.get(SESSION_KEY); if (x?.[SESSION_KEY]) return String(x[SESSION_KEY]); } catch {}
    }
    const st=await chrome.storage.local.get([SESSION_ENCRYPTED_KEY,SESSION_KEY]);
    if (st[SESSION_ENCRYPTED_KEY]) {
      try {
        const decoded=await decryptJson(st[SESSION_ENCRYPTED_KEY]);
        const v=String(decoded?.value||"");
        if (v) { if (hasSessionStorage()) try { await chrome.storage.session.set({[SESSION_KEY]:v}); } catch {} return v; }
      } catch (error) { if (isStorageError(error)) throw error; await chrome.storage.local.remove(SESSION_ENCRYPTED_KEY); }
    }
    const legacy=String(st[SESSION_KEY]||"");
    if (legacy) { await setSession(legacy); return legacy; }
    return "";
  }
  function validInstallationId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||"")); }
  let installationIdPromise=null;
  async function getInstallationId() {
    if (installationIdPromise) return installationIdPromise;
    installationIdPromise=(async()=>{
      let local="";
      try { local=String((await chrome.storage.local.get(INSTALLATION_KEY))?.[INSTALLATION_KEY]||""); } catch (error) { throw storageError(error); }
      const mirrored=String(await strictDbGet(INSTALLATION_MIRROR)||"");
      const id=validInstallationId(mirrored)?mirrored:(validInstallationId(local)?local:crypto.randomUUID());
      if (mirrored!==id) await strictDbPut(INSTALLATION_MIRROR,id);
      if (local!==id) { try { await chrome.storage.local.set({[INSTALLATION_KEY]:id}); } catch (error) { throw storageError(error); } }
      const [verifiedMirror,verifiedLocalState]=await Promise.all([strictDbGet(INSTALLATION_MIRROR),chrome.storage.local.get(INSTALLATION_KEY)]);
      const verifiedLocal=String(verifiedLocalState?.[INSTALLATION_KEY]||"");
      if (String(verifiedMirror||"")!==id || verifiedLocal!==id) throw storageError(null,"secure_storage_verify_failed","Não foi possível persistir de forma estável a identidade deste dispositivo.");
      return id;
    })();
    try { return await installationIdPromise; } finally { installationIdPromise=null; }
  }
  let signingIdentityPromise=null;
  async function signingIdentity() {
    if (signingIdentityPromise) return signingIdentityPromise;
    signingIdentityPromise=(async()=>{
      const [existingPrivate,existingPublicRaw]=await Promise.all([strictDbGet(SIGNING_PRIVATE),strictDbGet(SIGNING_PUBLIC)]);
      const existingPublic=normalizePublicJwk(existingPublicRaw);
      const privateOk=Boolean(existingPrivate?.type === "private" && existingPrivate.extractable === false),publicOk=Boolean(existingPublic);
      if (privateOk && publicOk) { if (canonical(existingPublicRaw)!==canonical(existingPublic)) await strictDbPut(SIGNING_PUBLIC,existingPublic); return {privateKey:existingPrivate,publicJwk:existingPublic}; }
      if (existingPrivate || existingPublic) throw storageError(null,"secure_identity_incomplete","A identidade segura deste dispositivo está incompleta. Não foi criada uma nova identidade para evitar perder o vínculo da licença. Reinicie o navegador; se persistir, libere este dispositivo no painel e reative a licença.");
      let pair;
      try { pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]); }
      catch { pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]); }
      let privateKey=pair.privateKey;
      const publicJwk=normalizePublicJwk(await crypto.subtle.exportKey("jwk",pair.publicKey));
      if (privateKey.extractable) {
        const privateJwk=await crypto.subtle.exportKey("jwk",privateKey);
        privateKey=await crypto.subtle.importKey("jwk",privateJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
      }
      await strictDbPutMany([[SIGNING_PRIVATE,privateKey],[SIGNING_PUBLIC,publicJwk]]);
      const [storedPrivate,storedPublic]=await Promise.all([strictDbGet(SIGNING_PRIVATE),strictDbGet(SIGNING_PUBLIC)]);
      if (!(storedPrivate?.type === "private" && storedPrivate.extractable === false && validPublicJwk(storedPublic))) throw storageError(null,"secure_storage_verify_failed","Não foi possível persistir a identidade segura deste dispositivo.");
      return {privateKey:storedPrivate,publicJwk:normalizePublicJwk(storedPublic)};
    })();
    try { return await signingIdentityPromise; } finally { signingIdentityPromise=null; }
  }
  async function signedEnvelope(action,body={}) {
    const {privateKey,publicJwk}=await signingIdentity();
    const normalizedJwk=normalizePublicJwk(publicJwk);if(!normalizedJwk)throw storageError(null,"secure_identity_incomplete");
    const unsigned={action,...body,requestTs:Date.now(),nonce:crypto.randomUUID(),publicKeyJwk:normalizedJwk};
    const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,te.encode(canonical(unsigned))));
    return {...unsigned,signature:b64url(signature)};
  }
  async function request(action,body={}) {
    const endpoint=gateway();
    if (!endpoint) return {ok:false,status:blocked("backend_missing","Configuração de backend ausente.")};
    const envelope=await signedEnvelope(action,body);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","X-LovaBurst-Version":version(),"apikey":AUTH_SITE_PUBLISHABLE_KEY,"X-LovaBurst-App-Key":AUTH_SITE_APP_CLIENT_KEY},body:JSON.stringify(envelope),cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if (!data || data.gateway !== "secure-v3" || Number(data.gateway_revision||0) < 9 || data.server_authoritative !== true) return {ok:false,response,data,status:blocked("gateway_invalid","Resposta do servidor de licenças inválida.")};
      return {ok:response.ok && Boolean(data.ok),response,data};
    } finally { clearTimeout(timer); }
  }
  async function persistActive(data) {
    const snap=activeSnapshot(data);
    if (data.session_token) await setSession(data.session_token);
    if (data.device_credential) await saveCredential(data.device_credential);
    await chrome.storage.local.set({[SNAPSHOT_KEY]:snap,lovaburstUniversalLicenseFallbackUsed:true});
    return snap;
  }
  let activationRequestInFlight=null;
  async function activate(rawKey) {
    const key=String(rawKey||"").trim().toUpperCase();
    if (!/^LVB-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/i.test(key)) return {ok:false,status:blocked("invalid_key","Use uma chave no formato LVB-XXXXX-XXXXX-XXXXX.")};
    if (activationRequestInFlight) return activationRequestInFlight;
    activationRequestInFlight=(async()=>{
      try {
        const installationId=await getInstallationId();
        const result=await request("activate",{key,installationId,extensionVersion:version()});
        if (result.status) return {ok:false,status:result.status};
        if (!result.ok || !result.data?.session_token) {
          const status=blocked(result.data?.code||"activation_failed",result.data?.message||"Não foi possível ativar a licença.");
          await chrome.storage.local.set({[SNAPSHOT_KEY]:status});
          return {ok:false,status};
        }
        return {ok:true,status:await persistActive(result.data),fallback:true};
      } catch (error) {
        if (isStorageError(error)) return {ok:false,status:blocked("client_storage_error",error.message)};
        return {ok:false,status:blocked("network_error",error instanceof Error && error.name === "AbortError" ? "O servidor demorou para responder. Tente novamente." : "Não foi possível conectar ao servidor de licenças.")};
      }
    })();
    try { return await activationRequestInFlight; } finally { activationRequestInFlight=null; }
  }
  async function refreshWithCredential() {
    const credential=await loadCredential();
    if (!credential) return {ok:false,status:blocked("license_required","Ative sua LovaBurst para continuar.")};
    const result=await request("refresh",{deviceCredential:credential,installationId:await getInstallationId(),extensionVersion:version()});
    if (result.status) return {ok:false,status:result.status};
    if (!result.ok || !result.data?.session_token) return {ok:false,status:blocked(result.data?.code||"refresh_failed",result.data?.message||"Não foi possível renovar a sessão.")};
    return {ok:true,status:await persistActive(result.data),fallback:true};
  }
  async function status() {
    try {
      const sessionToken=String(await getSession()).trim();
      if (!sessionToken) return refreshWithCredential();
      const result=await request("validate",{sessionToken,installationId:await getInstallationId(),extensionVersion:version()});
      if (result.status) return {ok:false,status:result.status};
      if (result.ok) {
        const snap=activeSnapshot(result.data);
        await chrome.storage.local.set({[SNAPSHOT_KEY]:snap,lovaburstUniversalLicenseFallbackUsed:true});
        return {ok:true,status:snap,fallback:true};
      }
      if (["invalid_session","device_denied","device_signature_invalid"].includes(String(result.data?.code||""))) return refreshWithCredential();
      const snap=blocked(result.data?.code||"license_unavailable",result.data?.message||"Licença indisponível.");
      await chrome.storage.local.set({[SNAPSHOT_KEY]:snap});
      return {ok:false,status:snap};
    } catch (error) {
      if (isStorageError(error)) return {ok:false,status:blocked("client_storage_error",error.message)};
      return {ok:false,status:blocked("network_error",error instanceof Error && error.name === "AbortError" ? "O servidor demorou para responder. Tente novamente." : "Não foi possível verificar sua licença.")};
    }
  }
  async function release() {
    try {
      const sessionToken=String(await getSession()).trim();
      if (!sessionToken) return {ok:true,result:{ok:true},fallback:true};
      const result=await request("release",{sessionToken,installationId:await getInstallationId(),extensionVersion:version()});
      if (result.status) return {ok:false,status:result.status,error:result.status.message};
      if (!result.ok) return {ok:false,status:blocked(result.data?.code||"release_failed",result.data?.message||"Não foi possível liberar o dispositivo."),error:result.data?.message||"Não foi possível liberar o dispositivo."};
      await setSession("");
      await saveCredential("");
      await chrome.storage.local.set({[SNAPSHOT_KEY]:blocked("license_required","Ative sua LovaBurst para continuar.")});
      return {ok:true,result:result.data,fallback:true};
    } catch (error) {
      if (isStorageError(error)) return {ok:false,status:blocked("client_storage_error",error.message),error:error.message};
      return {ok:false,status:blocked("network_error",error instanceof Error && error.name === "AbortError" ? "O servidor demorou para responder. Tente novamente." : "Não foi possível conectar ao servidor de licenças."),error:"Não foi possível conectar ao servidor de licenças."};
    }
  }

  const api=Object.freeze({activate,status,release});
  globalThis.LovaBurstUniversalLicenseFallback=api;
  globalThis.LovaBurstMobileLicenseFallback=api;
})();
