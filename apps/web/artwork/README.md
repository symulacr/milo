# Milo synthetic product artwork

`generate.py` is the sole source for these original fictional editorial illustrations. It uses only Python's standard library: custom raster/vector drawing, a compact in-file glyph set, and a PNG encoder built with `struct` and `zlib`. It does not download, embed, trace, or depend on external assets. The artworks are illustrations, not photographic product claims.

The first three 600 × 720 px RGB PNGs depict the fictional **STILL / No.01** botanical ceramic studio in a warm paper, peach, and olive composition, with a sculptural cylindrical vessel, plinth, arch, leaf forms, restrained labels, and soft shadows. The eighteen `sc-0X-0Y` images extend the same editorial system to the six remaining synthetic service contexts (SC-02…SC-07) used by the public `/demo` tour: one fictional studio wordmark, motif and palette per context, in main (01), detail (02) and set (03) views. All are flat vector-style illustrations, not photographic product claims.

## Regenerate and verify

```sh
python3 apps/web/artwork/generate.py
```

The command is deterministic and prints each generated file's byte size and SHA-256 digest. It is a development asset generator only; it is not part of the web application's runtime.

| Asset | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `public/images/hero.png` | 600 × 720 | 7,779 | `21ec4110eedb37597293d858609f2c22d558fd3e6963bcd87e744b3a60dcce6a` |
| `public/images/detail.png` | 600 × 720 | 7,560 | `58221194d35709f6c489244ee5af248b316bded9b8296b68d03e59c70bc231a5` |
| `public/images/collection.png` | 600 × 720 | 7,758 | `435f3d70cd82a623cd1ab65d174f57f47f7b5d1e59f55b60fbc9dd59a1f4a588` |
| `public/images/sc-02-01.png` | 600 × 720 | 4,226 | `24769165f90df1ac5eda0d52badb2a89eb8d0fdf4125cab13766ecd4ce5fc24e` |
| `public/images/sc-02-02.png` | 600 × 720 | 5,035 | `a21af2f47add78191bd250030666abd0fbced2160d419ef1de6cb4b7535f09b9` |
| `public/images/sc-02-03.png` | 600 × 720 | 3,809 | `5525404b801997d71c790e8b62b5943375cdd26d0e79bdb7f7995fe515933390` |
| `public/images/sc-03-01.png` | 600 × 720 | 4,421 | `1bc49c4630d2efcf5b7623199ae4d9031d4c612b3b8604ce2b718d38d517fc2d` |
| `public/images/sc-03-02.png` | 600 × 720 | 4,972 | `759ec0e7e7fad742428df2baac39c6c8a9d2481271e13b533a76e4637d9e592e` |
| `public/images/sc-03-03.png` | 600 × 720 | 4,162 | `2b16c209bacfaaa74af159d9e73613b412c00e28736545fb71dcb637aed8d51e` |
| `public/images/sc-04-01.png` | 600 × 720 | 5,206 | `caf82eb18a5b3871380bd88314b518f72391da53be954ad16a96c8e3964134e5` |
| `public/images/sc-04-02.png` | 600 × 720 | 6,164 | `ef2d2dfa16eb50349e0ccaaa6c8e7992c6a25719429dcbae07d4c4f56dcee71a` |
| `public/images/sc-04-03.png` | 600 × 720 | 4,751 | `148f8c6118b5e2f497fb7832a376a17a77706712cec85c60eda74ab90af7fa0a` |
| `public/images/sc-05-01.png` | 600 × 720 | 4,623 | `94094f04d633b7ba52a00286241069648f9af01a240cd71f8aa957430779902f` |
| `public/images/sc-05-02.png` | 600 × 720 | 5,936 | `b834e4f939a0253279fa98e882950b00005a0f42a78071b3e889a67d9e1ab4cd` |
| `public/images/sc-05-03.png` | 600 × 720 | 4,129 | `72d0419f85ab2998efd073d2d591b2f1150a0fea67f2fe07e86776185223f4b9` |
| `public/images/sc-06-01.png` | 600 × 720 | 4,819 | `16f116f5eae88ed0f26a77de610fd25bc1031b9822a2fa387a393634cd7cda4f` |
| `public/images/sc-06-02.png` | 600 × 720 | 5,760 | `c55453b7faebe000ce41e0c066ee2eb39a81259f5a07b60199dd8f26a13c47de` |
| `public/images/sc-06-03.png` | 600 × 720 | 4,561 | `38ac2788bce3e4857532e77c6c3d40c6c24198182f05e10815e7156df9bd1e99` |
| `public/images/sc-07-01.png` | 600 × 720 | 4,293 | `089279f868c5ee8e02eb8a9bc933dd6b37b6d788762d1d8520648a31b704201f` |
| `public/images/sc-07-02.png` | 600 × 720 | 5,033 | `628b5b2ed31adc08cdcd9336a07dfa6581046d32aff339a04f853d94d677cb44` |
| `public/images/sc-07-03.png` | 600 × 720 | 3,832 | `63743d001d9eb672597250d3152e996a2491aa1fecde6962885c06860a730109` |

Hashes are local file-integrity checks only; they make no blockchain, provenance, or visual-quality claim.
