import assert from "node:assert/strict";
import test from "node:test";
import { firefoxSidebarCss } from "../../scripts/firefox-manifest.mjs";

test("primary hover does not mix AccentColor into the page surface", () => {
  const skin = firefoxSidebarCss();
  assert.doesNotMatch(skin, /color-mix\([^;]*--qz-ff-accent\)[^;]*(?:Canvas|--qz-ff-toolbar)/);
  assert.match(skin, /--control-primary-surface-hover:\s*var\(--qz-ff-accent\)/);
  assert.match(skin, /\.qz-btn--primary:not\(:disabled\):hover/);
  assert.match(skin, /--qz-ff-primary-hover-veil:\s*14%/);
  assert.match(skin, /--qz-ff-primary-active-veil:\s*22%/);
  assert.match(skin, /--qz-ff-primary-disabled-veil:\s*14%/);
  assert.match(skin, /rgb\(0 0 0 \/ var\(--qz-ff-primary-hover-veil\)\)/);
});

test("primary, secondary, and disabled button text stays at least 4.5:1", () => {
  const skin = firefoxSidebarCss();
  const hover = veil(skin, "primary-hover");
  const active = veil(skin, "primary-active");
  const disabled = veil(skin, "primary-disabled");
  const secondaryHover = veil(skin, "button-hover");
  assert.equal(hover, 0.14);
  assert.equal(active, 0.22);
  assert.equal(disabled, 0.14);
  assert.equal(secondaryHover, 0.10);

  const cases = [
    { name: "firefox accent, white label", fill: [0, 96, 223], text: [255, 255, 255] },
    { name: "reported blue, white label", fill: [59, 130, 246], text: [255, 255, 255] },
    { name: "yellow accent, dark label", fill: [245, 196, 81], text: [21, 20, 26] },
    { name: "violet accent, white label", fill: [118, 78, 221], text: [255, 255, 255] },
  ];
  for (const sample of cases) {
    for (const [state, amount] of [["hover", hover], ["active", active], ["disabled", disabled]]) {
      const background = mix([0, 0, 0], amount, sample.fill);
      const ratio = contrast(sample.text, background);
      assert.ok(ratio >= 4.5, `${sample.name} ${state} is ${ratio.toFixed(2)}:1`);
    }
  }

  const lightButton = mix([0, 0, 0], secondaryHover, [233, 233, 237]);
  const darkButton = mix([0, 0, 0], secondaryHover, [43, 42, 51]);
  assert.ok(contrast([0, 0, 0], lightButton) >= 4.5);
  assert.ok(contrast([255, 255, 255], darkButton) >= 4.5);

  const lightDisabled = mix([0, 0, 0], 0.62, [255, 255, 255]);
  const darkDisabled = mix([255, 255, 255], 0.62, [28, 27, 34]);
  assert.match(skin, /var\(--qz-ff-toolbar-text\) 62%, var\(--qz-ff-toolbar\)/);
  assert.ok(contrast(lightDisabled, [255, 255, 255]) >= 4.5);
  assert.ok(contrast(darkDisabled, [28, 27, 34]) >= 4.5);
});

function veil(skin, name) {
  const match = new RegExp(`--qz-ff-${name}-veil:\\s*(\\d+)%`).exec(skin);
  assert.ok(match, name);
  return Number(match[1]) / 100;
}

function mix(top, alpha, bottom) {
  return top.map((channel, index) => Math.round(channel * alpha + bottom[index] * (1 - alpha)));
}

function contrast(a, b) {
  const left = luminance(a);
  const right = luminance(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(rgb) {
  const linear = rgb.map(channel => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
