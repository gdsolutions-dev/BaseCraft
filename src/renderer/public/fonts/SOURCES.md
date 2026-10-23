# Embedded fonts: sources

The 24 TTF files below are shipped unmodified. Each is SIL Open Font License 1.1 data, except Caladea, which is
Apache License 2.0 data (contract §1.5, ruling C12); the licence of each family is in `LICENSES/`. The **SHA-256 pins the version**: `src/main/fonts/ttf.test.ts` checks every file against
this table, and `src/shared/font-metrics.json` is regenerated from these files with
`BC_WRITE_FONT_METRICS=1 npx vitest run src/main/fonts/ttf`. Version = `name` table, ID 5. Downloaded 2026-10-22.

## Archives

| Archive | URL | SHA-256 |
|---|---|---|
| `liberation-fonts-ttf-2.1.5.tar.gz` (release 2.1.5) | https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz | 7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0 |
| `Inter-4.1.zip` (release v4.1) | https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip | 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e |
| `crosextrafonts-20130214.tar.gz` (Crosextra, Caladea 1.002) | https://commondatastorage.googleapis.com/chromeos-localmirror/distfiles/crosextrafonts-20130214.tar.gz | c48d1c2fd613c9c06c959c34da7b8388059e2408d2bb19845dc3ed35f76e4d09 |

google/fonts files are taken at commit `45e3d5269e4a17d823f6d84470bc084dc5ae46f6` (`main` on 2026-10-22), from `ofl/carlito/`.

## Files

| File | Version | SHA-256 | Source |
|---|---|---|---|
| LiberationSans-Regular.ttf | Version 2.1.5 | 76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSans-Regular.ttf` |
| LiberationSerif-Regular.ttf | Version 2.1.5 | 058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSerif-Regular.ttf` |
| LiberationMono-Regular.ttf | Version 2.1.5 | f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationMono-Regular.ttf` |
| LiberationSans-Bold.ttf | Version 2.1.5 | 788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSans-Bold.ttf` |
| LiberationSerif-Bold.ttf | Version 2.1.5 | d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSerif-Bold.ttf` |
| LiberationMono-Bold.ttf | Version 2.1.5 | bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationMono-Bold.ttf` |
| LiberationSans-Italic.ttf | Version 2.1.5 | e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSans-Italic.ttf` |
| LiberationSerif-Italic.ttf | Version 2.1.5 | 0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSerif-Italic.ttf` |
| LiberationMono-Italic.ttf | Version 2.1.5 | 605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationMono-Italic.ttf` |
| LiberationSans-BoldItalic.ttf | Version 2.1.5 | 698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSans-BoldItalic.ttf` |
| LiberationSerif-BoldItalic.ttf | Version 2.1.5 | f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationSerif-BoldItalic.ttf` |
| LiberationMono-BoldItalic.ttf | Version 2.1.5 | 79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130 | `liberation-fonts-ttf-2.1.5.tar.gz`, path `liberation-fonts-ttf-2.1.5/LiberationMono-BoldItalic.ttf` |
| Carlito-Regular.ttf | Version 1.104 | f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595 | https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/carlito/Carlito-Regular.ttf |
| Carlito-Bold.ttf | Version 1.104 | bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db | https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/carlito/Carlito-Bold.ttf |
| Carlito-Italic.ttf | Version 1.104 | 0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c | https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/carlito/Carlito-Italic.ttf |
| Carlito-BoldItalic.ttf | Version 1.104 | b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517 | https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/carlito/Carlito-BoldItalic.ttf |
| Caladea-Regular.ttf | Version 1.002 | d2f6cad33f191e65b68bd74e6d4f7708080a41b32db635866109df3090265d91 | `crosextrafonts-20130214.tar.gz`, path `crosextrafonts-20130214/Caladea-Regular.ttf` |
| Caladea-Bold.ttf | Version 1.002 | 74eda4fc5ffba0d8dc4aa76d41499f5ab76168d9ed6141c6417064c6244db9b6 | `crosextrafonts-20130214.tar.gz`, path `crosextrafonts-20130214/Caladea-Bold.ttf` |
| Caladea-Italic.ttf | Version 1.002 | 9c968bf60ba1e851cdfea77c71e3540c57792f77482dd241acc29d1425569c4e | `crosextrafonts-20130214.tar.gz`, path `crosextrafonts-20130214/Caladea-Italic.ttf` |
| Caladea-BoldItalic.ttf | Version 1.002 | f47a35ad6cd0efa9914d93f9d03c93e30c55da43674bccfabac73b3c0d522c01 | `crosextrafonts-20130214.tar.gz`, path `crosextrafonts-20130214/Caladea-BoldItalic.ttf` |
| Inter-Regular.ttf | Version 4.001;git-9221beed3 | 40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82 | `Inter-4.1.zip`, path `extras/ttf/Inter-Regular.ttf` |
| Inter-Bold.ttf | Version 4.001;git-9221beed3 | 288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f | `Inter-4.1.zip`, path `extras/ttf/Inter-Bold.ttf` |
| Inter-Italic.ttf | Version 4.001;git-9221beed3 | bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a | `Inter-4.1.zip`, path `extras/ttf/Inter-Italic.ttf` |
| Inter-BoldItalic.ttf | Version 4.001;git-9221beed3 | 948405a16cdc62701da5f4005ed068ca5f4d27061d98f7974ccfc37831d9581d | `Inter-4.1.zip`, path `extras/ttf/Inter-BoldItalic.ttf` |

## Licences

| File in `LICENSES/` | Copied from | SHA-256 |
|---|---|---|
| OFL-Liberation.txt | `liberation-fonts-ttf-2.1.5/LICENSE` in the archive | 93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b |
| OFL-Carlito.txt | https://raw.githubusercontent.com/google/fonts/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/carlito/OFL.txt | 58402f82a7c332a700294988fe7554fbb0a63a8d27ccc1ee3bbc640311990a00 |
| Apache-Caladea.txt | https://www.apache.org/licenses/LICENSE-2.0.txt (the archive has no licence file; each Caladea file declares Apache-2.0 in its `name` table, IDs 13 and 14, under "Copyright (c) 2012 Huerta Tipografia", ID 0) | cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 |
| OFL-Inter.txt | `LICENSE.txt` in `Inter-4.1.zip` | 262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a |

## Notes

- Inter release v4.1 identifies itself as `Version 4.001` in its `name` table.
- Caladea (ruling C12): the files are the Crosextra 1.002 release, Apache-2.0, metric-compatible with Cambria. The
  google/fonts OFL-1.1 release (1.001) is a redesign and is not: about 125 to 150 advances per style differ, by up to
  0.24 em, and its line height is 1.150 em.
  - line height: hhea 950/-222/0 at 1000 units (1.172 em), the same as Cambria's 1946/-455/0 at 2048, in all four styles;
  - advances: for ASCII, Latin-1, €, en and em dashes, curly quotes and the ellipsis (199 code points), each advance is
    Cambria's (`src/main/fonts/cambria-advances.json`, Cambria 6.98/6.99) rounded to 1000 units, in all four styles,
    except these 12 known exceptions, which `ttf.test.ts` asserts exactly:
    - Italic: U+00AD 0.332 em against 0.319 em;
    - BoldItalic: U+00AF 0.361 against 0.270 (the worst, 0.09 em), U+00A8 0.337 against 0.270, U+0060 0.208 against
      0.270, U+00BC and U+00BE 0.972 against 0.938, U+00B4 0.241 against 0.270, U+0024 0.501 against 0.519, U+00B8
      0.255 against 0.270, U+00AD 0.337 against 0.325, U+00D0 0.679 against 0.683, U+00B7 0.270 against 0.269.
- Coverage gaps in the pinned files (checked by `ttf.test.ts`): U+202F (narrow no-break space) is not in the `cmap` of the
  Caladea and Liberation Mono files, and U+00AD (soft hyphen) is not in the Carlito and Inter files. Every file maps the
  rest of printable ASCII, Latin-1 and U+20AC.
