# Modified BabelDOC source

This distribution includes modified source from [BabelDOC 0.7.1](https://github.com/funstory-ai/BabelDOC/tree/d922e2b0c5a353bde8731921eb442c07ae75849d) under the GNU Affero General Public License, version 3. Original license and attribution files remain in `vendor/babeldoc`.

The native source was adapted for this macOS workbench in November 2026. The build dated 2026-11-21 includes changes in the PDF parser, formula detection, layout and typesetting, and PDF writer. These changes preserve source glyph orientation, use embedded CFF encodings, handle rotated page geometry, and compact repeated graphics state in the desktop pipeline. The selected translation provider runs through the desktop workbench.

The vendored source and the desktop source in this repository, together with the packaging script and Cargo dependency lockfile, are the source for this application build.
