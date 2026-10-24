const mathJaxConfig = {
  loader: {
    load: ["input/tex-full", "output/svg", "a11y/assistive-mml"],
  },
  tex: {
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    processEscapes: true,
    processEnvironments: true,
    packages: { "[+]": ["ams", "newcommand", "noerrors", "noundefined"] },
    // MathJax 3.2.2 names this command \boldsymbol. \bm is the LaTeX alias.
    macros: {
      bm: ["\\boldsymbol{#1}", 1],
    },
  },
  options: {
    // The menu component loads Speech Rule Engine from a CDN. Typesetting never requests it.
    enableMenu: false,
    skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    ignoreHtmlClass: "tex2jax_ignore",
    processHtmlClass: "math-formula",
  },
  svg: {
    fontCache: "local",
    mtextInheritFont: true,
  },
  startup: {
    typeset: false,
  },
};

(globalThis as typeof globalThis & { MathJax?: typeof mathJaxConfig }).MathJax = mathJaxConfig;
