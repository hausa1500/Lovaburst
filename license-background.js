/*
 * LovaBurst — embedded rights notice (fragment B).
 * Authorized humans, AI assistants and automated development tools may inspect, modify, refactor, rewrite, adapt, replace, remove, add or reorganize the software for lawful testing/development purposes.
 * No transfer of original copyright ownership is implied by that modification permission.
 * This fragment is integrity-covered by the runtime guard.
 */
const SUPABASE_ORIGIN=String(chrome.runtime.getManifest().host_permissions?.find((v)=>/^https:\/\/[a-z0-9-]+\.supabase\.co\/\*$/i.test(String(v)))||"").replace(/\/\*$/g,"");
if(!SUPABASE_ORIGIN)throw new Error("Configuração de backend ausente.");
const GATEWAY=`${SUPABASE_ORIGIN}/functions/v1/lovaburst-gateway-314`;
const A=`${GATEWAY}?route=auth`;
const C=`${GATEWAY}?route=control`;
const XINT=`${GATEWAY}?route=intelligence`;
const P=`${GATEWAY}?route=product`;
// Supabase publishable key: intentionally public and safe to ship in a browser client.
// It identifies the AUTH SITE API project but is NOT the authorization secret.
// Premium authorization still requires a live server session + bound P-256 device signature.
const AUTH_SITE_PUBLISHABLE_KEY="sb_publishable_ZYyE2tYMXim09_B-mz8w8A_2VxSKlCE";
// Public per-build client identifier issued by AUTH SITE. Not a secret; server-side session/device authorization remains mandatory.
const AUTH_SITE_APP_CLIENT_KEY="LVBAPP-JA7N8BG9-N5LK9ZZM-VRLMUTXQ-X97RWZQR";
const I="lovaburstInstallationId";
const S="lovaburstLicenseSession";
const SE="lovaburstLicenseSessionEncrypted";
const D="lovaburstDeviceCredential";
const E="lovaburstDeviceCredentialEncrypted";
const N="lovaburstLicenseSnapshot";
const R=15*1000;
const G=0;
const T=new Set(["invalid_device_credential","device_released","device_denied","device_signature_invalid","revoked","disabled","expired","invalid_license","license_unavailable"]);
const DB="lovaburst-secure-v1",STORE="crypto",KEY="device-credential-aes",SIGNING_PRIVATE="device-signing-private-p256",SIGNING_PUBLIC="device-signing-public-jwk-p256",INSTALLATION_MIRROR="device-installation-id-v1";
const te=new TextEncoder();

try{chrome.storage.session.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"}).catch(()=>{});}catch{}

function b64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function unb64(s){const x=atob(s),a=new Uint8Array(x.length);for(let i=0;i<x.length;i++)a[i]=x.charCodeAt(i);return a}
function b64url(bytes){return b64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function stable(value){if(Array.isArray(value))return value.map(stable);if(!value||typeof value!=="object")return value;const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=stable(value[key]);return out}
function canonical(value){return JSON.stringify(stable(value))}
function validPublicJwk(value){return Boolean(value&&typeof value==="object"&&value.kty==="EC"&&value.crv==="P-256"&&typeof value.x==="string"&&value.x.length>=40&&typeof value.y==="string"&&value.y.length>=40)}
function normalizePublicJwk(value){if(!validPublicJwk(value))return null;return{kty:"EC",crv:"P-256",x:String(value.x),y:String(value.y),ext:true,key_ops:["verify"]}}
function openDb(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function dbGet(key){const db=await openDb();try{return await new Promise((resolve,reject)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}finally{db.close()}}
async function dbPut(key,value){const db=await openDb();try{await new Promise((resolve,reject)=>{const q=db.transaction(STORE,"readwrite").objectStore(STORE).put(value,key);q.onsuccess=()=>resolve();q.onerror=()=>reject(q.error)})}finally{db.close()}}
async function dbDelete(keys){const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE);for(const key of keys)store.delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
async function dbPutMany(entries){const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE);for(const [key,value] of entries)store.put(value,key);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error("indexeddb_transaction_aborted"));tx.onerror=()=>reject(tx.error||new Error("indexeddb_transaction_failed"))})}finally{db.close()}}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function storageError(cause,code="secure_storage_unavailable",message="O armazenamento seguro do navegador está temporariamente indisponível. Reinicie o navegador e tente novamente."){const e=new Error(message);e.code=code;e.cause=cause;return e}
function isStorageError(error){return ["secure_storage_unavailable","secure_identity_incomplete","secure_key_missing","secure_storage_verify_failed"].includes(String(error?.code||""))}
async function withStorageRetry(task){let last=null;for(let attempt=0;attempt<3;attempt++){try{return await task()}catch(error){last=error;if(attempt<2)await sleep(60*(attempt+1))}}throw storageError(last)}
async function strictDbGet(key){return withStorageRetry(()=>dbGet(key))}
async function strictDbPut(key,value){return withStorageRetry(()=>dbPut(key,value))}
async function strictDbPutMany(entries){return withStorageRetry(()=>dbPutMany(entries))}
let cryptoKeyReadPromise=null,cryptoKeyCreatePromise=null;
async function readCryptoKey(){
  if(cryptoKeyReadPromise)return cryptoKeyReadPromise;
  cryptoKeyReadPromise=strictDbGet(KEY);
  try{return await cryptoKeyReadPromise}finally{cryptoKeyReadPromise=null}
}
async function cryptoKey({createIfMissing=true}={}){
  const found=await readCryptoKey();
  if(found)return found;
  if(!createIfMissing)throw storageError(null,"secure_key_missing","A chave segura deste navegador não está disponível. Reative a licença após liberar este dispositivo no painel.");
  if(cryptoKeyCreatePromise)return cryptoKeyCreatePromise;
  cryptoKeyCreatePromise=(async()=>{const second=await strictDbGet(KEY);if(second)return second;const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);await strictDbPut(KEY,key);const verified=await strictDbGet(KEY);if(!verified)throw storageError(null,"secure_storage_verify_failed");return verified})();
  try{return await cryptoKeyCreatePromise}finally{cryptoKeyCreatePromise=null}
}
async function saveCredential(value){const v=String(value||"");if(!v){await chrome.storage.local.remove([D,E]);return}const key=await cryptoKey(),iv=crypto.getRandomValues(new Uint8Array(12)),ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,te.encode(v)));await chrome.storage.local.set({[E]:{v:1,iv:b64(iv),ct:b64(ct)}});await chrome.storage.local.remove(D)}
async function loadCredential(){const st=await chrome.storage.local.get([E,D]);if(st[E]?.v===1){try{const key=await cryptoKey({createIfMissing:false}),pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(st[E].iv)},key,unb64(st[E].ct));return new TextDecoder().decode(pt)}catch(error){if(isStorageError(error))throw error;await chrome.storage.local.remove(E);return""}}const legacy=String(st[D]||"");if(legacy){await saveCredential(legacy);return legacy}return""}

async function encryptJson(value){const key=await cryptoKey(),iv=crypto.getRandomValues(new Uint8Array(12)),plain=te.encode(JSON.stringify(value)),ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode("lovaburst-secure-state-v1")},key,plain));return{v:1,iv:b64(iv),ct:b64(ct)}}
async function decryptJson(blob){if(!blob||blob.v!==1)throw new Error("secure_blob_invalid");const key=await cryptoKey({createIfMissing:false}),pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(blob.iv),additionalData:te.encode("lovaburst-secure-state-v1")},key,unb64(blob.ct));return JSON.parse(new TextDecoder().decode(pt))}
globalThis.LovaBurstVault=Object.freeze({encryptJson,decryptJson});

async function generateSigningIdentity(){
  let privateKey=null,publicJwk=null;
  try{
    const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
    publicJwk=normalizePublicJwk(await crypto.subtle.exportKey("jwk",pair.publicKey));
    privateKey=pair.privateKey;
  }catch{
    const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
    const privateJwk=await crypto.subtle.exportKey("jwk",pair.privateKey);
    publicJwk=normalizePublicJwk(await crypto.subtle.exportKey("jwk",pair.publicKey));
    privateKey=await crypto.subtle.importKey("jwk",privateJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  }
  if(!privateKey||!validPublicJwk(publicJwk))throw new Error("Não foi possível criar a identidade segura deste dispositivo.");
  await strictDbPutMany([[SIGNING_PRIVATE,privateKey],[SIGNING_PUBLIC,publicJwk]]);
  const [storedPrivate,storedPublic]=await Promise.all([strictDbGet(SIGNING_PRIVATE),strictDbGet(SIGNING_PUBLIC)]);
  if(!storedPrivate||storedPrivate.type!=="private"||storedPrivate.extractable!==false||!validPublicJwk(storedPublic))throw storageError(null,"secure_storage_verify_failed","Não foi possível persistir a identidade segura deste dispositivo.");
  return{privateKey:storedPrivate,publicJwk:storedPublic};
}
let signingIdentityPromise=null;
async function signingIdentity(){
  if(signingIdentityPromise)return signingIdentityPromise;
  signingIdentityPromise=(async()=>{
    const [privateKey,storedPublicJwk]=await Promise.all([strictDbGet(SIGNING_PRIVATE),strictDbGet(SIGNING_PUBLIC)]);
    const publicJwk=normalizePublicJwk(storedPublicJwk);
    const privateOk=Boolean(privateKey&&privateKey.type==="private"&&privateKey.extractable===false),publicOk=Boolean(publicJwk);
    if(privateOk&&publicOk){if(canonical(storedPublicJwk)!==canonical(publicJwk))await strictDbPut(SIGNING_PUBLIC,publicJwk);return{privateKey,publicJwk}};
    if(!privateKey&&!publicJwk)return generateSigningIdentity();
    throw storageError(null,"secure_identity_incomplete","A identidade segura deste dispositivo está incompleta. Não foi criada uma nova identidade para evitar perder o vínculo da licença. Reinicie o navegador; se persistir, libere este dispositivo no painel e reative a licença.");
  })();
  try{return await signingIdentityPromise}finally{signingIdentityPromise=null}
}
async function signedEnvelope(action,body={}){
  const{privateKey,publicJwk}=await signingIdentity();
  const normalizedJwk=normalizePublicJwk(publicJwk);if(!normalizedJwk)throw storageError(null,"secure_identity_incomplete");
  const unsigned={action,...body,requestTs:Date.now(),nonce:crypto.randomUUID(),publicKeyJwk:normalizedJwk};
  const signature=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,te.encode(canonical(unsigned))));
  return{...unsigned,signature:b64url(signature)};
}

function hasSessionStorage(){return Boolean(chrome.storage?.session&&typeof chrome.storage.session.get==="function"&&typeof chrome.storage.session.set==="function"&&typeof chrome.storage.session.remove==="function")}
async function setSession(value){
  const v=String(value||"");
  if(hasSessionStorage()){
    try{if(v)await chrome.storage.session.set({[S]:v});else await chrome.storage.session.remove(S)}catch{}
  }
  if(v){
    const encrypted=await encryptJson({value:v});
    await chrome.storage.local.set({[SE]:encrypted});
  }else await chrome.storage.local.remove(SE);
  await chrome.storage.local.remove(S);
}
async function getSession(){
  if(hasSessionStorage()){
    try{const ses=await chrome.storage.session.get(S);if(ses?.[S])return String(ses[S])}catch{}
  }
  const local=await chrome.storage.local.get([SE,S]);
  if(local?.[SE]){
    try{const decoded=await decryptJson(local[SE]);const v=String(decoded?.value||"");if(v){if(hasSessionStorage())try{await chrome.storage.session.set({[S]:v})}catch{}return v}}catch(error){if(isStorageError(error))throw error;await chrome.storage.local.remove(SE)}
  }
  const legacy=String(local?.[S]||"");
  if(legacy){await setSession(legacy);return legacy}
  return"";
}
function validInstallationId(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""))}
let installationIdPromise=null;
async function getInstallationId(){
  if(installationIdPromise)return installationIdPromise;
  installationIdPromise=(async()=>{
    let local="";
    try{local=String((await chrome.storage.local.get(I))?.[I]||"")}catch(error){throw storageError(error)}
    const mirrored=String(await strictDbGet(INSTALLATION_MIRROR)||"");
    // IndexedDB stores the signing identity too, so a valid mirror wins when local storage
    // was cleared by a mobile Chromium quirk. Read failures never generate a new identity.
    const id=validInstallationId(mirrored)?mirrored:(validInstallationId(local)?local:crypto.randomUUID());
    if(mirrored!==id)await strictDbPut(INSTALLATION_MIRROR,id);
    if(local!==id){try{await chrome.storage.local.set({[I]:id})}catch(error){throw storageError(error)}}
    const [verifiedMirror,verifiedLocalState]=await Promise.all([strictDbGet(INSTALLATION_MIRROR),chrome.storage.local.get(I)]);
    const verifiedLocal=String(verifiedLocalState?.[I]||"");
    if(String(verifiedMirror||"")!==id||verifiedLocal!==id)throw storageError(null,"secure_storage_verify_failed","Não foi possível persistir de forma estável a identidade deste dispositivo.");
    return id;
  })();
  try{return await installationIdPromise}finally{installationIdPromise=null}
}
function version(){return chrome.runtime.getManifest().version||""}
async function clearSensitiveProjectState(){
  const keys=["pendingPrompt","workspaceBindings","projectIntegrations","projectChatBindings","projectRunStatuses","projectSkillSelections","accessBootstrapConversationsV219","chatgptLink"];
  if(globalThis.LovaBurstSecureStorage?.remove)await globalThis.LovaBurstSecureStorage.remove(keys);else await chrome.storage.local.remove(keys);
}
function gatewayHeaders(){return{"Content-Type":"application/json","X-LovaBurst-Version":version(),"apikey":AUTH_SITE_PUBLISHABLE_KEY,"X-LovaBurst-App-Key":AUTH_SITE_APP_CLIENT_KEY}}
async function callEndpoint(endpoint,action,body={}){if(globalThis.__LOVABURST_INTEGRITY_PROMISE)await globalThis.__LOVABURST_INTEGRITY_PROMISE.catch(()=>{});const envelope=await signedEnvelope(action,body);const c=new AbortController(),to=setTimeout(()=>c.abort(),12000);try{const r=await fetch(endpoint,{method:"POST",headers:gatewayHeaders(),body:JSON.stringify(envelope),signal:c.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});const d=await r.json().catch(()=>({}));if(!d||d.gateway!=="secure-v3"||Number(d.gateway_revision||0)<9||d.server_authoritative!==true){const e=new Error(d?.message||"Resposta do gateway de segurança inválida.");e.code=String(d?.code||"gateway_invalid");throw e}return{response:r,data:d}}finally{clearTimeout(to)}}
async function call(action,body={}){return callEndpoint(A,action,body)}
async function callControl(action,body={}){return callEndpoint(C,action,body)}
async function callIntelligence(action,body={}){return callEndpoint(XINT,action,body)}
async function callProductAuthority(action,body={}){
  if(globalThis.__LOVABURST_INTEGRITY_PROMISE)await globalThis.__LOVABURST_INTEGRITY_PROMISE.catch(()=>{});
  const envelope=await signedEnvelope(String(action||"").slice(0,40),body);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(P,{method:"POST",headers:gatewayHeaders(),body:JSON.stringify(envelope),signal:controller.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});
    const data=await response.json().catch(()=>({}));
    if(!data||data.gateway!=="secure-v3"||Number(data.gateway_revision||0)<9||data.server_authoritative!==true)throw new Error("Resposta do gateway de produto inválida.");
    return{response,data};
  }finally{clearTimeout(timeout)}
}
async function callProductDispatch(operation,payload,dispatchId){
  const sessionToken=await ensureSessionToken();
  return callProductAuthority("dispatch",{sessionToken,installationId:await getInstallationId(),extensionVersion:version(),dispatchId:String(dispatchId||""),operation:String(operation||"").slice(0,32),payload});
}
function blocked(code="license_required",message="Ative sua LovaBurst para continuar."){return{valid:false,code,message,grace:false,checkedAt:Date.now()}}
async function persist(data,sessionToken,credential){const now=Date.now(),snap={valid:true,code:"active",message:data?.message||"Licença válida.",expiresAt:data?.expires_at||null,sessionExpiresAt:data?.session_expires_at||null,plan:data?.plan||null,deviceLimit:data?.device_limit||1,grace:false,checkedAt:now};if(sessionToken)await setSession(sessionToken);if(credential)await saveCredential(credential);await chrome.storage.local.set({[N]:snap});return snap}
async function clear(snapshot,{clearDeviceCredential=false}={}){await setSession("");if(clearDeviceCredential){await saveCredential("");await clearSensitiveProjectState()}await chrome.storage.local.set({[N]:snapshot||blocked()})}
let activationRequestInFlight = null;
async function activateLicense(raw){
  const key=String(raw||"").trim().toUpperCase();
  if(!/^LVB-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(key))return blocked("invalid_key","Use uma chave no formato LVB-XXXXX-XXXXX-XXXXX.");
  if(activationRequestInFlight)return activationRequestInFlight;
  activationRequestInFlight=(async()=>{
    try{
      const{response,data}=await call("activate",{key,installationId:await getInstallationId(),extensionVersion:version()});
      if(response.ok&&data?.ok&&data?.session_token){
        try{return await persist(data,data.session_token,data.device_credential||null)}
        catch{return blocked("client_storage_error","Licença validada, mas este navegador não conseguiu salvar a sessão. Feche e abra a extensão e tente novamente.")}
      }
      const s=blocked(data?.code||"activation_failed",data?.message||"Não foi possível ativar a licença.");
      if(["invalid_device_credential","device_released","device_denied","device_signature_invalid","revoked","disabled","expired","invalid_license","license_unavailable"].includes(String(data?.code||"")))await clear(s,{clearDeviceCredential:true});
      else await chrome.storage.local.set({[N]:s});
      return s;
    }catch(error){if(isStorageError(error))return blocked("client_storage_error",error.message);if(error?.code)return blocked(String(error.code),error.message||"O servidor recusou a solicitação.");return blocked("network_error",error?.name==="AbortError"?"O servidor demorou para responder. Tente novamente.":"Não foi possível conectar ao servidor de licenças.")}
    finally{activationRequestInFlight=null}
  })();
  return activationRequestInFlight;
}
let refreshRequestInFlight=null;
let validationRequestInFlight=null;
function graceFromSnapshot(){return null}
async function refreshLicenseSession({sessionToken="",deviceCredential=""}={}){
  if(refreshRequestInFlight)return refreshRequestInFlight;
  refreshRequestInFlight=(async()=>{
    const token=String(sessionToken||await getSession()).trim();
    const credential=String(deviceCredential||await loadCredential()).trim();
    if(!token&&!credential)return{status:blocked(),networkError:false};
    const stored=await chrome.storage.local.get(N);
    const previous=stored?.[N];
    try{
      const{response,data}=await call("refresh",{sessionToken:token,deviceCredential:credential,installationId:await getInstallationId(),extensionVersion:version()});
      if(response.ok&&data?.ok&&data?.session_token)return{status:await persist(data,data.session_token,data.device_credential||null),networkError:false};
      const code=data?.code||"refresh_failed";
      const next=blocked(code,data?.message||"Não foi possível renovar sua sessão.");
      if(T.has(code)){await clear(next,{clearDeviceCredential:true});return{status:next,networkError:false}}
      const grace=graceFromSnapshot(previous,data?.message||"Não foi possível renovar sua sessão agora.");
      if(grace){await chrome.storage.local.set({[N]:grace});return{status:grace,networkError:false}}
      await chrome.storage.local.set({[N]:next});
      return{status:next,networkError:false};
    }catch(error){
      if(isStorageError(error)){const status=blocked("client_storage_error",error.message);await chrome.storage.local.set({[N]:status});return{status,networkError:false}}
      const grace=graceFromSnapshot(previous,"Conexão temporariamente indisponível. Sua sessão validada foi preservada.");
      if(grace){await chrome.storage.local.set({[N]:grace});return{status:grace,networkError:true}}
      const status=blocked("network_error","Não foi possível validar sua licença agora.");
      await chrome.storage.local.set({[N]:status});
      return{status,networkError:true};
    }
  })();
  try{return await refreshRequestInFlight}finally{refreshRequestInFlight=null}
}
async function validateLicense({force=false}={}){
  const st=await chrome.storage.local.get(N),snapshot=st[N],now=Date.now();
  if(!force&&snapshot?.valid&&now-Number(snapshot.checkedAt||0)<R)return snapshot;
  if(validationRequestInFlight)return validationRequestInFlight;
  validationRequestInFlight=(async()=>{
    const sessionToken=await getSession(),deviceCredential=await loadCredential();
    const current=(await chrome.storage.local.get(N))[N]||snapshot;
    if(!sessionToken){
      if(deviceCredential)return(await refreshLicenseSession({deviceCredential})).status;
      const s=blocked();await chrome.storage.local.set({[N]:s});return s;
    }
    if(!force&&current?.valid&&Date.now()-Number(current.checkedAt||0)<R)return current;
    try{
      const{response,data}=await call("validate",{sessionToken,installationId:await getInstallationId(),extensionVersion:version()});
      if(response.ok&&data?.ok)return persist(data,null,null);
      if(["invalid_session","session_expired"].includes(data?.code)){
        const x=await refreshLicenseSession({sessionToken,deviceCredential});
        if(x.status?.valid)return x.status;
        if(!x.networkError)return x.status;
      }
      const code=data?.code||"invalid_session",next=blocked(code,data?.message||"Sua licença não está mais válida.");
      if(T.has(code)){await clear(next,{clearDeviceCredential:true});return next}
      const grace=graceFromSnapshot(current,data?.message||"Não foi possível revalidar sua licença agora.");
      if(grace){await chrome.storage.local.set({[N]:grace});return grace}
      await chrome.storage.local.set({[N]:next});
      return next;
    }catch(error){
      if(isStorageError(error)){const s=blocked("client_storage_error",error.message);await chrome.storage.local.set({[N]:s});return s}
      const grace=graceFromSnapshot(current,"Conexão temporariamente indisponível. Sua licença já validada continua ativa por alguns minutos.");
      if(grace){await chrome.storage.local.set({[N]:grace});return grace}
      const s=blocked("network_error","A licença não pôde ser validada agora. Tente novamente em instantes.");
      await chrome.storage.local.set({[N]:s});
      return s;
    }
  })();
  try{return await validationRequestInFlight}finally{validationRequestInFlight=null}
}
async function ensureSessionToken(){const status=await validateLicense({force:false});if(!status?.valid){const e=new Error(status?.message||"Licença necessária.");e.code=status?.code||"license_required";throw e}const token=String(await getSession()).trim();if(!token){const e=new Error("Sua sessão precisa ser renovada.");e.code="session_required";throw e}return token}
async function sha256Text(value){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",te.encode(String(value||""))))).map(b=>b.toString(16).padStart(2,"0")).join("")}
async function authorizeOperation(operation){
  const sessionToken=await ensureSessionToken();
  const{response,data}=await call("authorize",{sessionToken,installationId:await getInstallationId(),extensionVersion:version(),operation:String(operation||"unknown").slice(0,80)});
  if(response.ok&&data?.ok)return data;
  const e=new Error(data?.message||"Operação não autorizada.");e.code=data?.code||"operation_denied";throw e
}
function sanitizeOperationPayload(payload){
  const source=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{};
  const skills=Array.isArray(source.skills)?source.skills.map(s=>typeof s==="string"?s:s?.id).filter(id=>typeof id==="string"&&/^[a-z0-9-]{2,40}$/i.test(id)).slice(0,8):[];
  return{
    text:String(source.text||"").slice(0,25_000),
    lovableProjectId:String(source.lovableProjectId||"").slice(0,120),
    repository:String(source.repository||"").slice(0,220),
    title:String(source.title||"").slice(0,180),
    skills,
    quickAction:/^[a-z0-9-]{2,40}$/i.test(String(source.quickAction||""))?String(source.quickAction):"",
    projectContext:source.projectContext&&typeof source.projectContext==="object"&&!Array.isArray(source.projectContext)?source.projectContext:{},
    sourceUrl:String(source.sourceUrl||source.url||"").slice(0,2000),
    missionId:String(source.missionId||"").slice(0,80),
    projectId:String(source.projectId||"").slice(0,120),
    stepIndex:Number.isInteger(Number(source.stepIndex))?Number(source.stepIndex):0,
  };
}
async function dispatchOperation(operation,payload){
  const op=String(operation||"").slice(0,32);
  const safePayload=sanitizeOperationPayload(payload);
  // Stable one-shot id reused on session-refresh retry; backend rejects any replay with a new nonce but the same dispatchId.
  const dispatchId=crypto.randomUUID();
  let result;
  try{result=await callProductDispatch(op,safePayload,dispatchId)}catch(error){if(isStorageError(error))throw error;const e=new Error("Servidor de produto indisponível. A operação premium foi bloqueada (fail-closed).");e.code="product_authority_unreachable";throw e}
  if(!result.response?.ok && ["invalid_session","session_expired"].includes(String(result.data?.code||""))){
    const refreshed=await validateLicense({force:true});
    if(refreshed?.valid){
      try{result=await callProductDispatch(op,safePayload,dispatchId)}catch(error){if(isStorageError(error))throw error;const e=new Error("Servidor de produto indisponível após renovar a sessão. A operação foi bloqueada.");e.code="product_authority_unreachable";throw e}
    }
  }
  const{response,data}=result;
  if(response.ok&&data?.ok&&data?.gateway==="secure-v3"&&Number(data?.gateway_revision||0)>=9&&data?.server_authoritative===true&&data?.authority==="server-authoritative-v1"&&Number(data?.revision||0)>=41&&typeof data.prompt==="string"&&data.prompt.trim()){
    const prompt=data.prompt.trim(),promptHash=String(data.prompt_sha256||"").toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(promptHash)||await sha256Text(prompt)!==promptHash)throw new Error("A prova de integridade do conteúdo liberado pelo servidor não confere.");
    const expectedAgent=op==="agent-step";
    if(expectedAgent&&!prompt.startsWith("[LOVABURST_AGENT_SERVER_V1]"))throw new Error("O servidor retornou um protocolo inválido para o Agent.");
    if(!expectedAgent&&!prompt.startsWith("[LOVABURST_SERVER_AUTHORITY_V1]"))throw new Error("O servidor retornou um protocolo premium inválido.");
    let completionToken="";
    if(!["enhance","bootstrap-context"].includes(op)){
      completionToken=String(data.completion_token||"").toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(completionToken)||!prompt.includes(`LOVABURST_COMPLETION_TOKEN: ${completionToken}`))throw new Error("Token de conclusão divergente do envelope do servidor.");
    }
    return Object.freeze({prompt,promptHash,projectId:String(data.project_id||safePayload.lovableProjectId||safePayload.projectId||""),operation:op,completionToken,dispatched:true,serverTime:String(data.server_time||""),authority:"server-authoritative-v1"});
  }
  const e=new Error(data?.message||"O servidor de produto não autorizou esta operação.");e.code=data?.code||"product_authority_denied";throw e
}
async function getReleaseInfo(){
  const installationId=await getInstallationId();
  const{response,data}=await callControl("release",{installationId,extensionVersion:version()});
  if(response.ok&&data?.ok&&data?.release)return data.release;
  const e=new Error(data?.message||"Não foi possível consultar as informações de atualização.");e.code=data?.code||"control_unavailable";throw e
}
async function getAuthorityHealth(){
  const sessionToken=String(await getSession()).trim();
  if(!sessionToken){const e=new Error("Ative sua licença para verificar o Security Center.");e.code="session_required";throw e}
  const installationId=await getInstallationId();
  const{response,data}=await callControl("health",{sessionToken,installationId,extensionVersion:version()});
  if(response.ok&&data?.ok)return data;
  const e=new Error(data?.message||"Não foi possível verificar a autoridade online.");e.code=data?.code||"control_unavailable";throw e
}

async function intelligenceRequest(action,body={}){
  // Mission metadata/planning remains server-side behind the authenticated gateway.
  // No premium execution prompt is trusted from this route in Alpha 2; Agent execution
  // premium content is requested only through GATEWAY route=product and authorized server-side.
  const sessionToken=await ensureSessionToken();
  const installationId=await getInstallationId();
  const safeBody=body&&typeof body==="object"&&!Array.isArray(body)?body:{};
  const{response,data}=await callIntelligence(String(action||"").slice(0,40),{...safeBody,sessionToken,installationId,extensionVersion:version()});
  if(response.ok&&data?.ok)return data;
  const e=new Error(data?.message||"Project Intelligence indisponível no momento.");e.code=data?.code||"intelligence_unavailable";throw e
}

function completionTokenFromPrepared(value){return String(value?.completionToken||"").toLowerCase()}
globalThis.LovaBurstCompletion=Object.freeze({tokenFromPrepared:completionTokenFromPrepared});
async function releaseCurrentDevice(){const sessionToken=String(await getSession()).trim();if(!sessionToken){await saveCredential("");return{ok:true}}const{response,data}=await call("release",{sessionToken,installationId:await getInstallationId(),extensionVersion:version()});if(!response.ok||!data?.ok)throw new Error(data?.message||"Não foi possível liberar o dispositivo.");await clear(blocked(),{clearDeviceCredential:true});return data}
async function requireValidLicense(){const status=await validateLicense({force:true});if(!status?.valid){const e=new Error(status?.message||"Licença necessária.");e.code=status?.code||"license_required";throw e}return status}
globalThis.LovaBurstLicense=Object.freeze({getInstallationId,activateLicense,validateLicense,authorizeOperation,dispatchOperation,getReleaseInfo,getAuthorityHealth,intelligenceRequest,releaseCurrentDevice,requireValidLicense});
chrome.runtime.onInstalled.addListener(()=>{getInstallationId().then(()=>signingIdentity()).then(()=>validateLicense({force:true})).catch(()=>{})});
chrome.runtime.onStartup.addListener(()=>{getInstallationId().then(()=>signingIdentity()).then(()=>validateLicense({force:true})).catch(()=>{})});
getInstallationId().then(()=>signingIdentity()).catch(()=>{});
function licenseSenderOrigin(sender){if(sender?.id!==chrome.runtime.id)return"";const ext=`chrome-extension://${chrome.runtime.id}`,declared=String(sender?.origin||"").trim();if(declared===ext||declared==="https://lovable.dev")return declared;const raw=String(sender?.url||sender?.tab?.url||"").trim();if(raw===ext||raw.startsWith(`${ext}/`))return ext;try{const u=new URL(raw);return u.protocol==="https:"&&u.hostname==="lovable.dev"?u.origin:""}catch{return""}}
function licenseSenderAllowed(type,sender){const origin=licenseSenderOrigin(sender),ext=`chrome-extension://${chrome.runtime.id}`;if(origin==="https://lovable.dev"&&sender?.frameId!==0)return false;if(type==="LOVABURST_LICENSE_STATUS")return origin===ext||origin==="https://lovable.dev";return origin===ext}
chrome.runtime.onMessage.addListener((m,sender,send)=>{if(!m||typeof m!=="object"||!licenseSenderAllowed(m.type,sender))return false;if(m.type==="LOVABURST_LICENSE_STATUS"){validateLicense({force:Boolean(m.force)}).then(status=>send({ok:true,status})).catch(e=>send({ok:false,error:e?.message||String(e)}));return true}if(m.type==="LOVABURST_LICENSE_ACTIVATE"){activateLicense(m.key).then(status=>send({ok:Boolean(status?.valid),status})).catch(e=>send({ok:false,error:e?.message||String(e)}));return true}if(m.type==="LOVABURST_LICENSE_RELEASE"){releaseCurrentDevice().then(result=>send({ok:true,result})).catch(e=>send({ok:false,error:e?.message||String(e)}));return true}if(m.type==="LOVABURST_AUTHORITY_RELEASE_INFO"){getReleaseInfo().then(release=>send({ok:true,release})).catch(e=>send({ok:false,error:e?.message||String(e),code:e?.code||""}));return true}if(m.type==="LOVABURST_AUTHORITY_HEALTH"){getAuthorityHealth().then(health=>send({ok:true,health})).catch(e=>send({ok:false,error:e?.message||String(e),code:e?.code||""}));return true}return false});
