# The payslip font

`Roboto-Subset-Regular.ttf` is **Roboto Regular**, cut down to the characters a Vietnamese payslip
uses. Roboto is published by Google under the **Apache License 2.0**; the licence travels with the
font, so a copy of it sits beside this file as `LICENSE-Roboto.txt`.

## Why a font is committed at all

A PDF that contains Vietnamese must carry the glyphs with it: the fourteen fonts every PDF reader
is required to know are Latin-1 only, and none of them can draw `ệ`, `ữ` or `₫`. The writer in
`../writer.ts` therefore embeds this file in every payslip.

## Why a subset

Full Roboto is 515 KB — about 260 KB once compressed — which would ride along in every payslip
anyone ever downloads. Cut to the ranges below it is 45 KB (29 KB compressed), so a one-page
payslip comes to roughly 35 KB.

The cut is made **once, here**, not at runtime: subsetting a TrueType font means renumbering glyphs
and rewriting the composite glyphs that accented Vietnamese letters are built from, and that is not
something worth doing — or getting wrong — on the way to a download. The file below is the output
of `pyftsubset` (fontTools), which does it properly.

## How it was made

```sh
curl -sLO https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf
pyftsubset Roboto-Regular.ttf --output-file=Roboto-Subset-Regular.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0180-024F,U+0300-036F,U+1EA0-1EF9,U+2010-2027,U+20AB,U+20AC,U+2122" \
  --layout-features="" --no-hinting --desubroutinize \
  --drop-tables+=GDEF,GPOS,GSUB,LTSH,hdmx,gasp,post,DSIG --name-IDs="" --notdef-outline --recalc-bounds
```

The ranges are: ASCII, Latin-1, Latin Extended-A and -B (`Đ`, `đ`, `ơ`, `ư`), combining marks, the
Vietnamese block `U+1EA0–U+1EF9`, general punctuation, `₫`, `€` and `™`. 809 glyphs.

## Replacing it

Any TrueType font with the same coverage will do — run the command above against it and keep the
name. `writer.ts` reads `head`, `hhea`, `hmtx`, `maxp` and the format-4 `cmap` out of whatever file
is here, so nothing is hard-coded about Roboto itself. A character outside the subset is drawn as
`.notdef` (an empty box), which is the one thing to check after a swap.
