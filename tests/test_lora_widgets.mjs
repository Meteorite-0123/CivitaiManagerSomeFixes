import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ensureLoraDataWidget, syncLoraWidgets, loraPanelHeight, LORA_EMPTY_HEIGHT } from "../js/civitai/lora_widgets.js";

const source = readFileSync(new URL("../js/civitai_lora_node.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, "");

class Element {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = { setProperty: (name, value) => { this.style[name] = value; } };
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.value = "";
        this.className = "";
        this.classList = {
            toggle: (name, active) => {
                const values = new Set(this.className.split(" ").filter(Boolean));
                if (active) values.add(name);
                else values.delete(name);
                this.className = [...values].join(" ");
            },
        };
    }
    get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    append(...children) { for (const child of children) this.insertBefore(child, null); }
    insertBefore(child, before) {
        child.remove();
        this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
        child.parentElement = this;
    }
    remove() {
        if (!this.parentElement) return;
        this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
    }
    click() { this.onclick?.({ stopPropagation() {} }); }
}
globalThis.document = { createElement: (name) => new Element(name), activeElement: null };
const setStrength = (row, value) => { row.strength.value = String(value); row.strength.onchange(); };

function setup(entries = []) {
    let extension;
    const snapshots = [];
    const committed = [];
    class Node {
        constructor() {
            this.size = [340, 130];
            this.widgets = [{ name: "lora_list_json", value: JSON.stringify(entries), onRemove: () => { this.domRemoved = true; } }];
            this.resizeCount = 0;
            this.graph = {
                beforeChange: () => { snapshots.push(this.serialize()); },
                afterChange: () => { committed.push(this.serialize()); },
            };
            this.onNodeCreated();
        }
        addWidget(type, name, value, callback, options) {
            const widget = { type, name, value, callback, options };
            this.widgets.push(widget);
            this.size[1] = Math.max(this.size[1], this.computeSize()[1]);
            return widget;
        }
        addCustomWidget(widget) { this.widgets.push(widget); return widget; }
        addDOMWidget(name, type, element, options) {
            const widget = { name, type, element, options };
            this.widgets.push(widget);
            return widget;
        }
        removeWidget(widget) {
            assert.ok(this.widgets.includes(widget));
            widget.onRemove?.();
            this.widgets.splice(this.widgets.indexOf(widget), 1);
        }
        computeSize() {
            return [300, 50 + this.widgets.filter((widget) => !widget.options?.hidden)
                .reduce((height, widget) => height + (widget.computeSize?.(300)[1] ?? 24), 0)];
        }
        setSize(size) { this.size = [...size]; this.resizeCount++; }
        setDirtyCanvas() {}
        serialize() {
            return { size: [...this.size], widgets_values: this.widgets.filter((widget) => widget.serialize !== false).map((widget) => widget.value) };
        }
        configure(info) {
            this.size = [...info.size];
            this.widgets[0].value = info.widgets_values?.[0] ?? info.widgets_values_named?.lora_list_json;
            this.onConfigure(info);
        }
    }
    const context = vm.createContext({
        app: { registerExtension: (value) => { extension = value; }, canvas: { setDirty() {} } },
        ensureLoraDataWidget, syncLoraWidgets, t: (value) => value,
        console,
    });
    vm.runInContext(source, context);
    extension.beforeRegisterNodeDef(Node, { name: "CivitaiMultiLoraLoader" });
    const node = new Node();
    context.node = node;
    const run = (code) => vm.runInContext(code, context);
    const add = (entry) => { context.entry = entry; run("addLoraToTargetNode(node, entry)"); };
    return { node, add, snapshots, committed, run };
}

const entry = (name, strength_model = 1, enabled = true, storage_root_id = "") => ({ name, strength_model, enabled, storage_root_id });
const names = (node) => Array.from(node._cmgrLoras, (item) => item.name);

test("uses one native DOMWidget for compact rows and serializes only backend JSON", () => {
    const { node } = setup([entry("folder/角色.safetensors", -0.25)]);
    assert.equal(node.domRemoved, true);
    const row = node._cmgrLoraRows[0];
    assert.equal(node._cmgrLoraList.parentElement, node._cmgrLoraPanel.element);
    assert.equal(node._cmgrLoraList.children[0], row.element);
    assert.equal(row.element.children.length, 2);
    assert.equal(row.header.children.length, 4);
    assert.equal(node._cmgrLoraPanel.options.getMinHeight(), loraPanelHeight(1));
    assert.equal(node._cmgrLoraPanel.options.getMaxHeight(), loraPanelHeight(1));
    assert.equal(node.widgets.length, 2);
    assert.equal(node.serialize().widgets_values.length, 1);
    assert.equal(JSON.parse(node.serialize().widgets_values[0])[0].strength_model, -0.25);
    assert.ok(node.widgets.every((widget) => !/[\u200B\u200C\u2060\u2063]/.test(widget.name)));
});

test("deletes middle, first and last rows with one DOM click each", () => {
    const { node } = setup([entry("a"), entry("b"), entry("c")]);
    const last = node._cmgrLoraRows[2];
    node._cmgrLoraRows[1].remove.click();
    assert.deepEqual(names(node), ["a", "c"]);
    assert.equal(node._cmgrLoraRows[1], last);
    node._cmgrLoraRows[0].remove.click();
    last.remove.click();
    assert.deepEqual(names(node), []);
    assert.equal(node.widgets.length, 2);
    assert.equal(node._cmgrLoraPanel.options.getHeight(), LORA_EMPTY_HEIGHT);
    assert.equal(node._cmgrLoraList.children.length, 0);
    assert.equal(node._cmgrLoraParts.empty.hidden, false);
    assert.equal(node._cmgrLoraParts.footer.hidden, true);
    last.remove.click();
    assert.deepEqual(names(node), []);
});

test("toggle and strength edits preserve widget identities and user dimensions", () => {
    const { node, run } = setup([entry("a"), entry("b")]);
    node.setSize([520, 620]);
    const widgets = [...node.widgets];
    const resizes = node.resizeCount;
    const row = node._cmgrLoraRows[0];
    row.enabled.click();
    assert.equal(node._cmgrLoras[0].enabled, false);
    assert.equal(row.strength.disabled, true);
    row.enabled.click();
    for (const strength of [-0.35, 0, 0.65, 5]) setStrength(row, strength);
    run("syncNodeWidgets(node, node._cmgrLoras)");
    assert.equal(node._cmgrLoras[0].strength_model, 5);
    assert.deepEqual(node.widgets, widgets);
    assert.deepEqual(node.size, [520, 620]);
    assert.equal(node.resizeCount, resizes);
});

test("reordering keeps callbacks associated with the correct entry", () => {
    const { node, run } = setup([entry("a"), entry("b"), entry("c")]);
    const row = node._cmgrLoraRows[2];
    run("syncNodeWidgets(node, [node._cmgrLoras[2], node._cmgrLoras[0], node._cmgrLoras[1]])");
    setStrength(row, 0.37);
    assert.equal(node._cmgrLoras[0].name, "c");
    assert.equal(node._cmgrLoras[0].strength_model, 0.37);
    row.remove.click();
    assert.deepEqual(names(node), ["a", "b"]);
});

test("identical paths in different roots and duplicate legacy entries delete independently", () => {
    const { node } = setup([entry("a", 1, true, "root1"), entry("a", 2, true, "root2"), entry("a", 3, true, "root1")]);
    node._cmgrLoraRows[2].remove.click();
    assert.deepEqual(Array.from(node._cmgrLoras, (item) => item.strength_model), [1, 2]);
    node._cmgrLoraRows[1].remove.click();
    assert.equal(node._cmgrLoras[0].storage_root_id, "root1");
});

test("old and named workflows restore enabled states, strengths, metadata and size repeatedly", () => {
    const { node } = setup();
    const payload = JSON.stringify([{ ...entry("folder/长名字.safetensors", -0.6, false), trained_words: ["word"], version_id: 42 }]);
    for (const info of [
        { size: [460, 530], widgets_values: [payload, null, 1] },
        { size: [460, 530], widgets_values_named: { lora_list_json: payload } },
    ]) {
        for (let i = 0; i < 5; i++) node.configure(info);
        assert.deepEqual(node.size, [460, 530]);
        assert.equal(node._cmgrLoras[0].enabled, false);
        assert.equal(node._cmgrLoras[0].strength_model, -0.6);
        assert.equal(node._cmgrLoras[0].version_id, 42);
        assert.equal(node._cmgrLoraRows[0].strength.disabled, true);
    }
});

test("delete and edits record old JSON for undo and restore the controls", () => {
    const { node, snapshots } = setup([entry("a"), entry("b", 0.7)]);
    node._cmgrLoraRows[1].remove.click();
    assert.equal(snapshots.length, 1);
    node.configure(snapshots.pop());
    assert.deepEqual(names(node), ["a", "b"]);
    setStrength(node._cmgrLoraRows[1], 0.4);
    assert.equal(snapshots.length, 1);
    node.configure(snapshots.pop());
    assert.equal(node._cmgrLoras[1].strength_model, 0.7);
});

test("add, reapply and long-name updates do not duplicate controls or change width", () => {
    const { node, add } = setup();
    add(entry("a", 0.25));
    const row = node._cmgrLoraRows[0];
    row.enabled.click();
    add({ ...entry("a"), display_name: "角色".repeat(100) });
    assert.equal(node._cmgrLoraRows[0], row);
    assert.equal(node._cmgrLoras.length, 1);
    assert.equal(node._cmgrLoras[0].strength_model, 0.25);
    assert.equal(node._cmgrLoras[0].enabled, true);
    assert.equal(node.size[0], 340);
    assert.equal(row.name.textContent, "角色".repeat(100));
    assert.ok(row.name.title.includes("copy its trigger words"));
});

test("popup scroll memory targets the shared results grid, not only the LoRA grid", () => {
    const scroll = source.slice(source.indexOf("function popupScrollElement"), source.indexOf("function bindPopupScroll"));
    assert.ok(scroll.includes('querySelector(".cmgr-results")'), "image and LoRA grids share the .cmgr-results class");
    assert.ok(!scroll.includes(".cmgr-lora-results"), "the LoRA-only class misses the image grid and resets its scroll");
    const select = source.slice(source.indexOf("async function selectNodeImage"), source.indexOf("async function applyImageLora"));
    assert.ok(!select.includes("preserveScroll: false"), "selecting an image must keep the grid scroll position");
});

test("adding and deleting preserves user-added vertical space without cumulative growth", () => {
    const { node, add } = setup([entry("a")]);
    const minimum = node.computeSize()[1];
    node.setSize([480, minimum + 90]);
    for (let i = 0; i < 10; i++) {
        add(entry("b"));
        assert.equal(node.size[1], node.computeSize()[1] + 90);
        node._cmgrLoraRows[1].remove.click();
        assert.deepEqual(node.size, [480, minimum + 90]);
    }
});

test("range input and number input stay synchronized without replacing focused controls", () => {
    const { node } = setup([entry("a")]);
    const row = node._cmgrLoraRows[0];
    row.range.value = "0.65";
    row.range.oninput();
    assert.equal(node._cmgrLoras[0].strength_model, 0.65);
    assert.equal(row.strength.value, "0.65");
    const element = row.element;
    document.activeElement = row.strength;
    setStrength(row, -0.35);
    assert.equal(row.range.value, "-0.35");
    assert.equal(node._cmgrLoraRows[0].element, element);
    row.strength.value = "";
    row.strength.onchange();
    assert.equal(node._cmgrLoras[0].strength_model, -0.35);
    document.activeElement = null;
});

test("deletion commits the new JSON and final node height in one history transaction", () => {
    const { node, committed } = setup([entry("a"), entry("b"), entry("c")]);
    node._cmgrLoraRows[1].remove.click();
    assert.equal(committed.length, 1);
    assert.deepEqual(committed[0], node.serialize());
    assert.equal(JSON.parse(committed[0].widgets_values[0]).length, 2);
});

test("configure rebinds the DOMWidget, preserving rows, values and serialized dimensions", () => {
    const { node } = setup([entry("a"), entry("b", 0.65, false)]);
    const row = node._cmgrLoraRows[1];
    const panel = node._cmgrLoraPanel;
    const saved = node.serialize();
    node.configure(saved);
    assert.notEqual(node._cmgrLoraPanel.name, panel.name);
    assert.equal(node._cmgrLoraRows[1], row);
    assert.equal(row.element.parentElement, node._cmgrLoraList);
    assert.equal(node._cmgrLoraList.parentElement, node._cmgrLoraPanel.element);
    assert.equal(row.strength.value, "0.65");
    assert.equal(row.strength.disabled, true);
    assert.deepEqual(node.serialize(), saved);
});
