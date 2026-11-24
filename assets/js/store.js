/* ПОЛКА — shared helpers, local storage and formatting. */
(function () {
  const DB_NAME = 'polka-library';
  const DB_VERSION = 1;
  const STORE_NAME = 'items';
  let dbPromise = null;

  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB не поддерживается этим браузером.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Не удалось открыть локальное хранилище.')); };
    });
    return dbPromise;
  }

  function transaction(mode, callback) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;
        try { result = callback(store); } catch (error) { reject(error); return; }
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error || new Error('Ошибка локального хранилища.')); };
        tx.onabort = function () { reject(tx.error || new Error('Операция отменена.')); };
      });
    });
  }

  function getLocalItems() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = function () {
          const items = (request.result || []).sort(function (a, b) {
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
          });
          resolve(items);
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function putLocalItem(item) {
    return transaction('readwrite', function (store) { store.put(item); return item; });
  }

  function deleteLocalItem(id) {
    return transaction('readwrite', function (store) { store.delete(id); });
  }

  function getPublishedItems() {
    const source = window.POLKA_LIBRARY;
    if (!source) return [];
    const items = Array.isArray(source) ? source : (Array.isArray(source.items) ? source.items : []);
    return items.filter(function (item) { return item && item.title && item.fileName; }).map(function (item) {
      return Object.assign({
        description: '',
        category: 'Другое',
        tags: [],
        version: '1.0',
        createdAt: new Date().toISOString(),
        coverUrl: ''
      }, item, { source: 'published' });
    });
  }

  const CATEGORY_META = {
    'Дизайн': { color: '#FF6239', icon: 'palette' },
    'Документы': { color: '#DCE9FF', icon: 'doc' },
    'Код': { color: '#173B2B', icon: 'code' },
    'Маркетинг': { color: '#F2E56B', icon: 'megaphone' },
    'Шаблоны': { color: '#D7FF57', icon: 'layout' },
    'Фото': { color: '#FFB7A1', icon: 'image' },
    'Аудио': { color: '#C7B7FF', icon: 'play' },
    'Видео': { color: '#FFC7B8', icon: 'play' },
    'Другое': { color: '#E8E2D5', icon: 'file' }
  };

  const EXT_ICONS = {
    zip: 'package', rar: 'package', '7z': 'package', tar: 'package', gz: 'package',
    pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', rtf: 'doc', pages: 'doc',
    json: 'code', js: 'code', mjs: 'code', ts: 'code', html: 'code', css: 'code', py: 'code', fig: 'layers',
    jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
    xls: 'files', xlsx: 'files', csv: 'files', numbers: 'files',
    mp4: 'play', mov: 'play', webm: 'play', mp3: 'play', wav: 'play'
  };

  function categoryMeta(category) {
    return CATEGORY_META[category] || CATEGORY_META['Другое'];
  }

  function getExtension(fileName) {
    const name = String(fileName || '').trim();
    const clean = name.split('?')[0].split('#')[0];
    const index = clean.lastIndexOf('.');
    if (index < 1 || index === clean.length - 1) return 'FILE';
    return clean.slice(index + 1).toUpperCase().slice(0, 6);
  }

  function fileIcon(fileName) {
    const ext = getExtension(fileName).toLowerCase();
    return EXT_ICONS[ext] || 'file';
  }

  function formatBytes(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number) || number <= 0) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
    const value = number / Math.pow(1024, index);
    const digits = value >= 100 || index === 0 ? 0 : (value >= 10 ? 1 : 1);
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value) + ' ' + units[index];
  }

  function formatDate(value, short) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'long', year: 'numeric' }
    ).format(date).replace(' г.', '');
  }

  function formatRelativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now - date;
    const day = 86400000;
    if (diff < 0) return formatDate(date, true);
    if (diff < day && date.getDate() === now.getDate()) return 'сегодня';
    if (diff < day * 2) return 'вчера';
    if (diff < day * 7) return Math.floor(diff / day) + ' дн. назад';
    return formatDate(date, true);
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function makeFallbackCover(title, fileName, category) {
    const meta = categoryMeta(category);
    const ext = getExtension(fileName);
    const safeTitle = escapeXml(String(title || 'Файл').slice(0, 28));
    const dark = category === 'Код';
    const fg = dark ? '#D7FF57' : '#171914';
    const bg = meta.color;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">' +
      '<rect width="1200" height="900" fill="' + bg + '"/>' +
      '<g stroke="' + fg + '" stroke-opacity=".16" stroke-width="2"><path d="M80 0v900M240 0v900M400 0v900M560 0v900M720 0v900M880 0v900M1040 0v900"/><path d="M0 100h1200M0 260h1200M0 420h1200M0 580h1200M0 740h1200"/></g>' +
      '<circle cx="930" cy="258" r="190" fill="none" stroke="' + fg + '" stroke-width="4"/>' +
      '<path d="M930 68v380M740 258h380" stroke="' + fg + '" stroke-width="4"/>' +
      '<text x="72" y="125" fill="' + fg + '" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="7">ПОЛКА / FILE</text>' +
      '<text x="62" y="600" fill="' + fg + '" font-family="Arial, Helvetica, sans-serif" font-size="250" font-weight="900" letter-spacing="-14">' + escapeXml(ext) + '</text>' +
      '<path d="M72 660h620" stroke="' + fg + '" stroke-width="3"/>' +
      '<text x="72" y="735" fill="' + fg + '" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">' + safeTitle + '</text>' +
      '<text x="72" y="820" fill="' + fg + '" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="4">СКАЧИВАЙ · ИСПОЛЬЗУЙ · ДЕЛИСЬ</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function uniqueId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return (prefix || 'item') + '-' + window.crypto.randomUUID();
    }
    return (prefix || 'item') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function downloadURL(url, fileName) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'download';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Не удалось прочитать файл.')); };
      reader.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    if (!dataURL || !dataURL.startsWith('data:')) return null;
    const parts = dataURL.split(',');
    const meta = parts[0];
    const content = parts.slice(1).join(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    if (/;base64/i.test(meta)) {
      const binary = atob(content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(content)], { type: mime });
  }

  function titleFromFileName(fileName) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return '';
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function detectCategory(fileName, mime) {
    const ext = getExtension(fileName).toLowerCase();
    const type = String(mime || '');
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'heic'].includes(ext) || /^image\//.test(type)) return 'Фото';
    if (['mp4', 'mov', 'webm', 'avi'].includes(ext) || /^video\//.test(type)) return 'Видео';
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext) || /^audio\//.test(type)) return 'Аудио';
    if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'pages'].includes(ext)) return 'Документы';
    if (['json', 'js', 'mjs', 'ts', 'html', 'css', 'py', 'fig', 'sketch'].includes(ext)) return 'Код';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Шаблоны';
    return 'Другое';
  }

  function downloadItem(item) {
    if (!item || !item.fileUrl) return;
    downloadURL(item.fileUrl, item.fileName || 'file');
  }

  window.PolkaStore = {
    getLocalItems: getLocalItems,
    putLocalItem: putLocalItem,
    deleteLocalItem: deleteLocalItem,
    getPublishedItems: getPublishedItems
  };

  window.PolkaUtils = {
    categoryMeta: categoryMeta,
    getExtension: getExtension,
    fileIcon: fileIcon,
    formatBytes: formatBytes,
    formatDate: formatDate,
    formatRelativeDate: formatRelativeDate,
    escapeHTML: escapeHTML,
    makeFallbackCover: makeFallbackCover,
    uniqueId: uniqueId,
    downloadURL: downloadURL,
    downloadItem: downloadItem,
    blobToDataURL: blobToDataURL,
    dataURLToBlob: dataURLToBlob,
    titleFromFileName: titleFromFileName,
    detectCategory: detectCategory,
    CATEGORY_META: CATEGORY_META
  };
})();
