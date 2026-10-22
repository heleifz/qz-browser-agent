# Website examples

Homepage cards and detail pages come from [`catalog.js`](catalog.js). Regenerate after a catalog
or export change. Do not hand-edit the generated HTML or the marked translation blocks.

```bash
node website/examples/generate-pages.mjs
```

Chinese and English are separate lists, `locales.zh` and `locales.en`. Each entry is one
exported session with its own media and copy. The generator writes the `#examples` block in
`index.html`, Chinese pages at `examples/<slug>/`, English pages at `examples/en/<slug>/`, and
the marked blocks in `assets/translations.js`. English pages sit one directory deeper so a
Chinese page keeps its `../../` paths to assets and the site root, and every generated page
stays under `examples/`. Styles for this section live in `assets/examples.css`. Detail pages
load `assets/examples-render.js` for the looping clip, click-to-play video, and the document
title. Paths in the catalog are relative to `website/`. The catalog is a classic script that
sets `window.QZ_EXAMPLES`, so pages can read it on the GitHub Pages subpath without `fetch`.

The homepage `#examples` grid is one translation. Switching language replaces the cards and
their links. On a detail page, the language button opens the same slug in the other locale.
When that slug does not exist, it opens the other locale's homepage at `#examples`.

`fallback` is `"zh"`. While `locales.en` is empty, the English homepage shows the Chinese
examples with the English title and summary in `fallbackCopy.en`, and those cards link to the
Chinese pages. Adding any English entry turns that fallback off for the whole English list.

## Add an example

1. Export the session from qz.
2. Clear `runtime.ownedTabs`, shrink PNG data URLs in the exchange JSON, and copy the file
   into `examples/sessions/`:

   ```bash
   node website/examples/prepare-exports.mjs --out website/examples/sessions path/to/export.html
   ```

   The script empties the last `ownedTabs` array and minifies the exchange JSON. A
   `data:image/png;base64` URL inside that JSON is re-encoded to WebP at quality 80 when the
   result is smaller, and the MIME type is updated. The script tag stays `id` then `type`.
   `format` and `version` stay in the first 256 characters. `<`, U+2028, and U+2029 stay escaped.
   The same screenshot is not folded into a shared reference: version 1 stores each image inline,
   and import copies that data URL through with no asset id. Run
   `node website/examples/prepare-exports.mjs --self-test` after changing that script.
3. Put the cover image and the video under `assets/`. Add one object to `locales.zh` or
   `locales.en`: `slug`, `title`, `summary`, `file` (the session export path), `cover`
   (`src`, `width`, `height`, `alt`), and `media` (`kind` is `loop` or `click`, plus `src`,
   `poster`, `width`, `height`, and `alt`). An English example is that object in `locales.en`
   after the English export and video are in place.
4. Regenerate. The generator copies `#messages` from the export into a shadow root and copies
   the exchange `<script id="qingzhou-session-exchange" type="application/json">` once onto the
   page. The side-panel stylesheet and interaction script are shared, so every export must
   carry the same copies; `:root` and `html, body` in that stylesheet are retargeted to `:host`
   so the rules apply inside the shadow root.

A companion page stays in the same locale list with `card: false`, so it is not a homepage
card. `group` shares the card's title keys, `session` keeps the page id, and `related` links
to the other slug: `{ slug, id, label }`. The arXiv reuse page is the Chinese companion.

## Replace an export

Run `prepare-exports.mjs` again for the same filename, then regenerate so the shadow transcript
and the embedded exchange script match the file. Do not edit the JSON inside the HTML by hand.

## Unpublish an example

Remove its object from the locale list, run the generator, and delete
`examples/sessions/<file>.html`. The generator deletes a slug directory only when its
`index.html` is marked `data-generated="qz-example"`. It leaves `sessions/`, this README, and
the scripts in place.

## Media and size

`travel` loops `assets/media/parallel.mp4`. That file is a short pan of the parallel task-tree
screenshot, used until a real `parallel.gif` is available. The player respects
`prefers-reduced-motion` and does not start the file when motion is reduced.

`llm-compare`, `arxiv`, and `github-weekly` point at `assets/demo-en.mp4` until each example has
its own recording. Those players show a cover frame and set the video `src` only after a click.
Do not add the long case video.

Keep the whole `website/` directory at or below 45MB. Covers should be compressed. The homepage
does not request session HTML.

## Preview on the Pages subpath

```bash
mkdir -p /tmp/qz-pages
ln -sfn "$PWD/website" /tmp/qz-pages/qz-browser-agent
python3 -m http.server 4173 --bind 127.0.0.1 --directory /tmp/qz-pages
```

Open `http://127.0.0.1:4173/qz-browser-agent/#examples`.
