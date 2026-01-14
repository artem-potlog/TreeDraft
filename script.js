// --- Configuration ---
const CONFIG = {
    nodeSize: 40,
    levelW: 180,
    leafH: 60,
    siblingSpacing: 20,
    colors: {
        decision: '#007bff', // Blue
        chance: '#28a745',   // Green
        terminal: '#dc3545', // Red
        selected: '#ffc107',
        text: '#333'
    }
};

// --- State ---
let treeData = {
    id: 'root',
    type: 'decision',
    label: 'Start',
    value: 0,
    cost: 0, // investment/cost at this node (can be negative)
    children: []
};

let selectedNodeId = treeData.id;
let selectedNodeIds = new Set([treeData.id]); // multi-select
let autoProbabilitiesEnabled = true;

// View State
let viewState = {
    scale: 1,
    offsetX: 50,
    offsetY: 300,
    isDraggingCanvas: false,
    lastMouseX: 0,
    lastMouseY: 0
};

// Interaction State
let dragNodeId = null;
let dropTargetId = null;
let editingField = null; // { nodeId, field ('label'|'value'|'prob'), element }
let dragIntent = null; // { kind: 'node'|'link'|'canvas', nodeId?, startX, startY, active }
let selectionBox = { active: false, startX: 0, startY: 0, endX: 0, endY: 0 };
let isSpaceDown = false;

// Drawing + Notes
let toolMode = 'select'; // 'select' | 'pen' | 'eraser' | 'note'
let annotations = []; // { id, d, points, color, width }
let penState = { active: false, points: [] }; // points in world coords
let penColor = '#222';
let eraserState = { active: false, didStart: false, points: [] };
let digitsFontSize = 12; // px
let treeColorsEnabled = false;
let notes = []; // { id, x, y, w, h, text } in world coords
let noteDrag = { id: null, startClientX: 0, startClientY: 0, startX: 0, startY: 0 };
let noteResize = { id: null, startClientX: 0, startClientY: 0, startW: 0, startH: 0 };

// Overlay selection (notes / pen drawings). Nodes use selectedNodeId/selectedNodeIds.
let selectedOverlay = { kind: null, id: null }; // kind: 'note' | 'annotation' | null

// Copy/Paste (tree only)
let copyBuffer = null; // { nodes: Array<treeNode> }

// Undo/Redo
let undoStack = [];
let redoStack = [];
const HISTORY_LIMIT = 100;

// --- DOM Elements ---
const container = document.getElementById('tree-container');
const contextMenu = document.getElementById('context-menu');
const statusBar = document.getElementById('status-bar');
const selectionRectEl = document.getElementById('selection-rect');
const notesLayer = document.getElementById('notes-layer');

// --- Initialization ---
function init() {
    setupEventListeners();
    setupCanvasInteractions();
    
    // Initial centering
    viewState.offsetY = container.clientHeight / 2;
    
    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    pushHistory('init');
    render();
}

function deepClone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

function serializeState() {
    return deepClone({
        treeData,
        viewState,
        selectedNodeId,
        selectedNodeIds: Array.from(selectedNodeIds),
        autoProbabilitiesEnabled,
        toolMode,
        penColor,
        digitsFontSize,
        treeColorsEnabled,
        annotations,
        notes,
        selectedOverlay
    });
}

function restoreState(state) {
    treeData = state.treeData;
    viewState = state.viewState;
    selectedNodeId = state.selectedNodeId;
    selectedNodeIds = new Set(state.selectedNodeIds || [treeData.id]);
    autoProbabilitiesEnabled = !!state.autoProbabilitiesEnabled;
    toolMode = state.toolMode || 'select';
    penColor = state.penColor || '#222';
    digitsFontSize = Number(state.digitsFontSize ?? 12) || 12;
    treeColorsEnabled = !!state.treeColorsEnabled;
    annotations = state.annotations || [];
    notes = state.notes || [];
    selectedOverlay = state.selectedOverlay || { kind: null, id: null };

    const autoProb = document.getElementById('auto-prob');
    if (autoProb) autoProb.checked = autoProbabilitiesEnabled;
    updateToolButtons();
    updatePenColorUI();
    applyDigitsFontSize();
    const digitsSelect = document.getElementById('digits-font-select');
    if (digitsSelect) digitsSelect.value = String(digitsFontSize);
    const treeColors = document.getElementById('tree-colors');
    if (treeColors) treeColors.checked = treeColorsEnabled;
    applyTreeColorsMode();
    render();
}

function pushHistory(reason) {
    // Keep history lightweight by bounding size
    undoStack.push(serializeState());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (undoStack.length <= 1) return; // keep initial snapshot
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = undoStack[undoStack.length - 1];
    restoreState(deepClone(prev));
}

function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push(deepClone(next));
    restoreState(deepClone(next));
}

// --- Event Listeners ---
function setupEventListeners() {
    document.getElementById('reset-view').addEventListener('click', centerView);
    // Digits font size dropdown
    const digitsSelect = document.getElementById('digits-font-select');
    if (digitsSelect) {
        digitsSelect.value = String(digitsFontSize);
        digitsSelect.addEventListener('change', () => {
            digitsFontSize = clampInt(Number(digitsSelect.value), 9, 20);
            applyDigitsFontSize();
            updateStatus();
        });
    }

    const treeColors = document.getElementById('tree-colors');
    if (treeColors) {
        treeColors.checked = treeColorsEnabled;
        treeColors.addEventListener('change', () => {
            treeColorsEnabled = !!treeColors.checked;
            applyTreeColorsMode();
            render();
        });
    }

    document.getElementById('export-png')?.addEventListener('click', () => exportAsPng());
    document.getElementById('export-pdf')?.addEventListener('click', () => exportAsPdf());

    // Toolbar actions (operate on selected node)
    document.getElementById('add-decision').addEventListener('click', () => addChildToSelected('decision'));
    document.getElementById('add-chance').addEventListener('click', () => addChildToSelected('chance'));
    document.getElementById('add-terminal').addEventListener('click', () => addChildToSelected('terminal'));
    document.getElementById('delete-node').addEventListener('click', () => deleteCurrentSelection());
    document.getElementById('to-decision').addEventListener('click', () => convertSelectedNodeType('decision'));
    document.getElementById('to-chance').addEventListener('click', () => convertSelectedNodeType('chance'));

    // Tools
    document.getElementById('tool-select')?.addEventListener('click', () => setToolMode('select'));
    document.getElementById('tool-pen')?.addEventListener('click', () => setToolMode('pen'));
    document.getElementById('tool-eraser')?.addEventListener('click', () => setToolMode('eraser'));
    document.getElementById('tool-note')?.addEventListener('click', () => setToolMode('note'));
    document.getElementById('pen-color')?.addEventListener('click', () => togglePenColor());
    updateToolButtons();
    updatePenColorUI();
    updateCanvasCursor();
    applyDigitsFontSize();
    applyTreeColorsMode();

    const autoProb = document.getElementById('auto-prob');
    autoProb.checked = true;
    autoProb.addEventListener('change', () => {
        autoProbabilitiesEnabled = !!autoProb.checked;
        if (autoProbabilitiesEnabled) {
            applyAutoProbabilitiesIfEnabled(treeData);
            calculateEMV(treeData);
            render();
        }
        updateStatus();
    });

    // Context Menu Handling
    document.addEventListener('click', (e) => {
        hideContextMenu();
        if (editingField && !e.target.classList.contains('inline-editor')) {
            finishEditing();
        }
    });

    document.getElementById('context-menu').addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        if (action && window.contextNodeId) {
            handleContextAction(action, window.contextNodeId);
        }
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Undo/Redo (avoid interfering with text editing)
        const isTyping = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        if (!isTyping && e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            undo();
            return;
        }
        if (!isTyping && e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            redo();
            return;
        }

        // Copy/Paste subtree (tree only)
        if (!isTyping && e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            copySelectedSubtree();
            return;
        }
        if (!isTyping && e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
            e.preventDefault();
            pasteSubtreeToSelected();
            return;
        }

        if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            deleteCurrentSelection();
            return;
        }

        if (e.code === 'Space') {
            // prevent page scrolling when focusing body
            e.preventDefault();
            isSpaceDown = true;
        }
        if (e.key === 'Escape') {
            hideContextMenu();
            finishEditing(false); // Cancel edit
        }
        if (e.key === 'Enter' && editingField) {
            finishEditing(true);
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isSpaceDown = false;
        }
    });

    // Note dragging handlers (single global listeners)
    window.addEventListener('mousemove', (e) => {
        if (!noteDrag.id) return;
        const n = notes.find(x => x.id === noteDrag.id);
        if (!n) return;
        const dx = (e.clientX - noteDrag.startClientX) / viewState.scale;
        const dy = (e.clientY - noteDrag.startClientY) / viewState.scale;
        n.x = noteDrag.startX + dx;
        n.y = noteDrag.startY + dy;
        renderNotes();
    });
    window.addEventListener('mouseup', () => {
        if (!noteDrag.id) return;
        noteDrag.id = null;
    });

    // Note resize handlers
    window.addEventListener('mousemove', (e) => {
        if (!noteResize.id) return;
        const n = notes.find(x => x.id === noteResize.id);
        if (!n) return;
        const dx = (e.clientX - noteResize.startClientX);
        const dy = (e.clientY - noteResize.startClientY);
        n.w = Math.max(140, noteResize.startW + dx);
        n.h = Math.max(90, noteResize.startH + dy);
        renderNotes();
    });
    window.addEventListener('mouseup', () => {
        if (!noteResize.id) return;
        noteResize.id = null;
    });
}

function setToolMode(mode) {
    toolMode = mode;
    updateToolButtons();
    updateStatus();
    updateCanvasCursor();
}

function togglePenColor() {
    penColor = (penColor === '#e11d2e') ? '#222' : '#e11d2e';
    updatePenColorUI();
    updateCanvasCursor();
}

function updatePenColorUI() {
    const sw = document.querySelector('#pen-color .color-swatch');
    if (sw) sw.style.background = penColor;
}

function applyDigitsFontSize() {
    document.body.style.setProperty('--digits-font-size', `${digitsFontSize}px`);
}

function clampInt(n, min, max) {
    return Math.min(max, Math.max(min, Math.round(n)));
}

function applyTreeColorsMode() {
    container.classList.toggle('tree-colored', !!treeColorsEnabled);
}

// --- Export (cropped) ---
async function exportAsPng() {
    try {
        const { svgString, width, height } = buildCroppedExportSvg();
        const dataUrl = await svgToPngDataUrl(svgString, width, height, 2);
        downloadDataUrl(dataUrl, `TreeDraft-${Date.now()}.png`);
    } catch (e) {
        console.error(e);
        alert('Export failed. See console for details.');
    }
}

async function exportAsPdf() {
    try {
        const { svgString, width, height } = buildCroppedExportSvg();
        const dataUrl = await svgToPngDataUrl(svgString, width, height, 2);
        openPrintWindowWithImage(dataUrl, width, height);
    } catch (e) {
        console.error(e);
        alert('Export failed. See console for details.');
    }
}

function buildCroppedExportSvg() {
    // Build an offscreen SVG that contains: annotations + links + nodes + notes, then crop to bbox.
    const layout = calculateLayout(treeData);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '1000');
    svg.setAttribute('height', '1000');

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    // Annotations
    annotations.forEach(a => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', a.d);
        p.setAttribute('stroke', a.color || '#222');
        p.setAttribute('stroke-width', String(a.width || 2));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        g.appendChild(p);
    });

    // Links
    layout.nodes.forEach(n => {
        if (!n.parent) return;
        const parent = n.parent;
        const node = n;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const midX = (parent.x + node.x) / 2;
        const d = `M${parent.x + 20},${parent.y} C${midX},${parent.y} ${midX},${node.y} ${node.x - 20},${node.y}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#999');
        path.setAttribute('stroke-width', '2');
        g.appendChild(path);

        // Probability label (if parent chance and value exists)
        if (parent.raw?.type === 'chance' && node.raw.probability !== undefined && node.raw.probability !== null) {
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', String((parent.x + node.x) / 2));
            txt.setAttribute('y', String((parent.y + node.y) / 2 - 5));
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('fill', '#444');
            txt.setAttribute('font-size', String(Math.max(9, digitsFontSize - 2)));
            if (autoProbabilitiesEnabled) txt.textContent = `${Math.round(Number(node.raw.probability) * 1000) / 10}%`;
            else txt.textContent = String(node.raw.probability);
            g.appendChild(txt);
        }
    });

    // Nodes
    layout.nodes.forEach(n => {
        const node = n.raw;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', `translate(${n.x}, ${n.y})`);
        g.appendChild(group);

        // Border color mode
        let stroke = '#333';
        if (treeColorsEnabled) {
            if (node.id === treeData.id || node.type === 'decision') stroke = '#f1c40f';
            if (node.type === 'chance') stroke = '#28a745';
            if (node.type === 'terminal') stroke = '#1e90ff';
        }

        let shape;
        if (node.type === 'decision') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            shape.setAttribute('x', '-15');
            shape.setAttribute('y', '-15');
            shape.setAttribute('width', '30');
            shape.setAttribute('height', '30');
        } else if (node.type === 'chance') {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            shape.setAttribute('r', '15');
        } else {
            shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            shape.setAttribute('points', '-15,-15 15,0 -15,15');
        }
        shape.setAttribute('fill', '#fff');
        shape.setAttribute('stroke', stroke);
        shape.setAttribute('stroke-width', '2');
        group.appendChild(shape);

        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', '0');
        label.setAttribute('y', '-25');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#333');
        label.setAttribute('font-size', '12');
        label.textContent = node.label || '';
        group.appendChild(label);

        // Value/EMV (1 decimal)
        const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        val.setAttribute('x', '0');
        val.setAttribute('y', '5');
        val.setAttribute('text-anchor', 'middle');
        val.setAttribute('fill', '#000');
        val.setAttribute('font-weight', '700');
        val.setAttribute('font-size', String(digitsFontSize));
        if (node.type === 'terminal') {
            const isUntouchedZero = (node.payoffEdited !== true) && ((Number(node.value) || 0) === 0);
            val.textContent = isUntouchedZero ? 'enter payoff' : String(Number(node.value ?? 0));
            if (isUntouchedZero) {
                val.setAttribute('fill', '#777');
                val.setAttribute('font-weight', '500');
                val.setAttribute('font-style', 'italic');
                val.setAttribute('font-size', String(Math.max(10, digitsFontSize)));
            }
        } else {
            val.textContent = node.emv !== undefined ? Number(node.emv).toFixed(1) : '0.0';
        }
        group.appendChild(val);

        // Decision investment
        if (node.type === 'decision') {
            const cost = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            cost.setAttribute('x', '0');
            cost.setAttribute('y', '28');
            cost.setAttribute('text-anchor', 'middle');
            cost.setAttribute('fill', '#333');
            cost.setAttribute('font-size', '10');
            cost.textContent = `Inv: ${Number(node.cost || 0)}`;
            group.appendChild(cost);
        }
    });

    // Notes (render as SVG shapes + text)
    notes.forEach(n => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(n.x));
        rect.setAttribute('y', String(n.y));
        rect.setAttribute('width', String(n.w || 220));
        rect.setAttribute('height', String(n.h || 120));
        rect.setAttribute('rx', '10');
        rect.setAttribute('fill', '#fff7a8');
        rect.setAttribute('stroke', '#e2d36f');
        g.appendChild(rect);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(n.x + 10));
        text.setAttribute('y', String(n.y + 22));
        text.setAttribute('fill', '#333');
        text.setAttribute('font-family', 'Times New Roman, Times, serif');
        text.setAttribute('font-size', '16');
        const lines = String(n.text || '').split(/\r?\n/);
        lines.slice(0, 20).forEach((line, i) => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(n.x + 10));
            tspan.setAttribute('dy', i === 0 ? '0' : '20');
            tspan.textContent = line;
            text.appendChild(tspan);
        });
        g.appendChild(text);
    });

    // Measure bbox (must be in DOM)
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '-10000px';
    holder.style.width = '1px';
    holder.style.height = '1px';
    holder.style.overflow = 'hidden';
    holder.appendChild(svg);
    document.body.appendChild(holder);

    const bbox = g.getBBox();
    const pad = 20;
    const vbX = bbox.x - pad;
    const vbY = bbox.y - pad;
    const vbW = Math.max(1, bbox.width + pad * 2);
    const vbH = Math.max(1, bbox.height + pad * 2);

    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    svg.setAttribute('width', String(vbW));
    svg.setAttribute('height', String(vbH));

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);

    document.body.removeChild(holder);

    return { svgString, width: vbW, height: vbH };
}

function svgToPngDataUrl(svgString, width, height, scale = 2) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(width * scale);
            canvas.height = Math.ceil(height * scale);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function openPrintWindowWithImage(dataUrl, width, height) {
    const w = window.open('', '_blank');
    if (!w) {
        alert('Popup blocked. Please allow popups for PDF export.');
        return;
    }
    const css = `
      <style>
        @page { margin: 0; size: auto; }
        html, body { margin: 0; padding: 0; }
        img { display:block; width: 100%; height: auto; }
      </style>
    `;
    w.document.open();
    w.document.write(`<!doctype html><html><head><title>TreeDraft Export</title>${css}</head><body><img src="${dataUrl}" /></body></html>`);
    w.document.close();
    w.focus();
    // give the image a moment to load before printing
    setTimeout(() => w.print(), 250);
}

function updateCanvasCursor() {
    // Cursor should reflect current tool (and pen color).
    container.classList.remove('cursor-hand', 'cursor-pen-black', 'cursor-pen-red', 'cursor-eraser');
    if (toolMode === 'select') container.classList.add('cursor-hand');
    if (toolMode === 'pen') container.classList.add(penColor === '#e11d2e' ? 'cursor-pen-red' : 'cursor-pen-black');
    if (toolMode === 'eraser') container.classList.add('cursor-eraser');
    if (toolMode === 'note') container.classList.add('cursor-hand');
}

function clearOverlaySelection() {
    selectedOverlay = { kind: null, id: null };
}

function applyNoteSelectionClasses() {
    if (!notesLayer) return;
    notesLayer.querySelectorAll('.sticky-note').forEach(el => {
        const id = el.dataset.id;
        const isSel = selectedOverlay.kind === 'note' && selectedOverlay.id === id;
        el.classList.toggle('selected', isSel);
    });
}

function deleteCurrentSelection() {
    // Delete overlay selection first (note/annotation), otherwise delete selected node
    if (selectedOverlay.kind === 'note' && selectedOverlay.id) {
        pushHistory('note-delete');
        notes = notes.filter(n => n.id !== selectedOverlay.id);
        clearOverlaySelection();
        render();
        return;
    }
    if (selectedOverlay.kind === 'annotation' && selectedOverlay.id) {
        pushHistory('annotation-delete');
        annotations = annotations.filter(a => a.id !== selectedOverlay.id);
        clearOverlaySelection();
        render();
        return;
    }
    deleteSelected();
}

function copySelectedSubtree() {
    // Copy selected tree roots (if multi-select) or selectedNodeId.
    const roots = getSelectionRoots(selectedNodeIds);
    const idsToCopy = roots.length ? roots : (selectedNodeId ? [selectedNodeId] : []);
    const nodes = idsToCopy
        .map(id => findNode(treeData, id))
        .filter(Boolean)
        .map(n => deepClone(n));

    if (nodes.length === 0) return;
    copyBuffer = { nodes };
    updateStatus();
}

function pasteSubtreeToSelected() {
    if (!copyBuffer || !Array.isArray(copyBuffer.nodes) || copyBuffer.nodes.length === 0) return;
    const target = findNode(treeData, selectedNodeId);
    if (!target) return;
    if (target.type === 'terminal') {
        alert('Cannot paste into a terminal node.');
        return;
    }

    pushHistory('paste');

    copyBuffer.nodes.forEach(src => {
        const clone = deepClone(src);
        remapIdsDeep(clone);
        // Incoming-edge probability belongs to the chance parent; treat pasted branch as untouched.
        if (target.type === 'chance') clone.probability = 0;
        target.children.push(clone);
    });

    if (target.type === 'chance') normalizeChanceNodeAuto(target);
    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    render();
}

function remapIdsDeep(node) {
    node.id = Math.random().toString(36).substr(2, 9);
    if (node.type === 'chance') node.manualProbIds = [];
    if (Array.isArray(node.children)) node.children.forEach(remapIdsDeep);
    else node.children = [];
}

function updateToolButtons() {
    const btnSelect = document.getElementById('tool-select');
    const btnPen = document.getElementById('tool-pen');
    const btnEraser = document.getElementById('tool-eraser');
    const btnNote = document.getElementById('tool-note');
    [btnSelect, btnPen, btnEraser, btnNote].forEach(b => b?.classList.remove('tool-active'));
    if (toolMode === 'select') btnSelect?.classList.add('tool-active');
    if (toolMode === 'pen') btnPen?.classList.add('tool-active');
    if (toolMode === 'eraser') btnEraser?.classList.add('tool-active');
    if (toolMode === 'note') btnNote?.classList.add('tool-active');
    // Subtle canvas hint: show only in Select mode
    const hint = document.getElementById('canvas-hint');
    if (hint) hint.style.display = (toolMode === 'select') ? 'block' : 'none';
}
function setupCanvasInteractions() {
    // Canvas Pan (mousedown on empty space)
    container.addEventListener('mousedown', (e) => {
        // Only pan if clicking on empty space (svg element directly)
        if (e.target.tagName === 'svg') {
            if (toolMode === 'pen') {
                startPenStroke(e);
                return;
            }
            if (toolMode === 'eraser') {
                startEraser(e);
                return;
            }
            if (toolMode === 'note') {
                createStickyNoteAtEvent(e);
                return;
            }
            // Select tool behavior:
            // - Drag empty space = PAN
            // - Shift + drag empty space = BOX SELECT
            // Space can also force pan (legacy)
            if (e.shiftKey) {
                startSelectionBox(e);
                return;
            }
            startCanvasDrag(e);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (penState.active) {
            continuePenStroke(e);
            return;
        }
        if (eraserState.active) {
            continueEraser(e);
            return;
        }
        if (selectionBox.active) {
            updateSelectionBox(e);
            return;
        }
        if (viewState.isDraggingCanvas) {
            const dx = e.clientX - viewState.lastMouseX;
            const dy = e.clientY - viewState.lastMouseY;
            viewState.offsetX += dx;
            viewState.offsetY += dy;
            viewState.lastMouseX = e.clientX;
            viewState.lastMouseY = e.clientY;
            updateTransform();
        }
    });

    window.addEventListener('mouseup', () => {
        if (penState.active) {
            finishPenStroke();
            return;
        }
        if (eraserState.active) {
            finishEraser();
            return;
        }
        if (selectionBox.active) {
            finishSelectionBox();
            return;
        }
        if (viewState.isDraggingCanvas) {
            viewState.isDraggingCanvas = false;
            container.style.cursor = 'grab';
        }
    });

    container.addEventListener('wheel', (e) => {
        // While selecting/drawing/dragging overlays, ignore wheel zoom so the view doesn't shift mid-action.
        if (selectionBox.active || penState.active || eraserState.active || noteDrag.id || noteResize.id) {
            e.preventDefault();
            return;
        }
        e.preventDefault();

        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;

        // Zoom towards mouse pointer
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Current world coordinates
        const worldX = (mouseX - viewState.offsetX) / viewState.scale;
        const worldY = (mouseY - viewState.offsetY) / viewState.scale;

        const newScale = Math.min(Math.max(0.1, viewState.scale + delta), 5);

        // Adjust offset to keep mouse point stationary
        viewState.offsetX = mouseX - worldX * newScale;
        viewState.offsetY = mouseY - worldY * newScale;

        viewState.scale = newScale;
        updateTransform();
    });
}

function startCanvasDrag(e) {
    viewState.isDraggingCanvas = true;
    viewState.lastMouseX = e.clientX;
    viewState.lastMouseY = e.clientY;
    container.style.cursor = 'grabbing';
}

function startSelectionBox(e) {
    selectionBox.active = true;
    selectionBox.startX = e.clientX;
    selectionBox.startY = e.clientY;
    selectionBox.endX = e.clientX;
    selectionBox.endY = e.clientY;
    selectionRectEl.style.display = 'block';
    updateSelectionRectEl();
}

function updateSelectionBox(e) {
    selectionBox.endX = e.clientX;
    selectionBox.endY = e.clientY;
    updateSelectionRectEl();
}

function updateSelectionRectEl() {
    const x1 = Math.min(selectionBox.startX, selectionBox.endX);
    const y1 = Math.min(selectionBox.startY, selectionBox.endY);
    const x2 = Math.max(selectionBox.startX, selectionBox.endX);
    const y2 = Math.max(selectionBox.startY, selectionBox.endY);
    selectionRectEl.style.left = x1 + 'px';
    selectionRectEl.style.top = y1 + 'px';
    selectionRectEl.style.width = (x2 - x1) + 'px';
    selectionRectEl.style.height = (y2 - y1) + 'px';
}

function finishSelectionBox() {
    selectionRectEl.style.display = 'none';
    selectionBox.active = false;

    const x1 = Math.min(selectionBox.startX, selectionBox.endX);
    const y1 = Math.min(selectionBox.startY, selectionBox.endY);
    const x2 = Math.max(selectionBox.startX, selectionBox.endX);
    const y2 = Math.max(selectionBox.startY, selectionBox.endY);

    if (Math.hypot(x2 - x1, y2 - y1) < 10) return;

    const next = new Set();
    document.querySelectorAll('.node[data-id]').forEach(el => {
        const id = el.getAttribute('data-id');
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) next.add(id);
    });

    if (next.size > 0) {
        selectedNodeIds = next;
        selectedNodeId = next.values().next().value;
        clearOverlaySelection();
        render();
    }
}

function containerPointToWorld(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const x = (clientX - rect.left - viewState.offsetX) / viewState.scale;
    const y = (clientY - rect.top - viewState.offsetY) / viewState.scale;
    return { x, y };
}

// --- Pen tool ---
function startPenStroke(e) {
    e.preventDefault();
    penState.active = true;
    penState.points = [];
    const p = containerPointToWorld(e.clientX, e.clientY);
    penState.points.push(p);
}

function continuePenStroke(e) {
    const p = containerPointToWorld(e.clientX, e.clientY);
    const last = penState.points[penState.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.4) {
        penState.points.push(p);
        render(); // simple and OK for lightweight usage
    }
}

function finishPenStroke() {
    penState.active = false;
    if (penState.points.length < 2) {
        penState.points = [];
        return;
    }
    pushHistory('pen');
    annotations.push({
        id: Math.random().toString(36).slice(2, 9),
        d: penPointsToPathD(penState.points),
        points: penState.points.map(p => ({ x: p.x, y: p.y })),
        color: penColor,
        width: 2
    });
    penState.points = [];
    render();
}

function penPointsToPathD(points) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

function parsePathDToPoints(d) {
    // Supports simple "M x,y L x,y ..." paths we generate
    const pts = [];
    const tokens = d.replace(/[ML]/g, ' ').trim().split(/\s+/);
    tokens.forEach(tok => {
        const [xs, ys] = tok.split(',');
        const x = Number(xs), y = Number(ys);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    });
    return pts;
}

// --- Eraser tool (pen only) ---
function startEraser(e) {
    e.preventDefault();
    eraserState.active = true;
    eraserState.didStart = false;
    eraserState.points = [];
    continueEraser(e);
}

function continueEraser(e) {
    const p = containerPointToWorld(e.clientX, e.clientY);
    const radius = 10; // world units (thicker than pen)

    const last = eraserState.points[eraserState.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.6) {
        eraserState.points.push(p);
    }

    // Push history only once when actual erase happens
    const erasedAny = eraseAnnotationsByPoint(p, radius);
    if (erasedAny && !eraserState.didStart) {
        pushHistory('erase');
        eraserState.didStart = true;
    }
}

function finishEraser() {
    eraserState.active = false;
    eraserState.points = [];
}

function eraseAnnotationsByPoint(p, radius) {
    let erasedAny = false;
    const next = [];
    const r2 = radius * radius;

    for (const a of annotations) {
        const pts = (a.points && a.points.length) ? a.points : parsePathDToPoints(a.d || '');
        if (pts.length < 2) {
            next.push(a);
            continue;
        }

        const segments = splitPolylineByErasePoint(pts, p, r2);
        if (segments.length === 1 && segments[0].length === pts.length) {
            next.push(a);
            continue;
        }

        erasedAny = true;
        for (const seg of segments) {
            if (seg.length < 2) continue;
            next.push({
                id: Math.random().toString(36).slice(2, 9),
                d: penPointsToPathD(seg),
                points: seg.map(x => ({ x: x.x, y: x.y })),
                color: a.color || '#222',
                width: a.width || 2
            });
        }
    }

    if (erasedAny) {
        annotations = next;
        // If selected annotation got erased, clear selection.
        if (selectedOverlay.kind === 'annotation' && selectedOverlay.id) {
            const stillExists = annotations.some(a => a.id === selectedOverlay.id);
            if (!stillExists) selectedOverlay = { kind: null, id: null };
        }
        render();
    }

    return erasedAny;
}

function splitPolylineByErasePoint(pts, p, r2) {
    const segments = [];
    let current = [];
    let removed = false;

    for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const dx = pt.x - p.x;
        const dy = pt.y - p.y;
        const keep = (dx * dx + dy * dy) > r2;
        if (keep) {
            current.push(pt);
        } else {
            removed = true;
            if (current.length >= 2) segments.push(current);
            current = [];
        }
    }
    if (current.length >= 2) segments.push(current);

    if (!removed) return [pts];
    return segments;
}

function isPointNearPolyline(p, pts, r) {
    const r2 = r * r;
    for (let i = 0; i < pts.length - 1; i++) {
        if (distancePointToSegmentSquared(p, pts[i], pts[i + 1]) <= r2) return true;
    }
    return false;
}

function distancePointToSegmentSquared(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return wx * wx + wy * wy;
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        return dx * dx + dy * dy;
    }
    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    const dx = p.x - px;
    const dy = p.y - py;
    return dx * dx + dy * dy;
}

// --- Sticky notes ---
function createStickyNoteAtEvent(e) {
    const p = containerPointToWorld(e.clientX, e.clientY);
    pushHistory('note-create');
    const newNote = {
        id: Math.random().toString(36).slice(2, 9),
        x: p.x,
        y: p.y,
        w: 220,
        h: 120,
        text: ''
    };
    notes.push(newNote);
    selectedOverlay = { kind: 'note', id: newNote.id };
    // After placing one note, auto-switch back to Select tool (hand)
    setToolMode('select');
    render();
}

function renderNotes() {
    if (!notesLayer) return;
    notesLayer.innerHTML = '';
    notes.forEach(n => {
        const div = document.createElement('div');
        div.className = 'sticky-note' + (selectedOverlay.kind === 'note' && selectedOverlay.id === n.id ? ' selected' : '');
        div.dataset.id = n.id;

        // Position in container pixels
        div.style.left = (n.x * viewState.scale + viewState.offsetX) + 'px';
        div.style.top = (n.y * viewState.scale + viewState.offsetY) + 'px';
        div.style.width = (n.w || 220) + 'px';
        div.style.height = (n.h || 120) + 'px';

        const ta = document.createElement('textarea');
        ta.value = n.text || '';
        ta.addEventListener('focus', () => pushHistory('note-edit'));
        ta.addEventListener('input', () => { n.text = ta.value; });
        ta.addEventListener('mousedown', () => {
            // Selecting a note should not rebuild DOM (which would kill focus)
            selectedOverlay = { kind: 'note', id: n.id };
            applyNoteSelectionClasses();
        });
        div.appendChild(ta);

        // Resize handle
        const resizer = document.createElement('div');
        resizer.className = 'note-resizer';
        resizer.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            pushHistory('note-resize');
            selectedOverlay = { kind: 'note', id: n.id };
            noteResize.id = n.id;
            noteResize.startClientX = ev.clientX;
            noteResize.startClientY = ev.clientY;
            noteResize.startW = n.w || 220;
            noteResize.startH = n.h || 120;
            renderNotes();
        });
        div.appendChild(resizer);

        // Select note on click (including textarea)
        div.addEventListener('mousedown', (ev) => {
            if (ev.target.classList.contains('note-resizer')) return;
            selectedOverlay = { kind: 'note', id: n.id };
            applyNoteSelectionClasses();
            // Clicking the note body should allow typing: focus textarea
            if (ev.target.tagName !== 'TEXTAREA') {
                // Defer focus so selection style applies first
                setTimeout(() => ta.focus(), 0);
            }
        });

        div.addEventListener('mousedown', (ev) => {
            if (ev.target.tagName === 'TEXTAREA') return;
            if (ev.target.classList.contains('note-resizer')) return;
            ev.preventDefault();
            pushHistory('note-move');
            noteDrag.id = n.id;
            noteDrag.startClientX = ev.clientX;
            noteDrag.startClientY = ev.clientY;
            noteDrag.startX = n.x;
            noteDrag.startY = n.y;
        });

        notesLayer.appendChild(div);
    });
}

function selectSubtreeFromId(nodeId) {
    const node = findNode(treeData, nodeId);
    if (!node) return;
    const ids = new Set();
    (function walk(n) {
        ids.add(n.id);
        n.children.forEach(walk);
    })(node);
    selectedNodeIds = ids;
    selectedNodeId = nodeId;
    render();
}

// --- Logic: Tree Manipulation ---

function handleContextAction(action, nodeId) {
    const node = findNode(treeData, nodeId);
    if (!node) return;

    // Keep selection on the node the action was invoked on (never jump to the newly created node)
    selectedNodeId = nodeId;
    selectedNodeIds = new Set([nodeId]);

    if (action === 'delete') {
        if (nodeId === treeData.id) {
            alert("Cannot delete root node.");
            return;
        }
        if (confirm("Delete this node and its branch?")) {
            pushHistory('delete');
            deleteNode(treeData, nodeId);
            if (selectedNodeId === nodeId) selectedNodeId = treeData.id;
            selectedNodeIds = new Set([selectedNodeId]);
        }
    } else if (action.startsWith('add-')) {
        if (node.type === 'terminal') {
            alert("Terminal nodes cannot have children.");
            return;
        }
        pushHistory('add-child');
        const type = action.replace('add-', '');
        addChild(node, type);
    } else if (action === 'to-decision') {
        pushHistory('convert');
        convertNodeType(nodeId, 'decision');
    } else if (action === 'to-chance') {
        pushHistory('convert');
        convertNodeType(nodeId, 'chance');
    }
    
    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    render();
}

function convertSelectedNodeType(newType) {
    pushHistory('convert');
    convertNodeType(selectedNodeId, newType);
    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    render();
}

function convertNodeType(nodeId, newType) {
    const node = findNode(treeData, nodeId);
    if (!node) return;
    if (node.type === 'terminal') {
        // Allow converting terminal into decision/chance
        node.type = newType;
        if (!Array.isArray(node.children)) node.children = [];
        // For chance nodes, default to auto unless already manual
        if (newType === 'chance') {
            if (node.autoProb === undefined) node.autoProb = true;
            node.manualProbIds = [];
        }
        return;
    }

    if (newType !== 'decision' && newType !== 'chance') return;
    node.type = newType;
    if (newType === 'chance') {
        // Default this node to auto probabilities unless user set manual previously
        if (node.autoProb !== false) node.autoProb = true;
        node.manualProbIds = [];
        if (node.children?.length) autoDistributeProbabilities(node);
    } else {
        // decision: keep children, hide probabilities (rendering handles it)
        // keep node.autoProb as-is; it's ignored when not chance
    }
}

function addChild(parent, type) {
    const newNode = {
        id: Math.random().toString(36).substr(2, 9),
        type: type,
        label: 'New ' + type,
        value: 0,
        cost: 0,
        children: []
    };

    // Terminal payoff placeholder support:
    // show placeholder only when value==0 AND payoffEdited is false/undefined.
    if (type === 'terminal') {
        newNode.payoffEdited = false;
    }

    // Chance nodes: initialize touched-branch tracking
    if (type === 'chance') {
        newNode.manualProbIds = [];
    }
    
    parent.children.push(newNode);
    
    if (parent.type === 'chance') {
        // Respect "touched branch" balancing when Auto probabilities is ON.
        // If no touched branches, this becomes equal distribution.
        normalizeChanceNodeAuto(parent);
    }
    
    return newNode;
}

function addChildToSelected(type) {
    const node = findNode(treeData, selectedNodeId);
    if (!node) return;
    if (node.type === 'terminal') {
        alert("Terminal nodes cannot have children.");
        return;
    }
    pushHistory('add-child');
    addChild(node, type);
    // Keep selection on the parent so repeated clicks always add to the same selected node.
    selectedNodeIds = new Set([selectedNodeId]);
    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    render();
}

function deleteSelected() {
    if (!selectedNodeId || selectedNodeId === treeData.id) {
        alert("Select a non-root node to delete.");
        return;
    }
    if (confirm("Delete selected node and its branch?")) {
        pushHistory('delete');
        deleteNode(treeData, selectedNodeId);
        selectedNodeId = treeData.id;
        selectedNodeIds = new Set([treeData.id]);
        applyAutoProbabilitiesIfEnabled(treeData);
        calculateEMV(treeData);
        render();
    }
}

function deleteNode(root, id) {
    const parent = findParent(root, id);
    if (parent) {
        const index = parent.children.findIndex(c => c.id === id);
        if (index > -1) {
            parent.children.splice(index, 1);
            if (parent.type === 'chance') {
                normalizeChanceNodeAuto(parent);
            }
        }
    }
}

function autoDistributeProbabilities(node) {
    if (!node.children.length) return;
    const count = node.children.length;
    const prob = 1 / count;
    node.children.forEach(c => c.probability = parseFloat(prob.toFixed(3)));
}

function normalizeChanceNodeAuto(node) {
    if (!node || node.type !== 'chance') return;
    const kids = node.children || [];
    if (kids.length === 0) return;

    const existing = new Set(kids.map(k => k.id));
    const manualIds = Array.isArray(node.manualProbIds) ? node.manualProbIds.filter(id => existing.has(id)) : [];

    // 2-branch special case: exactly one branch is "touched" (the last edited one),
    // so the other branch is always the balancer.
    let manualSet;
    if (kids.length === 2) {
        const last = manualIds[manualIds.length - 1];
        node.manualProbIds = last ? [last] : [];
        manualSet = new Set(node.manualProbIds);
    } else {
        node.manualProbIds = manualIds;
        manualSet = new Set(manualIds);
    }

    const autoKids = kids.filter(k => !manualSet.has(k.id));
    if (autoKids.length === 0) return; // nothing left to balance

    const sumManual = kids
        .filter(k => manualSet.has(k.id))
        .reduce((s, k) => s + (Number(k.probability) || 0), 0);

    const remaining = 1 - sumManual;
    const each = remaining / autoKids.length;
    autoKids.forEach(k => {
        k.probability = Number(each.toFixed(6));
    });
}

function applyAutoProbabilitiesIfEnabled(root) {
    if (!autoProbabilitiesEnabled) return;
    // Ensure every chance node has probabilities on its outgoing branches and they sum to 1
    (function walk(n) {
        const autoHere = (n.autoProb !== false);
        if (n.type === 'chance' && autoHere && n.children.length > 0) {
            // If no touched branches, distribute equally.
            // If some branches were touched, balance only untouched branches to reach 100%.
            const hasTouched = Array.isArray(n.manualProbIds) && n.manualProbIds.length > 0;
            if (!hasTouched) autoDistributeProbabilities(n);
            else normalizeChanceNodeAuto(n);
        }
        n.children.forEach(walk);
    })(root);
}

function moveNode(nodeId, newParentId) {
    if (nodeId === newParentId) return; // Can't move to self
    
    // Check if newParent is a descendant of node (cycle prevention)
    const movingNode = findNode(treeData, nodeId);
    if (findNode(movingNode, newParentId)) {
        alert("Cannot move a node into its own descendant.");
        return;
    }

    const newParent = findNode(treeData, newParentId);
    if (newParent.type === 'terminal') {
        alert("Cannot move into a terminal node.");
        return;
    }

    // Remove from old parent
    const oldParent = findParent(treeData, nodeId);
    if (!oldParent) return; // Is root

    pushHistory('move');
    const index = oldParent.children.findIndex(c => c.id === nodeId);
    oldParent.children.splice(index, 1);
    
    if (oldParent.type === 'chance') normalizeChanceNodeAuto(oldParent);

    // Add to new parent
    newParent.children.push(movingNode);
    if (newParent.type === 'chance') normalizeChanceNodeAuto(newParent);

    selectedNodeId = nodeId;

    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);
    render();
}

function updateNodeValue(id, key, value) {
    const node = findNode(treeData, id);
    if (!node) return;

    pushHistory('edit');
    if (key === 'label') node.label = value;
    if (key === 'value') {
        node.value = parseFloat(value);
        if (node.type === 'terminal') node.payoffEdited = true;
        calculateEMV(treeData); // Re-calc immediately
    }
    if (key === 'cost') {
        node.cost = parseFloat(value);
        calculateEMV(treeData);
    }
    if (key === 'probability') {
        const parent = findParent(treeData, id);
        if (!parent || parent.type !== 'chance') return;

        const parsed = parseProbabilityInput(value);
        if (!Number.isFinite(parsed)) return;

        // If global auto-prob is OFF, allow any numeric probability values (no normalization, no clamp).
        if (!autoProbabilitiesEnabled) {
            node.probability = parsed;
        } else {
            // Auto ON: "touched branch" balancing
            // - touched branches keep their values
            // - untouched branches auto-balance to sum to 1
            let p = Math.max(0, Math.min(1, parsed));

            const kids = parent.children || [];
            const otherManualSum = (() => {
                const manualIds = Array.isArray(parent.manualProbIds) ? parent.manualProbIds : [];
                const manualSet = new Set(manualIds);
                let sum = 0;
                kids.forEach(k => {
                    if (k.id !== id && manualSet.has(k.id)) sum += (Number(k.probability) || 0);
                });
                return sum;
            })();
            // Ensure we never exceed 100% once combined with previously-touched branches
            const maxAllowed = Math.max(0, 1 - otherManualSum);
            p = Math.min(p, maxAllowed);

            node.probability = Number(p.toFixed(6));

            // Mark this branch as "touched"
            if (!Array.isArray(parent.manualProbIds)) parent.manualProbIds = [];
            if (kids.length === 2) {
                parent.manualProbIds = [id];
            } else if (!parent.manualProbIds.includes(id)) {
                parent.manualProbIds.push(id);
            }

            normalizeChanceNodeAuto(parent);
        }
        calculateEMV(treeData);
    }
    render();
}

function parseProbabilityInput(input) {
    // Accepts:
    // - "0.2" (decimal)
    // - "20"  (interpreted as 20%)
    // - "20%" (explicit percent)
    // Also accepts comma decimals: "0,2"
    if (input === null || input === undefined) return NaN;
    const s = String(input).trim();
    if (!s) return NaN;

    const hasPercent = s.includes('%');
    const cleaned = s.replace('%', '').trim().replace(',', '.');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return NaN;

    if (hasPercent) return n / 100;
    // If user typed "20", assume percent (20% -> 0.2)
    if (Math.abs(n) > 1) return n / 100;
    return n;
}

function setChanceBranchProbability(parentChanceNode, editedChildId, newProb) {
    const kids = parentChanceNode.children || [];
    if (kids.length === 0) return;
    if (kids.length === 1) {
        kids[0].probability = 1;
        return;
    }

    const edited = kids.find(k => k.id === editedChildId);
    if (!edited) return;

    edited.probability = newProb;
    const remaining = Math.max(0, 1 - edited.probability);
    const others = kids.filter(k => k.id !== editedChildId);

    const sumOthers = others.reduce((s, k) => s + (Number(k.probability) || 0), 0);
    if (sumOthers > 0) {
        others.forEach(k => {
            const old = Number(k.probability) || 0;
            k.probability = (old / sumOthers) * remaining;
        });
    } else {
        const each = remaining / others.length;
        others.forEach(k => { k.probability = each; });
    }

    // Round and fix sum exactly to 1
    kids.forEach(k => { k.probability = Number(Number(k.probability || 0).toFixed(6)); });
    const sum = kids.reduce((s, k) => s + (Number(k.probability) || 0), 0);
    const diff = 1 - sum;
    if (Math.abs(diff) > 1e-9) {
        const last = kids[kids.length - 1];
        last.probability = Number((Number(last.probability || 0) + diff).toFixed(6));
    }
}


// --- Logic: Calculation & Search ---

function calculateEMV(node) {
    const nodeCost = Number(node.cost) || 0;
    if (node.type === 'terminal') {
        return (Number(node.value) || 0) + nodeCost;
    }

    const childrenValues = node.children.map(child => calculateEMV(child));

    if (node.type === 'decision') {
        node.emv = (childrenValues.length ? Math.max(...childrenValues) : 0) + nodeCost;
    } else if (node.type === 'chance') {
        let sum = 0;
        node.children.forEach((child, index) => {
            sum += (child.probability || 0) * childrenValues[index];
        });
        node.emv = sum + nodeCost;
    }
    return node.emv;
}

function findNode(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
}

function findParent(node, childId) {
    if (node.children.some(c => c.id === childId)) return node;
    for (const child of node.children) {
        const found = findParent(child, childId);
        if (found) return found;
    }
    return null;
}


// --- Rendering ---

function render() {
    // Preserve overlays (like #notes-layer) by only replacing the SVG.
    const existingSvg = container.querySelector('svg#main-svg');
    if (existingSvg) existingSvg.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'main-svg');
    
    const mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    mainGroup.setAttribute('transform', `translate(${viewState.offsetX}, ${viewState.offsetY}) scale(${viewState.scale})`);
    mainGroup.setAttribute('id', 'zoom-group');
    
    svg.appendChild(mainGroup);
    // Put SVG under notes layer (notes are inside container and should stay on top)
    container.prepend(svg);

    applyAutoProbabilitiesIfEnabled(treeData);
    calculateEMV(treeData);

    // Calculate Layout
    const layout = calculateLayout(treeData);

    // Draw annotations behind the tree
    drawAnnotations(mainGroup);
    // Live pen stroke preview
    if (penState.active && penState.points.length > 1) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', penPointsToPathD(penState.points));
        p.setAttribute('stroke', penColor);
        p.setAttribute('stroke-width', '2');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        mainGroup.appendChild(p);
    }
    
    // Draw Links
    layout.nodes.forEach(node => {
        if (node.parent) {
            drawLink(mainGroup, node.parent, node);
        }
    });

    // Draw Nodes
    layout.nodes.forEach(node => {
        drawNode(mainGroup, node);
    });

    renderNotes();
    updateStatus();
}

function drawAnnotations(group) {
    annotations.forEach(a => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', a.d);
        p.setAttribute('stroke', a.color || '#222');
        p.setAttribute('stroke-width', String(a.width || 2));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('class', 'annotation-path' + (selectedOverlay.kind === 'annotation' && selectedOverlay.id === a.id ? ' selected' : ''));
        p.addEventListener('mousedown', (e) => {
            if (toolMode !== 'select') return;
            e.stopPropagation();
            selectedOverlay = { kind: 'annotation', id: a.id };
            render();
        });
        group.appendChild(p);
    });
}

function updateTransform() {
    const g = document.getElementById('zoom-group');
    if (g) {
        g.setAttribute('transform', `translate(${viewState.offsetX}, ${viewState.offsetY}) scale(${viewState.scale})`);
    }
    // Notes are HTML overlays, so we must reposition them when pan/zoom changes.
    renderNotes();
}

function centerView() {
    // Recenter should ONLY pan the canvas so the root ("Start") is at left-middle.
    // Keep current zoom level and other mechanics unchanged.
    const layout = calculateLayout(treeData);
    const rootLayout = layout?.nodes?.find(n => n.id === treeData.id);

    // Place relative to the visible viewport (not just the container),
    // so "left middle" matches what the user sees on screen.
    const rect = container.getBoundingClientRect();
    const desiredLeftX = 80 - rect.left; // px from viewport left
    const desiredMidY = (window.innerHeight / 2) - rect.top; // px from viewport top

    const rootX = rootLayout ? rootLayout.x : 0;
    const rootY = rootLayout ? rootLayout.y : 0;

    viewState.offsetX = desiredLeftX - (rootX * viewState.scale);
    viewState.offsetY = desiredMidY - (rootY * viewState.scale);
    updateTransform();
}

function calculateLayout(root) {
    // Basic vertical tree layout rotated 90deg (Horizontal Tree)
    let nodes = [];
    
    function process(node, depth, yOffset) {
        // Height of this subtree
        let height = 0;
        let childrenNodes = [];
        
        if (node.children.length === 0) {
            height = CONFIG.leafH;
        } else {
            let currentY = yOffset;
            node.children.forEach(child => {
                const childResult = process(child, depth + 1, currentY);
                childrenNodes.push(...childResult.nodes);
                height += childResult.height;
                currentY += childResult.height;
            });
        }

        const x = depth * CONFIG.levelW;
        // Y is midpoint of children, or yOffset if leaf
        let y = yOffset + height / 2;
        
        if (childrenNodes.length > 0) {
            const firstChild = childrenNodes.find(n => n.raw.id === node.children[0].id);
            const lastChild = childrenNodes.find(n => n.raw.id === node.children[node.children.length-1].id);
            if (firstChild && lastChild) {
                y = (firstChild.y + lastChild.y) / 2;
            }
        }

        const layoutNode = {
            id: node.id,
            x: x,
            y: y,
            raw: node,
            height: height
        };
        
        // Populate parent refs
        childrenNodes.forEach(c => {
             if (node.children.some(child => child.id === c.id)) {
                 c.parent = layoutNode;
             }
        });

        return { nodes: [layoutNode, ...childrenNodes], height };
    }

    return { nodes: process(root, 0, 0).nodes };
}

function drawLink(group, parent, node) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    // Bezier curve
    const midX = (parent.x + node.x) / 2;
    const d = `M${parent.x + 20},${parent.y} C${midX},${parent.y} ${midX},${node.y} ${node.x - 20},${node.y}`;
    
    path.setAttribute('d', d);
    path.setAttribute('class', 'link');
    path.style.strokeWidth = (2 / viewState.scale) + 'px'; 
    group.appendChild(path);

    // Invisible wide handle for dragging by the branch line
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    handle.setAttribute('d', d);
    handle.setAttribute('class', 'link-handle');
    handle.setAttribute('data-child-id', node.id);
    handle.addEventListener('mousedown', handleLinkMouseDown);
    handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const childId = e.currentTarget.getAttribute('data-child-id');
        if (childId) selectSubtreeFromId(childId);
    });
    group.appendChild(handle);

    // Link Label (Probability) - show ONLY if parent is a chance node
    if (parent?.raw?.type === 'chance' && node.raw.probability !== undefined && node.raw.probability !== null) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', (parent.x + node.x) / 2);
        txt.setAttribute('y', (parent.y + node.y) / 2 - 5);
        txt.setAttribute('class', 'editable-text probability-text');
        txt.setAttribute('text-anchor', 'middle');
        // Reduce font size slightly for probability
        txt.style.fontSize = '0.8em';
        if (autoProbabilitiesEnabled) {
            txt.textContent = `${Math.round(Number(node.raw.probability) * 1000) / 10}%`;
        } else {
            // Auto OFF: show raw value, no normalization assumptions
            txt.textContent = String(node.raw.probability);
        }
        txt.onclick = (e) => startEditing(e, node.id, 'probability');
        group.appendChild(txt);
    }
}

function drawNode(group, node) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    const isSelected = selectedNodeIds.has(node.id);
    g.setAttribute('class', `node type-${node.raw.type} ${node.raw.id === treeData.id ? 'root-node' : ''} ${isSelected ? 'selected' : ''}`);
    g.setAttribute('data-id', node.id);
    
    // Drag/select events
    g.addEventListener('mousedown', handleNodeMouseDown);
    g.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.contextNodeId = node.id;
        selectedNodeId = node.id;
        selectedNodeIds = new Set([node.id]);
        updateStatus();
        applySelectionClasses();
        showContextMenu(e.clientX, e.clientY);
    });

    // Shape
    let shape;
    const type = node.raw.type;
    if (type === 'decision') {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        shape.setAttribute('x', -15); shape.setAttribute('y', -15);
        shape.setAttribute('width', 30); shape.setAttribute('height', 30);
    } else if (type === 'chance') {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        shape.setAttribute('r', 15);
    } else { // terminal
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', '-15,-15 15,0 -15,15');
    }
    
    // Highlight drop target
    if (dropTargetId === node.id) {
        shape.style.stroke = 'green';
        shape.style.strokeWidth = '4px';
    }

    g.appendChild(shape);

    // Label (Top)
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', 0);
    label.setAttribute('y', -25);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'editable-text');
    label.textContent = node.raw.label;
    label.onclick = (e) => startEditing(e, node.id, 'label');
    g.appendChild(label);

    // Center value (big + obvious)
    const centerVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    centerVal.setAttribute('x', 0);
    centerVal.setAttribute('y', 5);
    centerVal.setAttribute('text-anchor', 'middle');
    centerVal.setAttribute('class', 'node-value ' + (type === 'terminal' ? 'editable-text editable-number' : ''));
    if (type === 'terminal') {
        const isUntouchedZero = (node.raw.payoffEdited !== true) && ((Number(node.raw.value) || 0) === 0);
        if (isUntouchedZero) {
            centerVal.textContent = 'enter payoff';
            centerVal.setAttribute('class', 'node-value editable-text editable-number placeholder');
            centerVal.dataset.placeholder = '1';
        } else {
            centerVal.textContent = Number(node.raw.value ?? 0);
        }
        centerVal.onclick = (e) => startEditing(e, node.id, 'value');
    } else {
        centerVal.textContent = (node.raw.emv !== undefined ? Number(node.raw.emv).toFixed(1) : '0.0');
    }
    g.appendChild(centerVal);

    // Decision investment/cost (editable, can be negative)
    if (type === 'decision') {
        const costText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        costText.setAttribute('x', 0);
        costText.setAttribute('y', 28);
        costText.setAttribute('text-anchor', 'middle');
        costText.setAttribute('class', 'editable-text editable-number');
        costText.style.fontSize = '0.8em';
        const c = Number(node.raw.cost) || 0;
        costText.textContent = `Inv: ${c}`;
        costText.onclick = (e) => startEditing(e, node.id, 'cost');
        g.appendChild(costText);
    }

    group.appendChild(g);
}


// --- Interaction: Drag & Drop Nodes ---

function handleNodeMouseDown(e) {
    if (e.button !== 0) return; // Only Left Click
    e.stopPropagation(); // Don't trigger canvas pan

    const g = e.currentTarget;
    const id = g.getAttribute('data-id');

    // If the user clicked on editable text/number, do NOT start drag intent.
    // Otherwise, a render-on-mouseup would remove the element before the click-to-edit fires.
    if (e.target?.classList?.contains('editable-text') || e.target?.classList?.contains('editable-number')) {
        selectedNodeId = id;
        selectedNodeIds = new Set([id]);
        clearOverlaySelection();
        updateStatus();
        applySelectionClasses();
        return;
    }

    // Alt+click selects entire subtree rooted at this node
    if (e.altKey) {
        selectSubtreeFromId(id);
        return;
    }
    
    if (id === treeData.id) {
        // If root, treat as canvas drag
        startCanvasDrag(e);
        selectedNodeId = id;
        selectedNodeIds = new Set([id]);
        updateStatus();
        return; 
    }

    // Click selects; drag re-parents. Use a movement threshold.
    if (e.ctrlKey) {
        if (selectedNodeIds.has(id)) selectedNodeIds.delete(id);
        else selectedNodeIds.add(id);
        if (selectedNodeIds.size === 0) selectedNodeIds.add(treeData.id);
        selectedNodeId = selectedNodeIds.values().next().value;
        clearOverlaySelection();
        updateStatus();
        applySelectionClasses();
        return;
    } else {
        selectedNodeId = id;
        selectedNodeIds = new Set([id]);
        clearOverlaySelection();
        updateStatus();
        applySelectionClasses();
    }

    dragIntent = { kind: 'node', nodeId: id, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener('mousemove', handleIntentMove);
    window.addEventListener('mouseup', handleIntentUp);
}

function handleLinkMouseDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const childId = e.currentTarget.getAttribute('data-child-id');
    if (!childId || childId === treeData.id) return;
    selectedNodeId = childId;
    // If you drag a branch line while multi-selected, keep multi-selection
    if (!selectedNodeIds.has(childId)) selectedNodeIds = new Set([childId]);
    updateStatus();
    dragIntent = { kind: 'link', nodeId: childId, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener('mousemove', handleIntentMove);
    window.addEventListener('mouseup', handleIntentUp);
}

function handleIntentMove(e) {
    if (!dragIntent) return;
    const dx = e.clientX - dragIntent.startX;
    const dy = e.clientY - dragIntent.startY;
    const dist = Math.hypot(dx, dy);

    // Start actual drag after threshold
    if (!dragIntent.active && dist >= 6) {
        dragIntent.active = true;
        dragNodeId = dragIntent.nodeId;
        container.style.cursor = 'grabbing';
    }

    if (!dragIntent.active) return;
    updateDropTarget(e.clientX, e.clientY);
}

function handleIntentUp(e) {
    window.removeEventListener('mousemove', handleIntentMove);
    window.removeEventListener('mouseup', handleIntentUp);

    if (dragIntent?.active && dragNodeId && dropTargetId) {
        const roots = getSelectionRoots(selectedNodeIds);
        // If we have a multi-selection and the drag started from within it, move selection roots.
        if (roots.length > 1 || (roots.length === 1 && roots[0] !== dragNodeId)) {
            roots.forEach(rid => {
                if (rid !== dropTargetId) moveNode(rid, dropTargetId);
            });
        } else {
            moveNode(dragNodeId, dropTargetId);
        }
    } else {
        // Just a click: do nothing here.
        // Rendering here can prevent the subsequent click-to-edit handler from firing.
    }

    dragIntent = null;
    dragNodeId = null;
    dropTargetId = null;
    container.style.cursor = 'grab';
}

function getSelectionRoots(idsSet) {
    const roots = [];
    idsSet.forEach(id => {
        if (id === treeData.id) return;
        const p = findParent(treeData, id);
        if (!p || !idsSet.has(p.id)) roots.push(id);
    });
    return roots;
}

function updateDropTarget(clientX, clientY) {
    dropTargetId = null;
    const el = document.elementFromPoint(clientX, clientY);
    const nodeGroup = el?.closest?.('.node');
    if (nodeGroup) {
        const targetId = nodeGroup.getAttribute('data-id');
        if (targetId && targetId !== dragNodeId) {
            dropTargetId = targetId;
        }
    }

    // Clear + set highlight
    document.querySelectorAll('.node.drag-target').forEach(n => n.classList.remove('drag-target'));
    if (dropTargetId) {
        const targetEl = document.querySelector(`.node[data-id="${dropTargetId}"]`);
        if (targetEl) targetEl.classList.add('drag-target');
    }
}

function applySelectionClasses() {
    // Update DOM selection highlight without re-rendering (keeps click-to-edit stable)
    document.querySelectorAll('.node.selected').forEach(el => el.classList.remove('selected'));
    selectedNodeIds.forEach(id => {
        const el = document.querySelector(`.node[data-id="${id}"]`);
        if (el) el.classList.add('selected');
    });
}

// --- Interaction: Inline Editing ---

function startEditing(e, nodeId, field) {
    e.stopPropagation();
    if (editingField) finishEditing();

    const target = e.target;
    const rect = target.getBoundingClientRect();
    
    const input = document.createElement('input');
    input.className = 'inline-editor';
    // For placeholder payoffs, start with an empty input.
    if (field === 'value' && target?.dataset?.placeholder === '1') {
        input.value = '';
    } else {
        input.value = String(target.textContent ?? '').trim();
    }
    if (field === 'probability') {
        // Must be text to allow "20%" input.
        input.type = 'text';
    } else {
        input.type = field === 'label' ? 'text' : 'number';
        if (field !== 'label') input.step = 'any';
    }

    // Position input over text
    input.style.left = (rect.left + rect.width / 2) + 'px';
    input.style.top = (rect.top + rect.height / 2) + 'px';
    
    document.body.appendChild(input);
    input.focus();
    input.select();

    editingField = { nodeId, field, element: input };
}

function finishEditing(save = true) {
    if (!editingField) return;

    const { nodeId, field, element } = editingField;
    const value = element.value;
    
    element.remove();
    editingField = null;

    if (save) {
        updateNodeValue(nodeId, field, value);
    }
}

// --- Interaction: Context Menu ---
function showContextMenu(x, y) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
}

function updateStatus() {
    const node = findNode(treeData, selectedNodeId);
    const label = node ? `${node.label} (${node.type})` : '(none)';
    const auto = autoProbabilitiesEnabled ? 'ON' : 'OFF';
    const count = selectedNodeIds.size;
    const overlay = selectedOverlay.kind ? `${selectedOverlay.kind}` : 'none';
    const clip = copyBuffer?.nodes?.length ? ` • Copied: ${copyBuffer.nodes.length}` : '';
    statusBar.textContent = `Tool: ${toolMode.toUpperCase()} • Node: ${label} • Multi: ${count} • Overlay: ${overlay} • Auto: ${auto} • Box-select: Shift+drag • Ctrl+C/Ctrl+V${clip}`;
}

// --- Start ---
window.addEventListener('DOMContentLoaded', init);
