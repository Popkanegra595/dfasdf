/* ПОЛКА — admin panel logic */
(function () {
  'use strict';

  const U = window.PolkaUtils;
  const Store = window.PolkaStore;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const MAX_COVER_SIZE = 12 * 1024 * 1024;

  const state = {
    published: [],
    local: [],
    editingId: null,
    file: null,
    fileName: '',
    fileSize: 0,
    fileType: '',
    cover: null,
    coverPreviewUrl: '',
    existingCoverUrl: '',
    coverRemoved: false,
    pendingDeleteId: null,
    localCoverURLs: new Map(),
    toastTimer: null
  };

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function icon(name) {
    return window.icon(name);
  }

  function plural(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
  }

  function revokeURL(url) {
    if (url && String(url).startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function parseTags(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[,;]/)
      .map(function (tag) { return tag.trim(); })
      .filter(function (tag) {
        if (!tag) return false;
        const key = tag.toLocaleLowerCase('ru-RU');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  function setStatus(message, isError) {
    const element = $('#form-status');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('is-error', !!isError);
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toast-text').textContent = message;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { toast.hidden = true; }, 3000);
  }

  function currentEditingItem() {
    if (!state.editingId) return null;
    return state.local.find(function (item) { return String(item.id) === String(state.editingId); }) || null;
  }

  function currentCategory() {
    const input = $('#category-input');
    return (input && input.value.trim()) || U.detectCategory(state.fileName, state.fileType) || 'Другое';
  }

  function currentTitle() {
    const input = $('#title-input');
    return input ? input.value.trim() : '';
  }

  function currentCoverForPreview() {
    if (state.coverPreviewUrl) return state.coverPreviewUrl;
    return U.makeFallbackCover(currentTitle() || 'Название файла', state.fileName || 'file', currentCategory());
  }

  /* ---------- Data ---------- */

  async function refreshLocal() {
    if (!Store) throw new Error('Локальное хранилище недоступно.');
    state.local = await Store.getLocalItems();
    state.localCoverURLs.forEach(function (url) { revokeURL(url); });
    state.localCoverURLs.clear();
  }

  function getLocalCover(item) {
    if (item.coverBlob) {
      if (!state.localCoverURLs.has(item.id)) {
        state.localCoverURLs.set(item.id, URL.createObjectURL(item.coverBlob));
      }
      return state.localCoverURLs.get(item.id);
    }
    return item.coverUrl || U.makeFallbackCover(item.title, item.fileName, item.category);
  }

  function dateValue(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function mergeItemsForExport() {
    const map = new Map();
    state.published.forEach(function (item) {
      map.set(String(item.id), Object.assign({}, item, { __origin: 'published' }));
    });
    state.local.forEach(function (item) {
      const id = String(item.id);
      const existing = map.get(id);
      const localUpdated = dateValue(item.updatedAt || item.createdAt);
      const publishedUpdated = existing ? dateValue(existing.updatedAt || existing.createdAt) : -1;
      if (!existing || localUpdated > publishedUpdated) {
        map.set(id, Object.assign({}, item, { __origin: 'local' }));
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return dateValue(b.createdAt) - dateValue(a.createdAt);
    });
  }

  function updateSummary() {
    const merged = mergeItemsForExport();
    const totalSize = merged.reduce(function (sum, item) { return sum + (Number(item.fileSize) || 0); }, 0);
    const publishedCount = $('#summary-published');
    const localCount = $('#summary-local');
    const size = $('#summary-size');
    if (publishedCount) publishedCount.textContent = state.published.length;
    if (localCount) localCount.textContent = state.local.length;
    if (size) size.textContent = U.formatBytes(totalSize);

    const localPill = $('#local-count');
    if (localPill) localPill.textContent = state.local.length + ' ' + plural(state.local.length, ['файл', 'файла', 'файлов']);
    const publishedPill = $('#published-count');
    if (publishedPill) publishedPill.textContent = state.published.length + ' ' + plural(state.published.length, ['файл', 'файла', 'файлов']);
    const publishCount = $('#publish-count');
    if (publishCount) publishCount.textContent = merged.length;
    const publishSize = $('#publish-size');
    if (publishSize) publishSize.textContent = U.formatBytes(totalSize);

    const exportMeta = $('#export-meta');
    if (exportMeta) exportMeta.textContent = merged.length + ' ' + plural(merged.length, ['файл', 'файла', 'файлов']) + ' · ' + U.formatBytes(totalSize);
  }

  /* ---------- Render lists ---------- */

  function renderLocal() {
    const list = $('#local-list');
    const empty = $('#local-empty');
    if (!list || !empty) return;
    list.innerHTML = state.local.map(function (item) {
      const cover = getLocalCover(item);
      const ext = U.getExtension(item.fileName);
      return '<article class="local-item" data-local-id="' + U.escapeHTML(item.id) + '">' +
        '<img class="local-thumb" src="' + U.escapeHTML(cover) + '" alt="" loading="lazy">' +
        '<div class="local-info">' +
          '<h3>' + U.escapeHTML(item.title) + '</h3>' +
          '<p>' + U.escapeHTML(ext) + ' · ' + U.formatBytes(item.fileSize) + ' · ' + U.escapeHTML(item.category || 'Другое') + '</p>' +
        '</div>' +
        '<div class="local-actions">' +
          '<button class="icon-btn" type="button" data-local-action="download" aria-label="Скачать ' + U.escapeHTML(item.title) + '" title="Скачать">' + icon('download') + '</button>' +
          '<button class="icon-btn" type="button" data-local-action="edit" aria-label="Редактировать ' + U.escapeHTML(item.title) + '" title="Редактировать">' + icon('edit') + '</button>' +
          '<button class="icon-btn is-danger" type="button" data-local-action="delete" aria-label="Удалить ' + U.escapeHTML(item.title) + '" title="Удалить">' + icon('trash') + '</button>' +
        '</div>' +
      '</article>';
    }).join('');
    list.hidden = state.local.length === 0;
    empty.hidden = state.local.length > 0;
  }

  function renderPublished() {
    const list = $('#published-list');
    if (!list) return;
    list.innerHTML = state.published.map(function (item) {
      const cover = item.coverUrl || U.makeFallbackCover(item.title, item.fileName, item.category);
      return '<article class="published-item">' +
        '<img class="local-thumb" src="' + U.escapeHTML(cover) + '" alt="" loading="lazy">' +
        '<div class="local-info">' +
          '<h3>' + U.escapeHTML(item.title) + '</h3>' +
          '<p>' + U.escapeHTML(U.getExtension(item.fileName)) + ' · ' + U.formatBytes(item.fileSize) + ' · ' + U.escapeHTML(item.category || 'Другое') + '</p>' +
        '</div>' +
        '<span class="published-badge">' + icon('checkCircle') + ' На сайте</span>' +
      '</article>';
    }).join('');
  }

  function refreshLists() {
    renderLocal();
    renderPublished();
    updateSummary();
  }

  /* ---------- Live preview ---------- */

  function updateCounters() {
    const title = $('#title-input');
    const description = $('#description-input');
    const titleCounter = $('#title-counter');
    const descriptionCounter = $('#description-counter');
    if (title && titleCounter) titleCounter.textContent = title.value.length + ' / 80';
    if (description && descriptionCounter) descriptionCounter.textContent = description.value.length + ' / 280';
  }

  function updatePreview() {
    const title = currentTitle();
    const descriptionInput = $('#description-input');
    const categoryInput = $('#category-input');
    const tagsInput = $('#tags-input');
    const category = currentCategory();
    const meta = U.categoryMeta(category);
    const description = descriptionInput ? descriptionInput.value.trim() : '';
    const tags = parseTags(tagsInput ? tagsInput.value : '');
    const previewCard = $('.preview-card');

    if (previewCard) previewCard.style.setProperty('--card-accent', meta.color);
    const cover = $('#preview-cover');
    if (cover) {
      cover.src = currentCoverForPreview();
      cover.alt = title ? 'Обложка: ' + title : 'Предпросмотр обложки';
    }
    const ext = $('#preview-ext');
    if (ext) ext.textContent = U.getExtension(state.fileName || 'file');
    const titleElement = $('#preview-title');
    if (titleElement) titleElement.textContent = title || 'Название файла';
    const categoryElement = $('#preview-category');
    if (categoryElement) categoryElement.textContent = (categoryInput && categoryInput.value.trim()) || 'Категория';
    const descriptionElement = $('#preview-description');
    if (descriptionElement) descriptionElement.textContent = description || 'Описание появится здесь, как только вы начнёте его писать.';
    const sizeElement = $('#preview-size');
    if (sizeElement) sizeElement.textContent = state.fileSize ? U.formatBytes(state.fileSize) : '0 Б';
    const tagsElement = $('#preview-tags');
    if (tagsElement) {
      const visible = tags.slice(0, 3);
      tagsElement.innerHTML = visible.map(function (tag) {
        return '<span class="tag">' + U.escapeHTML(tag) + '</span>';
      }).join('') + (tags.length > visible.length ? '<span class="tag">+' + (tags.length - visible.length) + '</span>' : '');
    }
    updateCounters();
  }

  /* ---------- File selection ---------- */

  function setSelectedFileDisplay() {
    const selected = $('#selected-file');
    const name = $('#selected-file-name');
    const meta = $('#selected-file-meta');
    if (!selected || !name || !meta) return;
    if (!state.fileName) {
      selected.hidden = true;
      return;
    }
    selected.hidden = false;
    name.textContent = state.fileName;
    meta.textContent = U.getExtension(state.fileName) + ' · ' + U.formatBytes(state.fileSize);
    const iconBox = $('.selected-file-icon', selected);
    if (iconBox) iconBox.innerHTML = icon(U.fileIcon(state.fileName));
  }

  function applyFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setStatus('Файл больше 100 МБ. Выберите файл поменьше.', true);
      return;
    }
    state.file = file;
    state.fileName = file.name || 'file';
    state.fileSize = file.size || 0;
    state.fileType = file.type || '';
    setSelectedFileDisplay();
    setStatus('');

    const titleInput = $('#title-input');
    const categoryInput = $('#category-input');
    if (titleInput && !titleInput.dataset.touched) {
      titleInput.value = U.titleFromFileName(state.fileName);
    }
    if (categoryInput && !categoryInput.dataset.touched) {
      categoryInput.value = U.detectCategory(state.fileName, state.fileType);
    }
    updatePreview();
  }

  function clearFile() {
    state.file = null;
    state.fileName = '';
    state.fileSize = 0;
    state.fileType = '';
    const input = $('#file-input');
    if (input) input.value = '';
    setSelectedFileDisplay();
    updatePreview();
  }

  /* ---------- Cover selection ---------- */

  function setCoverPreview(url) {
    revokeURL(state.coverPreviewUrl);
    state.coverPreviewUrl = url || '';
    const preview = $('#cover-preview');
    const placeholder = $('#cover-placeholder');
    const replace = $('#cover-replace');
    const remove = $('#cover-remove');
    if (preview) {
      if (url) {
        preview.src = url;
        preview.hidden = false;
      } else {
        preview.removeAttribute('src');
        preview.hidden = true;
      }
    }
    if (placeholder) placeholder.hidden = !!url;
    if (replace) replace.hidden = !url;
    if (remove) remove.hidden = !url;
    updatePreview();
  }

  function applyCover(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(file.name)) {
      setStatus('Для обложки нужен файл изображения.', true);
      return;
    }
    if (file.size > MAX_COVER_SIZE) {
      setStatus('Обложка больше 12 МБ. Выберите изображение поменьше.', true);
      return;
    }
    state.cover = file;
    state.coverRemoved = false;
    state.existingCoverUrl = '';
    const url = URL.createObjectURL(file);
    setCoverPreview(url);
    setStatus('');
  }

  function removeCover() {
    state.cover = null;
    state.coverRemoved = true;
    state.existingCoverUrl = '';
    const input = $('#cover-input');
    if (input) input.value = '';
    setCoverPreview('');
  }

  /* ---------- Form ---------- */

  function resetForm() {
    const form = $('#item-form');
    if (form) form.reset();
    state.editingId = null;
    state.file = null;
    state.fileName = '';
    state.fileSize = 0;
    state.fileType = '';
    state.cover = null;
    state.coverRemoved = false;
    state.existingCoverUrl = '';
    setCoverPreview('');
    setSelectedFileDisplay();
    const titleInput = $('#title-input');
    const categoryInput = $('#category-input');
    if (titleInput) {
      titleInput.dataset.touched = '';
      titleInput.value = '';
    }
    if (categoryInput) {
      categoryInput.dataset.touched = '';
      categoryInput.value = '';
    }
    const fileInput = $('#file-input');
    if (fileInput) fileInput.value = '';
    const coverInput = $('#cover-input');
    if (coverInput) coverInput.value = '';
    const submitLabel = $('#submit-label');
    if (submitLabel) submitLabel.textContent = 'Сохранить на полку';
    const cancel = $('#cancel-edit');
    if (cancel) cancel.hidden = true;
    setStatus('');
    updatePreview();
  }

  function startEdit(id) {
    const item = state.local.find(function (entry) { return String(entry.id) === String(id); });
    if (!item) return;
    state.editingId = item.id;
    state.file = item.fileBlob || null;
    state.fileName = item.fileName || 'file';
    state.fileSize = Number(item.fileSize) || (item.fileBlob ? item.fileBlob.size : 0);
    state.fileType = item.fileType || (item.fileBlob ? item.fileBlob.type : '');
    state.cover = item.coverBlob || null;
    state.coverRemoved = false;
    state.existingCoverUrl = item.coverBlob ? '' : (item.coverUrl || '');

    const fileInput = $('#file-input');
    const coverInput = $('#cover-input');
    if (fileInput) fileInput.value = '';
    if (coverInput) coverInput.value = '';

    const titleInput = $('#title-input');
    const descriptionInput = $('#description-input');
    const categoryInput = $('#category-input');
    const versionInput = $('#version-input');
    const tagsInput = $('#tags-input');
    if (titleInput) {
      titleInput.value = item.title || '';
      titleInput.dataset.touched = 'true';
    }
    if (descriptionInput) descriptionInput.value = item.description || '';
    if (categoryInput) {
      categoryInput.value = item.category || '';
      categoryInput.dataset.touched = 'true';
    }
    if (versionInput) versionInput.value = item.version || '1.0';
    if (tagsInput) tagsInput.value = (item.tags || []).join(', ');

    setSelectedFileDisplay();
    if (item.coverBlob) {
      setCoverPreview(URL.createObjectURL(item.coverBlob));
    } else if (item.coverUrl) {
      setCoverPreview(item.coverUrl);
    } else {
      setCoverPreview('');
    }
    updatePreview();

    const submitLabel = $('#submit-label');
    if (submitLabel) submitLabel.textContent = 'Сохранить изменения';
    const cancel = $('#cancel-edit');
    if (cancel) cancel.hidden = false;
    setStatus('Редактирование: ' + item.title);
    const form = $('#add-file');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!state.fileName) {
      setStatus('Сначала выберите файл.', true);
      const dropzone = $('#file-dropzone');
      if (dropzone) dropzone.focus();
      return;
    }
    const title = currentTitle();
    if (!title) {
      setStatus('Добавьте название файла.', true);
      const titleInput = $('#title-input');
      if (titleInput) titleInput.focus();
      return;
    }
    const descriptionInput = $('#description-input');
    const categoryInput = $('#category-input');
    const versionInput = $('#version-input');
    const tagsInput = $('#tags-input');
    const editingItem = currentEditingItem();
    const category = (categoryInput && categoryInput.value.trim()) || U.detectCategory(state.fileName, state.fileType) || 'Другое';
    const tags = parseTags(tagsInput ? tagsInput.value : '');
    const now = new Date().toISOString();
    let coverBlob = null;
    let coverUrl = '';
    if (state.cover) {
      coverBlob = state.cover;
    } else if (!state.coverRemoved && state.existingCoverUrl) {
      coverUrl = state.existingCoverUrl;
    }
    if (!coverBlob && !coverUrl) {
      coverUrl = U.makeFallbackCover(title, state.fileName, category);
    }

    const item = {
      id: state.editingId || U.uniqueId('local'),
      title: title,
      description: descriptionInput ? descriptionInput.value.trim() : '',
      category: category,
      tags: tags,
      fileName: state.fileName,
      fileSize: state.fileSize,
      fileType: state.fileType,
      version: (versionInput && versionInput.value.trim()) || '1.0',
      createdAt: editingItem ? editingItem.createdAt : now,
      updatedAt: now,
      fileBlob: state.file,
      coverBlob: coverBlob,
      coverUrl: coverBlob ? '' : coverUrl
    };

    const button = $('#submit-button');
    if (button) button.disabled = true;
    setStatus('Сохраняем…');
    try {
      await Store.putLocalItem(item);
      await refreshLocal();
      resetForm();
      refreshLists();
      showToast(editingItem ? 'Изменения сохранены' : 'Файл добавлен на полку');
    } catch (error) {
      console.error(error);
      setStatus('Не удалось сохранить файл. Возможно, не хватает места в браузере.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ---------- Dialogs ---------- */

  function openPublishDialog() {
    const dialog = $('#publish-dialog');
    if (!dialog) return;
    updateSummary();
    const summary = $('#export-summary');
    const merged = mergeItemsForExport();
    if (summary) {
      const iconElement = summary.querySelector('.icon');
      if (iconElement) iconElement.outerHTML = icon('package');
    }
    const count = $('#publish-count');
    if (count) count.textContent = merged.length;
    const totalSize = merged.reduce(function (sum, item) { return sum + (Number(item.fileSize) || 0); }, 0);
    const size = $('#publish-size');
    if (size) size.textContent = U.formatBytes(totalSize);
    document.body.style.overflow = 'hidden';
    dialog.showModal();
  }

  function closePublishDialog() {
    const dialog = $('#publish-dialog');
    if (dialog && dialog.open) dialog.close();
    document.body.style.overflow = '';
  }

  function openDeleteDialog(id) {
    const item = state.local.find(function (entry) { return String(entry.id) === String(id); });
    if (!item) return;
    state.pendingDeleteId = id;
    const text = $('#delete-dialog-text');
    if (text) text.textContent = '«' + item.title + '» исчезнет из локальных черновиков. Опубликованная версия останется на сайте.';
    const dialog = $('#delete-dialog');
    if (!dialog) return;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
  }

  function closeDeleteDialog() {
    const dialog = $('#delete-dialog');
    if (dialog && dialog.open) dialog.close();
    document.body.style.overflow = '';
    state.pendingDeleteId = null;
  }

  async function confirmDelete() {
    if (!state.pendingDeleteId) return;
    const button = $('#confirm-delete');
    if (button) button.disabled = true;
    try {
      await Store.deleteLocalItem(state.pendingDeleteId);
      if (String(state.editingId) === String(state.pendingDeleteId)) resetForm();
      await refreshLocal();
      refreshLists();
      closeDeleteDialog();
      showToast('Файл удалён из черновиков');
    } catch (error) {
      console.error(error);
      showToast('Не удалось удалить файл');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ---------- Download local ---------- */

  function downloadLocal(item) {
    if (!item) return;
    let url = item.fileUrl || '';
    let revoke = false;
    if (item.fileBlob) {
      url = URL.createObjectURL(item.fileBlob);
      revoke = true;
    }
    if (!url) return;
    U.downloadURL(url, item.fileName || 'file');
    if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    showToast('Скачиваем «' + item.title + '»');
  }

  /* ---------- Export ---------- */

  function serializeItem(item) {
    return {
      id: item.id,
      title: item.title,
      description: item.description || '',
      category: item.category || 'Другое',
      tags: Array.isArray(item.tags) ? item.tags : [],
      fileName: item.fileName,
      fileSize: Number(item.fileSize) || 0,
      fileType: item.fileType || '',
      version: item.version || '1.0',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    };
  }

  async function buildLibraryFile() {
    const merged = mergeItemsForExport();
    const exported = [];
    for (const item of merged) {
      const serialized = serializeItem(item);
      if (item.__origin === 'local' || item.fileBlob) {
        serialized.fileUrl = item.fileBlob ? await U.blobToDataURL(item.fileBlob) : (item.fileUrl || '');
        if (item.coverBlob) {
          serialized.coverUrl = await U.blobToDataURL(item.coverBlob);
        } else {
          serialized.coverUrl = item.coverUrl || U.makeFallbackCover(item.title, item.fileName, item.category);
        }
      } else {
        serialized.fileUrl = item.fileUrl || '';
        serialized.coverUrl = item.coverUrl || '';
      }
      exported.push(serialized);
    }
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: exported
    };
    return '/* ПОЛКА — данные библиотеки. Сгенерировано ' + new Date().toLocaleString('ru-RU') + ' */\n' +
      'window.POLKA_LIBRARY = ' + JSON.stringify(payload, null, 2) + ';\n';
  }

  async function downloadLibrary() {
    const button = $('#download-library');
    if (button) button.disabled = true;
    try {
      const content = await buildLibraryFile();
      const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      U.downloadURL(url, 'library.js');
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      showToast('library.js готов. Замените файл на хостинге.');
    } catch (error) {
      console.error(error);
      showToast('Не удалось собрать library.js');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ---------- Theme ---------- */

  function updateThemeLabel() {
    const button = $('#theme-toggle');
    if (!button) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    button.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#11130f' : '#f2efe4');
  }

  function initTheme() {
    const button = $('#theme-toggle');
    updateThemeLabel();
    if (!button) return;
    button.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('polka-theme', next); } catch (error) {}
      updateThemeLabel();
    });
  }

  /* ---------- Events ---------- */

  function initDropzones() {
    const fileDrop = $('#file-dropzone');
    const fileInput = $('#file-input');
    const coverDrop = $('#cover-dropzone');
    const coverInput = $('#cover-input');

    function wireDropzone(dropzone, input, accept) {
      if (!dropzone || !input) return;
      dropzone.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.click();
        }
      });
      ['dragenter', 'dragover'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          event.stopPropagation();
          dropzone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          event.stopPropagation();
          dropzone.classList.remove('is-dragover');
        });
      });
      dropzone.addEventListener('drop', function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove('is-dragover');
        const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
        if (!file) return;
        accept(file);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        const file = fileInput.files && fileInput.files[0];
        if (file) applyFile(file);
      });
    }
    if (coverInput) {
      coverInput.addEventListener('change', function () {
        const file = coverInput.files && coverInput.files[0];
        if (file) applyCover(file);
      });
    }
    wireDropzone(fileDrop, fileInput, applyFile);
    wireDropzone(coverDrop, coverInput, applyCover);

    document.addEventListener('dragover', function (event) { event.preventDefault(); });
    document.addEventListener('drop', function (event) {
      const target = event.target;
      if (!target || !target.closest || !target.closest('.dropzone, .cover-dropzone')) event.preventDefault();
    });
  }

  function initForm() {
    const form = $('#item-form');
    if (form) form.addEventListener('submit', handleSubmit);

    const fileRemove = $('#file-remove');
    if (fileRemove) {
      fileRemove.addEventListener('click', function () {
        clearFile();
        setStatus('');
      });
    }

    const coverRemove = $('#cover-remove');
    if (coverRemove) coverRemove.addEventListener('click', removeCover);

    const titleInput = $('#title-input');
    if (titleInput) {
      titleInput.addEventListener('input', function () {
        titleInput.dataset.touched = titleInput.value.trim() ? 'true' : '';
        updatePreview();
      });
    }

    const categoryInput = $('#category-input');
    if (categoryInput) {
      categoryInput.addEventListener('input', function () {
        categoryInput.dataset.touched = categoryInput.value.trim() ? 'true' : '';
        updatePreview();
      });
    }

    ['#description-input', '#tags-input', '#version-input'].forEach(function (selector) {
      const input = $(selector);
      if (input) input.addEventListener('input', updatePreview);
    });

    const cancel = $('#cancel-edit');
    if (cancel) cancel.addEventListener('click', resetForm);

    const clear = $('#clear-form');
    if (clear) {
      clear.addEventListener('click', function () {
        resetForm();
        setStatus('Форма очищена');
      });
    }

    updatePreview();
  }

  function initLists() {
    const localList = $('#local-list');
    if (localList) {
      localList.addEventListener('click', function (event) {
        const button = event.target.closest('[data-local-action]');
        const row = event.target.closest('[data-local-id]');
        if (!button || !row) return;
        const item = state.local.find(function (entry) { return String(entry.id) === String(row.dataset.localId); });
        if (!item) return;
        const action = button.dataset.localAction;
        if (action === 'download') downloadLocal(item);
        if (action === 'edit') startEdit(item.id);
        if (action === 'delete') openDeleteDialog(item.id);
      });
    }
  }

  function initDialogs() {
    const publish = $('#publish-dialog');
    const publishButton = $('#publish-button');
    const noticeHelp = $('#notice-help');
    const publishClose = $('#publish-close');
    const publishLater = $('#publish-later');
    const downloadButton = $('#download-library');

    if (publishButton) publishButton.addEventListener('click', openPublishDialog);
    if (noticeHelp) noticeHelp.addEventListener('click', openPublishDialog);
    if (publishClose) publishClose.addEventListener('click', closePublishDialog);
    if (publishLater) publishLater.addEventListener('click', closePublishDialog);
    if (downloadButton) downloadButton.addEventListener('click', downloadLibrary);
    if (publish) {
      publish.addEventListener('click', function (event) {
        if (event.target === publish) closePublishDialog();
      });
      publish.addEventListener('close', function () { document.body.style.overflow = ''; });
    }

    const deleteDialog = $('#delete-dialog');
    const confirmDeleteButton = $('#confirm-delete');
    const cancelDeleteButton = $('#cancel-delete');
    if (confirmDeleteButton) confirmDeleteButton.addEventListener('click', confirmDelete);
    if (cancelDeleteButton) cancelDeleteButton.addEventListener('click', closeDeleteDialog);
    if (deleteDialog) {
      deleteDialog.addEventListener('click', function (event) {
        if (event.target === deleteDialog) closeDeleteDialog();
      });
      deleteDialog.addEventListener('close', function () {
        document.body.style.overflow = '';
        state.pendingDeleteId = null;
      });
    }
  }

  function init() {
    initTheme();
    initDropzones();
    initForm();
    initLists();
    initDialogs();
    const year = $('#footer-year');
    if (year) year.textContent = String(new Date().getFullYear());

    if (!Store) {
      setStatus('Локальное хранилище недоступно в этом браузере.', true);
      return;
    }

    state.published = Store.getPublishedItems();
    refreshLocal().then(function () {
      refreshLists();
      updatePreview();
    }).catch(function (error) {
      console.error(error);
      refreshLists();
      setStatus('Не удалось открыть локальное хранилище. Проверьте настройки браузера.', true);
    });
  }

  window.addEventListener('beforeunload', function () {
    state.localCoverURLs.forEach(function (url) { revokeURL(url); });
    revokeURL(state.coverPreviewUrl);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
