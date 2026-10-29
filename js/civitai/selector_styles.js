export function injectSelectorStyles() {
    if (document.getElementById("cmgr-selector-style")) return;
    const style = document.createElement("style");
    style.id = "cmgr-selector-style";
    style.textContent = `
        .cmgr-selector-overlay {
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            --selector-tint: color-mix(in srgb, var(--cmgr-accent) 45%, #8b9099);
            --selector-surface: color-mix(in srgb, var(--cmgr-panel) 84%, var(--selector-tint) 16%);
            --selector-rail: color-mix(in srgb, var(--cmgr-panel) 94%, var(--selector-tint) 6%);
            --selector-field: color-mix(in srgb, var(--cmgr-panel) 72%, var(--selector-tint) 28%);
            --selector-hover: color-mix(in srgb, var(--cmgr-text) 7%, var(--selector-surface));
            --selector-menu: color-mix(in srgb, var(--cmgr-panel) 74%, var(--selector-tint) 26%);
            --selector-line: color-mix(in srgb, var(--cmgr-text) 10%, transparent);
            --selector-text: var(--cmgr-text);
            --selector-muted: color-mix(in srgb, var(--cmgr-text) 62%, var(--selector-surface));
            --selector-accent: color-mix(in srgb, var(--cmgr-accent) 88%, var(--cmgr-text));
            --selector-selected: color-mix(in srgb, var(--cmgr-accent) 16%, var(--selector-surface));
            --selector-primary: var(--cmgr-sampled-primary, #526f98);
            --selector-favorite: color-mix(in srgb, #e8a924 78%, var(--cmgr-text));
            --selector-good: color-mix(in srgb, #38b26d 78%, var(--cmgr-text));
            --selector-warn: color-mix(in srgb, #df8f2e 80%, var(--cmgr-text));
            --cmgr-danger: color-mix(in srgb, #e5484d 82%, var(--cmgr-text));
        }
        .cmgr-selector-overlay .cmgr-selector-shell {
            position: relative;
            display: flex;
            flex-direction: column;
            width: min(1780px, calc(100vw - 32px));
            height: calc(100dvh - 32px);
            border: 0;
            border-radius: 12px;
            overflow: hidden;
            background: var(--selector-surface);
            box-shadow: 0 24px 80px rgba(0, 0, 0, .4);
        }
        .cmgr-selector-topbar, .cmgr-selector-tabs, .cmgr-selector-nav, .cmgr-selector-toolbar, .cmgr-selector-footer,
        .cmgr-selector-utility-toolbar {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            font-size: 12px;
            font-weight: 400;
        }
        .cmgr-selector-overlay .cmgr-selector-topbar {
            flex: 0 0 auto;
            min-height: 58px;
            padding: 12px 20px;
            gap: 20px;
            background: var(--selector-surface);
            border-bottom: 1px solid var(--selector-line);
        }
        .cmgr-selector-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .cmgr-selector-heading > svg { flex: 0 0 auto; width: 22px; height: 22px; color: var(--selector-accent); }
        .cmgr-selector-overlay .cmgr-selector-heading .cmgr-title { margin: 0; color: var(--selector-text); font-size: 15px; font-weight: 600; line-height: 22px; }
        .cmgr-selector-topbar .cmgr-topbar-actions { gap: 12px; }
        .cmgr-selector-close, .cmgr-selector-filter-toggle, .cmgr-selector-reset, .cmgr-selector-tab, .cmgr-selector-node-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            border: 0;
            background: transparent;
            color: var(--selector-muted);
            font: inherit;
            cursor: pointer;
        }
        .cmgr-selector-close { width: 32px; height: 32px; padding: 0; border-radius: 6px; }
        .cmgr-selector-close:hover { color: var(--selector-text); background: var(--selector-hover); }
        .cmgr-selector-filter-toggle { gap: 7px; min-height: 32px; padding: 0 10px; border-radius: 6px; font-size: 12px; }
        .cmgr-selector-filter-toggle:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-filter-toggle[aria-expanded="true"] { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-filter-toggle[hidden] { display: none; }
        .cmgr-selector-workspace { display: grid; grid-template-columns: 76px minmax(0, 1fr); flex: 1 1 auto; min-height: 0; overflow: hidden; }
        .cmgr-selector-tabs {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            min-width: 0;
            padding: 14px 8px;
            background: var(--selector-rail);
            border-right: 1px solid var(--selector-line);
            overflow-y: auto;
            scrollbar-width: thin;
        }
        .cmgr-selector-tab {
            position: relative;
            flex: 0 0 auto;
            flex-direction: column;
            gap: 7px;
            min-height: 66px;
            padding: 10px 3px;
            border-radius: 8px;
            color: var(--selector-muted);
            font-size: 10px;
            font-weight: 450;
            line-height: 14px;
            text-align: center;
            transition: background-color 160ms ease, color 160ms ease;
        }
        .cmgr-selector-tab > svg { width: 21px; height: 21px; }
        .cmgr-selector-tab > span { max-width: 100%; overflow-wrap: anywhere; }
        .cmgr-selector-tab:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-tab.active { color: var(--selector-accent); background: var(--selector-selected); }
        .cmgr-selector-tab b {
            position: absolute;
            top: 5px;
            right: 2px;
            min-width: 16px;
            padding: 0 3px;
            border-radius: 4px;
            background: var(--selector-rail);
            color: var(--selector-muted);
            font-size: 9px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            line-height: 14px;
        }
        .cmgr-selector-tab.active b { background: var(--selector-accent); color: var(--cmgr-panel); }
        .cmgr-selector-tab b:empty { display: none; }
        .cmgr-selector-overlay .cmgr-selector-layout {
            position: relative;
            display: grid;
            min-width: 0;
            min-height: 0;
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr);
            overflow: hidden;
        }
        .cmgr-selector-overlay .cmgr-selector-layout.has-filters.filters-open { grid-template-columns: 208px minmax(0, 1fr); }
        .cmgr-selector-overlay .cmgr-selector-nav { display: none; }
        .cmgr-selector-overlay .has-filters.filters-open > .cmgr-selector-nav {
            display: flex;
            flex-direction: column;
            gap: 0;
            min-height: 0;
            padding: 20px 14px;
            overflow: hidden auto;
            background: var(--selector-surface);
            border-right: 1px solid var(--selector-line);
        }
        .cmgr-selector-filter-backdrop { display: none; }
        .cmgr-selector-filter-heading { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; gap: 8px; margin-bottom: 24px; }
        .cmgr-selector-filter-heading h2 { margin: 0; color: var(--selector-text); font-size: 13px; font-weight: 600; }
        .cmgr-selector-reset { padding: 2px 0; color: var(--selector-muted); font-size: 10px; text-decoration: underline; text-underline-offset: 3px; }
        .cmgr-selector-reset:hover { color: var(--selector-text); }
        .cmgr-selector-nav .cmgr-nav-group { display: flex; flex-direction: column; flex: 0 0 auto; gap: 9px; margin: 0 0 24px; padding: 0; border: 0; }
        .cmgr-selector-nav .cmgr-nav-group:last-child { margin-bottom: 0; }
        .cmgr-selector-nav .cmgr-nav-title { display: block; margin: 0; padding: 0; color: var(--selector-muted); font-size: 11px; font-weight: 500; text-transform: none; letter-spacing: 0; }
        .cmgr-selector-nav .cmgr-search-picker { width: 100%; min-width: 0; }
        .cmgr-selector-nav .cmgr-combo-control {
            min-height: 38px;
            padding: 10px 30px 10px 11px;
            border: 1px solid transparent;
            border-radius: 7px;
            background: var(--selector-field);
            color: var(--selector-text);
            font-size: 12px;
            font-weight: 400;
            line-height: 16px;
            box-shadow: none;
        }
        .cmgr-selector-nav .cmgr-combo-control:hover { border-color: var(--selector-line); background: var(--selector-hover); }
        .cmgr-selector-nav .cmgr-combo.has-value .cmgr-combo-control { padding-right: 50px; border-color: transparent; background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-nav .cmgr-combo-value.placeholder { color: var(--selector-muted); font-weight: 400; }
        .cmgr-selector-nav .cmgr-combo.is-multi .cmgr-combo-control { align-items: flex-start; min-height: 38px; height: auto; padding-top: 7px; padding-bottom: 7px; }
        .cmgr-selector-nav .cmgr-combo.is-multi .cmgr-combo-value { display: flex; flex-wrap: wrap; gap: 4px; max-height: 62px; overflow: hidden; white-space: normal; text-overflow: clip; }
        .cmgr-selector-nav .cmgr-combo.is-multi .cmgr-combo-control > svg { top: 18px; }
        .cmgr-combo-chip { display: inline-flex; align-items: center; max-width: 132px; padding: 1px 6px; border-radius: 5px; background: var(--selector-hover); color: var(--selector-text); font-size: 11px; font-weight: 500; line-height: 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .cmgr-combo-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; padding: 5px 2px 0; border-top: 1px solid var(--selector-line); color: var(--selector-muted); font-size: 10px; }
        .cmgr-combo-footer button { padding: 2px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--selector-accent); font-size: 11px; font-weight: 500; cursor: pointer; }
        .cmgr-combo-footer button:hover { background: var(--selector-hover); }
        .cmgr-selector-nav .cmgr-combo-control > svg { position: absolute; right: 9px; top: 50%; width: 17px; height: 17px; color: var(--selector-muted); transform: translateY(-50%); }
        .cmgr-selector-nav .cmgr-combo.open .cmgr-combo-control > svg { transform: translateY(-50%) rotate(180deg); }
        .cmgr-selector-nav .cmgr-combo-clear { width: 20px; height: 20px; right: 26px; border-radius: 4px; background: transparent; color: var(--selector-muted); }
        .cmgr-selector-nav .cmgr-combo-clear:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-nav .cmgr-combo-clear svg { width: 13px; height: 13px; }
        .cmgr-selector-nav [hidden], .cmgr-selector-toolbar [hidden] { display: none !important; }
        .cmgr-selector-nav .cmgr-combo-popover { padding: 6px; border: 0; border-radius: 9px; background: var(--selector-menu); color: var(--selector-text); box-shadow: 0 16px 40px rgba(0, 0, 0, .36); }
        .cmgr-selector-combo-search { position: relative; margin-bottom: 5px; }
        .cmgr-selector-combo-search > svg { position: absolute; left: 9px; top: 9px; width: 14px; height: 14px; color: var(--selector-muted); pointer-events: none; }
        .cmgr-selector-nav .cmgr-combo-search { width: 100%; height: 32px; min-height: 32px; margin: 0; padding: 7px 9px 7px 30px; border: 0; border-radius: 5px; background: var(--selector-rail); color: var(--selector-text); font-size: 12px; font-weight: 400; }
        .cmgr-selector-nav .cmgr-combo-search::placeholder { color: var(--selector-muted); }
        .cmgr-selector-nav .cmgr-combo-list { padding: 0; }
        .cmgr-selector-nav .cmgr-combo-option { display: flex; align-items: center; min-height: 33px; padding: 7px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--selector-text); font-size: 12px; font-weight: 400; line-height: 18px; }
        .cmgr-selector-nav .cmgr-combo-option:hover, .cmgr-selector-nav .cmgr-combo-option.is-key-active { background: var(--selector-hover); }
        .cmgr-selector-nav .cmgr-combo-option.active { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-nav .cmgr-combo-option.active::after { content: ""; flex: 0 0 auto; width: 5px; height: 9px; margin: 0 3px 3px auto; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); }
        .cmgr-selector-nav .cmgr-nav-btn { min-height: 32px; padding: 6px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--selector-muted); font-size: 12px; font-weight: 400; line-height: 20px; box-shadow: none; }
        .cmgr-selector-nav .cmgr-nav-btn:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-nav .cmgr-nav-btn.active { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-nav .cmgr-nav-btn b { min-width: 16px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--selector-muted); font-size: 10px; font-weight: 400; font-variant-numeric: tabular-nums; }
        .cmgr-selector-nav .cmgr-folder-row { min-height: 32px; padding-left: calc(var(--cmgr-folder-depth, 0) * 12px); }
        .cmgr-selector-nav .cmgr-folder-tree,
        .cmgr-selector-nav .cmgr-folder-children { display: grid; align-items: stretch; width: 100%; max-width: none; gap: 2px; overflow: visible; }
        .cmgr-selector-nav .cmgr-folder-select { width: 100%; max-width: none; }
        .cmgr-selector-nav .cmgr-lora-folder-label { gap: 8px; }
        .cmgr-selector-nav .cmgr-folder-toggle { width: 20px; height: 30px; color: var(--selector-muted); }
        .cmgr-selector-nav .cmgr-folder-select.is-ancestor:not(.active) { background: transparent; color: var(--selector-text); }
        .cmgr-selector-overlay .cmgr-selector-body { min-width: 0; min-height: 0; }
        .cmgr-selector-overlay .cmgr-page { display: flex; flex-direction: column; height: 100%; }
        .cmgr-selector-overlay .cmgr-page > .cmgr-split,
        .cmgr-selector-overlay .cmgr-page > :is(.cmgr-download-list, .cmgr-lora-applied-list) { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
        .cmgr-selector-overlay .cmgr-selector-toolbar {
            display: flex;
            flex: 0 0 auto;
            flex-direction: column;
            align-items: stretch;
            gap: 14px;
            min-height: 0;
            padding: 20px;
            border-bottom: 1px solid var(--selector-line);
            background: var(--selector-surface);
        }
        .cmgr-selector-toolbar-top { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: 16px; }
        .cmgr-selector-page-heading { min-width: 0; }
        .cmgr-selector-overlay .cmgr-selector-toolbar h2 { margin: 0; color: var(--selector-text); font-size: 19px; font-weight: 600; line-height: 26px; }
        .cmgr-selector-toolbar .cmgr-lora-local-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; min-width: 0; }
        .cmgr-selector-toolbar .cmgr-lora-folder-context { min-width: 0; gap: 0; }
        .cmgr-selector-toolbar .cmgr-lora-folder-context-label { display: none; }
        .cmgr-selector-toolbar .cmgr-lora-breadcrumb { max-width: 280px; font-size: 11px; }
        .cmgr-selector-toolbar .cmgr-lora-breadcrumb button { color: var(--selector-muted); padding: 2px; }
        .cmgr-selector-toolbar .cmgr-lora-breadcrumb button:hover { background: transparent; color: var(--selector-text); }
        .cmgr-selector-toolbar .cmgr-lora-breadcrumb button.active { background: transparent; color: var(--selector-accent); }
        .cmgr-selector-actions { display: flex; align-items: center; flex: 0 0 auto; gap: 8px; }
        .cmgr-selector-button, .cmgr-selector-tools > summary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            min-height: 32px;
            margin: 0;
            padding: 0 10px;
            border: 0;
            border-radius: 6px;
            background: var(--selector-field);
            color: var(--selector-text);
            font: inherit;
            font-size: 12px;
            font-weight: 450;
            line-height: 18px;
            white-space: nowrap;
            cursor: pointer;
            list-style: none;
            box-shadow: none;
        }
        .cmgr-selector-tools > summary::-webkit-details-marker { display: none; }
        .cmgr-selector-button:hover, .cmgr-selector-tools > summary:hover { background: var(--selector-hover); color: var(--selector-accent); }
        .cmgr-selector-button:disabled, .cmgr-selector-menu button:disabled { opacity: .45; cursor: default; }
        .cmgr-selector-button.is-icon, .cmgr-selector-tools > summary.is-icon { width: 32px; padding: 0; }
        .cmgr-selector-button svg, .cmgr-selector-tools > summary svg { width: 16px; height: 16px; }
        .cmgr-selector-tools { position: relative; }
        .cmgr-selector-tools[open] > summary { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-sort > summary { background: transparent; color: var(--selector-muted); }
        .cmgr-selector-menu {
            position: absolute;
            z-index: 20;
            top: calc(100% + 7px);
            right: 0;
            min-width: 200px;
            max-width: min(290px, calc(100vw - 100px));
            padding: 6px;
            border-radius: 9px;
            background: var(--selector-menu);
            color: var(--selector-text);
            box-shadow: 0 16px 40px rgba(0, 0, 0, .36);
        }
        .cmgr-selector-menu button {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            min-height: 36px;
            padding: 8px 10px;
            border: 0;
            border-radius: 5px;
            background: transparent;
            color: var(--selector-text);
            font: inherit;
            font-size: 12px;
            font-weight: 400;
            line-height: 18px;
            text-align: left;
            white-space: nowrap;
            cursor: pointer;
        }
        .cmgr-selector-menu button:hover, .cmgr-selector-menu button:focus-visible { background: var(--selector-hover); }
        .cmgr-selector-menu button[aria-checked="true"] { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-menu button[aria-checked="true"]::after { content: ""; width: 5px; height: 9px; margin: 0 3px 3px auto; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); }
        .cmgr-selector-search-row { min-width: 0; width: 100%; }
        .cmgr-selector-search-row .cmgr-selector-search { position: relative; width: 100%; max-width: none; min-width: 0; margin: 0; }
        .cmgr-selector-search > .cmgr-selector-icon { position: absolute; z-index: 1; left: 13px; top: 50%; width: 17px; height: 17px; color: var(--selector-muted); transform: translateY(-50%); pointer-events: none; }
        .cmgr-selector-overlay .cmgr-selector-search .cmgr-search { width: 100%; min-width: 0; height: 42px; min-height: 42px; margin: 0; padding: 10px 42px 10px 40px; border: 1px solid transparent; border-radius: 8px; background: var(--selector-field); color: var(--selector-text); font: inherit; font-size: 12px; font-weight: 400; line-height: 20px; box-shadow: none; }
        .cmgr-selector-search .cmgr-search::placeholder { color: var(--selector-muted); opacity: 1; }
        .cmgr-selector-search .cmgr-search:hover { border-color: var(--selector-line); }
        .cmgr-selector-search .cmgr-search:focus { border-color: var(--selector-accent); outline: 0; }
        .cmgr-selector-search .cmgr-selector-search-clear { position: absolute; right: 7px; top: 50%; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--selector-muted); transform: translateY(-50%); cursor: pointer; }
        .cmgr-selector-search-clear svg { width: 15px; height: 15px; }
        .cmgr-selector-search-clear:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-search .cmgr-search-spinner { right: 12px; }
        .cmgr-selector-search [hidden] { display: none !important; }
        .cmgr-selector-filter-chips { min-width: 0; }
        .cmgr-selector-filter-chips .cmgr-active-filters { margin: 0; padding: 0; border: 0; background: transparent; }
        .cmgr-selector-filter-chips .cmgr-active-filter-chip { padding: 4px 8px; border: 0; border-radius: 5px; background: var(--selector-selected); color: var(--selector-accent); font-size: 11px; font-weight: 400; }
        .cmgr-selector-filter-chips .cmgr-active-filter-chip small { color: inherit; opacity: .75; }
        .cmgr-selector-filter-chips .cmgr-active-filter-chip b { font-weight: 500; }
        .cmgr-selector-total { color: var(--selector-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .cmgr-selector-toolbar .cmgr-kind-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; padding: 3px; border: 0; border-radius: 7px; background: var(--selector-rail); }
        .cmgr-selector-toolbar .cmgr-kind-tab { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; margin: 0; padding: 0 10px; border: 0; border-radius: 5px; background: transparent; color: var(--selector-muted); font: inherit; font-size: 12px; font-weight: 450; box-shadow: none; }
        .cmgr-selector-toolbar .cmgr-kind-tab:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-toolbar .cmgr-kind-tab.active { background: var(--selector-field); color: var(--selector-accent); box-shadow: none; }
        .cmgr-selector-toolbar .cmgr-kind-tab b { padding: 0; border: 0; background: transparent; color: inherit; font-size: 10px; font-weight: 400; font-variant-numeric: tabular-nums; }
        .cmgr-selector-toolbar .cmgr-kind-tab.active::before, .cmgr-selector-toolbar .cmgr-kind-tab.active::after { display: none; }
        .cmgr-selector-overlay .cmgr-selector-utility-toolbar { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: space-between; align-items: center; min-height: 80px; padding: 20px; gap: 12px 20px; background: var(--selector-surface); border-bottom: 1px solid var(--selector-line); }
        .cmgr-selector-utility-toolbar h2 { margin: 0; color: var(--selector-text); font-size: 19px; font-weight: 600; }
        .cmgr-selector-utility-toolbar button { min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: var(--selector-field); color: var(--selector-text); font: inherit; font-size: 12px; font-weight: 400; }
        .cmgr-selector-body > .settings { min-height: 0; overflow: hidden; }
        .cmgr-selector-body > .settings .cmgr-settings-grid { min-height: 0; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
        .cmgr-selector-body > .settings .cmgr-setting-card { background: var(--selector-surface); border-color: var(--selector-line); }
        .cmgr-selector-body > .settings .cmgr-input { background: var(--selector-field); color: var(--selector-text); border-color: transparent; border-radius: 6px; font-size: 12px; }
        .cmgr-selector-body > .settings .cmgr-secondary { min-height: 32px; padding: 0 10px; background: var(--selector-field); color: var(--selector-text); border: 0; border-radius: 6px; font-size: 12px; font-weight: 400; }
        .cmgr-selector-footer { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; min-height: 34px; padding: 0 16px; border-top: 1px solid var(--selector-line); background: var(--selector-rail); color: var(--selector-muted); }
        .cmgr-selector-footer > div { display: flex; align-items: center; gap: 20px; }
        .cmgr-selector-node-status { gap: 7px; padding: 5px 0; color: var(--selector-muted); font-size: 10px; }
        .cmgr-selector-node-status:hover { color: var(--selector-text); }
        .cmgr-selector-node-status svg { width: 13px; height: 13px; }
        .cmgr-selector-node-status b { color: var(--selector-accent); font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .cmgr-selector-footer .cmgr-promo-links { gap: 8px; }
        .cmgr-selector-footer .cmgr-promo-link { min-height: 26px; height: 26px; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: var(--selector-muted); font-size: 10px; box-shadow: none; }
        .cmgr-selector-footer .cmgr-promo-link svg { width: 14px; height: 14px; }
        .cmgr-selector-footer .cmgr-promo-link:hover { color: var(--selector-text); background: var(--selector-hover); box-shadow: none; transform: none; }
        .cmgr-selector-escape { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; }
        .cmgr-selector-escape kbd { padding: 1px 4px; border: 1px solid var(--selector-line); border-radius: 4px; color: var(--selector-muted); font: inherit; }
        .cmgr-selector-tab:focus-visible, .cmgr-selector-close:focus-visible, .cmgr-selector-filter-toggle:focus-visible,
        .cmgr-selector-reset:focus-visible, .cmgr-selector-node-status:focus-visible,
        .cmgr-selector-nav button:focus-visible, .cmgr-selector-nav input:focus-visible,
        .cmgr-selector-toolbar :is(button, summary):focus-visible { outline: 2px solid var(--selector-accent); outline-offset: -2px; }
        .cmgr-selector-nav, .cmgr-selector-nav .cmgr-combo-list { scrollbar-width: thin; scrollbar-color: var(--selector-line) transparent; }
        .cmgr-selector-nav::-webkit-scrollbar, .cmgr-selector-nav .cmgr-combo-list::-webkit-scrollbar { width: 5px; height: 5px; }
        .cmgr-selector-nav ::selection, .cmgr-selector-toolbar ::selection { background: var(--selector-selected); color: var(--selector-text); }
        .cmgr-selector-nav input, .cmgr-selector-toolbar input { caret-color: var(--selector-accent); }
        .cmgr-selector-body {
            --cmgr-panel: var(--selector-rail);
            --cmgr-panel-soft: var(--selector-surface);
            --cmgr-control: var(--selector-field);
            --cmgr-border: var(--selector-line);
            --cmgr-muted: var(--selector-muted);
            --cmgr-radius: 8px;
            background: var(--selector-rail);
            color: var(--selector-text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            font-size: 12px;
            font-weight: 400;
            line-height: 1.5;
        }
        .cmgr-selector-body [hidden] { display: none !important; }
        .cmgr-selector-body .cmgr-split { background: var(--selector-rail); }
        .cmgr-selector-body .cmgr-results { padding: 20px; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 184px), 1fr)); grid-auto-rows: max-content !important; scrollbar-gutter: stable; }
        .cmgr-selector-body .cmgr-card {
            display: block;
            height: auto !important;
            min-height: 0;
            aspect-ratio: 2 / 3 !important;
            border: 1px solid var(--selector-line);
            border-radius: 9px;
            background: var(--selector-surface);
            box-shadow: none;
            contain: none;
            content-visibility: visible !important;
            transition: border-color .16s ease, background-color .16s ease;
        }
        .cmgr-selector-body .cmgr-card:hover { border-color: var(--selector-muted); box-shadow: none; transform: none; }
        .cmgr-selector-body .cmgr-card.selected { border-color: var(--selector-accent); background: var(--selector-selected); box-shadow: 0 0 0 1px var(--selector-accent); }
        .cmgr-selector-body .cmgr-card .cmgr-thumb {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            aspect-ratio: auto;
            border-radius: 0;
            clip-path: none;
            background: var(--selector-field);
        }
        .cmgr-selector-body .cmgr-card .cmgr-card-body { position: absolute; inset: auto 0 0; min-height: 0; box-sizing: border-box; gap: 5px; padding: 42px 12px 12px; background: linear-gradient(0deg, rgba(12, 17, 25, .96), rgba(12, 17, 25, .78) 62%, transparent); }
        .cmgr-selector-body .cmgr-card-title { order: 0; min-height: 0; color: #f2f5fa; font-size: 13px; font-weight: 550; line-height: 18px; text-shadow: none; overflow-wrap: anywhere; }
        .cmgr-selector-body :is(.cmgr-card-creator, .cmgr-card-meta) { order: 1; color: #b8c4d4; font-size: 10px; font-weight: 400; line-height: 15px; text-shadow: none; }
        .cmgr-selector-body .cmgr-card-tags:empty { display: none; }
        .cmgr-selector-body .cmgr-card-stat-row { order: 2; gap: 6px; min-height: 24px; margin: 2px 0 0; }
        .cmgr-selector-body .cmgr-card-stat-chip { max-width: none; height: 23px; gap: 5px; padding: 0 6px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 5px; background: rgba(255, 255, 255, .1); color: #f4f5f7; font-size: 10px; font-weight: 550; font-variant-numeric: tabular-nums; box-shadow: none; backdrop-filter: none; }
        .cmgr-selector-body .cmgr-card-stat-chip svg { width: 12px; height: 12px; color: color-mix(in srgb, var(--cmgr-accent) 45%, #fff); }
        .cmgr-selector-body .cmgr-card-stat-chip.is-likes { background: rgba(151, 96, 116, .17); border-color: rgba(217, 161, 183, .14); }
        .cmgr-selector-body .cmgr-card-stat-chip.is-likes svg { color: #d9a1b7; }
        .cmgr-selector-body .cmgr-card-stat-chip.is-size { padding: 0; border: 0; background: transparent; color: #b8c4d4; font-size: 9px; font-weight: 400; }
        .cmgr-selector-body :is(.cmgr-card-badge, .cmgr-card-status) { padding: 5px 7px; border: 0; border-radius: 4px; background: var(--selector-menu); color: var(--selector-text); font-size: 10px; font-weight: 500; line-height: 13px; box-shadow: none; backdrop-filter: none; }
        .cmgr-selector-body .cmgr-card-status.is-installed { background: #2f9e62; color: #fff; }
        .cmgr-selector-body .cmgr-card-status.is-downloading { background: var(--selector-primary); color: #fff; }
        .cmgr-selector-body .cmgr-card-badge.is-early-access { display: grid; place-items: center; width: 23px; height: 23px; padding: 0; background: #d97a1e; color: #fff; }
        .cmgr-selector-body .cmgr-card-badge.is-early-access svg { width: 13px; height: 13px; stroke-width: 2; }
        .cmgr-selector-body .cmgr-early-access { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 10px; margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--selector-warn) 40%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--selector-warn) 10%, var(--selector-surface)); }
        .cmgr-selector-body .cmgr-early-access-icon { color: var(--selector-warn); }
        .cmgr-selector-body .cmgr-early-access-icon svg { width: 16px; height: 16px; }
        .cmgr-selector-body .cmgr-early-access > div { display: grid; gap: 3px; min-width: 0; }
        .cmgr-selector-body .cmgr-early-access b { color: var(--selector-warn); font-size: 12px; font-weight: 600; }
        .cmgr-selector-body .cmgr-early-access span { color: var(--selector-text); font-size: 11.5px; line-height: 17px; }
        .cmgr-selector-body .cmgr-early-access > a { grid-column: 2; display: inline-flex; align-items: center; justify-self: start; min-height: 28px; padding: 0 10px; font-size: 11px; text-decoration: none; }
        .cmgr-selector-body .cmgr-card-badge { top: 9px; left: 9px; }
        .cmgr-selector-body .cmgr-card-top-badges { top: 9px; left: 9px; }
        .cmgr-selector-body .cmgr-card-top-badges .cmgr-card-badge { position: static; }
        .cmgr-selector-body .cmgr-card-tags span { padding: 3px 6px; border: 0; border-radius: 4px; background: color-mix(in srgb, var(--selector-primary) 55%, transparent); color: #fff; font-size: 10px; font-weight: 400; }
        .cmgr-selector-body .cmgr-card-tags .installed { background: #2f9e62; font-weight: 500; }
        .cmgr-selector-body .cmgr-card-favorite-btn { display: grid; place-items: center; justify-content: center; opacity: 1; transform: none; width: 28px; height: 28px; min-height: 28px; padding: 0; border: 0; border-radius: 5px; background: var(--selector-menu); color: var(--selector-muted); box-shadow: none; backdrop-filter: none; }
        .cmgr-selector-body .cmgr-card-favorite-mark > span { display: grid; place-items: center; width: 18px; height: 18px; }
        .cmgr-selector-body .cmgr-card-favorite-btn:hover { color: var(--selector-favorite) !important; background: var(--selector-menu) !important; border-color: transparent !important; }
        .cmgr-selector-body .cmgr-card-favorite-btn.is-active, .cmgr-selector-body .cmgr-card-favorite-btn.is-active:hover { color: #fff !important; background: #e09b17 !important; box-shadow: 0 2px 8px rgba(0, 0, 0, .3); }
        .cmgr-selector-body .cmgr-no-image { background: var(--selector-field); color: var(--selector-muted); font-size: 12px; font-weight: 400; }
        .cmgr-selector-body .cmgr-skeleton-card::after { display: none; }
        .cmgr-selector-body .cmgr-skeleton-badge { top: 9px; left: 9px; width: 56px; height: 23px; background: var(--selector-menu); }
        .cmgr-selector-body .cmgr-skeleton-content { position: absolute; inset: auto 0 0; display: grid; gap: 5px; box-sizing: border-box; padding: 42px 12px 12px; background: linear-gradient(0deg, rgba(12, 17, 25, .96), rgba(12, 17, 25, .78) 62%, transparent); }
        .cmgr-selector-body .cmgr-skeleton-content :is(.cmgr-skeleton-line, .cmgr-skeleton-stats span) { background: rgba(255, 255, 255, .13); }
        .cmgr-selector-body .cmgr-skeleton-line { height: 12px; margin: 3px 0; }
        .cmgr-selector-body .cmgr-skeleton-line.is-creator { width: 38%; height: 9px; }
        .cmgr-selector-body .cmgr-skeleton-stats { align-items: center; gap: 6px; min-height: 24px; margin-top: 2px; }
        .cmgr-selector-body .cmgr-skeleton-stats span { width: 52px; height: 23px; }
        .cmgr-selector-body :is(.cmgr-skeleton-line, .cmgr-skeleton-stats span, .cmgr-skeleton-badge) { border-radius: 4px; }
        .cmgr-selector-body .cmgr-media-skeleton { background: var(--selector-field); transition: opacity .32s ease .04s; }
        .cmgr-selector-body :is(.cmgr-thumb, .cmgr-dl-thumb, .cmgr-applied-thumb):has(.cmgr-card-media.is-loaded, .cmgr-no-image) .cmgr-media-skeleton { opacity: 0; }
        .cmgr-selector-body .cmgr-card-media { opacity: 0; transition: opacity .32s ease; }
        .cmgr-selector-body .cmgr-card-media.is-loaded { opacity: 1; }
        .cmgr-selector-body .cmgr-card-video:not(.cmgr-card-media) { opacity: 0; transition: opacity .22s ease; }
        .cmgr-selector-body .cmgr-card-video.is-loaded { opacity: 1; }
        .cmgr-selector-body .cmgr-card.is-entering > :not(.cmgr-thumb) { animation: cmgrCardIn .36s cubic-bezier(.2,.7,.2,1) var(--cmgr-enter-delay, 0ms) both; }
        @keyframes cmgrCardIn { from { opacity: 0; } }
        .cmgr-selector-body .cmgr-detail { background: var(--selector-surface); border-color: var(--selector-line); box-shadow: none; }
        .cmgr-selector-body .cmgr-detail-scroll { padding: 16px 18px 24px; }
        .cmgr-selector-body .cmgr-detail-preview { height: clamp(220px, 32vh, 360px); min-height: 0; border: 0; border-radius: 7px; background: var(--selector-rail); box-shadow: none; }
        .cmgr-selector-body .cmgr-detail-preview-bg { filter: blur(26px) saturate(1.1) brightness(.5); opacity: .9; }
        .cmgr-selector-body .cmgr-detail-preview-nav { width: 30px; height: 34px; border: 0; border-radius: 5px; background: var(--selector-menu); color: var(--selector-text); box-shadow: none; }
        .cmgr-selector-body .cmgr-detail-preview-count { border: 0; border-radius: 4px; background: var(--selector-menu); color: var(--selector-text); font-size: 10px; font-weight: 400; }
        .cmgr-selector-body .cmgr-detail-head { margin: 14px 0 16px; }
        .cmgr-selector-body .cmgr-detail-head h2 { margin: 0; color: var(--selector-text); font-size: 17px; font-weight: 550; line-height: 23px; }
        .cmgr-selector-body .cmgr-detail-head p { margin: 7px 0 0; color: var(--selector-muted); font-size: 11px; font-weight: 400; line-height: 17px; }
        .cmgr-selector-body .cmgr-detail-head .cmgr-card-stat-row { margin-top: 12px; }
        .cmgr-selector-body :is(.cmgr-detail-head, .cmgr-dl-model) .cmgr-card-stat-chip { background: var(--selector-field); border-color: transparent; color: var(--selector-text); }
        .cmgr-selector-body :is(.cmgr-detail-head, .cmgr-dl-model) .cmgr-card-stat-chip svg { color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-detail-title-link:hover h2 { color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-external-icon { border: 0; border-radius: 4px; background: transparent; color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-detail-match-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; padding: 12px 0 0; border: 0; border-top: 1px solid var(--selector-line); border-radius: 0; background: transparent; }
        .cmgr-selector-body .cmgr-detail-match-row.is-matched { background: transparent; border-color: var(--selector-line); }
        .cmgr-selector-body .cmgr-detail-match-row > div { flex: 1 1 auto; min-width: 0; gap: 2px; }
        .cmgr-selector-body .cmgr-detail-match-row b { display: flex; align-items: center; gap: 6px; color: var(--selector-text); font-size: 12px; font-weight: 500; }
        .cmgr-selector-body .cmgr-detail-match-row b::before { content: ""; flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--selector-muted); }
        .cmgr-selector-body .cmgr-detail-match-row.is-matched b::before { background: var(--selector-good); }
        .cmgr-selector-body .cmgr-detail-match-row span { color: var(--selector-muted); font-size: 11px; font-weight: 400; line-height: 16px; white-space: normal; overflow: visible; }
        .cmgr-selector-body .cmgr-detail-match-row .cmgr-secondary { flex: 0 0 auto; min-height: 28px; padding: 0 9px; font-size: 11px; }
        .cmgr-selector-body .cmgr-info-list { margin: 0; gap: 0; }
        .cmgr-selector-body .cmgr-info-list > div { grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 12px; padding: 8px 0; border: 0; font-size: 11px; line-height: 17px; }
        .cmgr-selector-body .cmgr-info-list > div:first-child { padding-top: 0; }
        .cmgr-selector-body .cmgr-info-list span { color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-info-list b { padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--selector-text); font: inherit; text-align: left; overflow-wrap: anywhere; word-break: normal; }
        .cmgr-selector-body :is(.cmgr-info-list, .cmgr-description) a { color: var(--selector-accent); text-decoration-color: var(--selector-line); text-underline-offset: 3px; }
        .cmgr-selector-body :is(.cmgr-info-list, .cmgr-description) a:hover { text-decoration: underline; }
        .cmgr-selector-body :is(.cmgr-section-title, .cmgr-path-title) { margin: 22px 0 10px; color: var(--selector-text); font-size: 12px; font-weight: 600; line-height: 18px; }
        .cmgr-selector-body .cmgr-section-head { margin: 22px 0 10px; }
        .cmgr-selector-body .cmgr-section-head .cmgr-section-title { margin: 0; }
        .cmgr-selector-body .cmgr-trained { gap: 6px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--selector-muted); font-size: 11px; }
        .cmgr-selector-body .cmgr-description { margin-top: 0; color: var(--selector-muted); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
        .cmgr-selector-body .cmgr-selector-section { margin: 8px 0 0; border-top: 1px solid var(--selector-line); interpolate-size: allow-keywords; }
        .cmgr-selector-body .cmgr-selector-section > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; color: var(--selector-text); font-size: 12px; font-weight: 500; cursor: pointer; list-style: none; }
        .cmgr-selector-body .cmgr-selector-section > summary::-webkit-details-marker { display: none; }
        .cmgr-selector-body .cmgr-selector-section > summary > svg { flex: 0 0 auto; width: 15px; height: 15px; color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-selector-section > summary > span { flex: 1; }
        .cmgr-selector-body .cmgr-selector-section > summary::after { content: ""; width: 6px; height: 6px; margin-right: 3px; border-right: 1px solid var(--selector-muted); border-bottom: 1px solid var(--selector-muted); transform: rotate(45deg); transition: transform .21s cubic-bezier(.2,.7,.2,1); }
        .cmgr-selector-body .cmgr-selector-section[open] > summary::after { transform: rotate(225deg); }
        .cmgr-selector-body .cmgr-selector-section-body { display: grid; gap: 12px; padding: 0 0 14px; }
        .cmgr-selector-body .cmgr-selector-section::details-content { block-size: 0; overflow: clip; opacity: 0; transition: block-size .21s cubic-bezier(.2,.7,.2,1), opacity .16s ease, content-visibility .21s allow-discrete; }
        .cmgr-selector-body .cmgr-selector-section[open]::details-content { block-size: auto; opacity: 1; }
        @keyframes cmgrSelectorMenuIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .cmgr-selector-overlay .cmgr-combo.open .cmgr-combo-popover,
        .cmgr-selector-tools[open] > .cmgr-selector-menu,
        .cmgr-selector-body .cmgr-path-drawer { animation: cmgrSelectorMenuIn .17s cubic-bezier(.2,.7,.2,1); }
        .cmgr-selector-overlay .cmgr-selector-body :where(.cmgr-primary, .cmgr-secondary, .cmgr-danger, .cmgr-icon-btn, .cmgr-load-more, .cmgr-trained button, .cmgr-copy-all-btn, .cmgr-alert button) {
            min-height: 34px;
            padding: 0 11px;
            border: 1px solid transparent;
            border-radius: 6px;
            background: var(--selector-field);
            color: var(--selector-text);
            font-family: inherit;
            font-size: 12px;
            font-weight: 450;
            line-height: 18px;
            text-shadow: none;
            box-shadow: none;
            transition: background-color .16s ease, border-color .16s ease, color .16s ease;
        }
        .cmgr-selector-overlay .cmgr-selector-body :where(.cmgr-primary, .cmgr-secondary, .cmgr-icon-btn, .cmgr-load-more, .cmgr-trained button, .cmgr-copy-all-btn):hover:not(:disabled) { background: var(--selector-hover); color: var(--selector-text); border-color: var(--selector-line); box-shadow: none; transform: none; filter: none; }
        .cmgr-selector-body .cmgr-primary { background: var(--selector-primary); color: #fff; }
        .cmgr-selector-body .cmgr-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--selector-primary) 86%, #000); color: #fff; border-color: transparent; }
        .cmgr-selector-body .cmgr-danger { background: color-mix(in srgb, var(--cmgr-danger) 9%, var(--selector-surface)); color: var(--cmgr-danger); }
        .cmgr-selector-body .cmgr-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--cmgr-danger) 16%, var(--selector-surface)); border-color: transparent; color: var(--cmgr-danger); }
        .cmgr-selector-body :is(button, input):disabled { opacity: .45; cursor: default; }
        .cmgr-selector-body .cmgr-download-cta { min-height: 38px !important; border-radius: 6px !important; font-size: 12px !important; font-weight: 500 !important; letter-spacing: 0; box-shadow: none; }
        .cmgr-selector-body .cmgr-download-cta-icon { background: transparent; }
        .cmgr-selector-body .cmgr-trained button { min-height: 28px; padding: 4px 9px; font-size: 11px; }
        .cmgr-selector-overlay .cmgr-selector-body .cmgr-copy-all-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 8px; border-color: color-mix(in srgb, var(--selector-accent) 35%, transparent); background: transparent; color: var(--selector-accent); font-size: 10px; font-weight: 500; }
        .cmgr-selector-body :is(.cmgr-input, .cmgr-combo-control) { min-height: 36px; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; background: var(--selector-field); color: var(--selector-text); font: inherit; font-size: 12px; line-height: 18px; box-shadow: none; }
        .cmgr-selector-body :is(.cmgr-input, .cmgr-combo-control):hover { border-color: var(--selector-line); }
        .cmgr-selector-body .cmgr-input:focus { outline: 0; border-color: var(--selector-accent); box-shadow: none; }
        .cmgr-selector-body .cmgr-combo.open .cmgr-combo-control { border-color: var(--selector-accent); box-shadow: none; }
        .cmgr-selector-body .cmgr-combo-popover { padding: 6px; border: 0; border-radius: 8px; background: var(--selector-menu); color: var(--selector-text); box-shadow: 0 12px 30px rgba(0, 0, 0, .3); }
        .cmgr-selector-body .cmgr-combo-option { min-height: 32px; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--selector-text); font-size: 12px; font-weight: 400; }
        .cmgr-selector-body .cmgr-combo-option:hover, .cmgr-selector-body .cmgr-combo-option.is-key-active { background: var(--selector-hover); }
        .cmgr-selector-body .cmgr-combo-option.active { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-body :is(.cmgr-label, .cmgr-grid2 label, .cmgr-check) { color: var(--selector-muted); font-size: 11px; font-weight: 400; }
        .cmgr-selector-body .cmgr-grid2 { gap: 12px; }
        .cmgr-selector-body .cmgr-path-box { margin: 24px 0; padding: 20px 0 0; border: 0; border-top: 1px solid var(--selector-line); border-radius: 0; background: transparent; box-shadow: none; }
        .cmgr-selector-body .cmgr-path-title { margin: 0 0 12px; }
        .cmgr-selector-body .cmgr-path { padding: 10px; border: 0; border-radius: 6px; background: var(--selector-rail); color: var(--selector-muted); font-size: 11px; font-weight: 400; }
        .cmgr-selector-body .cmgr-detail-download-card { margin: 18px 0; padding: 12px; gap: 14px; border: 1px solid var(--selector-line); border-radius: 8px; background: var(--selector-rail); box-shadow: none; }
        .cmgr-selector-body .cmgr-detail-download-card .cmgr-label { display: flex; align-items: center; gap: 7px; color: var(--selector-accent); font-size: 12px; font-weight: 550; }
        .cmgr-selector-body .cmgr-detail-download-card .cmgr-label svg { width: 15px; height: 15px; }
        .cmgr-selector-body .cmgr-detail-download-card .cmgr-path-box { margin: 0; background: transparent; }
        .cmgr-selector-body .cmgr-file-picker { display: grid; gap: 12px; margin: 0; }
        .cmgr-selector-body .cmgr-file-picker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .cmgr-selector-body .cmgr-file-picker-head > div { display: grid; gap: 4px; min-width: 0; }
        .cmgr-selector-body .cmgr-file-picker-head p { margin: 0; color: var(--selector-muted); font-size: 11px; line-height: 16px; }
        .cmgr-selector-body .cmgr-file-picker-actions { display: flex; align-items: center; justify-content: flex-end; flex: 0 0 auto; flex-wrap: wrap; gap: 6px; }
        .cmgr-selector-body .cmgr-file-picker-actions .cmgr-selector-button { min-height: 28px; font-size: 11px; }
        .cmgr-selector-body .cmgr-file-select-all { color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-file-components { display: grid; gap: 10px; padding-top: 12px; border-top: 1px dashed var(--selector-line); }
        .cmgr-selector-body .cmgr-file-components-title { color: var(--selector-text); font-size: 11px; font-weight: 600; }
        .cmgr-selector-body .cmgr-file-group { display: grid; gap: 5px; }
        .cmgr-selector-body .cmgr-file-group-head { display: flex; align-items: center; gap: 8px; min-height: 20px; min-width: 0; }
        .cmgr-selector-body .cmgr-file-group-head > span:not(.cmgr-file-role) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--selector-muted); font-size: 10px; }
        .cmgr-selector-body .cmgr-file-rows { display: grid; gap: 4px; }
        .cmgr-selector-body .cmgr-file-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px 10px;
            width: 100%;
            min-height: 38px;
            padding: 7px 10px;
            box-sizing: border-box;
            border: 1px solid transparent;
            border-radius: 6px;
            background: var(--selector-field);
            color: var(--selector-text);
            font: inherit;
            text-align: left;
        }
        .cmgr-selector-body .cmgr-file-row:hover { border-color: var(--selector-line); background: var(--selector-hover); }
        .cmgr-selector-body .cmgr-file-row.is-checked { background: color-mix(in srgb, var(--selector-accent) 6%, var(--selector-field)); }
        .cmgr-selector-body .cmgr-file-row.is-selected { border-color: var(--selector-accent); background: var(--selector-selected); }
        .cmgr-selector-body .cmgr-file-row.is-selected .cmgr-file-name { color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-file-check { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: var(--selector-accent); cursor: pointer; }
        .cmgr-selector-body .cmgr-file-main {
            display: flex;
            flex: 1 1 190px;
            flex-wrap: wrap;
            align-items: center;
            gap: 2px 8px;
            min-width: 0;
            margin: 0;
            padding: 0;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }
        .cmgr-selector-body .cmgr-file-main:focus-visible { outline: 1px solid var(--selector-accent); outline-offset: 3px; border-radius: 4px; }
        .cmgr-selector-body .cmgr-file-name {
            flex: 1 1 120px;
            min-width: 0;
            overflow-wrap: break-word;
            word-break: break-word;
            font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
            font-size: 11.5px;
            line-height: 15px;
        }
        .cmgr-selector-body .cmgr-file-meta { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 1px; margin-left: auto; }
        .cmgr-selector-body .cmgr-file-meta span { color: var(--selector-muted); font-size: 9.5px; white-space: nowrap; }
        .cmgr-selector-body .cmgr-file-meta b { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cmgr-selector-body .cmgr-file-target { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; min-width: 0; max-width: 100%; margin: 0 0 0 auto; color: var(--selector-muted); font-size: 10px; cursor: pointer; }
        .cmgr-selector-body .cmgr-file-target select {
            min-height: 24px;
            max-width: 140px;
            padding: 2px 4px;
            border: 1px solid var(--selector-line);
            border-radius: 5px;
            background: var(--selector-surface);
            color: var(--selector-text);
            font: inherit;
            font-size: 10px;
            cursor: pointer;
        }
        .cmgr-selector-body .cmgr-file-target select:hover { border-color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-file-target select:focus-visible { outline: 1px solid var(--selector-accent); outline-offset: 1px; }
        .cmgr-selector-body .cmgr-file-role {
            flex: 0 0 auto;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--selector-rail);
            color: var(--selector-muted);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: .4px;
            line-height: 14px;
            white-space: nowrap;
        }
        .cmgr-selector-body .cmgr-file-role.is-model { background: color-mix(in srgb, var(--selector-accent) 16%, var(--selector-surface)); color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-file-role.is-text_encoder { background: color-mix(in srgb, #38bdf8 18%, var(--selector-surface)); color: #38bdf8; }
        .cmgr-selector-body .cmgr-file-role.is-vae { background: color-mix(in srgb, #c084fc 18%, var(--selector-surface)); color: #c084fc; }
        .cmgr-selector-body .cmgr-file-role.is-config { background: color-mix(in srgb, #fbbf24 18%, var(--selector-surface)); color: #fbbf24; }
        .cmgr-selector-body .cmgr-file-role.is-archive { background: color-mix(in srgb, var(--selector-muted) 16%, var(--selector-surface)); color: var(--selector-muted); }
        @media (max-width: 560px) {
            .cmgr-selector-body .cmgr-file-picker-head { flex-direction: column; }
            .cmgr-selector-body .cmgr-file-picker-actions { width: 100%; justify-content: flex-start; }
            .cmgr-selector-body .cmgr-file-main { flex-basis: 100%; }
        }
        .cmgr-selector-body .cmgr-version-pill { min-height: 32px; padding: 6px 9px; border: 1px solid transparent; border-radius: 5px; background: var(--selector-field); color: var(--selector-muted); font-size: 11px; font-weight: 400; }
        .cmgr-selector-body .cmgr-version-pill:hover { border-color: var(--selector-line); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-version-pill.active { border-color: var(--selector-accent); background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-version-pill small { background: transparent; color: inherit; font-size: 9px; font-weight: 400; }
        .cmgr-selector-body .cmgr-favorite-controls { position: relative; display: flex; flex-direction: row; align-items: center; gap: 4px; margin-top: 20px; padding: 12px 0; border: 0; border-top: 1px solid var(--selector-line); border-bottom: 1px solid var(--selector-line); border-radius: 0; background: transparent; box-shadow: none; }
        .cmgr-selector-body .cmgr-favorite-toggle { min-width: 0; flex: 1 1 auto; padding: 0; gap: 10px; border: 0; border-radius: 6px; background: transparent; color: var(--selector-text); transform: none; }
        .cmgr-selector-body .cmgr-favorite-toggle:hover { background: var(--selector-hover); transform: none; }
        .cmgr-selector-body .cmgr-favorite-toggle-star { width: 30px; height: 30px; border: 0; border-radius: 5px; background: var(--selector-field); color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-favorite-toggle.is-active .cmgr-favorite-toggle-star { background: color-mix(in srgb, var(--selector-favorite) 18%, var(--selector-surface)); color: var(--selector-favorite); }
        .cmgr-selector-body .cmgr-favorite-toggle-copy b { font-size: 12px; font-weight: 500; }
        .cmgr-selector-body .cmgr-favorite-toggle-copy small { color: var(--selector-muted); font-size: 10px; font-weight: 400; }
        .cmgr-selector-body .cmgr-favorite-controls.is-compact { width: 128px; margin: 0; border: 0; padding: 0; gap: 0; border-radius: 6px; background: var(--selector-field); }
        .cmgr-selector-body .cmgr-detail-action-hub.is-inline-cta .cmgr-favorite-controls.is-compact .cmgr-favorite-toggle { min-height: 38px; width: 96px; padding: 0 9px; gap: 6px; border: 0; border-radius: 6px 0 0 6px; background: transparent; }
        .cmgr-selector-body .cmgr-favorite-controls.is-compact .cmgr-favorite-toggle-copy { width: 52px; }
        .cmgr-selector-body .cmgr-detail-action-hub [data-remote-download-state] { display: grid; gap: 10px; min-width: 0; }
        .cmgr-selector-body .cmgr-detail-action-hub [data-remote-download-state] > .cmgr-lora-detail-actions { min-width: 0; margin: 0; gap: 0; }
        .cmgr-selector-body [data-remote-download-state] .cmgr-download-cta { min-width: 0; height: 38px; padding: 4px 8px; }
        .cmgr-selector-body .cmgr-download-cta-copy { display: grid; min-width: 0; gap: 0; line-height: 14px; text-align: center; }
        .cmgr-selector-body .cmgr-download-cta-copy > span { font-size: 11px; }
        .cmgr-selector-body .cmgr-download-cta-copy > small { font-size: 10px; line-height: 12px; font-weight: 400; opacity: .85; }
        .cmgr-selector-body .cmgr-detail-action-hub.is-inline-cta { align-items: start; }
        .cmgr-selector-body .cmgr-detail-action-hub.is-inline-cta > .cmgr-favorite-controls.is-compact { min-height: 38px; height: 38px; align-self: start; flex-direction: row; background: var(--selector-field); }
        .cmgr-selector-body .cmgr-detail-action-hub.is-inline-cta .cmgr-favorite-toggle { height: 38px; box-sizing: border-box; }
        .cmgr-selector-body .cmgr-detail-action-hub .cmgr-favorite-toggle-star { width: 16px; height: 16px; background: transparent; color: var(--selector-favorite); font-size: 16px; }
        .cmgr-selector-body .cmgr-favorite-controls:not(.is-compact) { margin-top: 16px; padding: 12px; border: 1px solid var(--selector-line); border-radius: 8px; background: var(--selector-surface); }
        .cmgr-selector-body .cmgr-favorite-controls:not(.is-compact) .cmgr-favorite-toggle-star { color: var(--selector-favorite); background: color-mix(in srgb, var(--selector-favorite) 12%, var(--selector-surface)); }
        .cmgr-selector-body .cmgr-favorite-controls.is-active { border-color: color-mix(in srgb, var(--selector-favorite) 45%, transparent); background: color-mix(in srgb, var(--selector-favorite) 14%, var(--selector-surface)); }
        .cmgr-selector-body .cmgr-detail-action-hub.is-inline-cta > .cmgr-favorite-controls.is-compact.is-active { background: color-mix(in srgb, var(--selector-favorite) 16%, var(--selector-surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--selector-favorite) 55%, transparent); }
        .cmgr-selector-body .cmgr-favorite-toggle.is-active .cmgr-favorite-toggle-copy b { color: var(--selector-favorite); font-weight: 600; }
        .cmgr-selector-body .cmgr-favorite-controls.is-active .cmgr-favorite-organize { border-color: color-mix(in srgb, var(--selector-favorite) 35%, transparent); }
        .cmgr-selector-body .cmgr-favorite-organize { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; min-height: 32px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--selector-muted); transform: none; }
        .cmgr-selector-body .is-compact .cmgr-favorite-organize { height: 38px; border-radius: 0 6px 6px 0; border-left: 1px solid var(--selector-line); }
        .cmgr-selector-body .cmgr-favorite-organize:hover:not(:disabled), .cmgr-selector-body .cmgr-favorite-organize[aria-expanded="true"] { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-favorite-organize:disabled { opacity: .35; cursor: default; }
        .cmgr-selector-body .cmgr-favorite-popover { position: absolute; z-index: 12; top: calc(100% + 7px); right: 0; width: 224px; max-width: calc(100vw - 100px); box-sizing: border-box; padding: 14px; border-radius: 8px; background: var(--selector-menu); box-shadow: 0 8px 24px rgba(0,0,0,.3); animation: cmgrFavoriteMenuIn 170ms cubic-bezier(.16,1,.3,1); }
        .cmgr-selector-body .cmgr-favorite-popover[hidden] { display: none; }
        .cmgr-selector-body .opens-above .cmgr-favorite-popover { top: auto; bottom: calc(100% + 7px); }
        .cmgr-selector-body .cmgr-favorite-popover .cmgr-favorite-folder-select { display: grid; grid-template-columns: minmax(0,1fr); gap: 10px; padding: 0; border: 0; }
        .cmgr-selector-body .cmgr-favorite-popover .cmgr-favorite-folder-select > span { font-size: 12px; font-weight: 500; color: var(--selector-text); }
        .cmgr-selector-body .cmgr-favorite-star { display: block; flex: none; fill: transparent; transition: fill 160ms ease, color 160ms ease; }
        .cmgr-selector-body :is(.cmgr-favorite-toggle.is-active, .cmgr-card-favorite-mark.is-active) .cmgr-favorite-star { fill: currentColor; animation: cmgrFavoriteSaved 260ms cubic-bezier(.16,1,.3,1); }
        @keyframes cmgrFavoriteSaved { 0% { transform: scale(.8); } 55% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes cmgrFavoriteMenuIn { from { opacity: .2; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .cmgr-selector-body .cmgr-selector-triggers { margin: 16px 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--selector-accent) 30%, transparent); border-radius: 8px; background: var(--selector-selected); }
        .cmgr-selector-body .cmgr-selector-triggers .cmgr-section-head { margin: 0 0 10px; }
        .cmgr-selector-body .cmgr-selector-triggers:not(:has(.cmgr-trained button)) { border-color: var(--selector-line); background: transparent; }
        .cmgr-selector-body .cmgr-selector-triggers:not(:has(.cmgr-trained button)) .cmgr-section-title { color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-selector-triggers .cmgr-section-title { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-selector-triggers .cmgr-section-head .cmgr-section-title { margin: 0; }
        .cmgr-selector-body .cmgr-selector-triggers .cmgr-section-title svg { width: 15px; height: 15px; }
        .cmgr-selector-overlay .cmgr-selector-body .cmgr-selector-triggers .cmgr-trained button { display: inline-flex; align-items: center; gap: 5px; border-color: color-mix(in srgb, var(--selector-accent) 32%, transparent); background: var(--selector-surface); color: var(--selector-accent); font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-weight: 500; }
        .cmgr-selector-overlay .cmgr-selector-body .cmgr-selector-triggers :is(.cmgr-trained button, .cmgr-copy-all-btn):hover:not(:disabled) { border-color: transparent; background: var(--selector-primary); color: #fff; }
        .cmgr-selector-overlay .cmgr-selector-body .cmgr-selector-triggers :is(.cmgr-trained button, .cmgr-copy-all-btn).is-copied { border-color: transparent; background: color-mix(in srgb, var(--selector-good) 18%, var(--selector-surface)); color: var(--selector-good); }
        .cmgr-selector-body .cmgr-selector-triggers .is-copied::before { content: ""; width: 10px; height: 10px; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
        .cmgr-selector-body :is(.cmgr-detail-installed-bar, .cmgr-detail-download-progress) { padding: 12px; border: 0; border-radius: 6px; background: var(--selector-rail); box-shadow: none; }
        .cmgr-selector-body .cmgr-detail-installed-badge b { font-size: 12px; font-weight: 500; }
        .cmgr-selector-body .cmgr-card-status i { box-shadow: none; }
        .cmgr-selector-body :is(.cmgr-download-list, .cmgr-lora-applied-list) { display: block; padding: 20px; }
                .cmgr-selector-body :is(.cmgr-empty, .cmgr-empty-detail, .cmgr-empty-state) { border: 0; border-radius: 0; background: transparent; color: var(--selector-muted); box-shadow: none; }
        .cmgr-selector-body :is(.cmgr-empty-detail, .cmgr-empty-state)::before { display: none; }
        .cmgr-selector-body :is(.cmgr-empty-detail-art, .cmgr-empty-detail-kicker, .cmgr-empty-detail-features) { display: none; }
        .cmgr-selector-body :is(.cmgr-empty-detail, .cmgr-empty-state) h2 { color: var(--selector-text); font-size: 16px; font-weight: 550; line-height: 24px; }
        .cmgr-selector-body :is(.cmgr-empty-detail, .cmgr-empty-state) p { color: var(--selector-muted); font-size: 12px; font-weight: 400; line-height: 20px; }
        .cmgr-selector-body .cmgr-load-status { color: var(--selector-muted); font-size: 12px; font-weight: 400; }
        .cmgr-selector-body .cmgr-setting-card { border: 0; border-radius: 8px; background: var(--selector-surface); box-shadow: none; }
        .cmgr-selector-body .cmgr-settings-head h2 { color: var(--selector-text); font-size: 15px; font-weight: 550; }
        .cmgr-selector-body .cmgr-settings-head p { color: var(--selector-muted); font-size: 12px; font-weight: 400; }
        .cmgr-selector-body .cmgr-root-row { padding: 8px 0; border: 0; border-bottom: 1px solid var(--selector-line); border-radius: 0; background: transparent; }
        .cmgr-selector-body .cmgr-root-list { max-height: 188px; overflow-y: auto; padding-right: 4px; scrollbar-width: thin; scrollbar-color: var(--selector-line) transparent; }
        .cmgr-selector-body .cmgr-check { padding: 8px 0; border: 0; border-radius: 0; background: transparent; }
        .cmgr-selector-body .cmgr-settings-footer { padding: 16px 0 0; border: 0; border-top: 1px solid var(--selector-line); border-radius: 0; background: transparent; }
        .cmgr-selector-body .cmgr-root-row b { border: 0; background: transparent; color: var(--selector-text); font-size: 11px; font-weight: 400; }
        .cmgr-selector-body :is(.cmgr-setting-status, .cmgr-root-row > span) { font-size: 11px; font-weight: 450; }
        .cmgr-selector-body input[type="checkbox"] { accent-color: var(--selector-primary); }
        .cmgr-selector-body :is(button, input, summary, a):focus-visible { outline: 2px solid var(--selector-accent); outline-offset: 2px; box-shadow: none; }
        .cmgr-selector-body ::selection { background: var(--selector-selected); color: var(--selector-text); }
        .cmgr-selector-body input { caret-color: var(--selector-accent); }
        .cmgr-selector-body :is(.cmgr-results, .cmgr-detail-scroll, .cmgr-download-list, .cmgr-lora-applied-list, .cmgr-settings-grid) { scrollbar-width: thin; scrollbar-color: var(--selector-line) transparent; }
        .cmgr-selector-body ::-webkit-scrollbar { display: block; width: 5px; height: 5px; }
        .cmgr-selector-body ::-webkit-scrollbar-thumb { background: var(--selector-line); border-radius: 4px; }
        .cmgr-selector-overlay .cmgr-notification-host .cmgr-notice { border: 0; border-radius: 7px; background: var(--selector-menu); color: var(--selector-text); font: 400 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; backdrop-filter: none; }
        .cmgr-selector-body .cmgr-card:focus-visible { outline: 2px solid var(--selector-accent); outline-offset: 2px; }
        .cmgr-selector-body .cmgr-detail.is-loading::before { content: ""; position: absolute; z-index: 9; inset: 0 0 auto; height: 2px; background: linear-gradient(90deg, transparent, var(--selector-accent), transparent) no-repeat; background-size: 40% 100%; animation: cmgrDetailLoading 1s linear infinite; }
        .cmgr-selector-body .cmgr-split.is-searching-more::before { content: ""; position: absolute; z-index: 4; grid-column: 1; grid-row: 1; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--selector-accent), transparent) no-repeat; background-size: 40% 100%; animation: cmgrDetailLoading 1s linear infinite; pointer-events: none; }
        @keyframes cmgrDetailLoading { from { background-position: -70% 0; } to { background-position: 170% 0; } }
        .cmgr-selector-body .cmgr-detail-dismiss { display: none; }
        .cmgr-selector-body :is(.cmgr-detail-stage-media, .cmgr-detail-thumb img, .cmgr-detail-preview-bg) { transition: opacity .26s ease; }
        .cmgr-selector-body :is(.cmgr-detail-stage-media, .cmgr-detail-thumb img, .cmgr-detail-preview-bg):not(.is-loaded) { opacity: 0; }
        .cmgr-selector-body .cmgr-detail-preview:not(:has(.cmgr-detail-stage-media.is-loaded, .cmgr-no-image))::after,
        .cmgr-selector-body .cmgr-detail-skeleton :is(.cmgr-detail-skeleton-block, .cmgr-detail-skeleton-chips span, .cmgr-detail-skeleton-lines span)::after,
        .cmgr-selector-body :is(.cmgr-description, .cmgr-dl-model) .cmgr-detail-skeleton-lines span::after { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 22%, color-mix(in srgb, var(--selector-text) 9%, transparent) 44%, transparent 66%); transform: translateX(-115%); animation: cmgrSkeletonShimmer 1.35s ease-in-out infinite; }
        .cmgr-selector-body .cmgr-detail-skeleton .cmgr-detail-preview { position: relative; overflow: hidden; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines { display: grid; gap: 8px; margin: 16px 0; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines span, .cmgr-selector-body .cmgr-detail-skeleton-chips span, .cmgr-selector-body .cmgr-detail-skeleton-block { position: relative; display: block; overflow: hidden; border-radius: 5px; background: var(--selector-field); }
        .cmgr-selector-body .cmgr-detail-skeleton-lines span { height: 10px; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines span:nth-child(2n) { width: 82%; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines span:last-child { width: 56%; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines.is-title span:first-child { height: 18px; width: 74%; }
        .cmgr-selector-body .cmgr-detail-skeleton-lines.is-title span:last-child { width: 34%; }
        .cmgr-selector-body .cmgr-detail-skeleton-chips { display: flex; gap: 6px; }
        .cmgr-selector-body .cmgr-detail-skeleton-chips span { width: 52px; height: 22px; }
        .cmgr-selector-body .cmgr-detail-skeleton-block { height: 64px; margin-top: 18px; border-radius: 8px; }
        .cmgr-selector-body .cmgr-detail-gallery { display: grid; gap: 8px; }
        .cmgr-selector-body .cmgr-detail-stage { position: relative; z-index: 2; display: block; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: zoom-in; }
        .cmgr-selector-body .cmgr-detail-stage-media { display: block; width: 100%; height: 100%; object-fit: contain; }
        .cmgr-selector-body .cmgr-detail-stage:focus-visible { outline-offset: -2px; }
        .cmgr-selector-body .cmgr-detail-preview > .cmgr-no-image { display: grid; place-items: center; height: 100%; }
        @media (hover: hover) {
            .cmgr-selector-body .cmgr-detail-preview-nav { opacity: 0; transition: opacity .15s ease; }
            .cmgr-selector-body .cmgr-detail-preview:hover .cmgr-detail-preview-nav, .cmgr-selector-body .cmgr-detail-preview-nav:focus-visible { opacity: 1; }
        }
        .cmgr-selector-body .cmgr-detail-thumbs { position: relative; display: flex; gap: 6px; padding: 1px; overflow-x: auto; scrollbar-width: none; }
        .cmgr-selector-body .cmgr-detail-thumbs::-webkit-scrollbar { display: none; }
        .cmgr-selector-body .cmgr-detail-thumb { position: relative; flex: 0 0 46px; width: 46px; height: 46px; margin: 0; padding: 0; border: 1px solid transparent; border-radius: 6px; overflow: hidden; background: var(--selector-field); opacity: .55; cursor: pointer; transition: opacity .15s ease, border-color .15s ease; }
        .cmgr-selector-body .cmgr-detail-thumb:hover { opacity: .9; }
        .cmgr-selector-body .cmgr-detail-thumb.active { border-color: var(--selector-accent); opacity: 1; }
        .cmgr-selector-body .cmgr-detail-thumb:focus-visible { outline-offset: -2px; }
        .cmgr-selector-body .cmgr-detail-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .cmgr-selector-body .cmgr-detail-thumb-play { position: absolute; inset: 0; margin: auto; width: 0; height: 0; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 10px solid #fff; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .6)); }
        .cmgr-selector-body .cmgr-detail-head p { overflow-wrap: anywhere; }
        .cmgr-selector-body .cmgr-detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
        .cmgr-selector-body .cmgr-detail-meta > :is(.cmgr-detail-facts, .cmgr-card-stat-row) { display: contents; }
        .cmgr-selector-body .cmgr-detail-facts span { padding: 3px 7px; border-radius: 4px; background: var(--selector-field); color: var(--selector-text); font-size: 10.5px; line-height: 16px; }
        .cmgr-selector-body .cmgr-detail-tags { margin: 16px 0; }
        .cmgr-selector-body .cmgr-detail-tags .cmgr-section-title { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; }
        .cmgr-selector-body .cmgr-detail-tags .cmgr-section-title svg { width: 15px; height: 15px; color: var(--selector-muted); }
        .cmgr-selector-body .cmgr-detail-tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .cmgr-selector-body .cmgr-detail-tag-list > * { margin: 0; padding: 2px 9px; border: 1px solid var(--selector-line); border-radius: 999px; background: transparent; color: var(--selector-muted); font: inherit; font-size: 11px; line-height: 18px; }
        .cmgr-selector-body .cmgr-detail-tag-list > button { cursor: pointer; }
        .cmgr-selector-body .cmgr-detail-tag-list > button:hover { border-color: var(--selector-accent); color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-detail-local-cta { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; }
        .cmgr-selector-body .cmgr-detail-local-cta svg { width: 16px; height: 16px; }
        .cmgr-selector-body .cmgr-detail-danger-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--selector-line); }
        .cmgr-selector-body .cmgr-detail-danger-row > span { display: grid; gap: 2px; min-width: 0; }
        .cmgr-selector-body .cmgr-detail-danger-row b { color: var(--selector-text); font-size: 12px; font-weight: 500; }
        .cmgr-selector-body .cmgr-detail-danger-row small { color: var(--selector-muted); font-size: 10px; }
        .cmgr-selector-body .cmgr-detail-file-actions { display: flex; gap: 8px; }
        .cmgr-selector-body .cmgr-detail-file-actions > button { flex: 1 1 0; }
        .cmgr-lightbox { position: absolute; z-index: 60; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; background: rgba(6, 9, 14, .94); color: #dbe2ec; font: 400 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; animation: cmgrLightboxIn .16s ease; }
        @keyframes cmgrLightboxIn { from { opacity: 0; } to { opacity: 1; } }
        .cmgr-lightbox-stage { display: flex; align-items: center; justify-content: center; min-height: 0; padding: 28px 76px 8px; overflow: hidden; }
        .cmgr-lightbox-stage > :is(img, video) { width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 24px 64px rgba(0, 0, 0, .55); }
        .cmgr-lightbox-bar { display: flex; align-items: center; gap: 16px; min-width: 0; padding: 10px 20px 16px; }
        .cmgr-lightbox-title { flex: 1 1 auto; min-width: 0; overflow: hidden; color: #f2f5fa; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
        .cmgr-lightbox-count { color: #9aa6b6; font-variant-numeric: tabular-nums; }
        .cmgr-lightbox-original { color: color-mix(in srgb, var(--cmgr-accent) 50%, #fff); text-decoration: none; white-space: nowrap; }
        .cmgr-lightbox-original:hover { text-decoration: underline; }
        .cmgr-lightbox-close, .cmgr-lightbox-nav { display: grid; place-items: center; margin: 0; padding: 0; border: 0; border-radius: 7px; background: rgba(255, 255, 255, .08); color: #fff; cursor: pointer; }
        .cmgr-lightbox-close { flex: 0 0 auto; width: 34px; height: 34px; }
        .cmgr-lightbox-close svg { width: 18px; height: 18px; }
        .cmgr-lightbox-nav { position: absolute; top: calc(50% - 46px); width: 46px; height: 60px; font-size: 30px; line-height: 1; }
        .cmgr-lightbox-nav.prev { left: 16px; }
        .cmgr-lightbox-nav.next { right: 16px; }
        .cmgr-lightbox :is(.cmgr-lightbox-close, .cmgr-lightbox-nav):hover { background: rgba(255, 255, 255, .16); }
        .cmgr-lightbox :is(button, a):focus-visible { outline: 2px solid color-mix(in srgb, var(--cmgr-accent) 50%, #fff); outline-offset: 2px; }
        .cmgr-lightbox .cmgr-no-image { color: #9aa6b6; font-size: 13px; }
        .cmgr-selector-overlay .cmgr-notice-action { margin-left: 6px; padding: 3px 9px; border: 0; border-radius: 5px; background: var(--selector-selected); color: var(--selector-accent); font: inherit; font-weight: 600; cursor: pointer; }
        .cmgr-selector-overlay .cmgr-notice-action:hover { background: var(--selector-hover); }
        .cmgr-selector-body :is(.cmgr-dl-thumb, .cmgr-applied-thumb) { position: relative; overflow: hidden; border-radius: 6px; background: var(--selector-field); }
        .cmgr-selector-body :is(.cmgr-dl-thumb, .cmgr-applied-thumb) > :is(img, video, .cmgr-no-image, .cmgr-media-skeleton) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .cmgr-selector-body :is(.cmgr-dl-thumb, .cmgr-applied-thumb) .cmgr-no-image { display: grid; place-items: center; padding: 2px; font-size: 9px; line-height: 1.2; text-align: center; }
        .cmgr-dl-heading { display: grid; gap: 4px; min-width: 0; }
        .cmgr-dl-heading > span { color: var(--selector-muted); font-size: 12px; }
        :is(.cmgr-dl-toolbar-actions, .cmgr-applied-toolbar-actions) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .cmgr-selector-body .cmgr-dl-group { margin: 0 0 22px; }
        .cmgr-selector-body .cmgr-dl-group > h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; color: var(--selector-muted); font-size: 11px; font-weight: 500; }
        .cmgr-selector-body .cmgr-dl-group > h3 b { min-width: 18px; padding: 0 6px; border-radius: 9px; background: var(--selector-field); color: var(--selector-text); font-size: 10px; font-weight: 500; line-height: 18px; text-align: center; }
        .cmgr-selector-body .cmgr-dl-rows { display: grid; gap: 8px; }
        .cmgr-selector-body .cmgr-dl-row { border: 1px solid var(--selector-line); border-radius: 8px; background: var(--selector-surface); transition: border-color .15s ease; }
        .cmgr-selector-body .cmgr-dl-row:hover { border-color: color-mix(in srgb, var(--selector-muted) 50%, transparent); }
        .cmgr-selector-body .cmgr-dl-row.is-open { border-color: color-mix(in srgb, var(--selector-accent) 45%, transparent); }
        .cmgr-selector-body .cmgr-dl-row-head { display: grid; grid-template-columns: 48px minmax(0, 1fr) 84px 156px 28px; align-items: center; gap: 14px; padding: 10px 12px; cursor: pointer; }
        .cmgr-selector-body .cmgr-dl-thumb { width: 48px; height: 48px; }
        .cmgr-selector-body .cmgr-dl-main { display: grid; gap: 6px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-status { justify-self: start; padding: 3px 8px; border-radius: 4px; background: var(--selector-field); color: var(--selector-muted); font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }
        .cmgr-selector-body .cmgr-dl-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-expand { display: grid; place-items: center; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--selector-muted); cursor: pointer; }
        .cmgr-selector-body .cmgr-dl-expand:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-dl-expand svg { width: 16px; height: 16px; transition: transform .2s cubic-bezier(.2,.7,.2,1); }
        .cmgr-selector-body .cmgr-dl-row.is-open .cmgr-dl-expand svg { transform: rotate(180deg); }
        .cmgr-selector-body .cmgr-dl-details { display: grid; grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows .22s cubic-bezier(.2,.7,.2,1), visibility 0s linear .22s; }
        .cmgr-selector-body .cmgr-dl-row.is-open .cmgr-dl-details { grid-template-rows: 1fr; visibility: visible; transition: grid-template-rows .22s cubic-bezier(.2,.7,.2,1); }
        .cmgr-selector-body .cmgr-dl-details > div { min-height: 0; overflow: hidden; }
        .cmgr-selector-body .cmgr-dl-details-body { display: grid; grid-template-columns: 280px minmax(0, 1fr); align-items: start; gap: 20px; margin: 0 12px; padding: 14px 0 16px; border-top: 1px solid var(--selector-line); }
        .cmgr-selector-body .cmgr-dl-gallery .cmgr-detail-preview { position: relative; height: clamp(240px, 34vh, 360px); overflow: hidden; }
        .cmgr-selector-body .cmgr-dl-gallery [aria-busy] .cmgr-detail-thumb { opacity: 1; cursor: default; }
        .cmgr-selector-body .cmgr-dl-info { display: grid; align-content: start; gap: 14px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-model { display: grid; gap: 12px; padding-top: 12px; border-top: 1px solid var(--selector-line); }
        .cmgr-selector-body .cmgr-dl-model :is(.cmgr-selector-triggers, .cmgr-detail-tags, .cmgr-detail-skeleton-lines) { margin: 0; }
        .cmgr-selector-body .cmgr-dl-model-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--selector-muted); font-size: 11px; }
        .cmgr-selector-body .cmgr-dl-model-stats .cmgr-card-stat-row { margin: 0; }
        .cmgr-selector-body .cmgr-dl-description { display: -webkit-box; margin: 0; overflow: hidden; color: var(--selector-muted); font-size: 12px; line-height: 1.65; white-space: pre-line; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
        .cmgr-selector-body .cmgr-dl-links { display: flex; flex-wrap: wrap; gap: 8px; }
        .cmgr-selector-body .cmgr-dl-links > * { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
        .cmgr-selector-body .cmgr-dl-links svg { width: 15px; height: 15px; }
        .cmgr-selector-body .cmgr-dl-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); grid-auto-flow: dense; gap: 10px 24px; margin: 0; }
        .cmgr-selector-body .cmgr-dl-facts > div { display: grid; gap: 3px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-facts > div:has(.is-path) { grid-column: 1 / -1; }
        .cmgr-selector-body .cmgr-dl-facts dt { color: var(--selector-muted); font-size: 10.5px; }
        .cmgr-selector-body .cmgr-dl-facts dd { margin: 0; color: var(--selector-text); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
        .cmgr-selector-body .cmgr-dl-facts dd a { color: var(--selector-accent); text-decoration: none; }
        .cmgr-selector-body .cmgr-dl-facts dd a:hover { text-decoration: underline; }
        .cmgr-selector-body .cmgr-dl-facts .is-path { font: 11px/18px ui-monospace, "Cascadia Mono", Consolas, monospace; user-select: text; }
        .cmgr-selector-body .cmgr-dl-reason { display: grid; gap: 4px; padding: 10px 12px; border-left: 3px solid var(--cmgr-danger); border-radius: 6px; background: color-mix(in srgb, var(--cmgr-danger) 9%, var(--selector-surface)); }
        .cmgr-selector-body .cmgr-dl-reason > b { color: var(--cmgr-danger); font-size: 12px; font-weight: 600; }
        .cmgr-selector-body .cmgr-dl-reason > span { color: var(--selector-text); font-size: 12px; line-height: 18px; }
        .cmgr-selector-body .cmgr-dl-reason > code { color: var(--selector-muted); font: 10.5px/16px ui-monospace, "Cascadia Mono", Consolas, monospace; overflow-wrap: anywhere; }
        .cmgr-selector-body .cmgr-dl-reason > a { display: inline-flex; align-items: center; justify-self: start; min-height: 30px; margin-top: 4px; text-decoration: none; }
        .cmgr-selector-body .cmgr-dl-row.is-new { animation: cmgrRowIn .32s cubic-bezier(.2,.7,.2,1); }
        .cmgr-selector-body .cmgr-dl-row.is-changed { animation: cmgrRowFlash .9s ease; }
        @keyframes cmgrRowIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        @keyframes cmgrRowFlash { from { background: var(--selector-selected); } to { background: var(--selector-surface); } }
        .cmgr-selector-body .cmgr-dl-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-head > b { min-width: 0; overflow: hidden; color: var(--selector-text); font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
        .cmgr-selector-body .cmgr-dl-chip { flex: 0 0 auto; padding: 1px 6px; border-radius: 4px; background: var(--selector-field); color: var(--selector-muted); font-size: 10px; }
        .cmgr-selector-body .is-downloading .cmgr-dl-status { background: var(--selector-selected); color: var(--selector-accent); }
        .cmgr-selector-body .is-completed .cmgr-dl-status { background: color-mix(in srgb, var(--selector-good) 15%, transparent); color: var(--selector-good); }
        .cmgr-selector-body .is-failed .cmgr-dl-status { background: color-mix(in srgb, var(--cmgr-danger) 14%, transparent); color: var(--cmgr-danger); }
        .cmgr-selector-body .cmgr-dl-bar { position: relative; height: 4px; overflow: hidden; border-radius: 2px; background: var(--selector-field); }
        .cmgr-selector-body .cmgr-dl-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--selector-accent); transition: width .6s linear; }
        .cmgr-selector-body .cmgr-dl-bar.is-indeterminate > span { width: 35% !important; animation: cmgrBarSlide 1.1s ease-in-out infinite; }
        @keyframes cmgrBarSlide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
        .cmgr-selector-body .cmgr-dl-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; color: var(--selector-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
        .cmgr-selector-body .cmgr-dl-meta b { color: var(--selector-text); font-weight: 550; }
        .cmgr-selector-body .cmgr-dl-meta i { font-style: normal; opacity: .5; }
        .cmgr-selector-body .cmgr-dl-meta .is-error { color: var(--cmgr-danger); overflow-wrap: anywhere; }
        .cmgr-selector-body .cmgr-dl-actions :is(.cmgr-primary, .cmgr-secondary) { min-height: 30px; padding: 0 10px; font-size: 11px; }
        .cmgr-selector-body .cmgr-dl-remove { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--selector-muted); cursor: pointer; opacity: 0; transition: opacity .15s ease, background-color .15s ease; }
        .cmgr-selector-body .cmgr-dl-row:hover .cmgr-dl-remove, .cmgr-selector-body .cmgr-dl-remove:focus-visible { opacity: 1; }
        .cmgr-selector-body .cmgr-dl-remove:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-dl-remove svg { width: 14px; height: 14px; }
        .cmgr-selector-body .cmgr-dl-inline { display: grid; gap: 7px; }
        .cmgr-selector-body .cmgr-dl-inline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
        .cmgr-selector-body .cmgr-dl-inline-head > b { flex: 0 0 auto; color: var(--selector-text); font-size: 12px; font-weight: 500; }
        .cmgr-selector-body .cmgr-dl-inline .cmgr-dl-meta { justify-content: flex-end; }
        .cmgr-applied-note { color: var(--selector-muted); font-size: 11px; }
        .cmgr-selector-body .cmgr-applied-rows { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .cmgr-selector-body .cmgr-applied-row { display: grid; grid-template-columns: 24px 20px 48px minmax(0, 1fr) minmax(160px, 240px) auto auto auto; align-items: center; gap: 12px; padding: 8px 10px 8px 6px; border: 1px solid var(--selector-line); border-radius: 8px; background: var(--selector-surface); transition: transform .18s cubic-bezier(.2,.7,.2,1), border-color .15s ease, background-color .15s ease; }
        .cmgr-selector-body .cmgr-applied-row:hover { border-color: color-mix(in srgb, var(--selector-muted) 55%, transparent); }
        .cmgr-selector-body .cmgr-applied-row.is-disabled :is(.cmgr-applied-order, .cmgr-applied-thumb, .cmgr-applied-info, .cmgr-applied-strength) { opacity: .42; }
        .cmgr-selector-body .cmgr-applied-row.is-dragging { position: relative; z-index: 3; transition: none; border-color: var(--selector-accent); background: var(--selector-selected); box-shadow: 0 12px 30px rgba(0, 0, 0, .35); }
        .cmgr-selector-body .cmgr-applied-handle { display: grid; place-items: center; width: 24px; height: 36px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--selector-muted); cursor: grab; touch-action: none; }
        .cmgr-selector-body .cmgr-applied-handle:hover { background: var(--selector-hover); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-applied-row.is-dragging .cmgr-applied-handle { cursor: grabbing; }
        .cmgr-selector-body .cmgr-applied-order { color: var(--selector-muted); font-size: 11px; font-variant-numeric: tabular-nums; text-align: center; }
        .cmgr-selector-body .cmgr-applied-thumb { width: 48px; height: 48px; }
        .cmgr-selector-body .cmgr-applied-info { display: grid; gap: 3px; min-width: 0; }
        .cmgr-selector-body .cmgr-applied-name { justify-self: start; max-width: 100%; margin: 0; padding: 0; overflow: hidden; border: 0; background: transparent; color: var(--selector-text); font: inherit; font-size: 13px; font-weight: 550; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
        .cmgr-selector-body .cmgr-applied-name:hover:not(:disabled) { color: var(--selector-accent); }
        .cmgr-selector-body .cmgr-applied-name:disabled { cursor: default; opacity: 1; }
        .cmgr-selector-body .cmgr-applied-meta { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--selector-muted); font-size: 11px; }
        .cmgr-selector-body .cmgr-applied-meta > i { flex: 0 0 auto; padding: 1px 6px; border-radius: 4px; background: var(--selector-field); font-size: 10px; font-style: normal; }
        .cmgr-selector-body .cmgr-applied-meta > i.is-warning { background: color-mix(in srgb, var(--selector-warn) 15%, transparent); color: var(--selector-warn); }
        .cmgr-selector-body .cmgr-applied-meta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cmgr-selector-body .cmgr-applied-strength { display: grid; grid-template-columns: minmax(0, 1fr) 64px; align-items: center; gap: 8px; }
        .cmgr-selector-body .cmgr-applied-strength input[type="number"] { min-height: 30px; padding: 4px 6px; font-variant-numeric: tabular-nums; text-align: right; }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"] {
            --cmgr-fill-a: calc(7px + (100% - 14px) * var(--cmgr-fill-from, 0));
            --cmgr-fill-b: calc(7px + (100% - 14px) * var(--cmgr-fill-to, 0));
            --cmgr-track: linear-gradient(to right, var(--selector-field) var(--cmgr-fill-a), var(--selector-accent) var(--cmgr-fill-a), var(--selector-accent) var(--cmgr-fill-b), var(--selector-field) var(--cmgr-fill-b));
            min-width: 0; height: 20px; margin: 0; padding: 0; background: linear-gradient(var(--selector-line), var(--selector-line)) no-repeat; background-size: 1px 10px;
            background-position: calc(7px + (100% - 14px) * var(--cmgr-zero, .5)) center; appearance: none; -webkit-appearance: none; cursor: pointer;
        }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--cmgr-track); }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--cmgr-track); }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"]::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px color-mix(in srgb, var(--selector-accent) 40%, transparent), 0 1px 3px rgba(0, 0, 0, .45); appearance: none; -webkit-appearance: none; transition: transform .12s ease; }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"]::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px color-mix(in srgb, var(--selector-accent) 40%, transparent), 0 1px 3px rgba(0, 0, 0, .45); }
        .cmgr-selector-body .cmgr-applied-strength input[type="range"]:active::-webkit-slider-thumb { transform: scale(1.15); }
        .cmgr-selector-body .cmgr-applied-words { display: inline-flex; align-items: center; gap: 4px; min-height: 30px; margin: 0; padding: 0 8px; border: 0; border-radius: 6px; background: var(--selector-field); color: var(--selector-muted); font: inherit; font-size: 11px; cursor: pointer; }
        .cmgr-selector-body .cmgr-applied-words svg { width: 13px; height: 13px; }
        .cmgr-selector-body .cmgr-applied-words:not(:disabled) { background: var(--selector-selected); color: var(--selector-accent); font-weight: 500; }
        .cmgr-selector-body .cmgr-applied-words:hover:not(:disabled) { background: var(--selector-primary); color: #fff; }
        .cmgr-selector-body .cmgr-applied-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 82px; min-height: 30px; margin: 0; padding: 0 10px; border: 1px solid var(--selector-line); border-radius: 6px; background: transparent; color: var(--selector-muted); font: inherit; font-size: 11px; font-weight: 500; cursor: pointer; transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
        .cmgr-selector-body .cmgr-applied-toggle > i { width: 12px; height: 12px; box-sizing: border-box; border: 1.5px solid currentColor; border-radius: 50%; }
        .cmgr-selector-body .cmgr-applied-toggle:hover { border-color: var(--selector-muted); color: var(--selector-text); }
        .cmgr-selector-body .cmgr-applied-toggle.is-on { border-color: transparent; background: color-mix(in srgb, var(--selector-good) 18%, transparent); color: var(--selector-good); }
        .cmgr-selector-body .cmgr-applied-toggle.is-on > i { border: 0; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2 5 8.6l4.5-5' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
        .cmgr-selector-body .cmgr-applied-toggle.is-on:hover { background: color-mix(in srgb, var(--selector-good) 26%, transparent); }
        .cmgr-selector-body .cmgr-applied-remove { display: grid; place-items: center; width: 30px; height: 30px; margin: 0; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--selector-muted); cursor: pointer; }
        .cmgr-selector-body .cmgr-applied-remove:hover { background: color-mix(in srgb, var(--cmgr-danger) 14%, transparent); color: var(--cmgr-danger); }
        .cmgr-selector-body .cmgr-applied-remove svg { width: 15px; height: 15px; }
        @media (hover: none) { .cmgr-selector-body .cmgr-dl-remove { opacity: 1; } }
        @media (max-width: 900px) {
            .cmgr-selector-body .cmgr-applied-row { grid-template-columns: 24px 48px minmax(0, 1fr) auto auto auto; }
            .cmgr-selector-body .cmgr-applied-order { display: none; }
            .cmgr-selector-body .cmgr-applied-strength { grid-column: 2 / -1; grid-row: 2; }
            .cmgr-selector-body .cmgr-dl-row-head { grid-template-columns: 44px minmax(0, 1fr) auto 28px; }
            .cmgr-selector-body .cmgr-dl-thumb { width: 44px; height: 44px; }
            .cmgr-selector-body .cmgr-dl-actions { grid-column: 2 / -1; grid-row: 2; }
            .cmgr-selector-body .cmgr-dl-details-body { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 980px) {
            .cmgr-selector-body .cmgr-split.has-detail { display: grid; grid-template-columns: minmax(0, 1fr); overflow: hidden; }
            .cmgr-selector-body .cmgr-split.has-detail > .cmgr-results { height: 100%; overflow-y: auto; }
            .cmgr-selector-body .cmgr-split.has-detail > .cmgr-detail { position: absolute; z-index: 5; inset: 0 0 0 auto; width: min(420px, 100%); height: 100%; overflow: hidden; border-left: 1px solid var(--selector-line); box-shadow: -18px 0 40px rgba(0, 0, 0, .35); transform: translateX(100%); visibility: hidden; transition: transform .22s cubic-bezier(.2,.7,.2,1), visibility 0s linear .22s; }
            .cmgr-selector-body .cmgr-split.has-detail.is-detail-open > .cmgr-detail { transform: none; visibility: visible; transition: transform .22s cubic-bezier(.2,.7,.2,1); }
            .cmgr-selector-body .cmgr-split.has-detail .cmgr-detail-scroll { height: 100%; overflow-y: auto; }
            .cmgr-selector-body .cmgr-detail-dismiss { position: absolute; z-index: 10; top: 22px; right: 24px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: var(--selector-menu); color: var(--selector-text); box-shadow: 0 4px 14px rgba(0, 0, 0, .3); cursor: pointer; }
            .cmgr-selector-body .cmgr-detail-dismiss svg { width: 16px; height: 16px; }
            .cmgr-lightbox-stage { padding: 20px 16px 8px; }
            .cmgr-lightbox-nav { top: auto; bottom: 64px; height: 46px; }
        }
        @media (max-width: 720px) {
            .cmgr-selector-body .cmgr-results { padding: 14px; gap: 12px; }
            .cmgr-selector-body :is(.cmgr-card .cmgr-card-body, .cmgr-skeleton-content) { min-height: 0; padding: 34px 10px 10px; }
            .cmgr-selector-body .cmgr-detail-scroll { padding: 16px; }
            .cmgr-selector-body :is(.cmgr-download-list, .cmgr-lora-applied-list) { padding: 14px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .cmgr-selector-body *, .cmgr-selector-body *::before, .cmgr-selector-body *::after,
            .cmgr-selector-body .cmgr-selector-section::details-content,
            .cmgr-selector-overlay .cmgr-combo-popover, .cmgr-selector-tools > .cmgr-selector-menu,
            .cmgr-selector-overlay .cmgr-notice { transition: none !important; animation: none !important; }
        }
        @media (max-width: 1179px) {
            .cmgr-selector-overlay .cmgr-selector-layout.has-filters.filters-open { grid-template-columns: minmax(0, 1fr); }
            .cmgr-selector-overlay .has-filters.filters-open > .cmgr-selector-nav { position: absolute; z-index: 3; inset: 0 auto 0 0; width: 248px; max-width: calc(100% - 40px); box-sizing: border-box; box-shadow: 12px 0 30px rgba(0, 0, 0, .25); }
            .cmgr-selector-overlay .has-filters.filters-open > .cmgr-selector-filter-backdrop { position: absolute; z-index: 2; inset: 0; display: block; border: 0; padding: 0; background: rgba(0, 0, 0, .4); cursor: pointer; }
        }
        @media (max-width: 720px) {
            .cmgr-selector-overlay .cmgr-selector-shell { width: 100vw; height: 100dvh; max-height: none; border-radius: 0; }
            .cmgr-selector-overlay .cmgr-selector-topbar { min-height: 54px; padding: 10px 14px; }
            .cmgr-selector-topbar .cmgr-topbar-actions { gap: 6px; }
            .cmgr-selector-filter-toggle { width: 32px; padding: 0; }
            .cmgr-selector-filter-toggle > span { display: none; }
            .cmgr-selector-workspace { grid-template-columns: 60px minmax(0, 1fr); }
            .cmgr-selector-tabs { padding: 10px 5px; gap: 6px; }
            .cmgr-selector-tab { min-height: 62px; padding: 9px 2px; font-size: 9px; line-height: 13px; }
            .cmgr-selector-tab > svg { width: 19px; height: 19px; }
            .cmgr-selector-tab b { font-size: 8px; right: 0; }
            .cmgr-selector-overlay .cmgr-selector-toolbar { padding: 16px 14px; gap: 12px; }
            .cmgr-selector-overlay .cmgr-selector-toolbar h2 { font-size: 17px; }
            .cmgr-selector-toolbar-top { gap: 10px; }
            .cmgr-selector-toolbar .cmgr-lora-local-heading { flex-direction: column; gap: 3px; }
            .cmgr-selector-toolbar .cmgr-lora-breadcrumb { max-width: 150px; }
            .cmgr-selector-button { min-height: 30px; padding: 0 8px; font-size: 11px; }
            .cmgr-selector-toolbar .cmgr-kind-tab { padding: 0 7px; font-size: 11px; }
            .cmgr-selector-sort > summary { max-width: 130px; gap: 4px; padding: 0 4px; font-size: 11px; }
            .cmgr-selector-menu { min-width: 180px; }
            .cmgr-selector-footer { padding: 0 12px; }
            .cmgr-selector-footer > div { gap: 8px; }
            .cmgr-selector-escape { display: none; }
        }
        @media (prefers-reduced-motion: reduce) { .cmgr-selector-tab { transition: none; } }
    `;
    document.head.appendChild(style);
}
