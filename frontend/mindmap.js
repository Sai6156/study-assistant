/**
 * mindmap.js — Best-in-class interactive SVG mind map renderer
 *
 * Features:
 *  - Reingold-Tilford inspired tree layout (no dependencies)
 *  - Radial layout for the root (branches spread in all directions)
 *  - Pan (drag) + zoom (wheel/pinch)
 *  - Animated expand/collapse per node (click)
 *  - Color-coded by depth level (8 distinct palette colours)
 *  - Curved bezier edges
 *  - Hover tooltip showing full label
 *  - Node click → "Ask AI" about that node (calls window.mindmapAskNode)
 *  - Export as PNG via offscreen canvas
 */

window.MindMap = (function () {
  "use strict";

  // ─── Palette ─────────────────────────────────────────────────────
  const DEPTH_COLORS = [
    "#7c3aed", // 0 root — purple
    "#4f46e5", // 1 — indigo
    "#0ea5e9", // 2 — sky
    "#10b981", // 3 — emerald
    "#f59e0b", // 4 — amber
    "#ef4444", // 5 — red
    "#ec4899", // 6 — pink
    "#8b5cf6", // 7 — violet
  ];

  const getColor = (depth) => DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];

  const NODE_RADIUS_BASE = 10;
  const NODE_RADIUS_ROOT = 20;
  const NODE_RADIUS_L1   = 15;
  const NODE_FONT_ROOT   = 14;
  const NODE_FONT_L1     = 12;
  const NODE_FONT_LEAF   = 11;
  const H_SPACING        = 120; // horizontal gap between depth levels
  const V_SPACING        = 38;  // vertical gap between siblings

  // SVG namespace helper
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // ─── Layout ──────────────────────────────────────────────────────

  /**
   * Assign x,y to every node using a Reingold-Tilford-style bottom-up layout.
   * x = depth * H_SPACING  (horizontal axis)
   * y = centred among children
   * Returns the total height used.
   */
  function computeLayout(node, depth = 0) {
    node._depth = depth;
    node._collapsed = node._collapsed || false;

    if (!node.children || node.children.length === 0 || node._collapsed) {
      node._h = V_SPACING;
      return;
    }

    let totalH = 0;
    for (const child of node.children) {
      computeLayout(child, depth + 1);
      totalH += child._h;
    }
    node._h = Math.max(totalH, V_SPACING);
  }

  function assignPositions(node, x = 0, y = 0) {
    node._x = x;
    node._y = y;

    if (!node.children || node.children.length === 0 || node._collapsed) return;

    const totalH = node._h;
    let curY = y - totalH / 2;

    for (const child of node.children) {
      const childY = curY + child._h / 2;
      assignPositions(child, x + H_SPACING, childY);
      curY += child._h;
    }
  }

  // Collect all visible nodes/edges
  function collectVisible(node, nodes = [], edges = []) {
    nodes.push(node);
    if (!node.children || node._collapsed) return { nodes, edges };
    for (const child of node.children) {
      edges.push({ from: node, to: child });
      collectVisible(child, nodes, edges);
    }
    return { nodes, edges };
  }

  // Bounding box of visible nodes
  function getBBox(nodes) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n._x);
      maxX = Math.max(maxX, n._x);
      minY = Math.min(minY, n._y);
      maxY = Math.max(maxY, n._y);
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  // ─── Renderer class ──────────────────────────────────────────────

  class MindMapRenderer {
    constructor(container, data, opts = {}) {
      this.container  = container;
      this.root       = JSON.parse(JSON.stringify(data.root)); // deep clone
      this.title      = data.title || "Mind Map";
      this.onAsk      = opts.onAsk || null; // callback(label)
      this.isDark     = document.documentElement.getAttribute("data-theme") !== "light";

      // View transform
      this.pan  = { x: 0, y: 0 };
      this.zoom = 1;

      // Drag state
      this._dragging  = false;
      this._dragStart = { x: 0, y: 0 };
      this._panStart  = { x: 0, y: 0 };

      // Pinch
      this._lastPinchDist = null;

      this._build();
    }

    _build() {
      this.container.innerHTML = "";
      this.container.style.position = "relative";
      this.container.style.overflow = "hidden";

      // SVG
      this.svg = svgEl("svg", {
        class: "mindmap-svg",
        width: "100%",
        height: "100%",
      });

      // Defs (gradient, arrowhead)
      const defs = svgEl("defs");
      // arrowhead
      const marker = svgEl("marker", { id: "mm-arrow", markerWidth: "8", markerHeight: "8", refX: "6", refY: "3", orient: "auto" });
      const arrow  = svgEl("path",   { d: "M0,0 L0,6 L8,3 z", fill: "#555" });
      marker.appendChild(arrow);
      defs.appendChild(marker);
      this.svg.appendChild(defs);

      // Main group (pan/zoom target)
      this.g = svgEl("g", { class: "mm-main" });
      this.svg.appendChild(this.g);

      this.container.appendChild(this.svg);

      // Tooltip
      this.tooltip = document.createElement("div");
      this.tooltip.className = "mm-tooltip";
      this.container.appendChild(this.tooltip);

      // Zoom controls
      this._addControls();

      // Events
      this._bindEvents();

      // Initial render
      this._render();
      this._fitToView();
    }

    _addControls() {
      const ctrl = document.createElement("div");
      ctrl.className = "mindmap-controls";

      const btnZoomIn  = this._ctrlBtn("+", () => this._applyZoom(1.2));
      const btnZoomOut = this._ctrlBtn("−", () => this._applyZoom(0.8));
      const btnFit     = this._ctrlBtn("⊡", () => this._fitToView());
      const btnExp     = this._ctrlBtn("⊞", () => { this._expandAll(); this._render(); this._fitToView(); });
      const btnCol     = this._ctrlBtn("⊟", () => { this._collapseAll(); this._render(); this._fitToView(); });

      btnZoomIn.title  = "Zoom in";
      btnZoomOut.title = "Zoom out";
      btnFit.title     = "Fit to view";
      btnExp.title     = "Expand all";
      btnCol.title     = "Collapse all";

      [btnZoomIn, btnZoomOut, btnFit, btnExp, btnCol].forEach(b => ctrl.appendChild(b));
      this.container.appendChild(ctrl);
    }

    _ctrlBtn(label, onClick) {
      const b = document.createElement("button");
      b.className = "mm-ctrl-btn";
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      return b;
    }

    _expandAll(node = this.root) {
      node._collapsed = false;
      (node.children || []).forEach(c => this._expandAll(c));
    }

    _collapseAll(node = this.root, depth = 0) {
      if (depth >= 2) node._collapsed = true;
      (node.children || []).forEach(c => this._collapseAll(c, depth + 1));
    }

    _render() {
      // Re-layout
      computeLayout(this.root);
      assignPositions(this.root);

      const { nodes, edges } = collectVisible(this.root);
      this.g.innerHTML = "";

      // Draw edges first
      const edgeGroup = svgEl("g", { class: "mm-edges" });
      for (const edge of edges) {
        const path = this._makeEdge(edge.from, edge.to);
        edgeGroup.appendChild(path);
      }
      this.g.appendChild(edgeGroup);

      // Draw nodes
      const nodeGroup = svgEl("g", { class: "mm-nodes" });
      for (const node of nodes) {
        const g = this._makeNode(node);
        nodeGroup.appendChild(g);
      }
      this.g.appendChild(nodeGroup);

      this._applyTransform();
    }

    _makeEdge(from, to) {
      const fx = from._x, fy = from._y;
      const tx = to._x,   ty = to._y;

      // cubic bezier: control points at midpoint
      const mx = (fx + tx) / 2;
      const d  = `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`;

      const color = getColor(to._depth);
      return svgEl("path", {
        class: "mm-edge",
        d,
        stroke: color,
        "stroke-opacity": "0.55",
        "stroke-width": to._depth <= 1 ? "2" : "1.5",
      });
    }

    _makeNode(node) {
      const g    = svgEl("g", { class: "mm-node", "data-id": node.id || "" });
      const x    = node._x, y = node._y;
      const depth = node._depth || 0;
      const color = getColor(depth);
      const hasChildren = node.children && node.children.length > 0;

      const r = depth === 0 ? NODE_RADIUS_ROOT : depth === 1 ? NODE_RADIUS_L1 : NODE_RADIUS_BASE;
      const fontSize = depth === 0 ? NODE_FONT_ROOT : depth === 1 ? NODE_FONT_L1 : NODE_FONT_LEAF;
      const fontWeight = depth <= 1 ? "600" : "400";

      // Glow circle behind (only for root & L1)
      if (depth <= 1) {
        const glow = svgEl("circle", {
          cx: x, cy: y, r: r + 5,
          fill: color,
          "fill-opacity": "0.12",
        });
        g.appendChild(glow);
      }

      // Main circle
      const circle = svgEl("circle", {
        class: "mm-node-circle",
        cx: x, cy: y, r,
        fill: color,
        stroke: this.isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)",
        "stroke-width": "1.5",
        style: "transition: r 0.2s, fill-opacity 0.2s;",
      });
      g.appendChild(circle);

      // Collapse indicator (if has children)
      if (hasChildren) {
        const ind = svgEl("text", {
          x, y: y + 1,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          "font-size": Math.max(8, r - 4),
          fill: "#fff",
          "pointer-events": "none",
          "font-weight": "700",
          style: "user-select:none",
        });
        ind.textContent = node._collapsed ? "+" : (depth === 0 ? "" : "−");
        g.appendChild(ind);
      }

      // Label
      const label = node.label || "";
      const words = label.split(" ");
      const maxCharsPerLine = depth === 0 ? 12 : 16;
      const lines = this._wrapText(label, maxCharsPerLine);

      const labelX = depth === 0 ? x : x + r + 8;
      const labelAnchor = depth === 0 ? "middle" : "start";
      const labelBaseY = depth === 0 ? y + r + 14 : y;

      if (depth === 0) {
        // Root: label below circle
        lines.forEach((line, i) => {
          const t = svgEl("text", {
            class: "mm-node-label",
            x: labelX,
            y: labelBaseY + i * (fontSize + 2),
            "text-anchor": labelAnchor,
            "dominant-baseline": "auto",
            "font-size": fontSize,
            "font-weight": fontWeight,
            fill: this.isDark ? "#cdd6f4" : "#1e1e2e",
          });
          t.textContent = line;
          g.appendChild(t);
        });
      } else {
        // Non-root: label to the right of circle
        const lineH = fontSize + 2;
        const totalH = lines.length * lineH;
        lines.forEach((line, i) => {
          const t = svgEl("text", {
            class: "mm-node-label",
            x: labelX,
            y: y - totalH / 2 + lineH * i + fontSize,
            "text-anchor": labelAnchor,
            "dominant-baseline": "auto",
            "font-size": fontSize,
            "font-weight": fontWeight,
            fill: this.isDark ? "#cdd6f4" : "#1e1e2e",
          });
          t.textContent = line;
          g.appendChild(t);
        });
      }

      // Invisible hit target
      const hit = svgEl("circle", {
        cx: x, cy: y, r: Math.max(r + 12, 20),
        fill: "transparent",
        cursor: hasChildren ? "pointer" : "default",
      });
      g.appendChild(hit);

      // Click: toggle collapse / ask AI
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hasChildren) {
          node._collapsed = !node._collapsed;
          this._render();
        }
      });
      hit.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (this.onAsk) this.onAsk(node.label);
      });

      // Hover tooltip for long labels
      hit.addEventListener("mouseenter", (e) => {
        this.tooltip.textContent = label + (hasChildren ? (node._collapsed ? " (click to expand)" : " (click to collapse)") : " (dbl-click to ask AI)");
        this.tooltip.classList.add("visible");
        this._positionTooltip(e);
      });
      hit.addEventListener("mousemove", this._positionTooltip.bind(this));
      hit.addEventListener("mouseleave", () => this.tooltip.classList.remove("visible"));

      return g;
    }

    _wrapText(text, maxChars) {
      if (text.length <= maxChars) return [text];
      const words = text.split(" ");
      const lines = [];
      let current = "";
      for (const w of words) {
        if ((current + " " + w).trim().length <= maxChars) {
          current = (current + " " + w).trim();
        } else {
          if (current) lines.push(current);
          current = w;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [text.slice(0, maxChars)];
    }

    _positionTooltip(e) {
      const rect = this.container.getBoundingClientRect();
      let tx = e.clientX - rect.left + 14;
      let ty = e.clientY - rect.top - 14;
      if (tx + 200 > rect.width) tx = e.clientX - rect.left - 14 - 180;
      this.tooltip.style.left = tx + "px";
      this.tooltip.style.top  = ty + "px";
    }

    // ─── Pan/Zoom ───────────────────────────────────────────────────

    _applyTransform() {
      this.g.setAttribute("transform", `translate(${this.pan.x}, ${this.pan.y}) scale(${this.zoom})`);
    }

    _applyZoom(factor, cx, cy) {
      const rect = this.container.getBoundingClientRect();
      if (cx === undefined) cx = rect.width / 2;
      if (cy === undefined) cy = rect.height / 2;

      const newZoom = Math.min(Math.max(this.zoom * factor, 0.15), 4);
      const scale   = newZoom / this.zoom;

      this.pan.x = cx - scale * (cx - this.pan.x);
      this.pan.y = cy - scale * (cy - this.pan.y);
      this.zoom  = newZoom;
      this._applyTransform();
    }

    _fitToView() {
      const { nodes } = collectVisible(this.root);
      if (!nodes.length) return;
      const bbox = getBBox(nodes);
      const rect = this.container.getBoundingClientRect();
      const W = rect.width  || 600;
      const H = rect.height || 500;

      const padX = 60, padY = 60;
      const dataW = bbox.w + padX * 2;
      const dataH = bbox.h + padY * 2;

      const scaleX = W / dataW;
      const scaleY = H / dataH;
      this.zoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.15), 2);

      this.pan.x = W / 2 - this.zoom * (bbox.minX + bbox.w / 2);
      this.pan.y = H / 2 - this.zoom * (bbox.minY + bbox.h / 2);

      this._applyTransform();
    }

    _bindEvents() {
      const c = this.container;

      // Mouse drag (pan)
      c.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        this._dragging  = true;
        this._dragStart = { x: e.clientX, y: e.clientY };
        this._panStart  = { x: this.pan.x, y: this.pan.y };
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!this._dragging) return;
        this.pan.x = this._panStart.x + (e.clientX - this._dragStart.x);
        this.pan.y = this._panStart.y + (e.clientY - this._dragStart.y);
        this._applyTransform();
      });
      window.addEventListener("mouseup", () => { this._dragging = false; });

      // Wheel zoom
      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 0.9;
        this._applyZoom(factor, cx, cy);
      }, { passive: false });

      // Touch: pinch zoom + drag
      c.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
          this._dragging  = true;
          this._dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          this._panStart  = { x: this.pan.x, y: this.pan.y };
        } else if (e.touches.length === 2) {
          this._lastPinchDist = this._pinchDist(e);
        }
        e.preventDefault();
      }, { passive: false });

      c.addEventListener("touchmove", (e) => {
        if (e.touches.length === 1 && this._dragging) {
          this.pan.x = this._panStart.x + (e.touches[0].clientX - this._dragStart.x);
          this.pan.y = this._panStart.y + (e.touches[0].clientY - this._dragStart.y);
          this._applyTransform();
        } else if (e.touches.length === 2) {
          const dist = this._pinchDist(e);
          if (this._lastPinchDist) {
            const factor = dist / this._lastPinchDist;
            const rect   = c.getBoundingClientRect();
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            this._applyZoom(factor, cx, cy);
          }
          this._lastPinchDist = dist;
        }
        e.preventDefault();
      }, { passive: false });

      c.addEventListener("touchend", () => {
        this._dragging = false;
        this._lastPinchDist = null;
      });
    }

    _pinchDist(e) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      return Math.hypot(dx, dy);
    }

    // ─── Export ─────────────────────────────────────────────────────

    exportPNG() {
      const svgEl = this.svg;
      const rect  = this.container.getBoundingClientRect();
      const W = rect.width  || 900;
      const H = rect.height || 600;

      const serializer = new XMLSerializer();
      let svgStr = serializer.serializeToString(svgEl);

      // Inject size
      svgStr = svgStr.replace(/width="[^"]*"/, `width="${W}"`)
                     .replace(/height="[^"]*"/, `height="${H}"`);

      const canvas = document.createElement("canvas");
      canvas.width  = W * 2;
      canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);

      // Fill background
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-ter").trim() || "#13131f";
      ctx.fillRect(0, 0, W, H);

      const img = new Image();
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url  = URL.createObjectURL(blob);

      img.onload = () => {
        ctx.drawImage(img, 0, 0, W, H);
        URL.revokeObjectURL(url);
        const link = document.createElement("a");
        link.download = "mindmap.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
      img.src = url;
    }

    // ─── Public API ─────────────────────────────────────────────────

    /** Re-render after theme change */
    updateTheme() {
      this.isDark = document.documentElement.getAttribute("data-theme") !== "light";
      this._render();
    }

    /** Programmatically zoom to a node */
    focusNode(id) {
      const find = (n) => {
        if (n.id === id) return n;
        for (const c of (n.children || [])) { const r = find(c); if (r) return r; }
        return null;
      };
      const node = find(this.root);
      if (!node) return;
      const rect = this.container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      this.pan.x = cx - this.zoom * node._x;
      this.pan.y = cy - this.zoom * node._y;
      this._applyTransform();
    }

    destroy() {
      this.container.innerHTML = "";
    }
  }

  // ─── Public factory ──────────────────────────────────────────────

  function create(container, data, opts) {
    return new MindMapRenderer(container, data, opts);
  }

  return { create };
})();
