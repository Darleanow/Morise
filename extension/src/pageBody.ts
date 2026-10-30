/** Static markup of the editor page; shared by the provider and the DOM tests. */
export function pageBody(): string {
    return `<div id="app">
  <aside id="left" aria-label="Widgets and outline">
    <section id="palette-section" aria-label="Widget palette">
      <header class="panel-head"><h2>Widgets</h2><span class="spacer"></span><button id="palette-collapse" class="icon-btn" type="button" title="Collapse all categories" aria-label="Collapse all categories"></button></header>
      <input id="palette-filter" type="search" placeholder="Search widgets" aria-label="Search widgets">
      <div id="palette" class="scroll"></div>
    </section>
    <div id="split-palette" class="splitter h" role="separator" aria-orientation="horizontal" tabindex="0" title="Drag to resize. Double-click to reset."></div>
    <section id="outline-section" aria-label="Object hierarchy">
      <header class="panel-head"><h2>Outline</h2><span class="spacer"></span><button id="outline-collapse" class="icon-btn" type="button" title="Collapse or expand all" aria-label="Collapse or expand all"></button></header>
      <input id="outline-filter" type="search" placeholder="Filter objects" aria-label="Filter objects">
      <div id="tree" class="scroll" role="tree" aria-label="Objects"></div>
    </section>
  </aside>
  <div id="split-left" class="splitter v" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to resize. Double-click to reset."></div>
  <main id="canvas" aria-label="Form">
    <div id="toolbar" role="toolbar" aria-label="Form actions"></div>
    <div id="viewport">
      <div id="box">
        <div id="stage">
          <img id="form" alt="Form preview rendered by Qt" draggable="false">
          <div id="overlay"></div>
          <div id="ghost" hidden></div>
        </div>
      </div>
    </div>
    <div id="statusbar">
      <nav id="crumbs" aria-label="Selection path"></nav>
      <span id="next"></span>
      <span id="geom"></span>
      <span id="hint"></span>
      <div id="zoom" role="group" aria-label="Zoom"></div>
    </div>
  </main>
  <div id="split-right" class="splitter v" role="separator" aria-orientation="vertical" tabindex="0" title="Drag to resize. Double-click to reset."></div>
  <aside id="inspector" aria-label="Inspector">
    <header id="inspector-head"></header>
    <div id="tabs" role="tablist"></div>
    <div id="panel-properties" class="tabpanel" role="tabpanel">
      <div class="filter-row">
        <input id="filter" type="search" placeholder="Filter properties" aria-label="Filter properties">
        <button id="changed-only" class="chip" type="button" aria-pressed="false" title="Show only properties changed from their default"></button>
      </div>
      <div id="props" class="scroll"></div>
    </div>
    <div id="panel-code" class="tabpanel" role="tabpanel" hidden><div id="code" class="scroll"></div></div>
    <div id="panel-connections" class="tabpanel" role="tabpanel" hidden><div id="connections" class="scroll"></div></div>
    <div id="panel-form" class="tabpanel" role="tabpanel" hidden><div id="form-settings" class="scroll"></div></div>
  </aside>
</div>
<div id="loading" class="overlay-msg"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span><span>Starting the Qt engine\u2026</span></div>
<div id="engine-down" class="overlay-msg" role="alert" hidden><span class="codicon codicon-warning" aria-hidden="true"></span><b>The Qt engine stopped</b><span id="engine-down-text"></span><button id="engine-restart" class="btn primary" type="button">Restart the engine</button></div>
<div id="toasts" aria-live="polite" aria-atomic="false"></div>
<div id="popups"></div>`;
}
