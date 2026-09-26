(() => {
  if (globalThis.__LOVABURST_ATTACHMENTS__) return;
  const MAX_FILES = 5;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  const BINARY_TYPES = new Map([
    ["png", new Set(["image/png"])],
    ["jpg", new Set(["image/jpeg"])],
    ["jpeg", new Set(["image/jpeg"])],
    ["webp", new Set(["image/webp"])],
    ["pdf", new Set(["application/pdf"])],
  ]);
  const TEXT_EXTENSIONS = new Set(["txt","md","csv","json","js","jsx","ts","tsx","css","py"]);
  const SAFE_TEXT_MIME = /^(?:text\/|application\/(?:json|javascript|x-javascript|xml)$)/i;

  const isImage = file => /^image\/(png|jpeg|webp)$/i.test(file?.type || "");
  const extension = name => String(name || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || "";
  function typeAllowed(file) {
    const ext = extension(file?.name);
    const type = String(file?.type || "").toLowerCase();
    if (BINARY_TYPES.has(ext)) return !type || BINARY_TYPES.get(ext).has(type);
    if (TEXT_EXTENSIONS.has(ext)) return !type || SAFE_TEXT_MIME.test(type);
    return false;
  }
  function validate(file, current=[]) {
    if (!(file instanceof File) && !(file instanceof Blob)) return "Arquivo inválido.";
    const name = String(file.name || "anexo");
    if (current.length >= MAX_FILES) return `Limite de ${MAX_FILES} anexos por envio.`;
    if (!file.size) return `${name} está vazio.`;
    if (file.size > MAX_FILE_BYTES) return `${name} excede o limite seguro de 8 MB por arquivo.`;
    const total = current.reduce((n,item)=>n+(item.file?.size||item.size||0),0) + file.size;
    if (total > MAX_TOTAL_BYTES) return "Os anexos excedem o limite seguro total de 20 MB.";
    if (!typeAllowed(file)) return `${name} usa um tipo de arquivo não permitido pela LovaBurst.`;
    return "";
  }
  function make(file) {
    return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, file, url: isImage(file) ? URL.createObjectURL(file) : "", name: file.name || `imagem-${Date.now()}.png`, type: file.type || "", size: file.size };
  }
  function release(item){ if(item?.url) URL.revokeObjectURL(item.url); }
  async function serialize(items) {
    if (!Array.isArray(items) || items.length > MAX_FILES) throw new Error("Quantidade de anexos inválida.");
    let total = 0;
    return Promise.all(items.map(async item => {
      const error = validate(item.file, []);
      if (error) throw new Error(error);
      total += Number(item.file.size || 0);
      if (total > MAX_TOTAL_BYTES) throw new Error("Os anexos excedem o limite seguro total de 20 MB.");
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      let binary = ""; const chunk=0x8000;
      for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
      return { name:item.name, type:item.type, size:item.size, base64:btoa(binary) };
    }));
  }
  function clipboardFiles(event) {
    const files=[];
    for (const item of Array.from(event.clipboardData?.items || [])) {
      if (item.kind !== "file") continue;
      const file=item.getAsFile(); if(file) files.push(file);
    }
    return files;
  }
  globalThis.__LOVABURST_ATTACHMENTS__={MAX_FILES,MAX_FILE_BYTES,MAX_TOTAL_BYTES,validate,make,release,serialize,clipboardFiles,isImage,typeAllowed};
})();
