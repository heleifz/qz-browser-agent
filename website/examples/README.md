# Website examples

Homepage cards and detail pages are generated from [`catalog.js`](catalog.js).
Chinese and English are separate lists, `locales.zh` and `locales.en`. Pages are
`examples/<slug>/` and `examples/en/<slug>/`. `fallback` is `"zh"`: while
`locales.en` is empty, the English homepage shows the Chinese examples with the
English title, summary, and alt in `fallbackCopy.en`, and those cards link to the
Chinese pages. Adding any English entry turns that fallback off for the whole
English list.

Do not hand-edit generated HTML or the marked blocks in `assets/translations.js`.

## Swap or add an example

An example is a session export and, when you have one, a full-browser recording.
The poster is optional.

1. Put the files in place.
   - Session export: `website/examples/sessions/<slug>-<locale>.html`
   - Recording: `website/assets/examples/<slug>-<locale>.mp4`
   - Poster, only to override the extracted frame: `website/assets/examples/<slug>-<locale>.webp`

   `<locale>` is `zh` or `en`. For a new export, clear `runtime.ownedTabs` and shrink images first:

   ```bash
   node website/examples/prepare-exports.mjs --out website/examples/sessions path/to/export.html
   ```

2. Add or edit one object in `locales.zh` or `locales.en`:

   ```js
   {
     slug: "travel",
     file: "examples/sessions/travel-zh.html",
     video: "assets/examples/travel-zh.mp4",
     // title and summary are optional. They default to the session title and
     // the first user message. Set them to override that text.
     // poster: "assets/examples/travel-zh.webp",
     // posterTime: 1,
   }
   ```

   `file` is the export. `video` is optional; leave it out until the recording exists.
   With a video and no `poster`, the generator takes a frame at `posterTime` seconds
   (default 1) and writes `assets/examples/<slug>-<locale>.webp`. `poster` overrides
   that frame. With neither a video nor a poster, the page shows an empty frame.

3. Compress a recording to H.264, with no audio, about 1280 pixels wide:

   ```bash
   ffmpeg -i input.mp4 -an -c:v libx264 -crf 28 -preset slow -vf "scale=1280:-2" -pix_fmt yuv420p -movflags +faststart website/assets/examples/<slug>-<locale>.mp4
   ```

   Record or crop the recording to the browser window only, with no outer black margin (`ffmpeg -i in.mp4 -vf cropdetect -f null -` finds the crop, then `-vf crop=w:h:x:y`).

   Aim for 20–40 seconds and 5MB or less. The poster, whether you supply it or the
   generator extracts it, should be WebP about 840 pixels wide and 80KB or less.

4. Regenerate:

   ```bash
   node website/examples/generate-pages.mjs
   ```

   The generator warns, and still writes the pages, when a video is over about 5MB,
   has an audio track, or is not H.264. If ffmpeg is missing, it says so and keeps
   a `poster` you already set.

5. Preview on the Pages subpath:

   ```bash
   mkdir -p /tmp/qz-pages
   ln -sfn "$PWD/website" /tmp/qz-pages/qz-browser-agent
   python3 -m http.server 4173 --bind 127.0.0.1 --directory /tmp/qz-pages
   ```

   Open `http://127.0.0.1:4173/qz-browser-agent/#examples`.

## Export runtime

`generate-pages.mjs` rewrites the extension's minified export runtime in
`adaptSessionScript` so the transcript runs inside the page's shadow root. If
the extension changes that runtime, regenerate the example pages and check
`adaptSessionScript` against the new script. The generator stops when an
expected rewrite target is missing, so a changed runtime cannot ship as a
broken page.
