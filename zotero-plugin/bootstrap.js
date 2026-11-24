/* PDF Translator for Zotero — bootstrap entry point (Zotero 7+). */

var chromeHandle;

function install() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Ci.amIAddonManagerStartup);
	const manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "pdftranslator", rootURI + "content/"],
	]);
	Services.scriptloader.loadSubScript(rootURI + "content/core.js");
	await Zotero.PDFTranslator.init({ id, version, rootURI });
	for (const win of Zotero.getMainWindows()) {
		if (win.ZoteroPane) Zotero.PDFTranslator.addToWindow(win);
	}
}

function onMainWindowLoad({ window }) {
	Zotero.PDFTranslator?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	Zotero.PDFTranslator?.removeFromWindow(window);
}

function shutdown(data, reason) {
	if (reason === APP_SHUTDOWN) return;
	try {
		Zotero.PDFTranslator?.shutdown();
	}
	finally {
		delete Zotero.PDFTranslator;
		chromeHandle?.destruct();
		chromeHandle = null;
	}
}

function uninstall() {}
