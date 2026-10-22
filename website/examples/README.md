# Website examples

Homepage cards and detail pages come from [`catalog.js`](catalog.js). The generator writes
`assets/examples-i18n.js`, the `#examples` block in `index.html`, and `examples/<slug>/index.html`.
Edit the catalog, then regenerate. Do not hand-edit the generated files.

```bash
node website/examples/generate-pages.mjs
```

Paths in the catalog are relative to `website/`. The catalog is a classic script that sets
`window.QZ_EXAMPLES`, so detail pages can read it on the GitHub Pages subpath without `fetch`.

## Add an example

1. Export the session from qz.
2. Clear `runtime.ownedTabs` and copy the file into `examples/sessions/`:

   ```bash
   node website/examples/prepare-exports.mjs --out website/examples/sessions path/to/export.html
   ```

   The script replaces only the last `ownedTabs` array. The exchange script tag, the rest of the
   JSON, and the `<`, U+2028, and U+2029 escapes stay as they were. Run
   `node website/examples/prepare-exports.mjs --self-test` after changing that script.
3. Add one object to `items` in `catalog.js`: `slug`, localized `title` and `summary`, `cover`,
   `media` (`kind` is `loop` or `click`), and `sessions`. Put a cover image in `assets/examples/`.
4. Regenerate. A second session with a `label` becomes a tab, and the download link follows the
   selected tab.

Example copy that should stay marked temporary uses the shared `copy-pending` class. Remove that
class from the generator when the wording is final.

## Replace an export

Run `prepare-exports.mjs` again for the same filename. Do not edit the JSON inside the HTML by hand.
Regenerate only if the catalog entry changed.

## Unpublish an example

Remove its object from `items`, run the generator, and delete `examples/sessions/<file>.html`.
The generator deletes a slug directory only when its `index.html` is marked
`data-generated="qz-example"`. It leaves `sessions/`, this README, and the scripts in place.

## Media and size

`travel` loops `assets/media/parallel.mp4`. That file is a short pan of the parallel task-tree
screenshot, used until a real `parallel.gif` is available. The player respects
`prefers-reduced-motion` and does not start the file when motion is reduced.

`llm-compare`, `arxiv`, and `github-weekly` point at `assets/demo-en.mp4` until each example has
its own recording. Those players show a cover frame and set the video `src` only after a click.
Do not add the long case video.

Keep the whole `website/` directory at or below 20MB. Covers should be compressed. The homepage
does not request session HTML.

## Preview on the Pages subpath

```bash
mkdir -p /tmp/qz-pages
ln -sfn "$PWD/website" /tmp/qz-pages/qz-browser-agent
python3 -m http.server 4173 --bind 127.0.0.1 --directory /tmp/qz-pages
```

Open `http://127.0.0.1:4173/qz-browser-agent/#examples`.
