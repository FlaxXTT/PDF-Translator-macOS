<h1 align="center">PDF Translator</h1>
<p align="center">Translate PDFs and read them side by side.</p>

<p align="center">
  <a href="https://github.com/FlaxXTT/PDF-Translator-macOS/releases/latest"><img alt="Download for macOS" src="docs/media/download-macos.svg"></a>
  <br><sub>Apple silicon · macOS 14+</sub>
</p>

<p align="center"><img src="docs/media/reader-cover.webp" alt="PDF Translator showing an English research PDF beside its Chinese translation" width="1160"></p>

## Translate & export

![Import a PDF, run translation, preview both languages, and open the download menu](docs/media/translate-export.gif)

## Read with Zotero

![Match a sentence across the source and translation, then zoom and pan the PDF](docs/media/bilingual-reader.gif)

## Recover & export a glossary

![Recover bilingual terms from an existing translation and export the glossary as JSON](docs/media/glossary.gif)

<sub>Demos use a sample PDF and a simulated translation service.</sub>

<details>
<summary>Requirements, build, and credits</summary>

Use searchable PDFs. Layout runs locally. Cloud translation sends extracted text to the selected provider. The app is distributed with an ad-hoc signature.

Build from the matching [release tag](https://github.com/FlaxXTT/PDF-Translator-macOS/tags) with stable Rust, the macOS SDK, and the release app’s runtime assets.

```sh
./packaging/build-app.sh '/path/to/PDF Translator.app/Contents/Resources' ./dist
```

[AGPL‑3.0](LICENSE) · [BabelDOC](https://github.com/funstory-ai/BabelDOC) · [PDFMathTranslate-next](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next) · [Third-party notices](upstream-notices)

</details>
