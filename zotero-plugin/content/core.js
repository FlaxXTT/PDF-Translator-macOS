/* PDF Translator Bridge for Zotero — ultra-lightweight handoff to PDF Translator.app.
 * All UI, settings, translation, bilingual linking, search, and isolated storage
 * live inside PDF Translator for macOS.
 */

/* global Zotero, Services, IOUtils, PathUtils, Cc, Ci */

(function () {
	"use strict";

	const ICON_URL = "chrome://pdftranslator/content/icons/icon.svg";

	class PDFTranslatorBridge {
		constructor() {
			this.pluginID = null;
			this.windows = new Set();
			this.windowState = new WeakMap();
		}

		async init({ id }) {
			this.pluginID = id;
			this._registerReaderButton();
			Zotero.debug("[PDF Translator Bridge] ready");
		}

		shutdown() {
			for (const win of [...this.windows]) this.removeFromWindow(win);
			try {
				if (this._toolbarHandler) {
					Zotero.Reader.unregisterEventListener("renderToolbar", this._toolbarHandler);
				}
			}
			catch (e) {}
		}

		appDataDir() {
			const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
			return PathUtils.join(home, "Library", "Application Support", "Hermeneuein");
		}

		libraryKind(libraryID) {
			const lib = Zotero.Libraries.get(libraryID);
			if (lib && lib.libraryType === "group") return "g" + lib.groupID;
			if (lib && lib.libraryType === "feed") return "f" + libraryID;
			return "u";
		}

		findPDFAttachment(item) {
			if (!item) return null;
			if (item.isAttachment()) return item.isPDFAttachment() ? item : null;
			if (item.isRegularItem()) {
				const atts = Zotero.Items.get(item.getAttachments()).filter((a) => a.isPDFAttachment());
				return atts[0] || null;
			}
			return null;
		}

		async resolveItem(itemID) {
			const item = Zotero.Items.get(itemID);
			if (!item) throw new Error("在 Zotero 中找不到该条目。");
			let att = null;
			if (item.isRegularItem()) {
				const best = await item.getBestAttachment();
				att = best && best.isPDFAttachment() ? best : this.findPDFAttachment(item);
			}
			else {
				att = this.findPDFAttachment(item);
			}
			if (!att) throw new Error("该条目没有 PDF 附件。");
			const path = await att.getFilePathAsync();
			if (!path) throw new Error("PDF 文件尚未下载到本地。");
			const parent = att.parentItem;
			const meta = parent || att;
			let year = "";
			try {
				year = String(Zotero.Date.strToDate(meta.getField("date") || "").year || "");
			}
			catch (e) {}
			let creators = "";
			try {
				const cs = (parent?.getCreators() || []).map((c) => c.lastName || c.firstName).filter(Boolean);
				creators = cs.length > 3 ? `${cs.slice(0, 3).join(", ")} 等` : cs.join(", ");
			}
			catch (e) {}
			const kind = this.libraryKind(att.libraryID);
			const md5 = await Zotero.Utilities.Internal.md5Async(path).catch(() => null);
			return {
				lib_key: `${kind}/${att.key}`,
				item_key: att.key,
				parent_key: parent?.key || null,
				title: (parent ? parent.getField("title") : "") || att.getField("title") || att.attachmentFilename,
				creators,
				year,
				journal: parent?.getField("publicationTitle") || "",
				file_name: att.attachmentFilename,
				path,
				md5,
			};
		}

		launchApp() {
			const openBin = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
			openBin.initWithPath("/usr/bin/open");
			const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
			proc.init(openBin);
			proc.run(false, ["-a", "PDF Translator"], 2);
		}

		async openInApp(itemID, win) {
			win = win || Zotero.getMainWindow();
			try {
				const payload = await this.resolveItem(itemID);
				const dataDir = this.appDataDir();
				const bridgePath = PathUtils.join(dataDir, "bridge.json");

				// 1. Try handing off directly to a running PDF Translator.app instance
				if (await IOUtils.exists(bridgePath)) {
					try {
						const bridge = await IOUtils.readJSON(bridgePath);
						if (bridge?.url) {
							const res = await Zotero.HTTP.request("POST", `${bridge.url}/api/zotero/open`, {
								body: JSON.stringify(Object.assign({}, payload, { activate: true })),
								headers: {
									"Content-Type": "application/json",
									"x-hermeneuein": "1",
								},
								timeout: 2500,
								successCodes: [200],
								errorDelayMax: 0,
							});
							if (res.status === 200) return;
						}
					}
					catch (e) {
						Zotero.debug(`[PDF Translator Bridge] running app unreachable, launching: ${e}`);
					}
				}

				// 2. App is not running: write pending_zotero.json and launch PDF Translator.app
				await IOUtils.makeDirectory(dataDir, { createAncestors: true, ignoreExisting: true });
				await IOUtils.writeJSON(PathUtils.join(dataDir, "pending_zotero.json"), payload);
				this.launchApp();
			}
			catch (e) {
				Zotero.logError(e);
				Services.prompt.alert(win, "PDF Translator", e.message || String(e));
			}
		}

		openFromContext(win) {
			const Tabs = win.Zotero_Tabs;
			if (Tabs && Tabs.selectedType !== "library") {
				const reader = Zotero.Reader.getByTabID(Tabs.selectedID);
				if (reader) return this.openInApp(reader.itemID, win);
			}
			const items = win.ZoteroPane?.getSelectedItems() || [];
			if (items.length) return this.openInApp(items[0].id, win);
			this.launchApp();
		}

		addToWindow(win) {
			if (this.windowState.has(win) || !win.document) return;
			const doc = win.document;
			const state = { nodes: [], cleanup: [] };
			this.windowState.set(win, state);
			this.windows.add(win);

			const itemMenu = doc.getElementById("zotero-itemmenu");
			if (itemMenu) {
				const sep = doc.createXULElement("menuseparator");
				const mi = doc.createXULElement("menuitem");
				mi.classList.add("menuitem-iconic");
				mi.setAttribute("image", ICON_URL);
				mi.setAttribute("label", "在 PDF Translator 中对照阅读");
				mi.addEventListener("command", () => {
					const items = win.ZoteroPane?.getSelectedItems() || [];
					if (items.length) this.openInApp(items[0].id, win);
				});
				itemMenu.append(sep, mi);
				state.nodes.push(sep, mi);

				const onShowing = (ev) => {
					if (ev.target !== itemMenu) return;
					const items = win.ZoteroPane.getSelectedItems();
					const att = items.length === 1 ? this.findPDFAttachment(items[0]) : null;
					mi.hidden = sep.hidden = !att;
				};
				itemMenu.addEventListener("popupshowing", onShowing);
				state.cleanup.push(() => itemMenu.removeEventListener("popupshowing", onShowing));
			}

			const tools = doc.getElementById("menu_ToolsPopup");
			if (tools) {
				const mi = doc.createXULElement("menuitem");
				mi.setAttribute("label", "打开 PDF Translator");
				mi.addEventListener("command", () => this.launchApp());
				tools.append(mi);
				state.nodes.push(mi);
			}

			const onKey = (ev) => {
				const mod = Zotero.isMac ? ev.metaKey : ev.ctrlKey;
				if (mod && ev.altKey && !ev.shiftKey && ev.code === "KeyT") {
					ev.preventDefault();
					ev.stopPropagation();
					this.openFromContext(win);
				}
			};
			win.addEventListener("keydown", onKey, true);
			state.cleanup.push(() => win.removeEventListener("keydown", onKey, true));
		}

		removeFromWindow(win) {
			const state = this.windowState.get(win);
			if (!state) return;
			for (const fn of state.cleanup) {
				try {
					fn();
				}
				catch (e) {}
			}
			for (const n of state.nodes) n.remove();
			this.windowState.delete(win);
			this.windows.delete(win);
		}

		_registerReaderButton() {
			this._toolbarHandler = (event) => {
				const { reader, doc, append } = event;
				if (reader.type && reader.type !== "pdf") return;
				const btn = doc.createElement("button");
				btn.className = "toolbar-button pdftranslator-button";
				btn.title = "在 PDF Translator 中对照阅读（⌥⌘T）";
				btn.setAttribute("aria-label", "PDF Translator");
				btn.tabIndex = -1;
				const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
				svg.setAttribute("width", "16");
				svg.setAttribute("height", "16");
				svg.setAttribute("viewBox", "0 0 16 16");
				svg.setAttribute("fill", "none");
				const mk = (d) => {
					const p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
					p.setAttribute("d", d);
					p.setAttribute("stroke", "currentColor");
					p.setAttribute("stroke-width", "1.3");
					p.setAttribute("stroke-linecap", "round");
					p.setAttribute("stroke-linejoin", "round");
					svg.append(p);
				};
				mk("M1.75 3.25h5.5M4.5 2v1.25M6 3.25c-.4 2.6-2 4.6-4.25 5.5M3.2 5.2c.6 1.4 1.9 2.7 3.3 3.3");
				mk("M8.25 14l2.75-7 2.75 7M9.2 11.75h3.6");
				btn.append(svg);
				btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;";
				btn.addEventListener("click", () => this.openInApp(reader.itemID, Zotero.getMainWindow()));
				append(btn);
			};
			try {
				Zotero.Reader.registerEventListener("renderToolbar", this._toolbarHandler, this.pluginID);
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
	}

	Zotero.PDFTranslator = new PDFTranslatorBridge();
})();
