// Utilidades compartidas.

export function fmt(n) {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n));
  return sign + "$" + v.toLocaleString("es-AR");
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Lee un archivo de imagen y lo devuelve como data URL, que es lo que espera
// la API del comprobante. El límite evita subir archivos enormes.
export function readImageAsDataUrl(file, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("no hay archivo"));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error("la imagen es demasiado grande (máximo 4 MB)"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("no se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
