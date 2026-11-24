/* ПОЛКА — public library page */
(function () {
  'use strict';

  const U = window.PolkaUtils;
  const Store = window.PolkaStore;
  const state = {
    items: [],
    filtered: [],
    query: '',
    category: 'all',
    sort: 'new',
    view: 'grid'
  };
  const objectURLs = [];
  let toastTimer = null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function normalize(value) {
    return String(value == null ? '' : value).toLocaleLowerCase('ru-RU').trim();
  }

  function icon(name) {
    return window.icon(name);
  }

  function loadLocal() {
    if (!Store) return Promise.resolve([]);
    return Store.getLocalItems().catch(function (error) {
      console.warn('Не удалось прочитать локальные файлы:', error);
      return [];
    });
  }

  function toViewItem(item) {
    const isLocal = item.source === 'local' || item.source === 'local-draft' || !!item.fileBlob;
    let fileUrl = item.fileUrl || '';
    let coverUrl = item.coverUrl || '';

    if (item.fileBlob) {
      fileUrl = URL.createObjectURL(item.fileBlob);
      objectURLs.push(fileUrl);
    }
    if (item.coverBlob) {
      coverUrl = URL.createObjectURL(item.coverBlob);
      objectURLs.push(coverUrl);
    }
    if (!coverUrl) {
      coverUrl = U.makeFallbackCover(item.title, item.fileName, item.category);
    }

    return Object.assign({}, item, {
      fileUrl: fileUrl,
      coverUrl: coverUrl,
      isLocal: isLocal,
      searchText: normalize([
        item.title,
        item.description,
        item.category,
        item.fileName,
        (item.tags || []).join(' ')
      ].join(' '))
    });
  }

  async function loadItems() {
    const published = Store ? Store.getPublishedItems() : [];
    const local = await loadLocal();
    const merged = new Map();

    published.forEach(function (item) {
      merged.set(String(item.id), item);
    });

    local.forEach(function (item) {
      const id = String(item.id);
      const existing = merged.get(id);
      const localUpdated = new Date(item.updatedAt || item.createdAt || 0).getTime();
      const publishedUpdated = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : -1;
      if (!existing || localUpdated > publishedUpdated) {
        merged.set(id, Object.assign({}, item, { source: 'local' }));
      }
    });

    state.items = Array.from(merged.values()).map(toViewItem);

    state.items.sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  function renderStats() {
    const totalBytes = state.items.reduce(function (sum, item) {
      return sum + (Number(item.fileSize) || 0);
    }, 0);
    const categories = new Set(state.items.map(function (item) { return item.category || 'Другое'; }));
    const count = String(state.items.length).padStart(2, '0');
    const categoryCount = String(categories.size).padStart(2, '0');
    $('#stat-files').textContent = count;
    $('#stat-size').textContent = U.formatBytes(totalBytes);
    $('#stat-categories').textContent = categoryCount;
  }

  function categoryOrder(a, b) {
    const order = ['Дизайн', 'Документы', 'Код', 'Маркетинг', 'Шаблоны', 'Фото', 'Аудио', 'Видео', 'Другое'];
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }

  function renderFilters() {
    const container = $('#category-filters');
    if (!container) return;
    const counts = new Map();
    state.items.forEach(function (item) {
      const category = item.category || 'Другое';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    const categories = Array.from(counts.keys()).sort(categoryOrder);
    const buttons = [
      '<button type="button" class="filter-btn' + (state.category === 'all' ? ' is-active' : '') + '" data-category="all">Все <span>' + state.items.length + '</span></button>'
    ].concat(categories.map(function (category) {
      const active = state.category === category ? ' is-active' : '';
      return '<button type="button" class="filter-btn' + active + '" data-category="' + U.escapeHTML(category) + '">' + U.escapeHTML(category) + ' <span>' + counts.get(category) + '</span></button>';
    }));
    container.innerHTML = buttons.join('');
  }

  function sortItems(items) {
    const sorted = items.slice();
    if (state.sort === 'old') {
      sorted.sort(function (a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
    } else if (state.sort === 'title') {
      sorted.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'ru'); });
    } else if (state.sort === 'size') {
      sorted.sort(function (a, b) { return (Number(b.fileSize) || 0) - (Number(a.fileSize) || 0); });
    } else {
      sorted.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    }
    return sorted;
  }

  function cardTemplate(item) {
    const meta = U.categoryMeta(item.category);
    const tags = (item.tags || []).filter(Boolean);
    const visibleTags = tags.slice(0, 3);
    const extra = tags.length - visibleTags.length;
    const tagHTML = visibleTags.map(function (tag) {
      return '<span class="tag">' + U.escapeHTML(tag) + '</span>';
    }).join('') + (extra > 0 ? '<span class="tag">+' + extra + '</span>' : '');
    const ext = U.getExtension(item.fileName);
    const localBadge = item.isLocal
      ? '<span class="local-badge">' + icon('db') + ' Черновик</span>'
      : '';
    return '<article class="file-card" style="--card-accent:' + meta.color + '" data-item-id="' + U.escapeHTML(item.id) + '">' +
      '<button class="card-cover card-cover-button" type="button" data-open-item="' + U.escapeHTML(item.id) + '" aria-label="Открыть карточку: ' + U.escapeHTML(item.title) + '">' +
        '<img src="' + U.escapeHTML(item.coverUrl) + '" alt="Обложка: ' + U.escapeHTML(item.title) + '" loading="lazy">' +
        '<span class="file-ext">' + U.escapeHTML(ext) + '</span>' +
        localBadge +
      '</button>' +
      '<div class="card-body">' +
        '<div class="card-meta">' +
          '<span class="card-category">' + U.escapeHTML(item.category || 'Другое') + '</span>' +
          '<span>' + U.formatBytes(item.fileSize) + '</span>' +
        '</div>' +
        '<h3><button class="card-title-button" type="button" data-open-item="' + U.escapeHTML(item.id) + '">' + U.escapeHTML(item.title) + '</button></h3>' +
        '<p class="card-description">' + U.escapeHTML(item.description || 'Без описания') + '</p>' +
        '<div class="card-foot">' +
          '<div class="tag-list">' + tagHTML + '</div>' +
          '<button class="download-round" type="button" data-download-id="' + U.escapeHTML(item.id) + '" aria-label="Скачать: ' + U.escapeHTML(item.title) + '">' + icon('download') + '</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function render() {
    const grid = $('#library-grid');
    const empty = $('#empty-state');
    if (!grid) return;
    const query = normalize(state.query);
    state.filtered = state.items.filter(function (item) {
      if (state.category !== 'all' && (item.category || 'Другое') !== state.category) return false;
      if (query && !item.searchText.includes(query)) return false;
      return true;
    });
    state.filtered = sortItems(state.filtered);

    grid.innerHTML = state.filtered.map(cardTemplate).join('');
    grid.classList.toggle('is-list', state.view === 'list');
    empty.hidden = state.filtered.length > 0;
    grid.hidden = state.filtered.length === 0;

    const count = $('#results-count');
    if (count) {
      if (state.filtered.length === 0) {
        count.textContent = 'Ничего не найдено';
      } else if (state.filtered.length === state.items.length) {
        count.textContent = 'Всего ' + state.items.length + ' ' + plural(state.items.length, ['файл', 'файла', 'файлов']);
      } else {
        count.textContent = 'Найдено ' + state.filtered.length + ' из ' + state.items.length;
      }
    }

    const clear = $('#search-clear');
    if (clear) clear.hidden = !state.query;
  }

  function plural(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function findItem(id) {
    return state.items.find(function (item) { return String(item.id) === String(id); });
  }

  function downloadItem(item) {
    if (!item || !item.fileUrl) return;
    U.downloadItem(item);
    showToast('Скачиваем «' + item.title + '»');
  }

  function openDialog(item) {
    if (!item) return;
    const dialog = $('#file-dialog');
    if (!dialog) return;
    const meta = U.categoryMeta(item.category);
    $('#dialog-cover').src = item.coverUrl;
    $('#dialog-cover').alt = 'Обложка: ' + item.title;
    $('#dialog-ext').textContent = U.getExtension(item.fileName);
    $('#dialog-category').textContent = item.category || 'Другое';
    $('#dialog-title').textContent = item.title;
    $('#dialog-description').textContent = item.description || 'Описание пока не добавлено.';
    $('#dialog-format').textContent = U.getExtension(item.fileName);
    $('#dialog-size').textContent = U.formatBytes(item.fileSize);
    $('#dialog-version').textContent = item.version ? 'v' + item.version : '—';
    $('#dialog-date').textContent = U.formatDate(item.createdAt);
    $('#dialog-tags').innerHTML = (item.tags || []).map(function (tag) {
      return '<span class="tag">' + U.escapeHTML(tag) + '</span>';
    }).join('');
    const download = $('#dialog-download');
    download.href = item.fileUrl || '#';
    download.setAttribute('download', item.fileName || 'file');
    download.dataset.downloadId = item.id;
    $('#dialog-category').style.color = meta.color;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.dataset.openItem = item.id;
  }

  function closeDialog() {
    const dialog = $('#file-dialog');
    if (dialog && dialog.open) dialog.close();
    document.body.style.overflow = '';
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toast-text').textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2800);
  }

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
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('polka-theme', next); } catch (error) {}
      updateThemeLabel();
    });
  }

  function initMobileNav() {
    const toggle = $('#nav-toggle');
    const panel = $('#mobile-nav');
    if (!toggle || !panel) return;
    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      toggle.innerHTML = window.icon(open ? 'x' : 'menu');
    }
    toggle.addEventListener('click', function () {
      setOpen(panel.hidden);
    });
    panel.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 980 && !panel.hidden) setOpen(false);
    });
  }

  function initControls() {
    const search = $('#search-input');
    const clear = $('#search-clear');
    const sort = $('#sort-select');
    const reset = $('#reset-filters');
    const filters = $('#category-filters');
    const grid = $('#library-grid');
    const savedView = (function () {
      try { return localStorage.getItem('polka-view'); } catch (error) { return null; }
    })();
    if (savedView === 'list' || savedView === 'grid') state.view = savedView;
    $all('.view-btn').forEach(function (button) {
      const active = button.dataset.view === state.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        render();
      });
      search.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && search.value) {
          search.value = '';
          state.query = '';
          render();
        }
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        if (!search) return;
        search.value = '';
        state.query = '';
        search.focus();
        render();
      });
    }

    if (sort) {
      sort.addEventListener('change', function () {
        state.sort = sort.value;
        render();
      });
    }

    if (reset) {
      reset.addEventListener('click', function () {
        state.query = '';
        state.category = 'all';
        state.sort = 'new';
        if (search) search.value = '';
        if (sort) sort.value = 'new';
        renderFilters();
        render();
      });
    }

    if (filters) {
      filters.addEventListener('click', function (event) {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        state.category = button.dataset.category;
        renderFilters();
        render();
      });
    }

    $all('.view-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        state.view = button.dataset.view;
        $all('.view-btn').forEach(function (item) {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        try { localStorage.setItem('polka-view', state.view); } catch (error) {}
        render();
      });
    });

    if (grid) {
      grid.addEventListener('click', function (event) {
        const downloadButton = event.target.closest('[data-download-id]');
        if (downloadButton) {
          event.preventDefault();
          event.stopPropagation();
          downloadItem(findItem(downloadButton.dataset.downloadId));
          return;
        }
        const openButton = event.target.closest('[data-open-item]');
        if (openButton) {
          event.preventDefault();
          openDialog(findItem(openButton.dataset.openItem));
          return;
        }
        const card = event.target.closest('.file-card');
        if (card && !event.target.closest('a, button')) {
          openDialog(findItem(card.dataset.itemId));
        }
      });
    }

    document.addEventListener('keydown', function (event) {
      const target = event.target;
      const tag = target && target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        if (search) search.focus();
      }
    });

    const dialog = $('#file-dialog');
    if (dialog) {
      const close = $('#dialog-close');
      if (close) close.addEventListener('click', closeDialog);
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeDialog();
      });
      dialog.addEventListener('close', function () {
        document.body.style.overflow = '';
        dialog.dataset.openItem = '';
      });
      const download = $('#dialog-download');
      if (download) {
        download.addEventListener('click', function () {
          const item = findItem(download.dataset.downloadId);
          if (item) showToast('Скачиваем «' + item.title + '»');
        });
      }
    }
  }

  async function init() {
    initTheme();
    initMobileNav();
    initControls();
    const year = $('#footer-year');
    if (year) year.textContent = String(new Date().getFullYear());
    try {
      await loadItems();
      renderStats();
      renderFilters();
      render();
    } catch (error) {
      console.error(error);
      const grid = $('#library-grid');
      if (grid) grid.innerHTML = '<div class="empty-state"><h3>Не удалось загрузить библиотеку</h3><p>Обновите страницу или проверьте файл data/library.js.</p></div>';
    }
  }

  window.addEventListener('beforeunload', function () {
    objectURLs.forEach(function (url) { URL.revokeObjectURL(url); });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
