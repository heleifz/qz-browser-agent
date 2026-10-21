import assert from "node:assert/strict";

class Node {
  constructor() {
    this.parentNode = null;
    this.nodeType = 1;
    this.isConnected = true;
  }
  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }
}

class Element extends Node {
  constructor(localName, id = "") {
    super();
    this.localName = localName;
    this.id = id;
    this.children = [];
    this.shadow = null;
  }
  get parentElement() {
    return this.parentNode instanceof Element ? this.parentNode : null;
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  attachShadow() {
    const root = new ShadowRoot();
    root.host = this;
    this.shadow = root;
    return root;
  }
}

class ShadowRoot extends Node {
  constructor() {
    super();
    this.nodeType = 11;
    this.children = [];
    this.host = null;
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
}

class DocumentNode extends Node {
  constructor() {
    super();
    this.nodeType = 9;
    this.children = [];
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
}

function flatten(scope) {
  const found = [];
  for (const child of scope.children || []) {
    found.push(child, ...flatten(child));
  }
  return found;
}

function matchPart(element, part) {
  if (part.startsWith("#")) return element.id === part.slice(1);
  const nth = part.match(/^([a-z0-9-]+):nth-of-type\((\d+)\)$/);
  const tag = nth ? nth[1] : part;
  if (element.localName !== tag) return false;
  if (!nth) return true;
  const siblings = [...element.parentNode.children].filter(child => child.localName === tag);
  return siblings.indexOf(element) + 1 === Number(nth[2]);
}

function queryAll(scope, selector) {
  const [first, ...rest] = selector.split(" > ");
  const found = [];
  for (const start of flatten(scope).filter(element => matchPart(element, first))) {
    let node = start;
    let matched = true;
    for (const part of rest) {
      node = [...node.children].find(child => matchPart(child, part));
      if (!node) {
        matched = false;
        break;
      }
    }
    if (matched) found.push(node);
  }
  return found;
}

const documentNode = new DocumentNode();
Node.ELEMENT_NODE = 1;
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.ShadowRoot = ShadowRoot;
globalThis.document = documentNode;
globalThis.document.querySelectorAll = selector => queryAll(documentNode, selector);
globalThis.CSS = { escape: value => value };
globalThis.window = { top: null };
globalThis.window.top = globalThis.window;

const { describeElement, locate } = await import("../../src/content/page-scripts/element.ts");

function resolveDescribed(described) {
  if (described.shadowPath) {
    let scope = documentNode;
    let element = null;
    for (const step of described.shadowPath.split(" >>> ")) {
      const matches = queryAll(scope, step);
      if (matches.length !== 1) return null;
      element = matches[0];
      scope = element.shadow || element;
    }
    return element;
  }
  if (!described.selector) return null;
  const matches = queryAll(documentNode, described.selector);
  return matches.length === 1 ? matches[0] : null;
}

function nest(parent, depth) {
  let node = parent;
  for (let index = 0; index < depth; index += 1) node = node.append(new Element("div"));
  return node;
}

const html = documentNode.append(new Element("html"));
const body = html.append(new Element("body"));
const firstLeaf = nest(body.append(new Element("section")), 12).append(new Element("button", "dup"));
const secondLeaf = nest(body.append(new Element("section")), 12).append(new Element("button", "dup"));
const describedSecond = describeElement(secondLeaf);
assert.equal(describedSecond.missing, undefined, "a deep duplicate id still has a structural selector");
assert.equal(resolveDescribed(describedSecond), secondLeaf, "the selector reaches the second deep control, not the first");
assert.notEqual(resolveDescribed(describedSecond), firstLeaf);

const firstHost = body.append(new Element("span"));
const secondHost = body.append(new Element("span"));
for (const host of [firstHost, secondHost]) {
  const root = host.attachShadow();
  root.querySelectorAll = selector => queryAll(root, selector);
  const leaf = nest(root.append(new Element("div")), 12);
  host.firstButton = leaf.append(new Element("button"));
  host.secondButton = leaf.append(new Element("button"));
}
const shadowDescribed = describeElement(secondHost.secondButton);
assert.match(shadowDescribed.shadowPath, / >>> /, "a shadow control keeps the host and the inner path");
assert.equal(resolveDescribed(shadowDescribed), secondHost.secondButton, "the shadow path reaches that host's second button");

const named = nest(body.append(new Element("section")), 12).append(new Element("button", "only"));
assert.match(describeElement(named).selector, /#only$/, "a unique id completes the path");

secondLeaf.isConnected = false;
assert.equal(describeElement(secondLeaf).missing, true, "a disconnected node is not a selector");
secondLeaf.isConnected = true;

window.top = {};
assert.equal(locate(secondLeaf).inFrame, true, "a backend node in a child frame is not given a top-document selector");
window.top = window;

console.log("shadow and deep selectors stay unique");
