import { openPdfFromUrl, extractDocument } from "/zotero-extract.js";

const byId = (id) => document.getElementById(id);

async function zApi(path, { method = "GET", json } = {}) {
  const headers = {};
  if (method !== "GET" && method !== "HEAD") headers["x-hermeneuein"] = "1";
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(path, { method, headers, body });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function initZoteroModule({ onSwitchToZoteroTab, onOpenInWorkspace }) {
  const els = {
    panel: byId("yepage-zotero"),
    libView: byId("zotero-library-view"),
    readerView: byId("zotero-reader-view"),
    libSearch: byId("zotero-lib-search"),
    libFilterAll: byId("zotero-filter-all"),
    libFilterDone: byId("zotero-filter-done"),
    libSort: byId("zotero-lib-sort"),
    libRefresh: byId("zotero-lib-refresh"),
    libOpenFolder: byId("zotero-lib-folder"),
    quickSetup: byId("zotero-quick-setup"),
    pluginBanner: byId("zotero-plugin-banner"),
    pluginBannerText: byId("zotero-plugin-banner-text"),
    bannerInstall: byId("zotero-banner-install"),
    settingsStatus: byId("settings-zotero-status"),
    settingsBadge: byId("settings-zotero-badge"),
    settingsBridge: byId("settings-zotero-bridge"),
    settingsOpenDir: byId("settings-zotero-open-dir"),
    settingsInstall: byId("settings-zotero-install"),
    settingsUninstall: byId("settings-zotero-uninstall"),
    libMeta: byId("zotero-lib-meta"),
    folderSidebar: byId("zotero-folder-sidebar"),
    libList: byId("zotero-lib-list"),
    btnBack: byId("zotero-back"),
    outlineToggle: byId("zotero-outline-toggle"),
    outlineDrawer: byId("zotero-outline-drawer"),
    outlineClose: byId("zotero-outline-close"),
    outlineList: byId("zotero-outline-list"),
    tabOutline: byId("zotero-tab-outline"),
    tabNotes: byId("zotero-tab-notes"),
    notesCount: byId("zotero-notes-count"),
    notesList: byId("zotero-notes-list"),
    noteBtn: byId("zotero-note-btn"),
    starBtn: byId("zotero-star-btn"),
    unmarkBtn: byId("zotero-unmark-btn"),
    noteEditor: byId("zotero-note-editor"),
    noteQuote: byId("zotero-note-quote"),
    noteInput: byId("zotero-note-input"),
    noteSave: byId("zotero-note-save"),
    noteDelete: byId("zotero-note-delete"),
    noteCancel: byId("zotero-note-cancel"),
    docTitle: byId("zotero-doc-title"),
    pageBadge: byId("zotero-page-badge"),
    modePdf: byId("zotero-mode-pdf"),
    modeText: byId("zotero-mode-text"),
    modeZh: byId("zotero-mode-zh"),
    moreBtn: byId("zotero-more-btn"),
    moreMenu: byId("zotero-more-menu"),
    zoomWrap: byId("zotero-pdf-zoom"),
    zoomOut: byId("zotero-zoom-out"),
    zoomLabel: byId("zotero-zoom-label"),
    zoomIn: byId("zotero-zoom-in"),
    reparseBtn: byId("zotero-reparse-btn"),
    fontDec: byId("zotero-font-dec"),
    fontLabel: byId("zotero-font-label"),
    fontInc: byId("zotero-font-inc"),
    fontToggle: byId("zotero-font-toggle"),
    btnSearch: byId("zotero-search-toggle"),
    btnTranslate: byId("zotero-translate-btn"),
    btnWorkspace: byId("zotero-to-workspace"),
    btnExport: byId("zotero-export-btn"),
    btnFolder: byId("zotero-folder-btn"),
    progressFill: byId("zotero-progress-fill"),
    searchBar: byId("zotero-search-bar"),
    searchInput: byId("zotero-search-input"),
    searchCount: byId("zotero-search-count"),
    searchPrev: byId("zotero-search-prev"),
    searchNext: byId("zotero-search-next"),
    searchClose: byId("zotero-search-close"),
    statusBox: byId("zotero-reader-status"),
    readerBody: byId("zotero-reader-body"),
    split: byId("zotero-split"),
    paneLeft: byId("zotero-pane-left"),
    paneRight: byId("zotero-pane-right"),
    splitter: byId("zotero-splitter"),
    pdfStream: byId("zotero-pdf-stream"),
    enStream: byId("zotero-en-stream"),
    zhStream: byId("zotero-zh-stream"),
    focusBar: byId("zotero-focus-bar"),
    focusMeta: byId("zotero-focus-meta"),
    focusRetranslate: byId("zotero-retranslate"),
    focusClear: byId("zotero-focus-clear"),
    toast: byId("zotero-toast"),
    termToggle: byId("zotero-term-toggle"),
    glossaryToggle: byId("zotero-glossary-toggle"),
    glossary: byId("zotero-glossary"),
    glossaryStatus: byId("zotero-glossary-status"),
    glossaryList: byId("zotero-glossary-list"),
    glossaryRecover: byId("zotero-glossary-recover"),
    glossaryExport: byId("zotero-glossary-export"),
    termTip: byId("zotero-term-tip"),
  };

  const state = {
    items: [],
    collections: [],
    selectedCollection: "", // "" means all collections
    storageDir: "",
    zoteroDir: "",
    filter: "all",
    sort: "recent",
    fontSize: Number(localStorage.getItem("z_font_size")) || 16.5,
    showTerms: localStorage.getItem("z_show_terms") !== "0",
    thumbCache: new Map(), // lib_key -> dataURL
    thumbQueue: [],
    thumbActive: 0,
    thumbObserver: null,
    activeKey: null,
    info: null,
    doc: null,
    job: null,
    pdfDoc: null,
    viewMode: "pdf",
    serif: false,
    zoom: 1.0,
    activeSid: null,
    hoverSid: null,
    searchQuery: "",
    searchHits: [],
    searchIndex: -1,
    visiblePages: new Set(),
    glossaryRun: null,
    pageObserver: null,
    pageNodes: new Map(),
    sentNodesZh: new Map(),
    sentNodesEn: new Map(),
    pdfRectNodes: new Map(),
    annotations: [],
    noteDraftColor: "yellow",
    noteDraftSid: null,
    pollJobTimer: null,
    toastTimer: null,
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function docStats(doc) {
    if (!doc) return { done: 0, total: 0, failed: 0 };
    let done = 0;
    let total = 0;
    let failed = 0;
    const skip = doc.options?.skip_references ?? true;
    for (const p of doc.paragraphs || []) {
      if (p.k === "other" || (p.k === "reference" && skip)) continue;
      for (let i = p.a; i < Math.min(p.b, doc.sentences.length); i++) {
        total++;
        if (doc.sentences[i].z) done++;
        else if (doc.sentences[i].e) failed++;
      }
    }
    return { done, total, failed };
  }

  /* ─────────────────────────── Library ─────────────────────────── */

  async function refreshLibrary() {
    try {
      const data = await zApi("/api/zotero/library");
      state.items = data.items || [];
      state.collections = data.collections || [];
      state.storageDir = data.storage_dir || "";
      state.zoteroDir = data.zotero_data_dir || "";
      renderFolderSidebar();
      renderLibrary();
      if (data.pending?.lib_key) {
        onSwitchToZoteroTab();
        openPaper(data.pending.lib_key);
      }
    } catch (e) {
      els.libMeta.textContent = `加载失败：${e.message}`;
    }
  }

  function renderFolderSidebar() {
    if (!els.folderSidebar) return;
    const cols = state.collections || [];
    if (!cols.length) {
      els.folderSidebar.hidden = true;
      return;
    }
    els.folderSidebar.hidden = false;
    const frag = document.createDocumentFragment();

    const head = document.createElement("div");
    head.className = "z-folder-head";
    head.textContent = "Zotero 文件夹";
    frag.append(head);

    const makeBtn = (label, count, key, depth = 0) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "z-folder-btn";
      if (state.selectedCollection === key) b.classList.add("active");
      b.style.paddingLeft = `${10 + depth * 14}px`;
      b.innerHTML = `<span class="z-folder-name">${escapeHtml(label)}</span><span class="z-folder-cnt">${count}</span>`;
      b.addEventListener("click", () => {
        state.selectedCollection = key;
        renderFolderSidebar();
        renderLibrary();
      });
      return b;
    };

    frag.append(makeBtn("全部文件夹", state.items.length, "", 0));
    for (const c of cols) {
      const depth = Math.max(0, c.full_path.split(" / ").length - 1);
      frag.append(makeBtn(c.name, c.count, c.full_path, depth));
    }
    els.folderSidebar.replaceChildren(frag);
  }

  function pumpThumbQueue() {
    while (state.thumbActive < 2 && state.thumbQueue.length) {
      const task = state.thumbQueue.shift();
      if (!task || !task.img.isConnected) continue;
      if (state.thumbCache.has(task.libKey)) {
        task.img.src = state.thumbCache.get(task.libKey);
        task.img.classList.add("loaded");
        continue;
      }
      state.thumbActive++;
      renderFirstPageThumb(task.libKey)
        .then((url) => {
          if (url) {
            state.thumbCache.set(task.libKey, url);
            if (task.img.isConnected) {
              task.img.src = url;
              task.img.classList.add("loaded");
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          state.thumbActive--;
          pumpThumbQueue();
        });
    }
  }

  async function renderFirstPageThumb(libKey) {
    const pdf = await openPdfFromUrl(`/api/zotero/pdf/${encodeURIComponent(libKey)}`);
    try {
      const page = await pdf.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      // Render at high DPI (240px wide -> >3.5x Retina for a 64px thumbnail) so small text is razor-crisp!
      const targetW = 240;
      const scale = targetW / vp1.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    } finally {
      pdf.destroy?.();
    }
  }

  function renderLibrary() {
    const q = (els.libSearch.value || "").trim().toLowerCase();
    const translatedCount = state.items.filter((i) => i.done > 0).length;
    els.libMeta.textContent = state.zoteroDir
      ? `${state.items.length} 篇 · 已译 ${translatedCount} 篇`
      : "未检测到本地 Zotero";

    const list = state.items.filter((it) => {
      if (state.filter === "done" && it.done <= 0) return false;
      if (state.selectedCollection) {
        const cols = it.collections || [];
        if (!cols.some((c) => c === state.selectedCollection || c.startsWith(`${state.selectedCollection} / `))) {
          return false;
        }
      }
      if (!q) return true;
      return (
        (it.title || "").toLowerCase().includes(q)
        || (it.creators || "").toLowerCase().includes(q)
        || (it.file_name || "").toLowerCase().includes(q)
        || (it.collections || []).some((c) => c.toLowerCase().includes(q))
      );
    });
    if (state.sort === "translated") {
      list.sort((a, b) => {
        const ra = a.total ? a.done / a.total : 0;
        const rb = b.total ? b.done / b.total : 0;
        if (rb !== ra) return rb - ra;
        return (b.done || 0) - (a.done || 0);
      });
    }

    if (state.thumbObserver) state.thumbObserver.disconnect();
    state.thumbQueue = [];

    if (!list.length) {
      els.libList.innerHTML = `<div class="z-empty">
        <p>${state.items.length ? "当前分类下没有匹配的文献" : "暂无可读的 Zotero PDF 文献"}</p>
        <span>在 Zotero 中右键论文选择「在 PDF Translator 中对照阅读」，或按 ⌥⌘T 即可一键打开。</span>
      </div>`;
      return;
    }

    state.thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          state.thumbObserver.unobserve(img);
          const libKey = img.dataset.libKey;
          if (!libKey) continue;
          if (state.thumbCache.has(libKey)) {
            img.src = state.thumbCache.get(libKey);
            img.classList.add("loaded");
          } else {
            state.thumbQueue.push({ libKey, img });
            pumpThumbQueue();
          }
        }
      },
      { root: els.libList, rootMargin: "200px 0px" },
    );

    const frag = document.createDocumentFragment();
    for (const it of list) {
      const pct = it.total ? Math.round((it.done / it.total) * 100) : 0;
      let badge = `<span class="z-badge">未译</span>`;
      if (it.status === "complete") badge = `<span class="z-badge done">已译完</span>`;
      else if (it.done > 0) badge = `<span class="z-badge partial">${pct}%</span>`;

      const folderTags = (it.collections || [])
        .slice(0, 3)
        .map((c) => `<span class="z-folder-tag" title="${escapeHtml(c)}">${escapeHtml(c.split(" / ").pop())}</span>`)
        .join("");

      const row = document.createElement("div");
      row.className = "z-card";
      row.innerHTML = `
        <div class="z-thumb-wrap">
          <img class="z-thumb-img" data-lib-key="${escapeHtml(it.lib_key)}" alt="" />
        </div>
        <div class="z-card-main">
          <div class="z-card-title">${escapeHtml(it.title)}</div>
          <div class="z-card-sub">
            ${badge}
            ${it.creators ? `<span>${escapeHtml(it.creators)}</span>` : ""}
            ${it.year ? `<span>${escapeHtml(it.year)}</span>` : ""}
            ${it.journal ? `<span class="z-journal">${escapeHtml(it.journal)}</span>` : ""}
            ${it.pages ? `<span>${it.pages} 页</span>` : ""}
          </div>
          ${folderTags ? `<div class="z-card-folders">${folderTags}</div>` : ""}
        </div>
        <div class="z-card-actions">
          ${it.done > 0 ? `<button class="z-del-icon" title="清除译文缓存（不影响 Zotero 原文件）">删除译文</button>` : ""}
          <button class="z-open-pill">${it.done > 0 ? "继续阅读" : "对照阅读"}</button>
        </div>
      `;
      const thumbImg = row.querySelector(".z-thumb-img");
      if (state.thumbCache.has(it.lib_key)) {
        thumbImg.src = state.thumbCache.get(it.lib_key);
        thumbImg.classList.add("loaded");
      } else if (it.in_zotero) {
        state.thumbObserver.observe(thumbImg);
      }

      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".z-del-icon")) return;
        openPaper(it.lib_key);
      });
      row.querySelector(".z-del-icon")?.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm(`确定清除「${it.title}」的本地译文吗？\n不会影响 Zotero 原文件及已导出的文档。`)) return;
        await zApi(`/api/zotero/doc/${encodeURIComponent(it.lib_key)}`, { method: "DELETE" });
        toast("已清除译文缓存");
        refreshLibrary();
      });
      frag.append(row);
    }
    els.libList.replaceChildren(frag);
  }

  /* ─────────────────────────── Reader ─────────────────────────── */

  function showLibraryView() {
    stopJobPoll();
    state.activeKey = null;
    els.glossary.close();
    els.readerView.hidden = true;
    els.libView.hidden = false;
    els.searchBar.hidden = true;
    els.focusBar.hidden = true;
    refreshLibrary();
  }

  async function openPaper(libKey) {
    stopJobPoll();
    state.activeKey = libKey;
    state.doc = null;
    els.glossaryToggle.disabled = true;
    els.glossaryList.replaceChildren();
    els.glossaryExport.hidden = true;
    state.activeSid = null;
    state.hoverSid = null;
    els.libView.hidden = true;
    els.readerView.hidden = false;
    els.readerBody.hidden = true;
    els.outlineDrawer.hidden = true;
    els.moreMenu.hidden = true;
    els.focusBar.hidden = true;
    els.statusBox.hidden = false;
    els.statusBox.textContent = "正在读取 Zotero 文献…";

    try {
      const encoded = encodeURIComponent(libKey);
      const res = await zApi(`/api/zotero/doc/${encoded}`);
      state.info = res.info;
      state.job = res.job;
      els.docTitle.textContent = res.info.title;
      els.docTitle.title = res.info.title;

      els.statusBox.textContent = "正在加载 PDF 原文…";
      state.pdfDoc = await openPdfFromUrl(`/api/zotero/pdf/${encoded}`);

      // Preserve sentence boundaries and note anchors in translated papers.
      const hasSavedWork = res.doc?.sentences.some((sentence) => sentence.z)
        || res.doc?.annotations?.length || state.job?.running;
      const needsRefresh = !res.doc || (!hasSavedWork && (
        res.doc.sentences.some((sentence) => (sentence.t || "").includes("\uFFFD"))
        || localStorage.getItem(`z_ext_v_${libKey}`) !== "3"
      ));
      if (needsRefresh) {
        els.statusBox.textContent = `正在解析 PDF 排版并过滤图表文字（共 ${state.pdfDoc.numPages} 页）…`;
        const extracted = await extractDocument(state.pdfDoc, (p, total) => {
          els.statusBox.textContent = `正在解析 PDF 排版（${p} / ${total} 页）…`;
        });
        const saved = await zApi(`/api/zotero/doc/${encoded}`, { method: "POST", json: extracted });
        state.doc = saved.doc;
        localStorage.setItem(`z_ext_v_${libKey}`, "3");
      } else {
        state.doc = res.doc;
      }

      els.statusBox.hidden = true;
      els.readerBody.hidden = false;
      state.annotations = state.doc.annotations || [];
      setViewMode(state.viewMode);
      renderReader();
      renderAnnotations();
      buildOutline();
      els.glossaryToggle.disabled = false;
      restoreReadingPos(libKey);
      if (state.job?.running) startJobPoll();
    } catch (e) {
      els.statusBox.textContent = `打开失败：${e.message}`;
    }
  }

  async function buildOutline() {
    if (!els.outlineList || !state.doc) return;
    const entries = [];
    try {
      const raw = state.pdfDoc ? await state.pdfDoc.getOutline() : null;
      if (raw && raw.length) {
        const walk = async (items, depth = 0) => {
          for (const it of items) {
            let pageNum = null;
            try {
              const dest = typeof it.dest === "string" ? await state.pdfDoc.getDestination(it.dest) : it.dest;
              if (Array.isArray(dest) && dest[0]) {
                pageNum = (await state.pdfDoc.getPageIndex(dest[0])) + 1;
              }
            } catch {}
            if (it.title && pageNum) entries.push({ title: it.title.trim(), page: pageNum, depth });
            if (it.items?.length && depth < 2) await walk(it.items, depth + 1);
          }
        };
        await walk(raw);
      }
    } catch {}

    if (!entries.length) {
      for (const p of state.doc.paragraphs || []) {
        if (p.k !== "heading") continue;
        const s = state.doc.sentences[p.a];
        if (!s) continue;
        entries.push({ title: (stripTermMarkup(s.z) || s.t).slice(0, 72), page: p.p, sid: p.a, depth: 0 });
      }
    }

    if (!entries.length) {
      els.outlineList.innerHTML = `<div class="z-outline-empty">未检测到章节目录</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "z-outline-item";
      btn.style.paddingLeft = `${12 + item.depth * 14}px`;
      btn.innerHTML = `<span class="z-outline-text">${escapeHtml(item.title)}</span><span class="z-outline-pg">${item.page}</span>`;
      btn.addEventListener("click", () => {
        if (item.sid !== undefined) {
          focusSentence(item.sid, { scrollSource: true, scrollTarget: true });
        } else {
          const firstOnPage = state.doc.sentences.findIndex((s) => s.p === item.page);
          if (firstOnPage >= 0) focusSentence(firstOnPage, { scrollSource: true, scrollTarget: true });
          else state.pageNodes.get(item.page)?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      frag.append(btn);
    }
    els.outlineList.replaceChildren(frag);
  }

  function applyFontSize(size) {
    state.fontSize = Math.max(13.5, Math.min(22, Math.round(size * 2) / 2));
    localStorage.setItem("z_font_size", String(state.fontSize));
    els.panel.style.setProperty("--z-font-size", `${state.fontSize}px`);
    if (els.fontLabel) els.fontLabel.textContent = String(state.fontSize);
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    els.split.dataset.mode = mode;
    els.modePdf.classList.toggle("active", mode === "pdf");
    els.modeText.classList.toggle("active", mode === "text");
    els.modeZh.classList.toggle("active", mode === "zh");
    els.pdfStream.hidden = mode !== "pdf";
    els.enStream.hidden = mode !== "text";
    if (els.zoomWrap) els.zoomWrap.hidden = mode !== "pdf";
    if (state.activeSid !== null) {
      focusSentence(state.activeSid, { scrollSource: true, scrollTarget: false });
    }
  }

  function renderReader() {
    const doc = state.doc;
    if (!doc) return;
    els.pageBadge.textContent = `1 / ${doc.pages}`;
    renderStreams();
    renderPdfSkeleton();
    updateTranslateUI();
  }

  function renderStreams() {
    const doc = state.doc;
    state.sentNodesZh.clear();
    state.sentNodesEn.clear();

    const headerHtml = `
      <div class="z-doc-head">
        <h1>${escapeHtml(state.info?.title || doc.source.title)}</h1>
        <div class="z-doc-meta">
          ${state.info?.creators ? `<span>${escapeHtml(state.info.creators)}</span>` : ""}
          ${state.info?.year ? `<span>${escapeHtml(state.info.year)}</span>` : ""}
          <span>${doc.pages} 页 · ${doc.sentences.length} 句</span>
        </div>
      </div>
    `;

    const zhFrag = document.createDocumentFragment();
    const enFrag = document.createDocumentFragment();
    const h1 = document.createElement("div");
    h1.innerHTML = headerHtml;
    zhFrag.append(h1.firstElementChild);
    const h2 = document.createElement("div");
    h2.innerHTML = headerHtml;
    enFrag.append(h2.firstElementChild);

    let lastPage = 0;
    for (const p of doc.paragraphs) {
      if (p.k === "other") continue;
      if (p.p !== lastPage) {
        lastPage = p.p;
        const dZh = document.createElement("div");
        dZh.className = "z-page-div";
        dZh.textContent = `第 ${p.p} 页`;
        zhFrag.append(dZh);
        const dEn = document.createElement("div");
        dEn.className = "z-page-div";
        dEn.textContent = `Page ${p.p}`;
        enFrag.append(dEn);
      }

      const pZh = document.createElement("p");
      pZh.className = `z-para kind-${p.k}`;
      const pEn = document.createElement("p");
      pEn.className = `z-para kind-${p.k}`;

      for (let sid = p.a; sid < Math.min(p.b, doc.sentences.length); sid++) {
        const s = doc.sentences[sid];
        const spZh = document.createElement("span");
        spZh.className = "z-sent";
        spZh.dataset.sid = String(sid);
        fillZhSpan(spZh, s);
        pZh.append(spZh);
        if (!s.z) pZh.append(" ");
        state.sentNodesZh.set(sid, spZh);

        const spEn = document.createElement("span");
        spEn.className = "z-sent";
        spEn.dataset.sid = String(sid);
        spEn.textContent = s.t;
        pEn.append(spEn, " ");
        state.sentNodesEn.set(sid, spEn);
      }
      zhFrag.append(pZh);
      enFrag.append(pEn);
    }

    els.zhStream.replaceChildren(zhFrag);
    els.enStream.replaceChildren(enFrag);
  }

  const TERM_RE = /\[\[([^|\[\]｜]+)[|｜]([^\[\]]+)\]\]/g;

  function stripTermMarkup(text) {
    if (!text) return "";
    return String(text).replace(TERM_RE, "$1");
  }

  function renderTextWithSearch(text, highlightQuery, isCurrent) {
    const escaped = escapeHtml(text);
    if (!highlightQuery) return escaped;
    const re = new RegExp(escapeRegExp(highlightQuery), "gi");
    const cls = isCurrent ? "z-hit current" : "z-hit";
    return escaped.replace(re, (m) => `<mark class="${cls}">${m}</mark>`);
  }

  function fillZhSpan(span, s, highlightQuery = "", isCurrent = false) {
    span.classList.toggle("untranslated", !s.z && !s.e);
    span.classList.toggle("failed", !s.z && !!s.e);
    const text = s.z || s.t;
    if (!s.z || !text.includes("[[")) {
      if (highlightQuery) {
        span.innerHTML = renderTextWithSearch(text, highlightQuery, isCurrent);
      } else {
        span.textContent = text;
      }
      return;
    }
    let html = "";
    let last = 0;
    TERM_RE.lastIndex = 0;
    let m;
    while ((m = TERM_RE.exec(text)) !== null) {
      if (m.index > last) {
        html += renderTextWithSearch(text.slice(last, m.index), highlightQuery, isCurrent);
      }
      const zhTerm = m[1].trim();
      const enTerm = m[2].trim();
      html += `<span class="z-term" data-en="${escapeHtml(enTerm)}">${renderTextWithSearch(zhTerm, highlightQuery, isCurrent)}</span>`;
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      html += renderTextWithSearch(text.slice(last), highlightQuery, isCurrent);
    }
    span.innerHTML = html;
  }

  function renderPdfSkeleton() {
    const doc = state.doc;
    if (!doc || !state.pdfDoc) return;
    if (state.pageObserver) state.pageObserver.disconnect();
    state.visiblePages.clear();
    state.pageNodes.clear();
    state.pdfRectNodes.clear();

    state.fitWidth = pdfFitWidth();
    const frag = document.createDocumentFragment();

    const sentsByPage = new Map();
    doc.sentences.forEach((s, sid) => {
      if (!sentsByPage.has(s.p)) sentsByPage.set(s.p, []);
      sentsByPage.get(s.p).push({ sid, s });
    });

    for (let p = 1; p <= doc.pages; p++) {
      const [pw, ph] = doc.page_sizes?.[p - 1] || [612, 792];
      const baseScale = Math.min(1.5, state.fitWidth / pw);
      const cssW = Math.round(pw * baseScale * state.zoom);
      const cssH = Math.round(ph * baseScale * state.zoom);

      const wrap = document.createElement("div");
      wrap.className = "z-pdf-page";
      wrap.dataset.page = String(p);
      wrap.style.width = `${cssW}px`;
      wrap.style.height = `${cssH}px`;

      const canvas = document.createElement("canvas");
      const overlay = document.createElement("div");
      overlay.className = "z-pdf-overlay";

      for (const { sid, s } of sentsByPage.get(p) || []) {
        const rectEls = [];
        for (const [x, y, w, h] of s.r || []) {
          const rEl = document.createElement("div");
          rEl.className = "z-pdf-rect";
          rEl.dataset.sid = String(sid);
          rEl.style.left = `${(x * 100).toFixed(3)}%`;
          rEl.style.top = `${(y * 100).toFixed(3)}%`;
          rEl.style.width = `${(w * 100).toFixed(3)}%`;
          rEl.style.height = `${(h * 100).toFixed(3)}%`;
          overlay.append(rEl);
          rectEls.push(rEl);
        }
        state.pdfRectNodes.set(sid, rectEls);
      }

      wrap.append(canvas, overlay);
      frag.append(wrap);
      state.pageNodes.set(p, { wrap, canvas, cssW, pw, ph });
    }

    els.pdfStream.replaceChildren(frag);
    els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;

    state.pageObserver = new IntersectionObserver(
      (entries) => {
        let topVisible = null;
        for (const entry of entries) {
          const p = Number(entry.target.dataset.page);
          if (state.pageNodes.get(p)?.wrap !== entry.target) continue;
          if (entry.isIntersecting) {
            state.visiblePages.add(p);
            renderPdfPage(p);
            if (topVisible === null || p < topVisible) topVisible = p;
          } else {
            state.visiblePages.delete(p);
          }
        }
        if (topVisible !== null) els.pageBadge.textContent = `${topVisible} / ${doc.pages}`;
      },
      { root: els.paneLeft, rootMargin: "600px 0px" },
    );
    for (const { wrap } of state.pageNodes.values()) state.pageObserver.observe(wrap);
    if (state.annotations.length) renderAnnotations();
  }

  async function renderPdfPage(pageNum) {
    const node = state.pageNodes.get(pageNum);
    if (!node || !state.pdfDoc || node.rendering || node.renderedWidth === node.cssW) return;
    if (zoomRenderTimer && node.renderedWidth) return;
    const width = node.cssW;
    const pdf = state.pdfDoc;
    node.rendering = true;
    try {
      const page = await pdf.getPage(pageNum);
      if (state.pageNodes.get(pageNum) !== node) return;
      const canvas = document.createElement("canvas");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / node.pw) * dpr });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
      if (state.pageNodes.get(pageNum) === node && (width === node.cssW || !node.renderedWidth)) {
        node.canvas.replaceWith(canvas);
        node.canvas = canvas;
        node.renderedWidth = width;
      }
    } catch (error) {
      console.warn("Could not render PDF page", error);
    } finally {
      node.rendering = false;
      if (width !== node.cssW && state.visiblePages.has(pageNum) && state.pageNodes.get(pageNum) === node) {
        renderPdfPage(pageNum);
      }
    }
  }

  let zoomRenderTimer = null;

  function pdfFitWidth() {
    return Math.max(360, (els.paneLeft.clientWidth || Math.round(window.innerWidth * 0.5)) - 44);
  }

  function applyPdfZoom(next, x, y) {
    if (state.viewMode !== "pdf" || !state.pageNodes.size) return;
    const pane = els.paneLeft;
    const fitWidth = pdfFitWidth();
    if (next === state.zoom && fitWidth === state.fitWidth) return;
    const bounds = pane.getBoundingClientRect();
    x ??= bounds.left + pane.clientWidth / 2;
    y ??= bounds.top + pane.clientHeight / 2;

    let anchor = document.elementFromPoint(x, y)?.closest(".z-pdf-page");
    if (!anchor) {
      // Find the page nearest the cursor even when it is over a gap or a margin.
      let lo = 1;
      let hi = state.pageNodes.size;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (state.pageNodes.get(mid).wrap.getBoundingClientRect().bottom < y) lo = mid + 1;
        else hi = mid;
      }
      anchor = state.pageNodes.get(lo).wrap;
    }
    const before = anchor.getBoundingClientRect();
    const ratioX = (x - before.left) / before.width;
    const ratioY = Math.max(0, Math.min(1, (y - before.top) / before.height));
    const gapY = y - (before.top + before.height * ratioY);
    pane.classList.add("is-zooming");
    state.zoom = next;
    state.fitWidth = fitWidth;
    for (const node of state.pageNodes.values()) {
      const scale = Math.min(1.5, fitWidth / node.pw) * next;
      node.cssW = Math.round(node.pw * scale);
      node.wrap.style.width = `${node.cssW}px`;
      node.wrap.style.height = `${Math.round(node.ph * scale)}px`;
    }
    const after = anchor.getBoundingClientRect();
    pane.scrollLeft += after.left + after.width * ratioX - x;
    pane.scrollTop += after.top + after.height * ratioY + gapY - y;
    pane.classList.remove("is-zooming");
    els.zoomLabel.textContent = `${Math.round(next * 100)}%`;
    clearTimeout(zoomRenderTimer);
    zoomRenderTimer = setTimeout(() => {
      zoomRenderTimer = null;
      for (const page of state.visiblePages) renderPdfPage(page);
    }, 150);
  }

  function stepPdfZoom(step, minimum, maximum, x, y) {
    const scale = Math.round((state.zoom + step) * 100) / 100;
    // If a shortcut took zoom beyond the toolbar range, let that control
    // stop in its own direction without jumping past the current scale.
    const next = step > 0 ? Math.min(maximum, scale) : Math.max(minimum, scale);
    if ((step > 0 && next > state.zoom) || (step < 0 && next < state.zoom)) {
      applyPdfZoom(next, x, y);
    }
  }

  /* ─────────────────────────── Bidirectional Cursor & Selection Linking ─────────────────────────── */

  function toggleSentClass(sid, cls, on) {
    state.sentNodesZh.get(sid)?.classList.toggle(cls, on);
    state.sentNodesEn.get(sid)?.classList.toggle(cls, on);
    const rects = state.pdfRectNodes.get(sid);
    if (rects) for (const r of rects) r.classList.toggle(cls, on);
  }

  function setHover(sid) {
    if (state.hoverSid === sid) return;
    if (state.hoverSid !== null) toggleSentClass(state.hoverSid, "is-hover", false);
    state.hoverSid = sid;
    if (sid !== null) toggleSentClass(sid, "is-hover", true);
  }

  function focusSentence(sid, { scrollSource = true, scrollTarget = true } = {}) {
    if (state.activeSid !== null) toggleSentClass(state.activeSid, "is-active", false);
    for (const el of els.zhStream.querySelectorAll(".z-peek")) el.remove();
    state.activeSid = sid;
    if (sid === null || !state.doc?.sentences[sid]) {
      els.focusBar.hidden = true;
      return;
    }
    const s = state.doc.sentences[sid];
    toggleSentClass(sid, "is-active", true);
    els.focusMeta.textContent = `P${s.p}`;
    els.focusMeta.title = `第 ${s.p} 页 · 第 ${sid + 1} 句`;
    const existingAnn = state.annotations.find((a) => a.sid === sid);
    if (els.noteBtn) els.noteBtn.dataset.tip = existingAnn?.note ? "编辑双语笔记" : "写双语笔记";
    if (els.starBtn) {
      els.starBtn.classList.toggle("starred", Boolean(existingAnn?.starred));
      els.starBtn.dataset.tip = existingAnn?.starred ? "取消收藏" : "收藏此句";
    }
    if (els.unmarkBtn) els.unmarkBtn.hidden = !existingAnn;
    els.focusBar.hidden = false;
    els.pageBadge.textContent = `${s.p} / ${state.doc.pages}`;

    if (scrollTarget) {
      state.sentNodesZh.get(sid)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (scrollSource) {
      if (state.viewMode === "pdf") {
        const rects = state.pdfRectNodes.get(sid);
        if (rects && rects.length) {
          renderPdfPage(s.p);
          rects[0].scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          state.pageNodes.get(s.p)?.wrap.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else if (state.viewMode === "text") {
        state.sentNodesEn.get(sid)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (state.viewMode === "zh") {
        const para = state.sentNodesZh.get(sid)?.closest(".z-para");
        if (para) {
          const peek = document.createElement("div");
          peek.className = "z-peek";
          peek.textContent = s.t;
          para.after(peek);
        }
      }
    }
  }

  const sidFrom = (target) => {
    const el = target?.closest?.("[data-sid]");
    return el ? Number(el.dataset.sid) : null;
  };

  for (const stream of [els.pdfStream, els.enStream, els.zhStream]) {
    stream.addEventListener("pointerover", (ev) => {
      const sid = sidFrom(ev.target);
      if (sid !== null) setHover(sid);
    });
    stream.addEventListener("pointerleave", () => setHover(null));
  }
  els.pdfStream.addEventListener("click", (ev) => {
    const sid = sidFrom(ev.target);
    if (sid !== null) focusSentence(sid, { scrollSource: false, scrollTarget: true });
  });
  els.enStream.addEventListener("click", (ev) => {
    const sid = sidFrom(ev.target);
    if (sid !== null) focusSentence(sid, { scrollSource: false, scrollTarget: true });
  });
  els.zhStream.addEventListener("click", (ev) => {
    const sid = sidFrom(ev.target);
    if (sid !== null) focusSentence(sid, { scrollSource: true, scrollTarget: false });
  });

  let selTimer;
  document.addEventListener("selectionchange", () => {
    if (els.readerView.hidden || !state.doc) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const node = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      const sid = sidFrom(node);
      if (sid === null) return;
      const inZh = els.zhStream.contains(node);
      focusSentence(sid, { scrollSource: inZh, scrollTarget: !inZh });
    }, 120);
  });

  /* ─────────────────────────── Bidirectional Search (CN & EN) ─────────────────────────── */

  function openSearch() {
    if (els.readerView.hidden) return;
    els.searchBar.hidden = false;
    els.searchInput.focus();
    els.searchInput.select();
  }

  function closeSearch() {
    els.searchBar.hidden = true;
    runSearch("", false);
  }

  function runSearch(query, jump = true) {
    const q = query.trim();
    state.searchQuery = q;
    const doc = state.doc;
    if (!doc) return;

    for (const [sid, sp] of state.sentNodesZh) fillZhSpan(sp, doc.sentences[sid]);
    for (const [sid, sp] of state.sentNodesEn) sp.textContent = doc.sentences[sid].t;
    for (const rects of state.pdfRectNodes.values()) {
      for (const r of rects) r.classList.remove("is-search", "is-search-current");
    }

    state.searchHits = [];
    state.searchIndex = -1;
    if (!q) {
      els.searchCount.textContent = "";
      return;
    }
    const low = q.toLowerCase();
    for (let sid = 0; sid < doc.sentences.length; sid++) {
      const s = doc.sentences[sid];
      const hitEn = s.t && s.t.toLowerCase().includes(low);
      const hitZh = s.z && s.z.toLowerCase().includes(low);
      if (hitEn || hitZh) {
        state.searchHits.push({ sid, hitEn, hitZh });
        const spZh = state.sentNodesZh.get(sid);
        if (spZh && (hitZh || (!s.z && hitEn))) fillZhSpan(spZh, s, q, false);
        const spEn = state.sentNodesEn.get(sid);
        if (spEn && hitEn) {
          const re = new RegExp(escapeRegExp(q), "gi");
          spEn.innerHTML = escapeHtml(s.t).replace(re, (m) => `<mark class="z-hit">${m}</mark>`);
        }
        for (const r of state.pdfRectNodes.get(sid) || []) r.classList.add("is-search");
      }
    }
    if (!state.searchHits.length) {
      els.searchCount.textContent = "0 / 0";
      return;
    }
    if (jump) stepSearch(0, true);
    else els.searchCount.textContent = `${state.searchHits.length} 处`;
  }

  function stepSearch(delta, absolute = false) {
    const hits = state.searchHits;
    if (!hits.length) return;
    const prev = hits[state.searchIndex];
    if (prev) {
      const spZh = state.sentNodesZh.get(prev.sid);
      if (spZh) fillZhSpan(spZh, state.doc.sentences[prev.sid], state.searchQuery, false);
      for (const r of state.pdfRectNodes.get(prev.sid) || []) r.classList.remove("is-search-current");
    }
    state.searchIndex = absolute ? delta : (state.searchIndex + delta + hits.length) % hits.length;
    const hit = hits[state.searchIndex];
    els.searchCount.textContent = `${state.searchIndex + 1} / ${hits.length}`;
    const spZh = state.sentNodesZh.get(hit.sid);
    if (spZh && (hit.hitZh || (!state.doc.sentences[hit.sid].z && hit.hitEn))) {
      fillZhSpan(spZh, state.doc.sentences[hit.sid], state.searchQuery, true);
    }
    for (const r of state.pdfRectNodes.get(hit.sid) || []) r.classList.add("is-search-current");
    focusSentence(hit.sid, { scrollSource: true, scrollTarget: true });
  }

  /* ─────────────────────────── Translation Polling ─────────────────────────── */

  function updateTranslateUI() {
    const stats = docStats(state.doc);
    const running = Boolean(state.job?.running);
    const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    els.progressFill.style.width = running ? `${Math.max(4, pct)}%` : "0%";
    if (running) {
      els.btnTranslate.textContent = `暂停翻译 (${pct}%)`;
      els.btnTranslate.className = "secondary";
    } else if (stats.total > 0 && stats.done >= stats.total) {
      els.btnTranslate.textContent = "已译完";
      els.btnTranslate.className = "secondary";
    } else if (stats.done > 0) {
      els.btnTranslate.textContent = `继续翻译 (${pct}%)`;
      els.btnTranslate.className = "primary";
    } else {
      els.btnTranslate.textContent = "开始翻译";
      els.btnTranslate.className = "primary";
    }
  }

  function startJobPoll() {
    stopJobPoll();
    state.pollJobTimer = setInterval(async () => {
      if (!state.activeKey) return stopJobPoll();
      try {
        const res = await zApi(`/api/zotero/doc/${encodeURIComponent(state.activeKey)}`);
        state.job = res.job;
        if (res.doc) {
          const prev = state.doc;
          state.doc = res.doc;
          for (let i = 0; i < res.doc.sentences.length; i++) {
            const cur = res.doc.sentences[i];
            if (!prev || prev.sentences[i]?.z !== cur.z || prev.sentences[i]?.e !== cur.e) {
              const sp = state.sentNodesZh.get(i);
              if (sp) {
                fillZhSpan(sp, cur);
                if (cur.z && !prev?.sentences[i]?.z) {
                  sp.classList.remove("z-just-translated");
                  void sp.offsetWidth;
                  sp.classList.add("z-just-translated");
                }
              }
            }
          }
        }
        updateTranslateUI();
        if (!state.job?.running) {
          stopJobPoll();
          if (state.job?.error) toast(`翻译中断：${state.job.error}`);
          else if (!state.job?.cancelled) toast("翻译已完成并自动保存");
        }
      } catch {
        stopJobPoll();
      }
    }, 600);
  }

  function stopJobPoll() {
    clearInterval(state.pollJobTimer);
    state.pollJobTimer = null;
  }

  /* ─────────────────────────── Wire Controls ─────────────────────────── */

  els.libSearch.addEventListener("input", renderLibrary);
  els.libFilterAll.addEventListener("click", () => {
    state.filter = "all";
    els.libFilterAll.classList.add("active");
    els.libFilterDone.classList.remove("active");
    renderLibrary();
  });
  els.libFilterDone.addEventListener("click", () => {
    state.filter = "done";
    els.libFilterDone.classList.add("active");
    els.libFilterAll.classList.remove("active");
    renderLibrary();
  });
  async function refreshPluginStatus() {
    try {
      const st = await zApi("/api/zotero/plugin-status");
      const ready = Boolean(st.plugin_installed && st.up_to_date);
      if (els.quickSetup) {
        els.quickSetup.textContent = ready ? "● 已接入" : "一键接入";
        els.quickSetup.className = ready ? "z-connected-pill" : "primary z-sm";
        els.quickSetup.title = ready
          ? "已接入 Zotero，点击可重新配置并唤起 Zotero"
          : "一键将本软件安装为 Zotero 轻量桥接插件并自动唤起 Zotero";
      }
      if (els.pluginBanner) {
        els.pluginBanner.hidden = ready;
        if (!ready) {
          els.pluginBannerText.textContent = !st.zotero_installed
            ? "未检测到 Zotero.app，安装 Zotero 后即可一键接入。"
            : st.plugin_installed
              ? "检测到 Zotero 桥接插件有新版本，点击即可一键更新并唤起 Zotero。"
              : "尚未将 PDF Translator 接入 Zotero，点击一键自动配置（无需先打开 Zotero）。";
          els.bannerInstall.disabled = !st.zotero_installed;
        }
      }
      if (els.settingsBridge) {
        els.settingsBridge.textContent = st.bridge_url || "未启动";
      }
      if (els.settingsBadge) {
        if (!st.zotero_installed) {
          els.settingsBadge.textContent = "未安装 Zotero";
          els.settingsBadge.className = "zset-badge warn";
        } else if (ready) {
          els.settingsBadge.textContent = "● 已接入";
          els.settingsBadge.className = "zset-badge ok";
        } else if (st.plugin_installed) {
          els.settingsBadge.textContent = "● 可更新";
          els.settingsBadge.className = "zset-badge warn";
        } else {
          els.settingsBadge.textContent = "○ 未接入";
          els.settingsBadge.className = "zset-badge err";
        }
      }
      if (els.settingsStatus) {
        if (!st.zotero_installed) {
          els.settingsStatus.textContent = "未在本机检测到 Zotero.app";
        } else if (ready) {
          els.settingsStatus.textContent = `已接入 ${st.profile_count} 个 Zotero 配置 · ${st.zotero_running ? "Zotero 运行中" : "Zotero 未打开"}`;
        } else if (st.plugin_installed) {
          els.settingsStatus.textContent = "检测到旧版桥接插件，建议一键更新";
        } else {
          els.settingsStatus.textContent = "尚未安装桥接插件，点击下方按钮一键完成";
        }
      }
      if (els.settingsInstall) {
        els.settingsInstall.disabled = !st.zotero_installed;
        els.settingsInstall.textContent = ready ? "重新配置并唤起 Zotero" : "一键配置并唤起 Zotero";
      }
      if (els.settingsUninstall) {
        els.settingsUninstall.hidden = !st.plugin_installed;
      }
    } catch {}
  }

  async function runOneClickInstall() {
    const btns = [els.quickSetup, els.bannerInstall, els.settingsInstall].filter(Boolean);
    for (const b of btns) b.disabled = true;
    if (els.settingsStatus) els.settingsStatus.textContent = "正在配置 Zotero 插件并唤起 Zotero…";
    toast("正在一键配置并唤起 Zotero…");
    try {
      await zApi("/api/zotero/plugin-install", { method: "POST" });
      toast("已成功配置 Zotero 插件并自动唤起 Zotero");
      await refreshPluginStatus();
      await refreshLibrary();
    } catch (e) {
      if (els.settingsStatus) els.settingsStatus.textContent = `配置失败：${e.message}`;
      toast(`配置失败：${e.message}`);
    } finally {
      for (const b of btns) b.disabled = false;
    }
  }

  async function runUninstall() {
    if (!confirm("确定从 Zotero 中卸载 PDF Translator 桥接插件吗？\n（不会删除已翻译的文件）")) return;
    if (els.settingsUninstall) els.settingsUninstall.disabled = true;
    try {
      await zApi("/api/zotero/plugin-uninstall", { method: "POST" });
      toast("已卸载 Zotero 桥接插件");
      await refreshPluginStatus();
    } catch (e) {
      toast(`卸载失败：${e.message}`);
    } finally {
      if (els.settingsUninstall) els.settingsUninstall.disabled = false;
    }
  }

  els.quickSetup?.addEventListener("click", runOneClickInstall);
  els.bannerInstall?.addEventListener("click", runOneClickInstall);
  els.settingsInstall?.addEventListener("click", runOneClickInstall);
  els.settingsUninstall?.addEventListener("click", runUninstall);
  els.settingsOpenDir?.addEventListener("click", () => zApi("/api/zotero/reveal", { method: "POST", json: {} }));

  els.libRefresh.addEventListener("click", () => {
    refreshLibrary();
    refreshPluginStatus();
  });
  els.libOpenFolder.addEventListener("click", () => zApi("/api/zotero/reveal", { method: "POST", json: {} }));
  refreshPluginStatus();

  els.libSort?.addEventListener("change", () => {
    state.sort = els.libSort.value;
    renderLibrary();
  });

  els.outlineToggle?.addEventListener("click", () => {
    els.outlineDrawer.hidden = !els.outlineDrawer.hidden;
    els.outlineToggle.classList.toggle("active", !els.outlineDrawer.hidden);
  });
  els.outlineClose?.addEventListener("click", () => {
    els.outlineDrawer.hidden = true;
    els.outlineToggle?.classList.remove("active");
  });

  els.moreBtn?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = els.moreMenu.hidden;
    els.moreMenu.hidden = !open;
    els.moreBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (ev) => {
    if (!els.moreMenu?.hidden && !els.moreMenu.contains(ev.target) && ev.target !== els.moreBtn) {
      els.moreMenu.hidden = true;
      els.moreBtn?.setAttribute("aria-expanded", "false");
    }
  });

  els.fontDec?.addEventListener("click", () => applyFontSize(state.fontSize - 1));
  els.fontInc?.addEventListener("click", () => applyFontSize(state.fontSize + 1));
  applyFontSize(state.fontSize);

  els.btnBack.addEventListener("click", showLibraryView);
  els.modePdf.addEventListener("click", () => setViewMode("pdf"));
  els.modeText.addEventListener("click", () => setViewMode("text"));
  els.modeZh.addEventListener("click", () => setViewMode("zh"));

  els.zoomIn.addEventListener("click", () => stepPdfZoom(0.15, 0.65, 2));
  els.zoomOut.addEventListener("click", () => stepPdfZoom(-0.15, 0.65, 2));

  els.fontToggle.addEventListener("click", () => {
    state.serif = !state.serif;
    els.zhStream.classList.toggle("serif", state.serif);
    els.fontToggle.textContent = state.serif ? "切换黑体" : "切换宋体";
  });

  els.btnSearch.addEventListener("click", () => (els.searchBar.hidden ? openSearch() : closeSearch()));
  els.searchInput.addEventListener("input", () => runSearch(els.searchInput.value, true));
  els.searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      stepSearch(ev.shiftKey ? -1 : 1);
    } else if (ev.key === "Escape") {
      closeSearch();
    }
  });
  els.searchPrev.addEventListener("click", () => stepSearch(-1));
  els.searchNext.addEventListener("click", () => stepSearch(1));
  els.searchClose.addEventListener("click", closeSearch);

  function currentPageNumber() {
    const m = (els.pageBadge?.textContent || "").match(/^(\d+)/);
    return m ? Number(m[1]) : 1;
  }

  function saveReadingPos() {
    if (!state.activeKey || els.readerView.hidden) return;
    try {
      localStorage.setItem(`z_pos_${state.activeKey}`, JSON.stringify({
        left: els.paneLeft.scrollTop,
        right: els.paneRight.scrollTop,
        page: currentPageNumber(),
      }));
    } catch {}
  }

  function restoreReadingPos(libKey) {
    try {
      const raw = localStorage.getItem(`z_pos_${libKey}`);
      if (!raw) return;
      const pos = JSON.parse(raw);
      requestAnimationFrame(() => {
        if (typeof pos.left === "number") els.paneLeft.scrollTop = pos.left;
        if (typeof pos.right === "number") els.paneRight.scrollTop = pos.right;
      });
    } catch {}
  }

  let posTimer;
  for (const pane of [els.paneLeft, els.paneRight]) {
    pane.addEventListener("scroll", () => {
      clearTimeout(posTimer);
      posTimer = setTimeout(saveReadingPos, 250);
    }, { passive: true });
  }

  els.zoomLabel.addEventListener("click", () => applyPdfZoom(1));

  els.reparseBtn?.addEventListener("click", async () => {
    if (!state.activeKey || !state.pdfDoc) return;
    els.moreMenu.hidden = true;
    toast("正在重新解析 PDF 并过滤图片文字…");
    const extracted = await extractDocument(state.pdfDoc);
    const saved = await zApi(`/api/zotero/doc/${encodeURIComponent(state.activeKey)}`, { method: "POST", json: extracted });
    state.doc = saved.doc;
    state.annotations = state.doc.annotations || [];
    renderReader();
    renderAnnotations();
    buildOutline();
    toast("已重新解析完成，图片内杂乱文字已过滤");
  });

  els.btnTranslate.addEventListener("click", async () => {
    if (!state.activeKey) return;
    const encoded = encodeURIComponent(state.activeKey);
    if (state.job?.running) {
      await zApi(`/api/zotero/cancel/${encoded}`, { method: "POST" });
      toast("正在暂停翻译…");
      return;
    }
    try {
      const res = await zApi(`/api/zotero/translate/${encoded}`, {
        method: "POST",
        json: { priority_page: currentPageNumber() },
      });
      state.job = res.job;
      updateTranslateUI();
      if (state.job?.running) startJobPoll();
      else toast("全文已翻译完成");
    } catch (e) {
      toast(e.message);
    }
  });

  els.btnWorkspace.addEventListener("click", async () => {
    if (!state.activeKey) return;
    try {
      await zApi(`/api/zotero/import-to-workspace/${encodeURIComponent(state.activeKey)}`, { method: "POST" });
      toast("已载入 Workspace，可生成原排版双语 PDF");
      onOpenInWorkspace();
    } catch (e) {
      toast(e.message);
    }
  });

  els.btnExport.addEventListener("click", async () => {
    if (!state.activeKey) return;
    try {
      await zApi(`/api/zotero/export/${encodeURIComponent(state.activeKey)}`, { method: "POST" });
      toast("已导出双语 Markdown 到独立译文文件夹");
    } catch (e) {
      toast(e.message);
    }
  });

  els.btnFolder.addEventListener("click", () => {
    zApi("/api/zotero/reveal", { method: "POST", json: {} });
  });

  // Focus rail actions (retranslate & clear)
  els.focusRetranslate?.addEventListener("click", async () => {
    if (!state.activeKey || state.activeSid === null) return;
    const sid = state.activeSid;
    const res = await zApi(`/api/zotero/translate/${encodeURIComponent(state.activeKey)}`, {
      method: "POST",
      json: { only_indices: [sid] },
    });
    state.job = res.job;
    updateTranslateUI();
    if (state.job?.running) startJobPoll();
  });
  els.focusClear.addEventListener("click", () => focusSentence(null));

  // Splitter drag
  let dragging = false;
  els.splitter.addEventListener("pointerdown", (ev) => {
    dragging = true;
    els.splitter.classList.add("dragging");
    els.splitter.setPointerCapture(ev.pointerId);
  });
  els.splitter.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const rect = els.split.getBoundingClientRect();
    const ratio = Math.max(0.28, Math.min(0.72, (ev.clientX - rect.left) / rect.width));
    els.paneLeft.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
  });
  const endDrag = () => {
    dragging = false;
    els.splitter.classList.remove("dragging");
  };
  els.splitter.addEventListener("pointerup", endDrag);
  els.splitter.addEventListener("pointercancel", endDrag);

  // Shortcuts (⌘F search, ⌘+/⌘−/⌘0 PDF zoom, Esc close)
  window.addEventListener("keydown", (ev) => {
    if (els.panel.hidden || els.readerView.hidden || els.glossary.open) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      openSearch();
    } else if ((ev.metaKey || ev.ctrlKey) && state.viewMode === "pdf" && (ev.key === "=" || ev.key === "+")) {
      ev.preventDefault();
      stepPdfZoom(0.15, 0.6, 2.2);
    } else if ((ev.metaKey || ev.ctrlKey) && state.viewMode === "pdf" && ev.key === "-") {
      ev.preventDefault();
      stepPdfZoom(-0.15, 0.6, 2.2);
    } else if ((ev.metaKey || ev.ctrlKey) && state.viewMode === "pdf" && ev.key === "0") {
      ev.preventDefault();
      applyPdfZoom(1);
    } else if (ev.key === "Escape") {
      if (!els.noteEditor?.hidden) closeNoteEditor();
      else if (!els.searchBar.hidden) closeSearch();
      else if (state.activeSid !== null) focusSentence(null);
    }
  });

  /* ─────────────────────────── Synced Bilingual Highlights & Notes ─────────────────────────── */

  const HL_CLASSES = ["hl-yellow", "hl-red", "hl-blue", "hl-green"];

  function renderAnnotations() {
    if (!state.doc) return;
    // 1. Clear all existing highlight classes and inline/PDF note widgets
    for (const sp of state.sentNodesZh.values()) sp.classList.remove(...HL_CLASSES);
    for (const sp of state.sentNodesEn.values()) sp.classList.remove(...HL_CLASSES);
    for (const rects of state.pdfRectNodes.values()) {
      for (const r of rects) r.classList.remove(...HL_CLASSES);
    }
    for (const el of els.zhStream.querySelectorAll(".z-inline-note")) el.remove();
    for (const el of els.enStream.querySelectorAll(".z-inline-note")) el.remove();
    for (const el of els.pdfStream.querySelectorAll(".z-pdf-note-pin")) el.remove();

    const anns = state.annotations || [];
    if (els.notesCount) els.notesCount.textContent = anns.length ? `(${anns.length})` : "";

    // 2. Apply each annotation synchronously to PDF overlay, English pane, and Chinese pane
    for (const ann of anns) {
      const cls = `hl-${ann.color || "yellow"}`;
      const spZh = state.sentNodesZh.get(ann.sid);
      const spEn = state.sentNodesEn.get(ann.sid);
      const rects = state.pdfRectNodes.get(ann.sid);
      spZh?.classList.add(cls);
      spEn?.classList.add(cls);
      if (rects) for (const r of rects) r.classList.add(cls);

      if (ann.note) {
        // Synced inline note card on Chinese pane
        const paraZh = spZh?.closest(".z-para");
        if (paraZh) paraZh.after(makeInlineNoteCard(ann));

        // Synced inline note card on English text pane
        const paraEn = spEn?.closest(".z-para");
        if (paraEn) paraEn.after(makeInlineNoteCard(ann));

        // Synced note pin + tooltip on Original PDF page at exact vertical coordinate
        const s = state.doc.sentences[ann.sid];
        const pageNode = s ? state.pageNodes.get(s.p) : null;
        if (pageNode && s.r?.length) {
          const overlay = pageNode.wrap.querySelector(".z-pdf-overlay");
          if (overlay) {
            const [, topY] = s.r[0];
            const pin = document.createElement("button");
            pin.type = "button";
            pin.className = `z-pdf-note-pin ${cls}`;
            pin.style.top = `${(topY * 100).toFixed(3)}%`;
            pin.title = ann.note;
            pin.innerHTML = `<span class="z-pin-dot"></span><span class="z-pin-preview">${escapeHtml(ann.note)}</span>`;
            pin.addEventListener("click", (ev) => {
              ev.stopPropagation();
              focusSentence(ann.sid, { scrollSource: false, scrollTarget: true });
              openNoteEditor(ann.sid);
            });
            overlay.append(pin);
          }
        }
      }
    }

    // 3. Render Notes drawer list
    if (els.notesList) {
      if (!anns.length) {
        els.notesList.innerHTML = `<div class="z-outline-empty">暂无标注或笔记<br>点击任意句子即可高亮或添加双语同步笔记</div>`;
      } else {
        const frag = document.createDocumentFragment();
        for (const ann of anns) {
          const s = state.doc.sentences[ann.sid];
          if (!s) continue;
          const card = document.createElement("div");
          card.className = `z-note-list-item hl-${ann.color || "yellow"}`;
          card.innerHTML = `
            <div class="z-note-list-meta">${ann.starred ? "★ 已收藏 · " : ""}第 ${s.p} 页 · 第 ${ann.sid + 1} 句</div>
            <div class="z-note-list-quote">${escapeHtml((s.z || s.t).slice(0, 72))}</div>
            ${ann.note ? `<div class="z-note-list-body">${escapeHtml(ann.note)}</div>` : ""}
          `;
          card.addEventListener("click", () => {
            focusSentence(ann.sid, { scrollSource: true, scrollTarget: true });
          });
          frag.append(card);
        }
        els.notesList.replaceChildren(frag);
      }
    }

    // Update focus rail buttons if a sentence is currently active
    if (state.activeSid !== null) {
      const existing = anns.find((a) => a.sid === state.activeSid);
      if (els.noteBtn) els.noteBtn.dataset.tip = existing?.note ? "编辑双语笔记" : "写双语笔记";
      if (els.starBtn) {
        els.starBtn.classList.toggle("starred", Boolean(existing?.starred));
        els.starBtn.dataset.tip = existing?.starred ? "取消收藏" : "收藏此句";
      }
      if (els.unmarkBtn) els.unmarkBtn.hidden = !existing;
    }
  }

  function makeInlineNoteCard(ann) {
    const card = document.createElement("div");
    card.className = `z-inline-note hl-${ann.color || "yellow"}`;
    card.innerHTML = `
      <div class="z-inline-note-text">${escapeHtml(ann.note)}</div>
      <div class="z-inline-note-actions">
        <button type="button" data-act="edit">编辑</button>
        <button type="button" data-act="del">删除</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      focusSentence(ann.sid, { scrollSource: true, scrollTarget: true });
      openNoteEditor(ann.sid);
    });
    card.querySelector('[data-act="del"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await removeAnnotation(ann.id);
    });
    return card;
  }

  async function saveAnnotation(sid, color, note, starred = undefined) {
    if (!state.activeKey) return;
    const existing = state.annotations.find((a) => a.sid === sid);
    const nextStarred = starred !== undefined ? starred : Boolean(existing?.starred);
    const res = await zApi(`/api/zotero/annotations/${encodeURIComponent(state.activeKey)}`, {
      method: "POST",
      json: { id: existing?.id || null, sid, color, note, starred: nextStarred },
    });
    state.annotations = res.annotations || [];
    renderAnnotations();
  }

  async function removeAnnotation(annId) {
    if (!state.activeKey || !annId) return;
    const res = await zApi(`/api/zotero/annotations/${encodeURIComponent(state.activeKey)}/${encodeURIComponent(annId)}`, {
      method: "DELETE",
    });
    state.annotations = res.annotations || [];
    renderAnnotations();
    toast("已同步删除原文与译文标注");
  }

  function openNoteEditor(sid) {
    const s = state.doc?.sentences[sid];
    if (!s || !els.noteEditor) return;
    const existing = state.annotations.find((a) => a.sid === sid);
    state.noteDraftSid = sid;
    state.noteDraftColor = existing?.color || "yellow";
    els.noteQuote.textContent = s.z ? `${stripTermMarkup(s.z)}\n${s.t}` : s.t;
    els.noteInput.value = existing?.note || "";
    els.noteDelete.hidden = !existing;
    for (const d of document.querySelectorAll("[data-note-color]")) {
      d.classList.toggle("active", d.dataset.noteColor === state.noteDraftColor);
    }
    els.noteEditor.hidden = false;
    els.noteInput.focus();
  }

  function closeNoteEditor() {
    if (els.noteEditor) els.noteEditor.hidden = true;
    state.noteDraftSid = null;
  }

  for (const dot of document.querySelectorAll("[data-hl]")) {
    dot.addEventListener("click", async () => {
      if (state.activeSid === null) return;
      const existing = state.annotations.find((a) => a.sid === state.activeSid);
      await saveAnnotation(state.activeSid, dot.dataset.hl, existing?.note || "");
      toast("已同步高亮原文与译文");
    });
  }
  for (const dot of document.querySelectorAll("[data-note-color]")) {
    dot.addEventListener("click", () => {
      state.noteDraftColor = dot.dataset.noteColor;
      for (const d of document.querySelectorAll("[data-note-color]")) {
        d.classList.toggle("active", d.dataset.noteColor === state.noteDraftColor);
      }
    });
  }
  els.noteBtn?.addEventListener("click", () => {
    if (state.activeSid !== null) openNoteEditor(state.activeSid);
  });
  els.starBtn?.addEventListener("click", async () => {
    if (state.activeSid === null) return;
    const existing = state.annotations.find((a) => a.sid === state.activeSid);
    const nextStar = !existing?.starred;
    await saveAnnotation(state.activeSid, existing?.color || "yellow", existing?.note || "", nextStar);
    toast(nextStar ? "已收藏此句（可在左侧「笔记」查看）" : "已取消收藏");
  });
  els.unmarkBtn?.addEventListener("click", async () => {
    const existing = state.annotations.find((a) => a.sid === state.activeSid);
    if (existing) await removeAnnotation(existing.id);
  });
  els.noteSave?.addEventListener("click", async () => {
    if (state.noteDraftSid === null) return;
    await saveAnnotation(state.noteDraftSid, state.noteDraftColor, els.noteInput.value);
    closeNoteEditor();
    toast("笔记已同步保存至原文与译文");
  });
  els.noteDelete?.addEventListener("click", async () => {
    const existing = state.annotations.find((a) => a.sid === state.noteDraftSid);
    closeNoteEditor();
    if (existing) await removeAnnotation(existing.id);
  });
  els.noteCancel?.addEventListener("click", closeNoteEditor);

  els.tabOutline?.addEventListener("click", () => {
    els.tabOutline.classList.add("active");
    els.tabNotes?.classList.remove("active");
    els.outlineList.hidden = false;
    if (els.notesList) els.notesList.hidden = true;
  });
  els.tabNotes?.addEventListener("click", () => {
    els.tabNotes.classList.add("active");
    els.tabOutline?.classList.remove("active");
    els.outlineList.hidden = true;
    if (els.notesList) els.notesList.hidden = false;
  });

  let middleDownOnPdf = false;
  let lastWheelZoomAt = -Infinity;

  for (const pane of [els.paneLeft, els.paneRight]) {
    if (!pane) continue;
    let panning = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    pane.addEventListener("mousedown", (e) => {
      if (e.button !== 1 || (pane === els.paneLeft && state.viewMode === "pdf")) return;
      e.preventDefault();
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = pane.scrollLeft;
      startScrollTop = pane.scrollTop;
      pane.classList.add("is-panning");
    });

    pane.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      pane.scrollLeft = startScrollLeft - (e.clientX - startX);
      pane.scrollTop = startScrollTop - (e.clientY - startY);
    });

    const stopPan = () => {
      if (!panning) return;
      panning = false;
      pane.classList.remove("is-panning");
    };
    window.addEventListener("mouseup", stopPan);
    window.addEventListener("blur", stopPan);
  }

  {
    const pane = els.paneLeft;
    let pan = null;
    let frame = 0;
    let dx = 0;
    let dy = 0;
    const flushPan = () => {
      frame = 0;
      pane.scrollLeft += dx;
      pane.scrollTop += dy;
      dx = dy = 0;
    };
    pane.addEventListener("pointerdown", (event) => {
      if (event.button !== 1 || pan || state.viewMode !== "pdf") return;
      event.preventDefault();
      pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
      middleDownOnPdf = true;
      pane.setPointerCapture(event.pointerId);
      pane.classList.add("is-panning");
    });
    pane.addEventListener("pointermove", (event) => {
      if (pan?.id !== event.pointerId) return;
      dx += pan.x - event.clientX;
      dy += pan.y - event.clientY;
      pan.x = event.clientX;
      pan.y = event.clientY;
      if (!frame) frame = requestAnimationFrame(flushPan);
    });
    const stopPan = (event) => {
      if (!pan || (event.pointerId !== undefined && pan.id !== event.pointerId)) return;
      const id = pan.id;
      pan = null;
      middleDownOnPdf = false;
      if (frame) cancelAnimationFrame(frame);
      flushPan();
      pane.classList.remove("is-panning");
      if (pane.hasPointerCapture(id)) pane.releasePointerCapture(id);
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      pane.addEventListener(event, stopPan);
    }
    window.addEventListener("blur", stopPan);
  }

  els.paneLeft.addEventListener("wheel", (event) => {
    if (state.viewMode !== "pdf" || !(middleDownOnPdf || event.buttons & 4 || event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (!event.deltaY || event.timeStamp - lastWheelZoomAt < 80) return;
    lastWheelZoomAt = event.timeStamp;
    const step = event.deltaY < 0 ? 0.12 : -0.12;
    stepPdfZoom(step, 0.6, 2.2, event.clientX, event.clientY);
  }, { passive: false });

  function applyGlossary(key, terms) {
    if (state.activeKey !== key || !state.doc) return;
    const items = document.createDocumentFragment();
    for (const term of terms) {
      const row = document.createElement("li");
      const source = document.createElement("small");
      source.textContent = term.source;
      row.append(term.target, source);
      items.append(row);
    }
    els.glossaryList.replaceChildren(items);
    els.glossaryExport.hidden = terms.length === 0;
    els.glossaryExport.href = `/api/zotero/glossary/${encodeURIComponent(key)}/export`;
    els.glossaryStatus.textContent = terms.length ? "" : "暂无术语。";
  }

  async function refreshGlossary(key) {
    els.glossaryStatus.textContent = "正在读取术语…";
    try {
      const data = await zApi(`/api/zotero/glossary/${encodeURIComponent(key)}`);
      if (state.glossaryRun !== key) applyGlossary(key, data.terms);
    } catch (error) {
      if (state.activeKey === key) els.glossaryStatus.textContent = error.message;
    }
  }

  els.glossaryToggle.addEventListener("click", () => {
    if (!state.activeKey || !state.doc) return;
    els.glossaryRecover.disabled = state.glossaryRun !== null || !docStats(state.doc).done;
    els.moreMenu.hidden = true;
    els.moreBtn.setAttribute("aria-expanded", "false");
    els.moreBtn.focus({ preventScroll: true });
    els.glossary.showModal();
    if (state.glossaryRun === state.activeKey) {
      els.glossaryStatus.textContent = "正在补提取术语，可继续阅读。";
    } else {
      refreshGlossary(state.activeKey);
    }
  });
  els.glossaryRecover.addEventListener("click", async () => {
    const key = state.activeKey;
    if (!key || state.glossaryRun) return;
    state.glossaryRun = key;
    els.glossaryRecover.disabled = true;
    els.glossaryStatus.textContent = "正在补提取术语，可关闭术语表继续阅读。";
    try {
      const data = await zApi(`/api/zotero/glossary/${encodeURIComponent(key)}`, { method: "POST" });
      applyGlossary(key, data.terms);
      if (state.activeKey === key) els.glossaryStatus.textContent = "术语表已更新。";
    } catch (error) {
      if (state.activeKey === key) els.glossaryStatus.textContent = error.message;
    } finally {
      state.glossaryRun = null;
      els.glossaryRecover.disabled = !docStats(state.doc).done;
    }
  });

  // Terminology highlight toggle + hover tooltip + click-to-copy English term
  function syncTermToggleUI() {
    els.zhStream?.classList.toggle("hide-terms", !state.showTerms);
    if (els.termToggle) {
      els.termToggle.textContent = state.showTerms ? "已开启" : "已关闭";
    }
  }
  syncTermToggleUI();

  els.termToggle?.addEventListener("click", () => {
    state.showTerms = !state.showTerms;
    localStorage.setItem("z_show_terms", state.showTerms ? "1" : "0");
    syncTermToggleUI();
    if (!state.showTerms && els.termTip) els.termTip.hidden = true;
    toast(state.showTerms ? "已开启术语高亮（悬浮查看英文原词）" : "已隐藏术语高亮");
  });

  function hideTermTip() {
    if (els.termTip) els.termTip.hidden = true;
  }

  els.zhStream?.addEventListener("mouseover", (ev) => {
    if (!state.showTerms || !els.termTip) return;
    const termEl = ev.target.closest?.(".z-term");
    if (!termEl || !termEl.dataset.en) return;
    const en = termEl.dataset.en;
    els.termTip.innerHTML = `<span class="z-term-tip-en">${escapeHtml(en)}</span><span class="z-term-tip-hint">点击复制</span>`;
    els.termTip.hidden = false;
    const rect = termEl.getBoundingClientRect();
    const placeBelow = rect.top < 54;
    els.termTip.dataset.place = placeBelow ? "below" : "above";
    const tipWidth = els.termTip.offsetWidth || 160;
    const cx = Math.max(tipWidth / 2 + 12, Math.min(window.innerWidth - tipWidth / 2 - 12, rect.left + rect.width / 2));
    els.termTip.style.left = `${Math.round(cx)}px`;
    els.termTip.style.top = `${Math.round(placeBelow ? rect.bottom + 8 : rect.top - 8)}px`;
  });

  els.zhStream?.addEventListener("mouseout", (ev) => {
    const termEl = ev.target.closest?.(".z-term");
    if (!termEl) return;
    if (ev.relatedTarget && termEl.contains(ev.relatedTarget)) return;
    hideTermTip();
  });

  els.paneRight?.addEventListener("scroll", hideTermTip, { passive: true });

  els.zhStream?.addEventListener("click", (ev) => {
    if (!state.showTerms) return;
    const termEl = ev.target.closest?.(".z-term");
    if (!termEl || !termEl.dataset.en) return;
    ev.stopPropagation();
    const en = termEl.dataset.en;
    navigator.clipboard?.writeText(en).catch(() => {});
    toast(`已复制英文术语：${en}`);
  }, true);

  // Poll for incoming Zotero bridge handoffs (500ms for instant jump)
  setInterval(async () => {
    try {
      const data = await zApi("/api/zotero/pending");
      if (data?.pending?.lib_key) {
        onSwitchToZoteroTab();
        openPaper(data.pending.lib_key);
      }
    } catch {}
  }, 500);

  return { refreshLibrary, openPaper };
}
