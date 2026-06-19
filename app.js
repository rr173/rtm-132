const PixelFontEditor = (function() {
    const PIXEL_SIZE = 30;
    const MAX_HISTORY = 30;
    const DEFAULT_KERNING_SUGGESTIONS = [
        ['A', 'V', -1], ['V', 'A', -1], ['A', 'Y', -1], ['Y', 'A', -1],
        ['T', 'o', -1], ['T', 'e', -1], ['L', 'T', -1], ['L', 'Y', -1],
        ['P', 'a', -1], ['P', 'o', -1], ['F', 'o', -1], ['F', 'a', -1],
        ['W', 'a', -1], ['W', 'o', -1], ['Y', 'o', -1], ['K', 'e', -1]
    ];

    const FONT_COLORS = [
        '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#ef4444',
        '#06b6d4', '#a855f7', '#84cc16', '#f97316', '#14b8a6'
    ];

    let workspace = {
        fonts: [],
        currentFontIndex: 0
    };

    let state = {
        currentCodePoint: 0x41,
        currentTool: 'pencil',
        isDrawing: false,
        lineStart: null,
        lastMouseX: 0,
        lastMouseY: 0,
        drawingModified: false,
        history: [],
        historyIndex: -1,
        searchFilter: '',
        currentLigature: null,
        contextMenuCodePoint: null,
        compareMode: false,
        compareFontAIndex: 0,
        compareFontBIndex: 1,
        compareCharIndex: 0,
        currentTab: 'glyphs',
        glyphFilter: '',
        clipboardGlyph: null,
        animationDirty: true,
        isRecording: false,
        recordingStartTime: 0,
        recordingOps: [],
        playbackMode: false,
        playbackGlyph: null,
        playbackOps: [],
        playbackSnapshot: null,
        playbackCurrentStep: 0,
        playbackIsPlaying: false,
        playbackSpeed: 1,
        playbackTimerId: null,
        playbackHighlightPixels: [],
        playbackHighlightAll: false,
        playbackHighlightTimerId: null
    };

    let previewState = {
        currentFrame: 0,
        isPlaying: true,
        fps: 12,
        lastFrameTime: 0,
        animationId: null,
        effectType: 'none',
        waveAmp: 3,
        waveSpeed: 2,
        waveLength: 80,
        glowIntensity: 4,
        gradientColor1: '#ff6b6b',
        gradientColor2: '#4ecdc4',
        gradientSpeed: 1,
        textColor: '#ffffff',
        scale: 3,
        lineWidth: 800,
        lineSpacing: 2
    };

    let canvas, ctx, previewCanvas, previewCtx;

    function getCurrentFont() {
        return workspace.fonts[workspace.currentFontIndex];
    }

    function getFontByIndex(index) {
        return workspace.fonts[index];
    }

    function getFontByName(name) {
        return workspace.fonts.find(f => f.metadata.name === name);
    }

    function getFontIndexByName(name) {
        return workspace.fonts.findIndex(f => f.metadata.name === name);
    }

    function getFontColor(index) {
        return FONT_COLORS[index % FONT_COLORS.length];
    }

    function createFontData(name, config) {
        return {
            metadata: {
                name: name || 'New Font',
                author: config?.author || 'Pixel Font Designer',
                version: config?.version || '1.0',
                glyphWidth: config?.glyphWidth || 8,
                glyphHeight: config?.glyphHeight || 12,
                ascent: config?.ascent || 10,
                baseline: config?.baseline || 2,
                descent: config?.descent || 0,
                defaultSpacing: config?.defaultSpacing || 1
            },
            glyphs: {},
            kerning: {},
            ligatures: {}
        };
    }

    function cloneFontData(fontData) {
        const newFont = {
            metadata: { ...fontData.metadata },
            glyphs: {},
            kerning: { ...fontData.kerning },
            ligatures: {}
        };
        Object.keys(fontData.glyphs).forEach(cp => {
            const g = fontData.glyphs[cp];
            newFont.glyphs[cp] = {
                width: g.width,
                height: g.height,
                pixels: [...g.pixels],
                modified: g.modified
            };
        });
        Object.keys(fontData.ligatures).forEach(key => {
            const l = fontData.ligatures[key];
            newFont.ligatures[key] = {
                width: l.width,
                height: l.height,
                pixels: [...l.pixels],
                modified: l.modified
            };
        });
        return newFont;
    }

    function addBlankFont(name) {
        const current = getCurrentFont();
        const config = current ? {
            glyphWidth: current.metadata.glyphWidth,
            glyphHeight: current.metadata.glyphHeight,
            ascent: current.metadata.ascent,
            baseline: current.metadata.baseline,
            descent: current.metadata.descent,
            defaultSpacing: current.metadata.defaultSpacing
        } : undefined;
        const fontName = name || prompt('请输入新字体名称：', 'New Font');
        if (!fontName) return;
        const newFont = createFontData(fontName, config);
        workspace.fonts.push(newFont);
        workspace.currentFontIndex = workspace.fonts.length - 1;
        clearHistory();
        renderAll();
        renderFontSelector();
    }

    function duplicateFont(sourceIndex, name) {
        const idx = sourceIndex !== undefined ? sourceIndex : workspace.currentFontIndex;
        const source = workspace.fonts[idx];
        const newName = name || prompt('请输入新字体名称：', source.metadata.name + ' Copy');
        if (!newName) return;
        const newFont = cloneFontData(source);
        newFont.metadata.name = newName;
        workspace.fonts.push(newFont);
        workspace.currentFontIndex = workspace.fonts.length - 1;
        clearHistory();
        renderAll();
        renderFontSelector();
    }

    function deleteFont(index) {
        const idx = index !== undefined ? index : workspace.currentFontIndex;
        if (workspace.fonts.length <= 1) {
            alert('至少保留一套字体！');
            return;
        }
        const font = workspace.fonts[idx];
        if (!confirm(`确定要删除字体 "${font.metadata.name}" 吗？`)) return;

        workspace.fonts.splice(idx, 1);
        if (workspace.currentFontIndex >= workspace.fonts.length) {
            workspace.currentFontIndex = workspace.fonts.length - 1;
        }
        if (state.compareFontAIndex >= workspace.fonts.length) {
            state.compareFontAIndex = 0;
        }
        if (state.compareFontBIndex >= workspace.fonts.length) {
            state.compareFontBIndex = Math.min(1, workspace.fonts.length - 1);
        }
        clearHistory();
        renderAll();
        renderFontSelector();
    }

    function renameFont(index, newName) {
        const idx = index !== undefined ? index : workspace.currentFontIndex;
        const name = newName || prompt('请输入新的字体名称：', workspace.fonts[idx].metadata.name);
        if (!name || !name.trim()) {
            return false;
        }
        const trimmedName = name.trim();
        if (workspace.fonts.some((f, i) => i !== idx && f.metadata.name === trimmedName)) {
            alert('字体名称已存在！');
            return false;
        }
        workspace.fonts[idx].metadata.name = trimmedName;
        renderFontSelector();
        renderPreview();
        return true;
    }

    function switchFont(index) {
        if (index < 0 || index >= workspace.fonts.length) return;
        workspace.currentFontIndex = index;
        clearHistory();
        renderAll();
        renderFontSelector();
    }

    function createEmptyGlyph(width, height) {
        const rows = [];
        for (let y = 0; y < height; y++) {
            rows.push('0'.repeat(width));
        }
        return {
            width: width,
            height: height,
            pixels: rows,
            modified: false
        };
    }

    function cloneGlyph(glyph) {
        return {
            width: glyph.width,
            height: glyph.height,
            pixels: [...glyph.pixels],
            modified: glyph.modified
        };
    }

    function isGlyphEmpty(glyph) {
        return glyph.pixels.every(row => row === '0'.repeat(glyph.width));
    }

    function getGlyph(codePoint) {
        const font = getCurrentFont();
        return getGlyphFromFont(font, codePoint);
    }

    function getGlyphFromFont(font, codePoint) {
        if (!font.glyphs[codePoint]) {
            font.glyphs[codePoint] = createEmptyGlyph(
                font.metadata.glyphWidth,
                font.metadata.glyphHeight
            );
        }
        return font.glyphs[codePoint];
    }

    function getCurrentGlyph() {
        if (state.currentTab === 'ligatures' && state.currentLigature) {
            const font = getCurrentFont();
            return font.ligatures[state.currentLigature];
        }
        return getGlyph(state.currentCodePoint);
    }

    function ensureGlyph(codePoint) {
        getGlyph(codePoint);
    }

    function getAvailableCodePoints() {
        const font = getCurrentFont();
        return Object.keys(font.glyphs).map(Number).sort((a, b) => a - b);
    }

    function setPixel(glyph, x, y, value) {
        if (x < 0 || x >= glyph.width || y < 0 || y >= glyph.height) return;
        const row = glyph.pixels[y];
        const newRow = row.substring(0, x) + (value ? '1' : '0') + row.substring(x + 1);
        glyph.pixels[y] = newRow;
        glyph.modified = true;
    }

    function getPixel(glyph, x, y) {
        if (x < 0 || x >= glyph.width || y < 0 || y >= glyph.height) return 0;
        return glyph.pixels[y][x] === '1' ? 1 : 0;
    }

    function bresenhamLine(x0, y0, x1, y1, callback) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            callback(x0, y0);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    function pushHistorySnapshot() {
        const snapshot = {
            codePoint: state.currentCodePoint,
            currentTab: state.currentTab,
            currentLigature: state.currentLigature,
            glyph: cloneGlyph(getCurrentGlyph())
        };

        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(snapshot);

        if (state.history.length > MAX_HISTORY) {
            state.history.shift();
        } else {
            state.historyIndex++;
        }
    }

    function saveHistory() {
        pushHistorySnapshot();
    }

    function undo() {
        if (state.historyIndex <= 0) return;
        state.historyIndex--;
        const snapshot = state.history[state.historyIndex];
        const font = getCurrentFont();
        
        state.currentCodePoint = snapshot.codePoint;
        state.currentTab = snapshot.currentTab;
        state.currentLigature = snapshot.currentLigature;
        
        if (snapshot.currentTab === 'ligatures' && snapshot.currentLigature) {
            font.ligatures[snapshot.currentLigature] = cloneGlyph(snapshot.glyph);
        } else {
            font.glyphs[snapshot.codePoint] = cloneGlyph(snapshot.glyph);
        }
        
        renderEditor();
        renderGlyphSet();
        renderPreview();
        updateCurrentCharInfo();
    }

    function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        const snapshot = state.history[state.historyIndex];
        const font = getCurrentFont();
        
        state.currentCodePoint = snapshot.codePoint;
        state.currentTab = snapshot.currentTab;
        state.currentLigature = snapshot.currentLigature;
        
        if (snapshot.currentTab === 'ligatures' && snapshot.currentLigature) {
            font.ligatures[snapshot.currentLigature] = cloneGlyph(snapshot.glyph);
        } else {
            font.glyphs[snapshot.codePoint] = cloneGlyph(snapshot.glyph);
        }
        
        renderEditor();
        renderGlyphSet();
        renderPreview();
        updateCurrentCharInfo();
    }

    function clearHistory() {
        state.history = [];
        state.historyIndex = -1;
        pushHistorySnapshot();
    }

    function renderGlyphCanvas() {
        const font = getCurrentFont();
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        
        const width = glyph.width * PIXEL_SIZE;
        const height = glyph.height * PIXEL_SIZE;
        
        canvas.width = width;
        canvas.height = height;
        
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
        
        for (let y = 0; y < glyph.height; y++) {
            for (let x = 0; x < glyph.width; x++) {
                const px = x * PIXEL_SIZE;
                const py = y * PIXEL_SIZE;
                
                if (getPixel(glyph, x, y)) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
                }
                
                ctx.strokeStyle = '#2a2a4a';
                ctx.lineWidth = 1;
                ctx.strokeRect(px + 0.5, py + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
            }
        }
        
        const ascentY = (glyph.height - font.metadata.ascent) * PIXEL_SIZE;
        const baselineY = (glyph.height - font.metadata.baseline) * PIXEL_SIZE;
        const descentY = (glyph.height - font.metadata.descent) * PIXEL_SIZE;
        
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.moveTo(0, ascentY + 0.5);
        ctx.lineTo(width, ascentY + 0.5);
        ctx.stroke();
        
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, baselineY + 0.5);
        ctx.lineTo(width, baselineY + 0.5);
        ctx.stroke();
        
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.beginPath();
        ctx.moveTo(0, descentY + 0.5);
        ctx.lineTo(width, descentY + 0.5);
        ctx.stroke();
        
        if (state.lineStart && state.currentTool === 'line') {
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(
                state.lineStart.x * PIXEL_SIZE + PIXEL_SIZE / 2,
                state.lineStart.y * PIXEL_SIZE + PIXEL_SIZE / 2
            );
            ctx.lineTo(
                state.lastMouseX * PIXEL_SIZE + PIXEL_SIZE / 2,
                state.lastMouseY * PIXEL_SIZE + PIXEL_SIZE / 2
            );
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function getCanvasPixelCoords(e, targetCanvas) {
        const rect = targetCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / PIXEL_SIZE);
        const y = Math.floor((e.clientY - rect.top) / PIXEL_SIZE);
        return { x, y };
    }

    function applyTool(x, y, targetGlyph, targetCanvas) {
        if (!targetGlyph) return;
        
        if (state.currentTool === 'pencil') {
            setPixel(targetGlyph, x, y, 1);
        } else if (state.currentTool === 'eraser') {
            setPixel(targetGlyph, x, y, 0);
        } else if (state.currentTool === 'rect' && state.lineStart) {
            const x0 = Math.min(state.lineStart.x, x);
            const x1 = Math.max(state.lineStart.x, x);
            const y0 = Math.min(state.lineStart.y, y);
            const y1 = Math.max(state.lineStart.y, y);
            for (let ry = y0; ry <= y1; ry++) {
                for (let rx = x0; rx <= x1; rx++) {
                    setPixel(targetGlyph, rx, ry, 1);
                }
            }
            state.lineStart = null;
        }
    }

    function handleCanvasMouseDown(e) {
        if (state.playbackMode) return;

        const { x, y } = getCanvasPixelCoords(e, canvas);
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        
        state.isDrawing = true;
        state.lastMouseX = x;
        state.lastMouseY = y;
        state.drawingModified = false;
        
        if (state.currentTool === 'line' || state.currentTool === 'rect') {
            if (!state.lineStart) {
                state.lineStart = { x, y };
                renderGlyphCanvas();
                return;
            }
        }
        
        if (state.currentTool === 'line' && state.lineStart) {
            bresenhamLine(state.lineStart.x, state.lineStart.y, x, y, (lx, ly) => {
                setPixel(glyph, lx, ly, 1);
            });
            if (state.isRecording) {
                recordOperation('line', {
                    x0: state.lineStart.x,
                    y0: state.lineStart.y,
                    x1: x,
                    y1: y
                });
            }
            state.lineStart = null;
            saveHistory();
            state.drawingModified = false;
        } else if (state.currentTool === 'rect' && state.lineStart) {
            const sx = Math.min(state.lineStart.x, x);
            const ex = Math.max(state.lineStart.x, x);
            const sy = Math.min(state.lineStart.y, y);
            const ey = Math.max(state.lineStart.y, y);
            for (let ry = sy; ry <= ey; ry++) {
                for (let rx = sx; rx <= ex; rx++) {
                    setPixel(glyph, rx, ry, 1);
                }
            }
            if (state.isRecording) {
                recordOperation('rect', {
                    x0: state.lineStart.x,
                    y0: state.lineStart.y,
                    x1: x,
                    y1: y
                });
            }
            state.lineStart = null;
            saveHistory();
            state.drawingModified = false;
        } else {
            applyTool(x, y, glyph, canvas);
            if (state.isRecording) {
                if (state.currentTool === 'pencil') {
                    recordOperation('pencil', { x, y });
                } else if (state.currentTool === 'eraser') {
                    recordOperation('eraser', { x, y });
                }
            }
            state.drawingModified = true;
        }
        
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function handleCanvasMouseMove(e) {
        if (state.playbackMode) return;

        const { x, y } = getCanvasPixelCoords(e, canvas);
        state.lastMouseX = x;
        state.lastMouseY = y;
        
        if (!state.isDrawing) {
            if (state.lineStart) {
                renderGlyphCanvas();
            }
            return;
        }
        
        if (state.currentTool === 'line' || state.currentTool === 'rect') {
            renderGlyphCanvas();
            return;
        }
        
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        applyTool(x, y, glyph, canvas);
        if (state.isRecording) {
            if (state.currentTool === 'pencil') {
                recordOperation('pencil', { x, y });
            } else if (state.currentTool === 'eraser') {
                recordOperation('eraser', { x, y });
            }
        }
        state.drawingModified = true;
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function handleCanvasMouseUp() {
        if (state.isDrawing && state.drawingModified) {
            saveHistory();
        }
        state.isDrawing = false;
        state.drawingModified = false;
    }

    function flipHorizontal() {
        if (state.playbackMode) return;
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        glyph.pixels = glyph.pixels.map(row => row.split('').reverse().join(''));
        glyph.modified = true;
        if (state.isRecording) {
            recordOperation('flipH', {});
        }
        saveHistory();
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function flipVertical() {
        if (state.playbackMode) return;
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        glyph.pixels.reverse();
        glyph.modified = true;
        if (state.isRecording) {
            recordOperation('flipV', {});
        }
        saveHistory();
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function moveGlyph(direction) {
        if (state.playbackMode) return;
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        const w = glyph.width;
        const h = glyph.height;
        
        if (direction === 'up') {
            glyph.pixels.shift();
            glyph.pixels.push('0'.repeat(w));
            if (state.isRecording) recordOperation('moveUp', {});
        } else if (direction === 'down') {
            glyph.pixels.pop();
            glyph.pixels.unshift('0'.repeat(w));
            if (state.isRecording) recordOperation('moveDown', {});
        } else if (direction === 'left') {
            glyph.pixels = glyph.pixels.map(row => row.substring(1) + '0');
            if (state.isRecording) recordOperation('moveLeft', {});
        } else if (direction === 'right') {
            glyph.pixels = glyph.pixels.map(row => '0' + row.substring(0, w - 1));
            if (state.isRecording) recordOperation('moveRight', {});
        }
        
        glyph.modified = true;
        saveHistory();
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function clearGlyph() {
        if (state.playbackMode) return;
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        glyph.pixels = glyph.pixels.map(() => '0'.repeat(glyph.width));
        glyph.modified = true;
        if (state.isRecording) {
            recordOperation('clear', {});
        }
        saveHistory();
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function recordOperation(type, params) {
        if (!state.isRecording) return;
        const now = Date.now();
        state.recordingOps.push({
            type: type,
            params: params,
            timestamp: now - state.recordingStartTime
        });
    }

    function startRecording() {
        if (state.currentTab === 'ligatures') {
            alert('连字暂不支持录制教程');
            return;
        }
        state.isRecording = true;
        state.recordingStartTime = Date.now();
        state.recordingOps = [];
        const glyph = getCurrentGlyph();
        if (glyph) {
            state.recordingInitialSnapshot = {
                width: glyph.width,
                height: glyph.height,
                pixels: [...glyph.pixels]
            };
        }
        const btn = document.getElementById('btn-record');
        if (btn) btn.classList.add('recording');
        saveHistory();
    }

    function stopRecording() {
        state.isRecording = false;
        const btn = document.getElementById('btn-record');
        if (btn) btn.classList.remove('recording');

        if (state.recordingOps.length === 0) {
            alert('没有录制到任何操作');
            return;
        }

        if (confirm('是否保存录制的教程为当前字形的书写教程？\n(再次录制将覆盖旧教程)')) {
            saveTutorial();
        }
    }

    function saveTutorial() {
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        glyph.tutorial = {
            initialSnapshot: state.recordingInitialSnapshot,
            operations: [...state.recordingOps]
        };
        renderGlyphSet();
    }

    function toggleRecording() {
        if (state.playbackMode) {
            alert('请先退出回放模式');
            return;
        }
        if (state.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    function applyOperationToGlyph(glyph, op) {
        const pixelsBefore = [];
        for (let y = 0; y < glyph.height; y++) {
            for (let x = 0; x < glyph.width; x++) {
                pixelsBefore.push({ x, y, value: getPixel(glyph, x, y) });
            }
        }

        switch (op.type) {
            case 'pencil':
                if (op.params.x !== undefined && op.params.y !== undefined) {
                    setPixel(glyph, op.params.x, op.params.y, 1);
                }
                break;
            case 'eraser':
                if (op.params.x !== undefined && op.params.y !== undefined) {
                    setPixel(glyph, op.params.x, op.params.y, 0);
                }
                break;
            case 'line':
                if (op.params.x0 !== undefined && op.params.y0 !== undefined &&
                    op.params.x1 !== undefined && op.params.y1 !== undefined) {
                    bresenhamLine(op.params.x0, op.params.y0, op.params.x1, op.params.y1, (lx, ly) => {
                        setPixel(glyph, lx, ly, 1);
                    });
                }
                break;
            case 'rect':
                if (op.params.x0 !== undefined && op.params.y0 !== undefined &&
                    op.params.x1 !== undefined && op.params.y1 !== undefined) {
                    const x0 = Math.min(op.params.x0, op.params.x1);
                    const x1 = Math.max(op.params.x0, op.params.x1);
                    const y0 = Math.min(op.params.y0, op.params.y1);
                    const y1 = Math.max(op.params.y0, op.params.y1);
                    for (let ry = y0; ry <= y1; ry++) {
                        for (let rx = x0; rx <= x1; rx++) {
                            setPixel(glyph, rx, ry, 1);
                        }
                    }
                }
                break;
            case 'flipH':
                glyph.pixels = glyph.pixels.map(row => row.split('').reverse().join(''));
                break;
            case 'flipV':
                glyph.pixels.reverse();
                break;
            case 'flipD':
                const newPixels = [];
                for (let x = 0; x < glyph.width; x++) {
                    let row = '';
                    for (let y = 0; y < glyph.height; y++) {
                        row += glyph.pixels[y][x];
                    }
                    newPixels.push(row);
                }
                const tempW = glyph.width;
                glyph.width = glyph.height;
                glyph.height = tempW;
                glyph.pixels = newPixels;
                break;
            case 'moveUp':
                glyph.pixels.shift();
                glyph.pixels.push('0'.repeat(glyph.width));
                break;
            case 'moveDown':
                glyph.pixels.pop();
                glyph.pixels.unshift('0'.repeat(glyph.width));
                break;
            case 'moveLeft':
                glyph.pixels = glyph.pixels.map(row => row.substring(1) + '0');
                break;
            case 'moveRight':
                glyph.pixels = glyph.pixels.map(row => '0' + row.substring(0, glyph.width - 1));
                break;
            case 'clear':
                glyph.pixels = glyph.pixels.map(() => '0'.repeat(glyph.width));
                break;
        }

        const modifiedPixels = [];
        const isGlobalOp = ['flipH', 'flipV', 'flipD', 'moveUp', 'moveDown', 'moveLeft', 'moveRight', 'clear'].includes(op.type);

        if (isGlobalOp) {
            return { isGlobal: true, pixels: [] };
        }

        for (let y = 0; y < glyph.height; y++) {
            for (let x = 0; x < glyph.width; x++) {
                const idx = y * glyph.width + x;
                const newValue = getPixel(glyph, x, y);
                if (pixelsBefore[idx].value !== newValue) {
                    modifiedPixels.push({ x, y });
                }
            }
        }

        if (op.type === 'pencil' || op.type === 'eraser') {
            if (modifiedPixels.length === 0 && op.params.x !== undefined) {
                modifiedPixels.push({ x: op.params.x, y: op.params.y });
            }
        }

        return { isGlobal: false, pixels: modifiedPixels };
    }

    function enterPlaybackMode(codePoint) {
        const font = getCurrentFont();
        const glyph = font.glyphs[codePoint];
        if (!glyph || !glyph.tutorial) {
            alert('该字形没有录制教程');
            return;
        }

        if (state.isRecording) {
            stopRecording();
        }

        state.currentCodePoint = codePoint;
        state.currentTab = 'glyphs';
        updateTabs();

        state.playbackMode = true;
        state.playbackOps = [...glyph.tutorial.operations];
        state.playbackSnapshot = {
            width: glyph.tutorial.initialSnapshot.width,
            height: glyph.tutorial.initialSnapshot.height,
            pixels: [...glyph.tutorial.initialSnapshot.pixels]
        };
        state.playbackGlyph = {
            width: glyph.tutorial.initialSnapshot.width,
            height: glyph.tutorial.initialSnapshot.height,
            pixels: [...glyph.tutorial.initialSnapshot.pixels],
            modified: false
        };
        state.playbackCurrentStep = 0;
        state.playbackIsPlaying = false;
        state.playbackHighlightPixels = [];
        state.playbackHighlightAll = false;

        document.getElementById('playback-controls').style.display = 'flex';
        document.querySelector('.canvas-container').classList.add('playback-mode');
        document.getElementById('playback-progress').max = state.playbackOps.length;
        document.getElementById('playback-progress').value = 0;
        document.getElementById('playback-step-info').textContent = `0 / ${state.playbackOps.length}`;
        document.getElementById('btn-playback-play').textContent = '▶';

        updateCurrentCharInfo();
        renderPlaybackGlyphCanvas();
        renderPlaybackPreview();
    }

    function exitPlaybackMode() {
        state.playbackMode = false;
        if (state.playbackTimerId) {
            clearTimeout(state.playbackTimerId);
            state.playbackTimerId = null;
        }
        if (state.playbackHighlightTimerId) {
            clearTimeout(state.playbackHighlightTimerId);
            state.playbackHighlightTimerId = null;
        }
        state.playbackGlyph = null;
        state.playbackOps = [];
        state.playbackSnapshot = null;
        state.playbackCurrentStep = 0;
        state.playbackIsPlaying = false;
        state.playbackHighlightPixels = [];
        state.playbackHighlightAll = false;

        document.getElementById('playback-controls').style.display = 'none';
        document.querySelector('.canvas-container').classList.remove('playback-mode');

        clearHistory();
        renderAll();
    }

    function playNextStep() {
        if (state.playbackCurrentStep >= state.playbackOps.length) {
            state.playbackIsPlaying = false;
            document.getElementById('btn-playback-play').textContent = '▶';
            return false;
        }

        const op = state.playbackOps[state.playbackCurrentStep];
        const result = applyOperationToGlyph(state.playbackGlyph, op);

        if (result.isGlobal) {
            state.playbackHighlightAll = true;
            state.playbackHighlightPixels = [];
        } else {
            state.playbackHighlightAll = false;
            state.playbackHighlightPixels = result.pixels;
        }

        state.playbackCurrentStep++;
        document.getElementById('playback-progress').value = state.playbackCurrentStep;
        document.getElementById('playback-step-info').textContent = `${state.playbackCurrentStep} / ${state.playbackOps.length}`;

        renderPlaybackGlyphCanvas();
        renderPlaybackPreview();

        if (state.playbackHighlightTimerId) {
            clearTimeout(state.playbackHighlightTimerId);
        }
        state.playbackHighlightTimerId = setTimeout(() => {
            state.playbackHighlightPixels = [];
            state.playbackHighlightAll = false;
            renderPlaybackGlyphCanvas();
        }, 300);

        return true;
    }

    function scheduleNextPlaybackStep() {
        if (!state.playbackIsPlaying) return;
        if (state.playbackCurrentStep >= state.playbackOps.length) {
            state.playbackIsPlaying = false;
            document.getElementById('btn-playback-play').textContent = '▶';
            return;
        }

        const currentOp = state.playbackOps[state.playbackCurrentStep];
        const nextOp = state.playbackOps[state.playbackCurrentStep + 1];
        let delay = 100;

        if (nextOp) {
            delay = (nextOp.timestamp - currentOp.timestamp) / state.playbackSpeed;
            delay = Math.max(30, Math.min(delay, 2000));
        }

        state.playbackTimerId = setTimeout(() => {
            if (playNextStep()) {
                scheduleNextPlaybackStep();
            }
        }, delay);
    }

    function togglePlaybackPlay() {
        if (state.playbackCurrentStep >= state.playbackOps.length) {
            state.playbackCurrentStep = 0;
            state.playbackGlyph = {
                width: state.playbackSnapshot.width,
                height: state.playbackSnapshot.height,
                pixels: [...state.playbackSnapshot.pixels],
                modified: false
            };
            document.getElementById('playback-progress').value = 0;
            document.getElementById('playback-step-info').textContent = `0 / ${state.playbackOps.length}`;
        }

        state.playbackIsPlaying = !state.playbackIsPlaying;
        document.getElementById('btn-playback-play').textContent = state.playbackIsPlaying ? '⏸' : '▶';

        if (state.playbackIsPlaying) {
            if (state.playbackCurrentStep === 0) {
                playNextStep();
            }
            scheduleNextPlaybackStep();
        } else {
            if (state.playbackTimerId) {
                clearTimeout(state.playbackTimerId);
                state.playbackTimerId = null;
            }
        }
    }

    function seekPlayback(step) {
        if (state.playbackTimerId) {
            clearTimeout(state.playbackTimerId);
            state.playbackTimerId = null;
        }

        state.playbackGlyph = {
            width: state.playbackSnapshot.width,
            height: state.playbackSnapshot.height,
            pixels: [...state.playbackSnapshot.pixels],
            modified: false
        };
        state.playbackHighlightPixels = [];
        state.playbackHighlightAll = false;

        for (let i = 0; i < step; i++) {
            applyOperationToGlyph(state.playbackGlyph, state.playbackOps[i]);
        }

        state.playbackCurrentStep = step;
        document.getElementById('playback-progress').value = step;
        document.getElementById('playback-step-info').textContent = `${step} / ${state.playbackOps.length}`;

        renderPlaybackGlyphCanvas();
        renderPlaybackPreview();

        if (state.playbackIsPlaying) {
            scheduleNextPlaybackStep();
        }
    }

    function setPlaybackSpeed(speed) {
        state.playbackSpeed = parseFloat(speed);
    }

    function renderPlaybackGlyphCanvas() {
        const font = getCurrentFont();
        const glyph = state.playbackGlyph;
        if (!glyph) return;

        const width = glyph.width * PIXEL_SIZE;
        const height = glyph.height * PIXEL_SIZE;

        canvas.width = width;
        canvas.height = height;

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const highlightSet = new Set();
        state.playbackHighlightPixels.forEach(p => {
            highlightSet.add(`${p.x},${p.y}`);
        });

        for (let y = 0; y < glyph.height; y++) {
            for (let x = 0; x < glyph.width; x++) {
                const px = x * PIXEL_SIZE;
                const py = y * PIXEL_SIZE;

                if (getPixel(glyph, x, y)) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
                }

                if (state.playbackHighlightAll || highlightSet.has(`${x},${y}`)) {
                    ctx.strokeStyle = '#facc15';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(px + 1.5, py + 1.5, PIXEL_SIZE - 3, PIXEL_SIZE - 3);
                } else {
                    ctx.strokeStyle = '#2a2a4a';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px + 0.5, py + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
                }
            }
        }

        const ascentY = (glyph.height - font.metadata.ascent) * PIXEL_SIZE;
        const baselineY = (glyph.height - font.metadata.baseline) * PIXEL_SIZE;
        const descentY = (glyph.height - font.metadata.descent) * PIXEL_SIZE;

        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(0, ascentY + 0.5);
        ctx.lineTo(width, ascentY + 0.5);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, baselineY + 0.5);
        ctx.lineTo(width, baselineY + 0.5);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.beginPath();
        ctx.moveTo(0, descentY + 0.5);
        ctx.lineTo(width, descentY + 0.5);
        ctx.stroke();
    }

    function renderPlaybackPreview() {
        if (!state.playbackMode || !state.playbackGlyph) return;

        const text = document.getElementById('preview-text').value;
        const scale = previewState.scale;

        const font = getCurrentFont();
        const originalGlyph = font.glyphs[state.currentCodePoint];
        const tempBackup = originalGlyph ? { ...originalGlyph, pixels: [...originalGlyph.pixels] } : null;

        if (originalGlyph) {
            originalGlyph.pixels = [...state.playbackGlyph.pixels];
        }

        renderPreview();

        if (originalGlyph && tempBackup) {
            originalGlyph.pixels = tempBackup.pixels;
        }
    }

    function drawGlyphToCanvas(targetCtx, glyph, x, y, scale, color = '#ffffff') {
        for (let gy = 0; gy < glyph.height; gy++) {
            for (let gx = 0; gx < glyph.width; gx++) {
                if (getPixel(glyph, gx, gy)) {
                    targetCtx.fillStyle = color;
                    targetCtx.fillRect(
                        x + gx * scale,
                        y + gy * scale,
                        scale,
                        scale
                    );
                }
            }
        }
    }

    function drawCharsetThumbnail(canvasEl, codePoint) {
        const glyph = getGlyph(codePoint);
        const ctx2d = canvasEl.getContext('2d');
        const scale = 2;
        const width = glyph.width * scale;
        const height = glyph.height * scale;
        
        canvasEl.width = width;
        canvasEl.height = height;
        
        ctx2d.fillStyle = '#1e1e3a';
        ctx2d.fillRect(0, 0, width, height);
        
        drawGlyphToCanvas(ctx2d, glyph, 0, 0, scale, '#ffffff');
    }

    function renderAll() {
        renderEditor();
        renderGlyphSet();
        renderPreview();
        updateCurrentCharInfo();
        renderKerningList();
        renderLigatureList();
        updateSettingsForm();
    }

    function renderEditor() {
        if (state.playbackMode) {
            renderPlaybackGlyphCanvas();
            return;
        }
        if (state.currentTab === 'ligatures') {
            renderGlyphCanvas();
        } else {
            renderGlyphCanvas();
        }
    }

    function updateTabs() {
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => tab.classList.remove('active'));
        if (state.currentTab === 'glyphs') {
            document.getElementById('btn-tab-glyphs').classList.add('active');
        } else {
            document.getElementById('btn-tab-ligatures').classList.add('active');
        }
    }

    function renderGlyphSet() {
        const font = getCurrentFont();
        const grid = document.getElementById('glyph-set');
        if (!grid) return;
        grid.innerHTML = '';
        
        let codePoints;
        if (state.currentTab === 'ligatures') {
            codePoints = Object.keys(font.ligatures).sort();
        } else {
            codePoints = Object.keys(font.glyphs)
                .map(Number)
                .sort((a, b) => a - b);
        }
        
        const filtered = state.glyphFilter 
            ? codePoints.filter(cp => {
                if (state.currentTab === 'ligatures') {
                    return cp.includes(state.glyphFilter);
                }
                const char = String.fromCodePoint(cp);
                const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
                return char.includes(state.glyphFilter) || hex.includes(state.glyphFilter.toUpperCase());
            })
            : codePoints;
        
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'charset-item';
            
            if (state.currentTab === 'glyphs') {
                const codePoint = item;
                const glyph = getGlyph(codePoint);
                const isEmpty = isGlyphEmpty(glyph);
                const hasTutorial = glyph && glyph.tutorial;
                
                if (codePoint === state.currentCodePoint) div.classList.add('active');
                if (isEmpty) div.classList.add('empty');
                div.dataset.codePoint = codePoint;
                
                const canvasEl = document.createElement('canvas');
                canvasEl.className = 'charset-canvas';
                
                const label = document.createElement('div');
                label.className = 'charset-label';
                label.textContent = 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
                
                div.appendChild(canvasEl);
                div.appendChild(label);

                if (hasTutorial) {
                    const playBtn = document.createElement('button');
                    playBtn.className = 'charset-play-icon';
                    playBtn.title = '播放教程';
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        enterPlaybackMode(codePoint);
                    });
                    div.appendChild(playBtn);
                }
                
                div.addEventListener('click', () => {
                    if (state.playbackMode) {
                        exitPlaybackMode();
                    }
                    state.currentCodePoint = codePoint;
                    state.currentTab = 'glyphs';
                    clearHistory();
                    updateTabs();
                    renderEditor();
                    renderGlyphSet();
                    updateCurrentCharInfo();
                });
                
                div.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showGlyphContextMenu(e.clientX, e.clientY, codePoint);
                });
                
                grid.appendChild(div);
                drawCharsetThumbnail(canvasEl, codePoint);
            } else {
                const ligKey = item;
                if (ligKey === state.currentLigature) div.classList.add('active');
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'ligature-name';
                nameSpan.textContent = ligKey;
                nameSpan.style.fontSize = '12px';
                nameSpan.style.padding = '8px';
                
                div.appendChild(nameSpan);
                
                div.addEventListener('click', () => {
                    state.currentLigature = ligKey;
                    state.currentTab = 'ligatures';
                    clearHistory();
                    updateTabs();
                    renderEditor();
                    renderGlyphSet();
                });
                
                grid.appendChild(div);
            }
        });
    }

    function showLigatureList() {
        state.currentTab = 'ligatures';
        renderGlyphSet();
    }

    function updateCurrentCharInfo() {
        if (state.currentTab === 'ligatures' && state.currentLigature) {
            document.getElementById('current-char-display').textContent = state.currentLigature;
            document.getElementById('current-char-code').textContent = '连字';
        } else {
            const char = String.fromCodePoint(state.currentCodePoint);
            document.getElementById('current-char-display').textContent = char;
            document.getElementById('current-char-code').textContent = 
                'U+' + state.currentCodePoint.toString(16).toUpperCase().padStart(4, '0');
        }
    }

    function showGlyphContextMenu(x, y, codePoint) {
        state.contextMenuCodePoint = codePoint;
        const items = [
            { icon: '⎘', label: '复制字形', action: () => copyGlyph(codePoint) },
            { icon: '⎙', label: '粘贴字形', action: () => pasteGlyph(codePoint) },
            { divider: true },
            { icon: '✕', label: '删除字形', danger: true, action: () => deleteGlyph(codePoint) }
        ];
        showContextMenu(x, y, items);
    }

    function processTextForRendering(text) {
        const font = getCurrentFont();
        return processTextWithFont(text, font);
    }

    function processTextWithFont(text, font) {
        const result = [];
        let i = 0;
        
        const ligatureKeys = Object.keys(font.ligatures)
            .sort((a, b) => b.length - a.length);
        
        while (i < text.length) {
            let matched = false;
            
            for (const ligKey of ligatureKeys) {
                if (text.substring(i, i + ligKey.length) === ligKey) {
                    result.push({
                        type: 'ligature',
                        chars: ligKey,
                        glyph: font.ligatures[ligKey]
                    });
                    i += ligKey.length;
                    matched = true;
                    break;
                }
            }
            
            if (!matched) {
                const codePoint = text.codePointAt(i);
                result.push({
                    type: 'char',
                    char: text[i],
                    codePoint: codePoint,
                    glyph: font.glyphs[codePoint] || createEmptyGlyph(font.metadata.glyphWidth, font.metadata.glyphHeight)
                });
                i++;
            }
        }
        
        return result;
    }

    function parseFontTags(text) {
        const segments = [];
        let currentFontName = getCurrentFont().metadata.name;
        let currentText = '';
        let i = 0;
        
        while (i < text.length) {
            if (text.substring(i, i + 6) === '(font:') {
                if (currentText) {
                    segments.push({
                        fontName: currentFontName,
                        text: currentText
                    });
                    currentText = '';
                }
                
                const endIndex = text.indexOf(')', i);
                if (endIndex !== -1) {
                    const fontName = text.substring(i + 6, endIndex).trim();
                    if (getFontByName(fontName)) {
                        currentFontName = fontName;
                    }
                    i = endIndex + 1;
                } else {
                    currentText += text[i];
                    i++;
                }
            } else {
                currentText += text[i];
                i++;
            }
        }
        
        if (currentText) {
            segments.push({
                fontName: currentFontName,
                text: currentText
            });
        }
        
        return segments;
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 255, b: 255 };
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => {
            const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }

    function lerpColor(color1, color2, t) {
        const c1 = hexToRgb(color1);
        const c2 = hexToRgb(color2);
        return rgbToHex(
            c1.r + (c2.r - c1.r) * t,
            c1.g + (c2.g - c1.g) * t,
            c1.b + (c2.b - c1.b) * t
        );
    }

    function getTextLayout(text, scale) {
        const segments = parseFontTags(text);
        const lineWidth = previewState.lineWidth;
        const lineSpacing = previewState.lineSpacing;

        const lines = [];
        let currentLine = [];
        let currentWidth = 0;
        let currentWord = [];
        let currentWordWidth = 0;
        let maxGlyphHeight = 0;

        segments.forEach(segment => {
            const font = getFontByName(segment.fontName);
            if (!font) return;
            if (font.metadata.glyphHeight > maxGlyphHeight) {
                maxGlyphHeight = font.metadata.glyphHeight;
            }
        });

        function flushWord() {
            if (currentWord.length > 0) {
                if (currentWidth + currentWordWidth > lineWidth && currentLine.length > 0) {
                    lines.push({ chars: currentLine, height: maxGlyphHeight });
                    currentLine = [];
                    currentWidth = 0;
                }
                currentLine.push(...currentWord);
                currentWidth += currentWordWidth;
                currentWord = [];
                currentWordWidth = 0;
            }
        }

        segments.forEach(segment => {
            const font = getFontByName(segment.fontName);
            if (!font) return;

            const processed = processTextWithFont(segment.text, font);
            const defaultSpacing = font.metadata.defaultSpacing;

            for (let i = 0; i < processed.length; i++) {
                const item = processed[i];
                let itemWidth;
                let glyph;

                if (item.type === 'ligature') {
                    glyph = item.glyph;
                    itemWidth = item.glyph.width + defaultSpacing;
                } else {
                    glyph = item.glyph || createEmptyGlyph(font.metadata.glyphWidth, font.metadata.glyphHeight);
                    let kerningOffset = 0;
                    if (i > 0 && processed[i-1].type === 'char') {
                        const prevChar = processed[i-1].char;
                        const kerningKey = prevChar + item.char;
                        kerningOffset = font.kerning[kerningKey] || 0;
                    }
                    itemWidth = glyph.width + defaultSpacing + kerningOffset;
                }

                if (item.type === 'char' && (item.char === ' ' || item.char === '\n')) {
                    flushWord();
                    if (item.char === '\n') {
                        lines.push({ chars: currentLine, height: maxGlyphHeight });
                        currentLine = [];
                        currentWidth = 0;
                    } else {
                        currentLine.push({ ...item, glyph, width: itemWidth, x: currentWidth, fontName: segment.fontName });
                        currentWidth += itemWidth * scale;
                    }
                } else {
                    currentWord.push({ ...item, glyph, width: itemWidth, x: 0, fontName: segment.fontName });
                    currentWordWidth += itemWidth * scale;
                }
            }
        });

        flushWord();
        if (currentLine.length > 0) {
            lines.push({ chars: currentLine, height: maxGlyphHeight });
        }

        const layoutLines = [];
        let y = 0;
        lines.forEach(line => {
            let x = 0;
            const layoutChars = [];
            
            line.chars.forEach((item, idx) => {
                const font = getFontByName(item.fontName);
                if (!font) return;

                if (item.type === 'char' && idx > 0) {
                    const prevItem = line.chars[idx - 1];
                    if (prevItem.type === 'char' && prevItem.fontName === item.fontName) {
                        const kerningKey = prevItem.char + item.char;
                        const kerningOffset = font.kerning[kerningKey] || 0;
                        x += kerningOffset * scale;
                    }
                }

                const baselineOffset = (line.height - font.metadata.glyphHeight) * scale;
                
                layoutChars.push({
                    ...item,
                    x: x,
                    y: y + baselineOffset,
                    glyph: item.glyph,
                    fontName: item.fontName
                });
                x += item.width * scale;
            });
            layoutLines.push({ chars: layoutChars, y: y, width: x, height: line.height });
            y += (line.height + lineSpacing) * scale;
        });

        return {
            lines: layoutLines,
            totalWidth: Math.max(...layoutLines.map(l => l.width), 100),
            totalHeight: y
        };
    }

    function drawGlyphWithColor(targetCtx, glyph, x, y, scale, color) {
        const rgb = hexToRgb(color);
        targetCtx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        for (let gy = 0; gy < glyph.height; gy++) {
            for (let gx = 0; gx < glyph.width; gx++) {
                if (getPixel(glyph, gx, gy)) {
                    targetCtx.fillRect(
                        x + gx * scale,
                        y + gy * scale,
                        scale,
                        scale
                    );
                }
            }
        }
    }

    function applyWaveEffect(layout, scale, frame) {
        const amplitude = previewState.waveAmp;
        const speed = previewState.waveSpeed;
        const length = previewState.waveLength;
        let charIndex = 0;

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                const offset = amplitude * scale * Math.sin(charIndex * (2 * Math.PI / length) + (frame * speed * Math.PI * 2) / 60);
                char.yOffset = offset;
                charIndex++;
            });
        });
    }

    function applyGradientEffect(layout, scale, frame) {
        const color1 = previewState.gradientColor1;
        const color2 = previewState.gradientColor2;
        const speed = previewState.gradientSpeed;

        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                if (!char.glyph) return;
                char.colors = [];
                const glyph = char.glyph;
                const tOffset = (frame * speed) / 60;

                for (let gy = 0; gy < glyph.height; gy++) {
                    char.colors[gy] = [];
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (getPixel(glyph, gx, gy)) {
                            const t = ((gx + gy) / (glyph.width + glyph.height) + tOffset) % 1;
                            char.colors[gy][gx] = lerpColor(color1, color2, t);
                        }
                    }
                }
            });
        });
    }

    function applyGlowEffect(ctx, layout, scale) {
        const intensity = previewState.glowIntensity;
        const color = previewState.textColor;
        const rgb = hexToRgb(color);

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                if (!char.glyph) return;
                const glyph = char.glyph;
                const y = char.y + (char.yOffset || 0);

                for (let dx = -intensity; dx <= intensity; dx++) {
                    for (let dy = -intensity; dy <= intensity; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > intensity) continue;
                        const alpha = (1 - dist / intensity) * 0.3;
                        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
                        for (let gy = 0; gy < glyph.height; gy++) {
                            for (let gx = 0; gx < glyph.width; gx++) {
                                if (getPixel(glyph, gx, gy)) {
                                    ctx.fillRect(
                                        char.x + gx * scale + dx * scale,
                                        y + gy * scale + dy * scale,
                                        scale,
                                        scale
                                    );
                                }
                            }
                        }
                    }
                }
            });
        });
    }

    function renderFrame(targetCtx, frame, text, scale, targetWidth, targetHeight) {
        const layout = getTextLayout(text, scale);

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                char.yOffset = 0;
                char.colors = null;
            });
        });

        const effectType = previewState.effectType;

        if (effectType === 'wave') {
            applyWaveEffect(layout, scale, frame);
        }

        targetCtx.fillStyle = '#0f0f23';
        targetCtx.fillRect(0, 0, targetWidth, targetHeight);

        if (effectType === 'glow') {
            applyGlowEffect(targetCtx, layout, scale);
        }

        if (effectType === 'gradient') {
            applyGradientEffect(layout, scale, frame);
        }

        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                if (!char.glyph) return;
                const glyph = char.glyph;
                const y = char.y + (char.yOffset || 0);

                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (getPixel(glyph, gx, gy)) {
                            let color = previewState.textColor;
                            if (char.colors && char.colors[gy] && char.colors[gy][gx]) {
                                color = char.colors[gy][gx];
                            }
                            const rgb = hexToRgb(color);
                            targetCtx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                            targetCtx.fillRect(
                                char.x + gx * scale,
                                y + gy * scale,
                                scale,
                                scale
                            );
                        }
                    }
                }
            });
        });

        return layout;
    }

    function renderPreview() {
        const text = document.getElementById('preview-text').value;
        const scale = previewState.scale;

        const layout = getTextLayout(text, scale);
        const padding = 20;
        const maxEffectOffset = 20;
        const totalWidth = Math.max(layout.totalWidth + padding * 2, 100);
        const totalHeight = Math.max(layout.totalHeight + padding * 2 + maxEffectOffset * 2, 50);

        previewCanvas.width = totalWidth;
        previewCanvas.height = totalHeight;

        previewCtx.save();
        previewCtx.translate(padding, padding + maxEffectOffset);

        renderFrame(previewCtx, previewState.currentFrame, text, scale, totalWidth, totalHeight);

        previewCtx.restore();

        const frameDisplay = document.getElementById('frame-display');
        if (frameDisplay) {
            frameDisplay.textContent = `帧: ${previewState.currentFrame}`;
        }
    }

    function startPreviewAnimation() {
        if (previewState.animationId) {
            cancelAnimationFrame(previewState.animationId);
        }
        previewState.lastFrameTime = 0;
        animatePreview();
    }

    function stopPreviewAnimation() {
        if (previewState.animationId) {
            cancelAnimationFrame(previewState.animationId);
            previewState.animationId = null;
        }
    }

    function animatePreview(timestamp) {
        if (!previewState.isPlaying) {
            previewState.animationId = requestAnimationFrame(animatePreview);
            return;
        }

        if (!previewState.lastFrameTime) {
            previewState.lastFrameTime = timestamp;
        }

        const frameInterval = 1000 / previewState.fps;
        const elapsed = timestamp - previewState.lastFrameTime;

        if (elapsed >= frameInterval) {
            previewState.currentFrame++;
            previewState.lastFrameTime = timestamp - (elapsed % frameInterval);
            renderPreview();
        }

        previewState.animationId = requestAnimationFrame(animatePreview);
    }

    function togglePlayPause() {
        previewState.isPlaying = !previewState.isPlaying;
        const btn = document.getElementById('btn-play-pause');
        if (btn) {
            btn.textContent = previewState.isPlaying ? '⏸ 暂停' : '▶ 播放';
        }
    }

    class GIFEncoder {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.frames = [];
            this.colors = [];
            this.colorMap = new Map();
            this.delay = 10;
        }

        addFrame(imageData, delay) {
            this.frames.push({ imageData, delay: delay || this.delay });
            this.extractColors(imageData);
        }

        extractColors(imageData) {
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                const key = `${r},${g},${b}`;
                if (!this.colorMap.has(key)) {
                    if (this.colors.length < 256) {
                        this.colorMap.set(key, this.colors.length);
                        this.colors.push({ r, g, b });
                    }
                }
            }
        }

        getColorIndex(r, g, b) {
            const key = `${r},${g},${b}`;
            if (this.colorMap.has(key)) {
                return this.colorMap.get(key);
            }
            let minDist = Infinity;
            let closest = 0;
            for (let i = 0; i < this.colors.length; i++) {
                const c = this.colors[i];
                const dist = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    closest = i;
                }
            }
            return closest;
        }

        writeWord(value) {
            return [value & 0xff, (value >> 8) & 0xff];
        }

        writeString(str) {
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                bytes.push(str.charCodeAt(i));
            }
            return bytes;
        }

        encodePalette() {
            const bytes = [];
            const paletteSize = 256;
            for (let i = 0; i < paletteSize; i++) {
                if (i < this.colors.length) {
                    bytes.push(this.colors[i].r);
                    bytes.push(this.colors[i].g);
                    bytes.push(this.colors[i].b);
                } else {
                    bytes.push(0, 0, 0);
                }
            }
            return bytes;
        }

        lzwCompress(indices, minCodeSize) {
            const clearCode = 1 << minCodeSize;
            const eoiCode = clearCode + 1;
            let codeSize = minCodeSize + 1;
            let nextCode = eoiCode + 1;

            const dict = new Map();
            for (let i = 0; i < clearCode; i++) {
                dict.set(String(i), i);
            }

            const output = [];
            let current = String(indices[0]);

            function writeCode(code, size, buffer, bufferPos) {
                for (let i = 0; i < size; i++) {
                    buffer[bufferPos >> 3] |= ((code >> i) & 1) << (bufferPos & 7);
                    bufferPos++;
                }
                return bufferPos;
            }

            let buffer = new Uint8Array(Math.ceil(indices.length * 2));
            let bufferPos = 0;

            bufferPos = writeCode(clearCode, codeSize, buffer, bufferPos);

            for (let i = 1; i < indices.length; i++) {
                const key = current + ',' + indices[i];
                if (dict.has(key)) {
                    current = key;
                } else {
                    bufferPos = writeCode(dict.get(current), codeSize, buffer, bufferPos);
                    if (nextCode < 4096) {
                        dict.set(key, nextCode++);
                        if (nextCode > (1 << codeSize) && codeSize < 12) {
                            codeSize++;
                        }
                    } else {
                        bufferPos = writeCode(clearCode, codeSize, buffer, bufferPos);
                        dict.clear();
                        for (let j = 0; j < clearCode; j++) {
                            dict.set(String(j), j);
                        }
                        codeSize = minCodeSize + 1;
                        nextCode = eoiCode + 1;
                    }
                    current = String(indices[i]);
                }
            }

            bufferPos = writeCode(dict.get(current), codeSize, buffer, bufferPos);
            bufferPos = writeCode(eoiCode, codeSize, buffer, bufferPos);

            const byteCount = Math.ceil(bufferPos / 8);
            return buffer.slice(0, byteCount);
        }

        encode() {
            const bytes = [];

            bytes.push(...this.writeString('GIF89a'));
            bytes.push(...this.writeWord(this.width));
            bytes.push(...this.writeWord(this.height));

            const colorResolution = 7;
            const sortFlag = 0;
            const sizeOfGlobalColorTable = 7;
            const packedField = 0x80 | (colorResolution << 4) | (sortFlag << 3) | sizeOfGlobalColorTable;
            bytes.push(packedField);

            bytes.push(0);
            bytes.push(0);

            bytes.push(...this.encodePalette());

            bytes.push(0x21);
            bytes.push(0xff);
            bytes.push(0x0b);
            bytes.push(...this.writeString('NETSCAPE2.0'));
            bytes.push(0x03);
            bytes.push(0x01);
            bytes.push(0x00);
            bytes.push(0x00);
            bytes.push(0x00);

            for (let frameIdx = 0; frameIdx < this.frames.length; frameIdx++) {
                const frame = this.frames[frameIdx];
                const imageData = frame.imageData;
                const delay = Math.round(frame.delay / 10);

                bytes.push(0x21);
                bytes.push(0xf9);
                bytes.push(0x04);
                bytes.push(0x04);
                bytes.push(...this.writeWord(delay));
                bytes.push(0x00);
                bytes.push(0x00);

                bytes.push(0x2c);
                bytes.push(...this.writeWord(0));
                bytes.push(...this.writeWord(0));
                bytes.push(...this.writeWord(this.width));
                bytes.push(...this.writeWord(this.height));
                bytes.push(0x00);

                const indices = [];
                for (let i = 0; i < imageData.data.length; i += 4) {
                    const r = imageData.data[i];
                    const g = imageData.data[i + 1];
                    const b = imageData.data[i + 2];
                    indices.push(this.getColorIndex(r, g, b));
                }

                const minCodeSize = 8;
                bytes.push(minCodeSize);

                const compressed = this.lzwCompress(indices, minCodeSize);

                let offset = 0;
                while (offset < compressed.length) {
                    const blockSize = Math.min(255, compressed.length - offset);
                    bytes.push(blockSize);
                    for (let i = 0; i < blockSize; i++) {
                        bytes.push(compressed[offset + i]);
                    }
                    offset += blockSize;
                }
                bytes.push(0x00);
            }

            bytes.push(0x3b);

            return new Uint8Array(bytes);
        }
    }

    async function exportGIF() {
        if (typeof GIFEncoder === 'undefined') {
            alert('GIF 导出功能需要 gif.js 库支持。请在项目中添加 gif.js 文件。');
            return;
        }
        
        const exportBtn = document.getElementById('btn-export-gif');
        const originalText = exportBtn.textContent;
        
        const text = document.getElementById('preview-text').value;
        const scale = previewState.scale;
        const fps = previewState.fps;
        const font = getCurrentFont();

        const layout = getTextLayout(text, scale);
        const padding = 20;
        const maxEffectOffset = 20;
        const totalWidth = Math.max(layout.totalWidth + padding * 2, 100);
        const totalHeight = Math.max(layout.totalHeight + padding * 2 + maxEffectOffset * 2, 50);

        const totalFrames = 60;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = totalWidth;
        offscreenCanvas.height = totalHeight;
        const offCtx = offscreenCanvas.getContext('2d');

        const encoder = new GIFEncoder(totalWidth, totalHeight);
        const delay = Math.round(1000 / fps);

        exportBtn.disabled = true;

        for (let frame = 0; frame < totalFrames; frame++) {
            exportBtn.textContent = `导出中 ${frame + 1}/${totalFrames}`;

            offCtx.fillStyle = '#0f0f23';
            offCtx.fillRect(0, 0, totalWidth, totalHeight);

            offCtx.save();
            offCtx.translate(padding, padding + maxEffectOffset);
            renderFrame(offCtx, frame, text, scale, totalWidth, totalHeight);
            offCtx.restore();

            const imageData = offCtx.getImageData(0, 0, totalWidth, totalHeight);
            encoder.addFrame(imageData, delay);

            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const gifData = encoder.encode();
        const blob = new Blob([gifData], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.download = `${font.metadata.name || 'pixel-text'}-animation.gif`;
        link.href = url;
        link.click();

        URL.revokeObjectURL(url);

        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
    }

    function exportJSON() {
        const exportData = {
            version: 3,
            fonts: []
        };

        workspace.fonts.forEach(font => {
            const fontExport = {
                metadata: { ...font.metadata },
                glyphs: {},
                kerning: { ...font.kerning },
                ligatures: {}
            };
            
            Object.keys(font.glyphs).forEach(cp => {
                const g = font.glyphs[cp];
                const glyphExport = {
                    width: g.width,
                    height: g.height,
                    pixels: g.pixels
                };
                if (g.tutorial) {
                    glyphExport.tutorial = {
                        initialSnapshot: {
                            width: g.tutorial.initialSnapshot.width,
                            height: g.tutorial.initialSnapshot.height,
                            pixels: [...g.tutorial.initialSnapshot.pixels]
                        },
                        operations: [...g.tutorial.operations]
                    };
                }
                fontExport.glyphs[cp] = glyphExport;
            });
            
            Object.keys(font.ligatures).forEach(key => {
                const l = font.ligatures[key];
                fontExport.ligatures[key] = {
                    width: l.width,
                    height: l.height,
                    pixels: l.pixels
                };
            });

            exportData.fonts.push(fontExport);
        });
        
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        const currentFont = getCurrentFont();
        link.download = `${currentFont.metadata.name || 'pixel-font-workspace'}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    function importJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.fonts && Array.isArray(data.fonts)) {
                    workspace.fonts = [];
                    data.fonts.forEach(fontData => {
                        const font = {
                            metadata: { ...fontData.metadata },
                            glyphs: {},
                            kerning: fontData.kerning || {},
                            ligatures: {}
                        };
                        
                        if (fontData.glyphs) {
                            Object.keys(fontData.glyphs).forEach(cp => {
                                const g = fontData.glyphs[cp];
                                const glyph = {
                                    width: g.width,
                                    height: g.height,
                                    pixels: [...g.pixels],
                                    modified: false
                                };
                                if (g.tutorial) {
                                    glyph.tutorial = {
                                        initialSnapshot: {
                                            width: g.tutorial.initialSnapshot.width,
                                            height: g.tutorial.initialSnapshot.height,
                                            pixels: [...g.tutorial.initialSnapshot.pixels]
                                        },
                                        operations: [...g.tutorial.operations]
                                    };
                                }
                                font.glyphs[cp] = glyph;
                            });
                        }
                        
                        if (fontData.ligatures) {
                            Object.keys(fontData.ligatures).forEach(key => {
                                const l = fontData.ligatures[key];
                                font.ligatures[key] = {
                                    width: l.width,
                                    height: l.height,
                                    pixels: [...l.pixels],
                                    modified: false
                                };
                            });
                        }
                        
                        workspace.fonts.push(font);
                    });
                    workspace.currentFontIndex = 0;
                } else {
                    const font = {
                        metadata: { ...data.metadata },
                        glyphs: {},
                        kerning: data.kerning || {},
                        ligatures: {}
                    };
                    
                    if (data.glyphs) {
                        Object.keys(data.glyphs).forEach(cp => {
                            const g = data.glyphs[cp];
                            const glyph = {
                                width: g.width,
                                height: g.height,
                                pixels: [...g.pixels],
                                modified: false
                            };
                            if (g.tutorial) {
                                glyph.tutorial = {
                                    initialSnapshot: {
                                        width: g.tutorial.initialSnapshot.width,
                                        height: g.tutorial.initialSnapshot.height,
                                        pixels: [...g.tutorial.initialSnapshot.pixels]
                                    },
                                    operations: [...g.tutorial.operations]
                                };
                            }
                            font.glyphs[cp] = glyph;
                        });
                    }
                    
                    if (data.ligatures) {
                        Object.keys(data.ligatures).forEach(key => {
                            const l = data.ligatures[key];
                            font.ligatures[key] = {
                                width: l.width,
                                height: l.height,
                                pixels: [...l.pixels],
                                modified: false
                            };
                        });
                    }
                    
                    workspace.fonts = [font];
                    workspace.currentFontIndex = 0;
                }
                
                clearHistory();
                renderAll();
                renderFontSelector();
                
                alert('字体导入成功！');
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function exportBDF() {
        const font = getCurrentFont();
        const { metadata, glyphs, kerning } = font;
        
        const lines = [];
        
        lines.push('STARTFONT 2.1');
        lines.push(`FONT ${metadata.name || 'PIXEL-FONT'}`);
        lines.push(`SIZE ${metadata.glyphHeight} 75 75`);
        lines.push(`FONTBOUNDINGBOX ${metadata.glyphWidth} ${metadata.glyphHeight} 0 ${-metadata.descent}`);
        lines.push(`STARTPROPERTIES 6`);
        lines.push(`FONTNAME "${metadata.name || 'Pixel Font'}"`);
        lines.push(`FAMILY_NAME "${metadata.name || 'Pixel'}"`);
        lines.push(`WEIGHT_NAME "Regular"`);
        lines.push(`SLANT "R"`);
        lines.push(`AUTHOR "${metadata.author || 'Anonymous'}"`);
        lines.push(`VERSION "${metadata.version || '1.0'}"`);
        lines.push(`ENDPROPERTIES`);
        
        const codePoints = Object.keys(glyphs).map(Number).sort((a, b) => a - b);
        lines.push(`CHARS ${codePoints.length}`);
        
        codePoints.forEach(cp => {
            const glyph = glyphs[cp];
            const char = String.fromCodePoint(cp);
            const charName = cp >= 0x20 && cp <= 0x7E ? char : `uni${cp.toString(16).toUpperCase()}`;
            
            lines.push(`STARTCHAR ${charName}`);
            lines.push(`ENCODING ${cp}`);
            lines.push(`SWIDTH 500 0`);
            lines.push(`DWIDTH ${glyph.width + metadata.defaultSpacing} 0`);
            lines.push(`BBX ${glyph.width} ${glyph.height} 0 ${-metadata.descent}`);
            lines.push(`BITMAP`);
            
            glyph.pixels.forEach(row => {
                let hex = '';
                for (let i = 0; i < row.length; i += 4) {
                    const nibble = row.substring(i, i + 4).padEnd(4, '0');
                    hex += parseInt(nibble, 2).toString(16).toUpperCase();
                }
                lines.push(hex);
            });
            
            lines.push(`ENDCHAR`);
        });
        
        const kerningKeys = Object.keys(kerning);
        if (kerningKeys.length > 0) {
            lines.push(`STARTKERN ${kerningKeys.length}`);
            kerningKeys.forEach(key => {
                const left = key.charCodeAt(0);
                const right = key.charCodeAt(1);
                const value = kerning[key];
                lines.push(`KERN ${value} ${left} ${right}`);
            });
            lines.push(`ENDKERN`);
        }
        
        lines.push(`ENDFONT`);
        
        const bdf = lines.join('\n');
        const blob = new Blob([bdf], { type: 'text/plain' });
        const link = document.createElement('a');
        link.download = `${metadata.name || 'pixel-font'}.bdf`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    function showModal(id) {
        document.getElementById(id).classList.add('active');
    }

    function hideModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    function showContextMenu(x, y, items) {
        hideContextMenu();
        
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        items.forEach(item => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'context-menu-divider';
                menu.appendChild(divider);
                return;
            }
            
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            if (item.danger) menuItem.classList.add('danger');
            if (item.disabled) menuItem.classList.add('disabled');
            
            const icon = document.createElement('span');
            icon.className = 'context-menu-icon';
            icon.textContent = item.icon || '';
            
            const label = document.createElement('span');
            label.className = 'context-menu-label';
            label.textContent = item.label;
            
            menuItem.appendChild(icon);
            menuItem.appendChild(label);
            
            if (!item.disabled) {
                menuItem.onclick = (e) => {
                    e.stopPropagation();
                    hideContextMenu();
                    if (item.action) item.action();
                };
            }
            
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
        
        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
            }
            menu.classList.add('active');
        }, 0);
    }

    function hideContextMenu() {
        const existing = document.getElementById('context-menu');
        if (existing) existing.remove();
    }

    function openSettings(tab) {
        const font = getCurrentFont();
        document.getElementById('setting-glyph-width').value = font.metadata.glyphWidth;
        document.getElementById('setting-glyph-height').value = font.metadata.glyphHeight;
        document.getElementById('setting-baseline').value = font.metadata.baseline;
        document.getElementById('setting-ascent').value = font.metadata.ascent;
        document.getElementById('setting-descent').value = font.metadata.descent;
        document.getElementById('setting-default-spacing').value = font.metadata.defaultSpacing;
        document.getElementById('setting-font-name').value = font.metadata.name || '';
        document.getElementById('setting-author').value = font.metadata.author || '';
        document.getElementById('setting-version').value = font.metadata.version || '';
        
        const tabs = document.querySelectorAll('.settings-tab');
        tabs.forEach(t => t.classList.remove('active'));
        const panes = document.querySelectorAll('.settings-pane');
        panes.forEach(p => p.classList.remove('active'));
        
        const tabEl = document.querySelector(`.settings-tab[data-tab="${tab}"]`);
        const paneEl = document.getElementById(`settings-${tab}`);
        if (tabEl) tabEl.classList.add('active');
        if (paneEl) paneEl.classList.add('active');
        
        renderKerningList();
        renderLigatureList();
        loadBatchPreview();
        
        showModal('settings-modal');
    }

    function updateSettingsForm() {
        // This can be used to update settings form if it's visible
    }

    function applySettings() {
        const font = getCurrentFont();
        saveHistory();
        
        font.metadata.glyphWidth = parseInt(document.getElementById('setting-glyph-width').value);
        font.metadata.glyphHeight = parseInt(document.getElementById('setting-glyph-height').value);
        font.metadata.baseline = parseInt(document.getElementById('setting-baseline').value);
        font.metadata.ascent = parseInt(document.getElementById('setting-ascent').value);
        font.metadata.descent = parseInt(document.getElementById('setting-descent').value);
        font.metadata.defaultSpacing = parseInt(document.getElementById('setting-default-spacing').value);
        font.metadata.name = document.getElementById('setting-font-name').value;
        font.metadata.author = document.getElementById('setting-author').value;
        font.metadata.version = document.getElementById('setting-version').value;
        
        document.title = `${font.metadata.name || 'Pixel Font Designer'} - 像素字体设计器`;
        
        Object.keys(font.glyphs).forEach(cp => {
            const glyph = font.glyphs[cp];
            if (glyph.width !== font.metadata.glyphWidth || glyph.height !== font.metadata.glyphHeight) {
                const oldPixels = glyph.pixels;
                const newPixels = [];
                for (let y = 0; y < font.metadata.glyphHeight; y++) {
                    let row = '';
                    for (let x = 0; x < font.metadata.glyphWidth; x++) {
                        if (y < oldPixels.length && x < oldPixels[y].length) {
                            row += oldPixels[y][x];
                        } else {
                            row += '0';
                        }
                    }
                    newPixels.push(row);
                }
                glyph.width = font.metadata.glyphWidth;
                glyph.height = font.metadata.glyphHeight;
                glyph.pixels = newPixels;
            }
        });
        
        hideModal('settings-modal');
        renderAll();
        renderFontSelector();
    }

    function addKerningPair() {
        const left = document.getElementById('kerning-left').value;
        const right = document.getElementById('kerning-right').value;
        const value = parseInt(document.getElementById('kerning-value').value) || 0;
        
        if (!left || !right) {
            alert('请输入左右字符');
            return;
        }
        
        const font = getCurrentFont();
        const key = left[0] + right[0];
        font.kerning[key] = value;
        
        saveHistory();
        renderKerningList();
        renderPreview();
    }

    function removeKerningPair(key) {
        const font = getCurrentFont();
        delete font.kerning[key];
        saveHistory();
        renderKerningList();
        renderPreview();
    }

    function renderKerningList() {
        const font = getCurrentFont();
        const list = document.getElementById('kerning-list');
        if (!list) return;
        const kerningKeys = Object.keys(font.kerning).sort();
        
        if (kerningKeys.length === 0) {
            list.innerHTML = '<div class="kerning-empty">暂无字距对</div>';
            return;
        }
        
        list.innerHTML = '';
        kerningKeys.forEach(key => {
            const item = document.createElement('div');
            item.className = 'kerning-item';
            
            const chars = document.createElement('span');
            chars.className = 'kerning-chars';
            chars.textContent = `"${key[0]}" + "${key[1]}"`;
            
            const value = document.createElement('span');
            value.className = 'kerning-value';
            value.textContent = font.kerning[key] + 'px';
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'kerning-remove';
            removeBtn.textContent = '删除';
            removeBtn.onclick = () => removeKerningPair(key);
            
            item.appendChild(chars);
            item.appendChild(value);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    function addLigature() {
        const input = document.getElementById('ligature-input').value;
        
        if (!input || input.length < 2) {
            alert('请输入至少2个字符的连字序列');
            return;
        }
        
        const font = getCurrentFont();
        
        if (font.ligatures[input]) {
            alert('该连字已存在');
            return;
        }
        
        const width = font.metadata.glyphWidth * input.length;
        const height = font.metadata.glyphHeight;
        const pixels = [];
        for (let y = 0; y < height; y++) {
            pixels.push('0'.repeat(width));
        }
        
        font.ligatures[input] = {
            width: width,
            height: height,
            pixels: pixels,
            modified: false
        };
        
        saveHistory();
        renderLigatureList();
        renderPreview();
    }

    function removeLigature(key) {
        const font = getCurrentFont();
        if (confirm(`确定删除连字 "${key}" 吗？`)) {
            delete font.ligatures[key];
            saveHistory();
            renderLigatureList();
            renderGlyphSet();
            renderPreview();
        }
    }

    function editLigature(key) {
        state.currentLigature = key;
        state.currentTab = 'ligatures';
        hideModal('settings-modal');
        updateTabs();
        renderEditor();
        renderGlyphSet();
    }

    function renderLigatureList() {
        const font = getCurrentFont();
        const list = document.getElementById('ligature-list');
        if (!list) return;
        const ligatureKeys = Object.keys(font.ligatures).sort();
        
        if (ligatureKeys.length === 0) {
            list.innerHTML = '<div class="ligature-empty">暂无连字</div>';
            return;
        }
        
        list.innerHTML = '';
        ligatureKeys.forEach(key => {
            const item = document.createElement('div');
            item.className = 'ligature-item';
            if (state.currentLigature === key && state.currentTab === 'ligatures') {
                item.classList.add('active');
            }
            
            const name = document.createElement('span');
            name.className = 'ligature-name';
            name.textContent = key;
            
            const actions = document.createElement('div');
            actions.className = 'ligature-actions';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'ligature-edit';
            editBtn.textContent = '编辑';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                editLigature(key);
            };
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'ligature-remove';
            removeBtn.textContent = '删除';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeLigature(key);
            };
            
            actions.appendChild(editBtn);
            actions.appendChild(removeBtn);
            item.appendChild(name);
            item.appendChild(actions);
            
            item.onclick = () => editLigature(key);
            
            list.appendChild(item);
        });
    }

    function importBatchImages(files) {
        const font = getCurrentFont();
        let count = 0;
        
        const processFile = (file, index) => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvasEl = document.createElement('canvas');
                        canvasEl.width = font.metadata.glyphWidth;
                        canvasEl.height = font.metadata.glyphHeight;
                        const ctx2d = canvasEl.getContext('2d');
                        
                        ctx2d.imageSmoothingEnabled = false;
                        ctx2d.drawImage(img, 0, 0, font.metadata.glyphWidth, font.metadata.glyphHeight);
                        
                        const imageData = ctx2d.getImageData(0, 0, font.metadata.glyphWidth, font.metadata.glyphHeight);
                        const pixels = [];
                        
                        for (let y = 0; y < font.metadata.glyphHeight; y++) {
                            let row = '';
                            for (let x = 0; x < font.metadata.glyphWidth; x++) {
                                const idx = (y * font.metadata.glyphWidth + x) * 4;
                                const r = imageData.data[idx];
                                const g = imageData.data[idx + 1];
                                const b = imageData.data[idx + 2];
                                const a = imageData.data[idx + 3];
                                
                                if (a > 128 && (r + g + b) / 3 > 128) {
                                    row += '1';
                                } else {
                                    row += '0';
                                }
                            }
                            pixels.push(row);
                        }
                        
                        const fileName = file.name.replace(/\.[^/.]+$/, '');
                        const char = fileName.length === 1 ? fileName : fileName[0];
                        const cp = char.codePointAt(0);
                        
                        font.glyphs[cp] = {
                            width: font.metadata.glyphWidth,
                            height: font.metadata.glyphHeight,
                            pixels: pixels,
                            modified: true
                        };
                        
                        count++;
                        resolve();
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            });
        };
        
        Promise.all(Array.from(files).map((f, i) => processFile(f, i))).then(() => {
            saveHistory();
            renderGlyphSet();
            renderEditor();
            renderPreview();
            loadBatchPreview();
            alert(`成功导入 ${count} 个字形`);
        });
    }

    function loadBatchPreview() {
        const font = getCurrentFont();
        const container = document.getElementById('batch-preview');
        if (!container) return;
        container.innerHTML = '';
        
        Object.keys(font.glyphs).sort((a, b) => a - b).forEach(cp => {
            const glyph = font.glyphs[cp];
            const canvasEl = document.createElement('canvas');
            canvasEl.width = glyph.width * 2;
            canvasEl.height = glyph.height * 2;
            const ctx2d = canvasEl.getContext('2d');
            ctx2d.imageSmoothingEnabled = false;
            
            ctx2d.fillStyle = '#1a1a2e';
            ctx2d.fillRect(0, 0, canvasEl.width, canvasEl.height);
            
            ctx2d.fillStyle = '#fff';
            for (let y = 0; y < glyph.height; y++) {
                for (let x = 0; x < glyph.width; x++) {
                    if (glyph.pixels[y][x] === '1') {
                        ctx2d.fillRect(x * 2, y * 2, 2, 2);
                    }
                }
            }
            
            const wrap = document.createElement('div');
            wrap.className = 'batch-preview-item';
            wrap.appendChild(canvasEl);
            
            const label = document.createElement('div');
            label.className = 'batch-preview-label';
            label.textContent = String.fromCodePoint(Number(cp));
            wrap.appendChild(label);
            
            container.appendChild(wrap);
        });
    }

    function copyGlyph(codePoint) {
        const cp = codePoint !== undefined ? codePoint : state.currentCodePoint;
        const font = getCurrentFont();
        const glyph = font.glyphs[cp];
        if (!glyph) return;
        
        state.clipboardGlyph = {
            width: glyph.width,
            height: glyph.height,
            pixels: [...glyph.pixels]
        };
        
        alert('字形已复制到剪贴板');
    }

    function pasteGlyph(codePoint) {
        if (state.playbackMode) return;
        if (!state.clipboardGlyph) {
            alert('剪贴板为空');
            return;
        }
        
        const cp = codePoint !== undefined ? codePoint : state.currentCodePoint;
        saveHistory();
        const font = getCurrentFont();
        
        font.glyphs[cp] = {
            width: state.clipboardGlyph.width,
            height: state.clipboardGlyph.height,
            pixels: [...state.clipboardGlyph.pixels],
            modified: true
        };
        
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function deleteGlyph(codePoint) {
        if (state.playbackMode) return;
        const cp = codePoint !== undefined ? codePoint : state.currentCodePoint;
        const font = getCurrentFont();
        const char = String.fromCodePoint(cp);
        
        if (confirm(`确定删除字符 "${char}" (U+${cp.toString(16).toUpperCase()}) 的字形吗？`)) {
            saveHistory();
            delete font.glyphs[cp];
            
            const cps = getAvailableCodePoints();
            if (cps.length > 0 && cp === state.currentCodePoint) {
                state.currentCodePoint = cps[0];
            }
            
            renderEditor();
            renderGlyphSet();
            renderPreview();
            updateCurrentCharInfo();
        }
    }

    function createVariant(type) {
        if (state.playbackMode) return;
        saveHistory();
        const glyph = getCurrentGlyph();
        if (!glyph) return;
        
        const newPixels = [];
        
        switch (type) {
            case 'flip-h':
                for (let y = 0; y < glyph.height; y++) {
                    newPixels.push(glyph.pixels[y].split('').reverse().join(''));
                }
                if (state.isRecording) recordOperation('flipH', {});
                break;
            case 'flip-v':
                for (let y = glyph.height - 1; y >= 0; y--) {
                    newPixels.push(glyph.pixels[y]);
                }
                if (state.isRecording) recordOperation('flipV', {});
                break;
            case 'rotate-cw':
                for (let x = 0; x < glyph.width; x++) {
                    let row = '';
                    for (let y = glyph.height - 1; y >= 0; y--) {
                        row += glyph.pixels[y][x];
                    }
                    newPixels.push(row);
                }
                const tempW = glyph.width;
                glyph.width = glyph.height;
                glyph.height = tempW;
                if (state.isRecording) recordOperation('flipD', {});
                break;
            case 'rotate-ccw':
                for (let x = glyph.width - 1; x >= 0; x--) {
                    let row = '';
                    for (let y = 0; y < glyph.height; y++) {
                        row += glyph.pixels[y][x];
                    }
                    newPixels.push(row);
                }
                const tempW2 = glyph.width;
                glyph.width = glyph.height;
                glyph.height = tempW2;
                break;
            case 'bold':
                for (let y = 0; y < glyph.height; y++) {
                    let row = '';
                    for (let x = 0; x < glyph.width; x++) {
                        if (glyph.pixels[y][x] === '1' || (x > 0 && glyph.pixels[y][x - 1] === '1')) {
                            row += '1';
                        } else {
                            row += '0';
                        }
                    }
                    newPixels.push(row);
                }
                break;
            case 'shift-left':
                for (let y = 0; y < glyph.height; y++) {
                    newPixels.push(glyph.pixels[y].substring(1) + '0');
                }
                if (state.isRecording) recordOperation('moveLeft', {});
                break;
            case 'shift-right':
                for (let y = 0; y < glyph.height; y++) {
                    newPixels.push('0' + glyph.pixels[y].substring(0, glyph.width - 1));
                }
                if (state.isRecording) recordOperation('moveRight', {});
                break;
            case 'shift-up':
                for (let y = 1; y < glyph.height; y++) {
                    newPixels.push(glyph.pixels[y]);
                }
                newPixels.push('0'.repeat(glyph.width));
                if (state.isRecording) recordOperation('moveUp', {});
                break;
            case 'shift-down':
                newPixels.push('0'.repeat(glyph.width));
                for (let y = 0; y < glyph.height - 1; y++) {
                    newPixels.push(glyph.pixels[y]);
                }
                if (state.isRecording) recordOperation('moveDown', {});
                break;
        }
        
        glyph.pixels = newPixels;
        glyph.modified = true;
        
        renderEditor();
        renderGlyphSet();
        renderPreview();
    }

    function deleteCurrentGlyph() {
        if (state.currentTab === 'ligatures' && state.currentLigature) {
            removeLigature(state.currentLigature);
        } else {
            deleteGlyph(state.currentCodePoint);
        }
    }

    function createDemoFont(name, boldOffset) {
        const font = {
            metadata: {
                name: name,
                author: 'Demo',
                version: '1.0',
                glyphWidth: 8,
                glyphHeight: 12,
                baseline: 9,
                ascent: 9,
                descent: 3,
                defaultSpacing: 1
            },
            glyphs: {},
            kerning: {},
            ligatures: {}
        };
        
        const demoGlyphs = {
            65: ['00111000','01111100','11000110','11000110','11111110','11111110','11000110','11000110','11000110','11000110','00000000','00000000'],
            66: ['11111000','11001100','11000110','11000110','11111100','11111100','11000110','11000110','11000110','11001100','11111000','00000000'],
            67: ['00111100','01100110','11000000','11000000','11000000','11000000','11000000','11000000','11000000','01100110','00111100','00000000'],
            68: ['11111000','11001100','11000110','11000110','11000110','11000110','11000110','11000110','11000110','11001100','11111000','00000000'],
            69: ['11111110','11000000','11000000','11000000','11111000','11111000','11000000','11000000','11000000','11000000','11111110','00000000'],
            70: ['11111110','11000000','11000000','11000000','11111000','11111000','11000000','11000000','11000000','11000000','11000000','00000000'],
            71: ['00111100','01100110','11000000','11000000','11000000','11001110','11000110','11000110','11000110','01100110','00111100','00000000'],
            72: ['11000110','11000110','11000110','11000110','11111110','11111110','11000110','11000110','11000110','11000110','11000110','00000000'],
            73: ['01111100','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','01111100','00000000'],
            74: ['00011100','00001100','00001100','00001100','00001100','00001100','00001100','00001100','11001100','11001100','01111000','00000000'],
            75: ['11000110','11001100','11011000','11110000','11110000','11011000','11001100','11000110','11000110','11000110','11000110','00000000'],
            76: ['11000000','11000000','11000000','11000000','11000000','11000000','11000000','11000000','11000000','11000000','11111110','00000000'],
            77: ['11000011','11100111','11111111','11011011','11011011','11000011','11000011','11000011','11000011','11000011','11000011','00000000'],
            78: ['11000110','11100110','11110110','11011110','11001110','11000110','11000110','11000110','11000110','11000110','11000110','00000000'],
            79: ['00111000','01101100','11000110','11000110','11000110','11000110','11000110','11000110','11000110','01101100','00111000','00000000'],
            80: ['11111000','11001100','11000110','11000110','11001100','11111000','11000000','11000000','11000000','11000000','11000000','00000000'],
            81: ['00111000','01101100','11000110','11000110','11000110','11000110','11000110','11000110','11010110','01101100','00111010','00000000'],
            82: ['11111000','11001100','11000110','11000110','11001100','11111000','11011000','11001100','11000110','11000110','11000110','00000000'],
            83: ['01111100','11000110','11000000','11000000','01111000','00111100','00000110','00000010','11000010','11000110','01111100','00000000'],
            84: ['11111110','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00000000'],
            85: ['11000110','11000110','11000110','11000110','11000110','11000110','11000110','11000110','11000110','11000110','01111100','00000000'],
            86: ['11000110','11000110','11000110','11000110','11000110','11000110','11000110','01101100','01101100','00111000','00111000','00000000'],
            87: ['11000011','11000011','11000011','11000011','11000011','11011011','11011011','11011011','11011011','11100111','11000011','00000000'],
            88: ['11000110','11000110','01101100','01101100','00111000','00111000','00111000','01101100','01101100','11000110','11000110','00000000'],
            89: ['11000110','11000110','01101100','01101100','00111000','00110000','00110000','00110000','00110000','00110000','00110000','00000000'],
            90: ['11111110','00000110','00001100','00011000','00110000','01100000','11000000','11000000','11000000','11000000','11111110','00000000'],
            32: ['00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000'],
            46: ['00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00110000','00110000','00000000'],
            44: ['00000000','00000000','00000000','00000000','00000000','00000000','00000000','00000000','00110000','00110000','01100000','00000000'],
            33: ['00110000','00110000','00110000','00110000','00110000','00110000','00110000','00110000','00000000','00110000','00110000','00000000'],
            63: ['01111000','11001100','00000110','00000110','00001100','00011000','00110000','00000000','00110000','00110000','00000000','00000000'],
            45: ['00000000','00000000','00000000','00000000','00000000','11111100','00000000','00000000','00000000','00000000','00000000','00000000'],
            43: ['00000000','00000000','00000000','00110000','00110000','11111100','00110000','00110000','00000000','00000000','00000000','00000000'],
            61: ['00000000','00000000','00000000','11111100','00000000','00000000','11111100','00000000','00000000','00000000','00000000','00000000']
        };
        
        Object.keys(demoGlyphs).forEach(cp => {
            let pixels = demoGlyphs[cp];
            
            if (boldOffset > 0) {
                const boldPixels = [];
                for (let y = 0; y < pixels.length; y++) {
                    let row = '';
                    for (let x = 0; x < pixels[y].length; x++) {
                        let hasPixel = false;
                        for (let o = 0; o <= boldOffset && !hasPixel; o++) {
                            if (x - o >= 0 && pixels[y][x - o] === '1') {
                                hasPixel = true;
                            }
                        }
                        row += hasPixel ? '1' : '0';
                    }
                    boldPixels.push(row);
                }
                pixels = boldPixels;
            }
            
            font.glyphs[cp] = {
                width: 8,
                height: 12,
                pixels: pixels,
                modified: false
            };
        });
        
        return font;
    }

    function renderFontSelector() {
        const selector = document.getElementById('font-selector');
        const dropdown = document.getElementById('font-dropdown');
        if (!selector || !dropdown) return;
        
        selector.innerHTML = '';
        dropdown.innerHTML = '';
        
        const currentFont = getCurrentFont();
        const currentColor = getFontColor(workspace.currentFontIndex);
        
        const selectorItem = document.createElement('div');
        selectorItem.className = 'font-selector-current';
        selectorItem.innerHTML = `
            <span class="font-color-dot" style="background-color: ${currentColor}"></span>
            <span class="font-name">${currentFont.metadata.name || '未命名'}</span>
            <span class="font-dropdown-arrow">▼</span>
        `;
        selectorItem.onclick = (e) => {
            e.stopPropagation();
            toggleFontDropdown();
        };
        selector.appendChild(selectorItem);
        
        workspace.fonts.forEach((font, index) => {
            const color = getFontColor(index);
            
            const dropdownItem = document.createElement('div');
            dropdownItem.className = 'font-dropdown-item';
            if (index === workspace.currentFontIndex) {
                dropdownItem.classList.add('active');
            }
            dropdownItem.innerHTML = `
                <span class="font-color-dot" style="background-color: ${color}"></span>
                <span class="font-name">${font.metadata.name || '未命名'}</span>
            `;
            dropdownItem.onclick = () => {
                switchFont(index);
                toggleFontDropdown(false);
            };
            dropdownItem.oncontextmenu = (e) => {
                e.preventDefault();
                showFontContextMenu(e.clientX, e.clientY, index);
            };
            dropdown.appendChild(dropdownItem);
        });
        
        const divider = document.createElement('div');
        divider.className = 'font-dropdown-divider';
        dropdown.appendChild(divider);
        
        const addItem = document.createElement('div');
        addItem.className = 'font-dropdown-item';
        addItem.innerHTML = '<span class="font-menu-icon">+</span><span class="font-name">新建空白字体</span>';
        addItem.onclick = () => {
            addBlankFont();
            toggleFontDropdown(false);
        };
        dropdown.appendChild(addItem);
        
        const copyItem = document.createElement('div');
        copyItem.className = 'font-dropdown-item';
        copyItem.innerHTML = '<span class="font-menu-icon">⎘</span><span class="font-name">复制当前字体</span>';
        copyItem.onclick = () => {
            duplicateFont();
            toggleFontDropdown(false);
        };
        dropdown.appendChild(copyItem);
        
        const renameItem = document.createElement('div');
        renameItem.className = 'font-dropdown-item';
        renameItem.innerHTML = '<span class="font-menu-icon">✎</span><span class="font-name">重命名</span>';
        renameItem.onclick = () => {
            renameFont();
            toggleFontDropdown(false);
        };
        dropdown.appendChild(renameItem);
        
        const deleteItem = document.createElement('div');
        deleteItem.className = 'font-dropdown-item danger';
        deleteItem.innerHTML = '<span class="font-menu-icon">✕</span><span class="font-name">删除字体</span>';
        deleteItem.onclick = () => {
            deleteFont();
            toggleFontDropdown(false);
        };
        if (workspace.fonts.length <= 1) {
            deleteItem.classList.add('disabled');
        }
        dropdown.appendChild(deleteItem);
    }

    function toggleFontDropdown(show) {
        const dropdown = document.getElementById('font-dropdown');
        if (!dropdown) return;
        if (show === undefined) {
            dropdown.classList.toggle('active');
        } else {
            dropdown.classList.toggle('active', show);
        }
    }

    function showFontContextMenu(x, y, fontIndex) {
        const items = [
            { icon: '✎', label: '重命名', action: () => { switchFont(fontIndex); renameFont(); } },
            { icon: '⎘', label: '复制', action: () => { switchFont(fontIndex); duplicateFont(); } },
            { divider: true },
            { icon: '✕', label: '删除', danger: true, disabled: workspace.fonts.length <= 1, action: () => { switchFont(fontIndex); deleteFont(); } }
        ];
        showContextMenu(x, y, items);
    }

    function toggleCompareMode() {
        state.compareMode = !state.compareMode;
        const comparePanel = document.getElementById('compare-panel');
        const compareBtn = document.getElementById('btn-compare');
        
        if (state.compareMode) {
            if (workspace.fonts.length < 2) {
                alert('需要至少两套字体才能对比');
                state.compareMode = false;
                return;
            }
            state.compareFontAIndex = 0;
            state.compareFontBIndex = Math.min(1, workspace.fonts.length - 1);
            state.compareCharIndex = 0;
            renderCompareView();
            comparePanel.classList.add('active');
            compareBtn.classList.add('active');
        } else {
            comparePanel.classList.remove('active');
            compareBtn.classList.remove('active');
        }
    }

    function getCompareCharList() {
        const fontA = workspace.fonts[state.compareFontAIndex];
        const fontB = workspace.fonts[state.compareFontBIndex];
        const allChars = new Set([
            ...Object.keys(fontA.glyphs).map(Number),
            ...Object.keys(fontB.glyphs).map(Number)
        ]);
        return Array.from(allChars).sort((a, b) => a - b);
    }

    function renderCompareView() {
        const fontA = workspace.fonts[state.compareFontAIndex];
        const fontB = workspace.fonts[state.compareFontBIndex];
        const charList = getCompareCharList();
        
        if (state.compareCharIndex >= charList.length) {
            state.compareCharIndex = 0;
        }
        
        const cp = charList[state.compareCharIndex];
        const char = String.fromCodePoint(cp);
        
        document.getElementById('compare-char-display').textContent = char;
        document.getElementById('compare-char-code').textContent = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
        
        const glyphA = fontA.glyphs[cp];
        const glyphB = fontB.glyphs[cp];
        
        const scale = 16;
        
        renderCompareGlyph('compare-glyph-a', glyphA, fontA, scale, cp, 'A');
        renderCompareGlyph('compare-glyph-b', glyphB, fontB, scale, cp, 'B');
        renderCompareDiff('compare-diff', glyphA, glyphB, scale);
        
        const stats = calculateDiffStats(glyphA, glyphB);
        document.getElementById('diff-total').textContent = stats.total;
        document.getElementById('diff-same').textContent = stats.same;
        document.getElementById('diff-different').textContent = stats.different;
        document.getElementById('diff-percent').textContent = stats.percent + '%';
        
        document.getElementById('compare-nav-info').textContent = `${state.compareCharIndex + 1} / ${charList.length}`;
        
        const selectA = document.getElementById('compare-font-a');
        const selectB = document.getElementById('compare-font-b');
        
        selectA.innerHTML = '';
        selectB.innerHTML = '';
        workspace.fonts.forEach((font, idx) => {
            const optA = document.createElement('option');
            optA.value = idx;
            optA.textContent = font.metadata.name || `字体${idx + 1}`;
            if (idx === state.compareFontAIndex) optA.selected = true;
            selectA.appendChild(optA);
            
            const optB = document.createElement('option');
            optB.value = idx;
            optB.textContent = font.metadata.name || `字体${idx + 1}`;
            if (idx === state.compareFontBIndex) optB.selected = true;
            selectB.appendChild(optB);
        });
    }

    function renderCompareGlyph(canvasId, glyph, font, scale, cp, label) {
        const canvasEl = document.getElementById(canvasId);
        if (!canvasEl) return;
        const ctx2d = canvasEl.getContext('2d');
        
        const width = font.metadata.glyphWidth * scale;
        const height = font.metadata.glyphHeight * scale;
        
        canvasEl.width = width;
        canvasEl.height = height;
        
        ctx2d.imageSmoothingEnabled = false;
        ctx2d.fillStyle = '#0f0f23';
        ctx2d.fillRect(0, 0, width, height);
        
        ctx2d.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx2d.lineWidth = 1;
        for (let x = 0; x <= font.metadata.glyphWidth; x++) {
            ctx2d.beginPath();
            ctx2d.moveTo(x * scale + 0.5, 0);
            ctx2d.lineTo(x * scale + 0.5, height);
            ctx2d.stroke();
        }
        for (let y = 0; y <= font.metadata.glyphHeight; y++) {
            ctx2d.beginPath();
            ctx2d.moveTo(0, y * scale + 0.5);
            ctx2d.lineTo(width, y * scale + 0.5);
            ctx2d.stroke();
        }
        
        if (glyph) {
            ctx2d.fillStyle = '#ffffff';
            for (let y = 0; y < glyph.height; y++) {
                for (let x = 0; x < glyph.width; x++) {
                    if (glyph.pixels[y] && glyph.pixels[y][x] === '1') {
                        ctx2d.fillRect(x * scale, y * scale, scale, scale);
                    }
                }
            }
        } else {
            ctx2d.fillStyle = 'rgba(255,255,255,0.3)';
            ctx2d.font = `${scale * 2}px monospace`;
            ctx2d.textAlign = 'center';
            ctx2d.fillText('?', width / 2, height / 2 + scale);
        }
    }

    function renderCompareDiff(canvasId, glyphA, glyphB, scale) {
        const canvasEl = document.getElementById(canvasId);
        if (!canvasEl) return;
        const ctx2d = canvasEl.getContext('2d');
        
        const maxW = Math.max(glyphA ? glyphA.width : 8, glyphB ? glyphB.width : 8);
        const maxH = Math.max(glyphA ? glyphA.height : 12, glyphB ? glyphB.height : 12);
        
        const width = maxW * scale;
        const height = maxH * scale;
        
        canvasEl.width = width;
        canvasEl.height = height;
        
        ctx2d.imageSmoothingEnabled = false;
        ctx2d.fillStyle = '#0f0f23';
        ctx2d.fillRect(0, 0, width, height);
        
        for (let y = 0; y < maxH; y++) {
            for (let x = 0; x < maxW; x++) {
                const hasA = glyphA && glyphA.pixels[y] && glyphA.pixels[y][x] === '1';
                const hasB = glyphB && glyphB.pixels[y] && glyphB.pixels[y][x] === '1';
                
                if (hasA && hasB) {
                    ctx2d.fillStyle = '#ffffff';
                    ctx2d.fillRect(x * scale, y * scale, scale, scale);
                } else if (hasA) {
                    ctx2d.fillStyle = '#4ecdc4';
                    ctx2d.fillRect(x * scale, y * scale, scale, scale);
                } else if (hasB) {
                    ctx2d.fillStyle = '#ff6b6b';
                    ctx2d.fillRect(x * scale, y * scale, scale, scale);
                }
            }
        }
    }

    function calculateDiffStats(glyphA, glyphB) {
        const maxW = Math.max(glyphA ? glyphA.width : 0, glyphB ? glyphB.width : 0);
        const maxH = Math.max(glyphA ? glyphA.height : 0, glyphB ? glyphB.height : 0);
        
        let total = 0, same = 0, different = 0;
        
        for (let y = 0; y < maxH; y++) {
            for (let x = 0; x < maxW; x++) {
                total++;
                const hasA = glyphA && glyphA.pixels[y] && glyphA.pixels[y][x] === '1';
                const hasB = glyphB && glyphB.pixels[y] && glyphB.pixels[y][x] === '1';
                if (hasA === hasB) {
                    same++;
                } else {
                    different++;
                }
            }
        }
        
        return {
            total,
            same,
            different,
            percent: total > 0 ? Math.round((same / total) * 100) : 0
        };
    }

    function prevCompareChar() {
        const charList = getCompareCharList();
        if (state.compareCharIndex > 0) {
            state.compareCharIndex--;
            renderCompareView();
        }
    }

    function nextCompareChar() {
        const charList = getCompareCharList();
        if (state.compareCharIndex < charList.length - 1) {
            state.compareCharIndex++;
            renderCompareView();
        }
    }

    function setCompareFontA(idx) {
        state.compareFontAIndex = parseInt(idx);
        if (state.compareFontAIndex === state.compareFontBIndex) {
            state.compareFontBIndex = state.compareFontAIndex === 0 ? 1 : 0;
        }
        renderCompareView();
    }

    function setCompareFontB(idx) {
        state.compareFontBIndex = parseInt(idx);
        if (state.compareFontAIndex === state.compareFontBIndex) {
            state.compareFontAIndex = state.compareFontBIndex === 0 ? 1 : 0;
        }
        renderCompareView();
    }

    function mergeSingleGlyph(direction) {
        const charList = getCompareCharList();
        const cp = charList[state.compareCharIndex];
        
        const srcIdx = direction === 'a-to-b' ? state.compareFontAIndex : state.compareFontBIndex;
        const dstIdx = direction === 'a-to-b' ? state.compareFontBIndex : state.compareFontAIndex;
        
        const srcFont = workspace.fonts[srcIdx];
        const dstFont = workspace.fonts[dstIdx];
        const srcGlyph = srcFont.glyphs[cp];
        
        if (!srcGlyph) {
            alert('源字体中没有该字形');
            return;
        }
        
        const char = String.fromCodePoint(cp);
        if (confirm(`确定将字符 "${char}" 从 ${srcFont.metadata.name} 合并到 ${dstFont.metadata.name} 吗？`)) {
            saveHistory();
            dstFont.glyphs[cp] = {
                width: srcGlyph.width,
                height: srcGlyph.height,
                pixels: [...srcGlyph.pixels],
                modified: true
            };
            renderCompareView();
            renderAll();
            alert('合并完成');
        }
    }

    function mergeAllGlyphs(direction) {
        const srcIdx = direction === 'a-to-b' ? state.compareFontAIndex : state.compareFontBIndex;
        const dstIdx = direction === 'a-to-b' ? state.compareFontBIndex : state.compareFontAIndex;
        
        const srcFont = workspace.fonts[srcIdx];
        const dstFont = workspace.fonts[dstIdx];
        
        const nonEmptyGlyphs = Object.keys(srcFont.glyphs).filter(cp => {
            const g = srcFont.glyphs[cp];
            return g && g.pixels.some(row => row.includes('1'));
        });
        
        if (nonEmptyGlyphs.length === 0) {
            alert('源字体中没有非空字形');
            return;
        }
        
        if (confirm(`确定将 ${nonEmptyGlyphs.length} 个非空字形从 ${srcFont.metadata.name} 全部合并到 ${dstFont.metadata.name} 吗？\n目标字体中的同名字形会被覆盖。`)) {
            saveHistory();
            nonEmptyGlyphs.forEach(cp => {
                const srcGlyph = srcFont.glyphs[cp];
                dstFont.glyphs[cp] = {
                    width: srcGlyph.width,
                    height: srcGlyph.height,
                    pixels: [...srcGlyph.pixels],
                    modified: true
                };
            });
            renderCompareView();
            renderAll();
            alert(`成功合并 ${nonEmptyGlyphs.length} 个字形`);
        }
    }

    function setupEventListeners() {
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMouseMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('mouseleave', handleCanvasMouseUp);
        
        document.getElementById('btn-settings').onclick = () => openSettings('size');
        document.getElementById('btn-export').onclick = () => exportJSON();
        document.getElementById('btn-import').onclick = () => document.getElementById('import-file').click();
        document.getElementById('btn-bdf').onclick = () => exportBDF();
        document.getElementById('btn-export-gif').onclick = () => exportGIF();
        document.getElementById('btn-compare').onclick = () => toggleCompareMode();
        
        document.getElementById('import-file').onchange = (e) => {
            if (e.target.files[0]) {
                importJSON(e.target.files[0]);
            }
            e.target.value = '';
        };
        
        document.getElementById('btn-undo').onclick = () => undo();
        document.getElementById('btn-redo').onclick = () => redo();
        
        document.getElementById('btn-tab-glyphs').onclick = () => {
            state.currentTab = 'glyphs';
            updateTabs();
            renderEditor();
            renderGlyphSet();
            updateCurrentCharInfo();
        };
        document.getElementById('btn-tab-ligatures').onclick = () => {
            state.currentTab = 'ligatures';
            const font = getCurrentFont();
            const ligKeys = Object.keys(font.ligatures);
            if (ligKeys.length > 0 && !state.currentLigature) {
                state.currentLigature = ligKeys[0];
            }
            updateTabs();
            renderEditor();
            renderGlyphSet();
            updateCurrentCharInfo();
        };
        
        document.getElementById('glyph-filter').oninput = (e) => {
            state.glyphFilter = e.target.value;
            renderGlyphSet();
        };
        
        document.getElementById('btn-add-glyph').onclick = () => {
            const input = prompt('请输入要添加的字符：');
            if (input && input.length > 0) {
                const cp = input.codePointAt(0);
                ensureGlyph(cp);
                state.currentCodePoint = cp;
                state.currentTab = 'glyphs';
                saveHistory();
                updateTabs();
                renderAll();
            }
        };
        
        document.getElementById('btn-record').onclick = () => toggleRecording();
        document.getElementById('btn-clear-glyph').onclick = () => clearGlyph();
        document.getElementById('btn-copy-glyph').onclick = () => copyGlyph();
        document.getElementById('btn-paste-glyph').onclick = () => pasteGlyph();
        document.getElementById('btn-delete-glyph').onclick = () => deleteCurrentGlyph();
        
        document.getElementById('btn-flip-h').onclick = () => createVariant('flip-h');
        document.getElementById('btn-flip-v').onclick = () => createVariant('flip-v');
        document.getElementById('btn-rotate-cw').onclick = () => createVariant('rotate-cw');
        document.getElementById('btn-rotate-ccw').onclick = () => createVariant('rotate-ccw');
        document.getElementById('btn-bold').onclick = () => createVariant('bold');
        
        document.getElementById('btn-shift-left').onclick = () => createVariant('shift-left');
        document.getElementById('btn-shift-right').onclick = () => createVariant('shift-right');
        document.getElementById('btn-shift-up').onclick = () => createVariant('shift-up');
        document.getElementById('btn-shift-down').onclick = () => createVariant('shift-down');
        
        document.getElementById('preview-text').oninput = () => {
            renderPreview();
        };
        document.getElementById('preview-scale').onchange = (e) => {
            previewState.scale = parseInt(e.target.value);
            renderPreview();
        };
        document.getElementById('preview-fps').onchange = (e) => {
            previewState.fps = parseInt(e.target.value);
        };
        document.getElementById('preview-color').onchange = (e) => {
            previewState.textColor = e.target.value;
            renderPreview();
        };
        document.getElementById('effect-type').onchange = (e) => {
            previewState.effectType = e.target.value;
            document.getElementById('wave-controls').style.display = e.target.value === 'wave' ? 'flex' : 'none';
            document.getElementById('glow-controls').style.display = e.target.value === 'glow' ? 'flex' : 'none';
            document.getElementById('gradient-controls').style.display = e.target.value === 'gradient' ? 'flex' : 'none';
            renderPreview();
        };
        document.getElementById('wave-amp').oninput = (e) => {
            previewState.waveAmp = parseInt(e.target.value);
            renderPreview();
        };
        document.getElementById('wave-speed').oninput = (e) => {
            previewState.waveSpeed = parseFloat(e.target.value);
            renderPreview();
        };
        document.getElementById('wave-length').oninput = (e) => {
            previewState.waveLength = parseInt(e.target.value);
            renderPreview();
        };
        document.getElementById('glow-intensity').oninput = (e) => {
            previewState.glowIntensity = parseInt(e.target.value);
            renderPreview();
        };
        document.getElementById('gradient-color1').oninput = (e) => {
            previewState.gradientColor1 = e.target.value;
            renderPreview();
        };
        document.getElementById('gradient-color2').oninput = (e) => {
            previewState.gradientColor2 = e.target.value;
            renderPreview();
        };
        
        document.getElementById('btn-apply-settings').onclick = () => applySettings();
        
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.onclick = () => {
                const tabName = tab.dataset.tab;
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`settings-${tabName}`).classList.add('active');
                
                if (tabName === 'batch') loadBatchPreview();
                if (tabName === 'kerning') renderKerningList();
                if (tabName === 'ligatures') renderLigatureList();
            };
        });
        
        document.getElementById('btn-add-kerning').onclick = () => addKerningPair();
        document.getElementById('btn-add-ligature').onclick = () => addLigature();
        
        document.getElementById('batch-import').onchange = (e) => {
            if (e.target.files.length > 0) {
                importBatchImages(e.target.files);
            }
            e.target.value = '';
        };
        
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.onclick = (e) => {
                const modal = e.target.closest('.modal-overlay');
                if (modal) hideModal(modal.id);
            };
        });
        
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    hideModal(modal.id);
                }
            };
        });
        
        document.addEventListener('click', () => {
            hideContextMenu();
            toggleFontDropdown(false);
        });
        
        document.getElementById('font-selector').onclick = (e) => {
            e.stopPropagation();
        };
        
        document.getElementById('font-dropdown').onclick = (e) => {
            e.stopPropagation();
        };
        
        document.getElementById('compare-font-a').onchange = (e) => setCompareFontA(e.target.value);
        document.getElementById('compare-font-b').onchange = (e) => setCompareFontB(e.target.value);
        document.getElementById('btn-prev-char').onclick = () => prevCompareChar();
        document.getElementById('btn-next-char').onclick = () => nextCompareChar();
        document.getElementById('btn-merge-a-to-b').onclick = () => mergeSingleGlyph('a-to-b');
        document.getElementById('btn-merge-b-to-a').onclick = () => mergeSingleGlyph('b-to-a');
        document.getElementById('btn-merge-all-a-to-b').onclick = () => mergeAllGlyphs('a-to-b');
        document.getElementById('btn-merge-all-b-to-a').onclick = () => mergeAllGlyphs('b-to-a');
        document.getElementById('btn-close-compare').onclick = () => toggleCompareMode();
        
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (state.compareMode) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    prevCompareChar();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    nextCompareChar();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    toggleCompareMode();
                }
                return;
            }
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                exportJSON();
            }
            if (e.key === 'Escape') {
                if (state.playbackMode) {
                    e.preventDefault();
                    exitPlaybackMode();
                    return;
                }
                document.querySelectorAll('.modal-overlay.active').forEach(m => {
                    hideModal(m.id);
                });
            }
            if (state.playbackMode) {
                if (e.key === ' ') {
                    e.preventDefault();
                    togglePlaybackPlay();
                }
            }
        });

        document.getElementById('btn-playback-play').onclick = () => togglePlaybackPlay();
        document.getElementById('btn-exit-playback').onclick = () => exitPlaybackMode();
        document.getElementById('playback-progress').oninput = (e) => {
            seekPlayback(parseInt(e.target.value));
        };
        document.getElementById('playback-speed').onchange = (e) => {
            setPlaybackSpeed(e.target.value);
        };
        
        window.addEventListener('resize', () => {
            if (!state.compareMode) {
                renderPreview();
            }
        });
    }

    function init() {
        canvas = document.getElementById('glyph-canvas');
        ctx = canvas.getContext('2d');
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        
        workspace.fonts = [
            createDemoFont('Regular', 0),
            createDemoFont('Bold', 1)
        ];
        workspace.currentFontIndex = 0;
        
        state.currentCodePoint = 65;
        
        setupEventListeners();
        renderAll();
        renderFontSelector();
        updateTabs();
        
        document.getElementById('preview-text').value = '(font:Bold)PIXEL (font:Regular)Font Designer';
        
        document.getElementById('effect-type').value = 'none';
        document.getElementById('wave-controls').style.display = 'none';
        document.getElementById('glow-controls').style.display = 'none';
        document.getElementById('gradient-controls').style.display = 'none';
        
        startPreviewAnimation();
    }

    return {
        getWorkspace: () => workspace,
        getCurrentFont: getCurrentFont,
        switchFont: switchFont,
        addBlankFont: addBlankFont,
        duplicateFont: duplicateFont,
        deleteFont: deleteFont,
        renameFont: renameFont,
        exportJSON: exportJSON,
        importJSON: importJSON,
        exportBDF: exportBDF,
        toggleCompareMode: toggleCompareMode,
        init: init
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    window.pixelFontEditor = PixelFontEditor;
    PixelFontEditor.init();
});