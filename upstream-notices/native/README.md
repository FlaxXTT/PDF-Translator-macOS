# Native dependency notices

This inventory covers the locked Cargo normal and build dependency graph for `aarch64-apple-darwin`, plus native components and data shipped through those dependencies. The graph includes build dependencies used by the compiler. License files are copied from the exact locally cached crate releases or the upstream revision indicated in the table. A single local copy is retained for byte-identical notices.

- [Cargo packages and license files](CARGO-DEPENDENCIES.tsv)
- [Rust 1.100.0 standard-library copyright and license notices](rust-standard-library/COPYRIGHT-library.html)

## Bundled native libraries and data

- FreeType 2.13.2 is included in the PDF rendering backend via `freetype-sys` 0.23.0. Portions of this software are copyright © 2024 The FreeType Project (https://www.freetype.org). All rights reserved. The [FreeType License](texts/08c135755dd5-FreeType-FTL.TXT) is used for distribution. [Upstream license overview](texts/2e3bbb7d7c5c-FreeType-LICENSE.TXT) · [BDF driver notice](texts/7984455e7e5a-FreeType-BDF-README) · [PCF driver notice](texts/18d9782898d9-FreeType-PCF-README) · [embedded zlib notice](texts/871024b2721f-FreeType-zlib-NOTICE) · [HarfBuzz-derived code notice](texts/9eb9395c70e8-FreeType-HarfBuzz-derived-NOTICE)
- libpng 1.6.44 is included through the same `freetype-sys` build. [libpng license](texts/7317e078e2d3-libpng-LICENSE)
- zlib 1.3.2 is included by `libz-sys` 1.1.31. [zlib license](texts/e32ff4e00d9d-zlib-LICENSE)
- Zstandard 1.5.7 is included by `zstd-sys` 2.1.3+zstd.1.5.7 under the BSD license option. [Zstandard license](texts/705526649763-Zstandard-LICENSE)
- The `tiktoken-rs` 0.12.1 crate embeds token vocabulary files from OpenAI’s tiktoken project. [Upstream MIT license](texts/418cb499b436-openai-tiktoken-LICENSE) · [Source](https://github.com/openai/tiktoken/blob/0.8.0/LICENSE)
- BabelDOC includes font metric data from Adobe and uses Unicode data. [BabelDOC license](texts/afca41723b45-BabelDOC-LICENSE) · [Unicode license](texts/55a4070ac99c-LICENSE-UNICODE.txt) · [LICENSE-ADOBE-AFM.txt](texts/ddaa375e5347-LICENSE-ADOBE-AFM.txt) · [LICENSE-ADOBE-CMAPS.txt](texts/242c087b1598-LICENSE-ADOBE-CMAPS.txt) · [LICENSE-ADOBE-GLYPHLIST.txt](texts/3eef499a7dc0-LICENSE-ADOBE-GLYPHLIST.txt)
- BabelDOC’s Rust R*-tree compatibility module includes code derived from libspatialindex 2.1.0. [Copyright and permission notice](texts/d1cc511eb1dc-rtree_compat-libspatialindex-NOTICE)

Verify the inventory files with `shasum -a 256 -c SHA256SUMS` run from this directory.
