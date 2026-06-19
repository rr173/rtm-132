const PixelFontEditor = (function() {
    const PIXEL_SIZE = 30;
    const MAX_HISTORY = 30;
    const DEFAULT_KERNING_SUGGESTIONS = [
        ['A', 'V', -1], ['V', 'A', -1], ['A', 'Y', -1], ['Y', 'A', -1],
        ['T', 'o', -1], ['T', 'e', -1], ['L', 'T', -1], ['L', 'Y', -1],
        ['P', 'a', -1], ['P', 'o', -1], ['F', 'o', -1], ['F', 'a', -1],
        ['W', 'a', -1], ['W', 'o', -1], ['Y', 'o', -1], ['K', 'e', -1]
    ];

    let fontData = {
        metadata: {
            name: 'Demo Pixel Font',
            author: 'Pixel Font Designer',
            version: '1.0',
            glyphWidth: 8,
            glyphHeight: 12,
            ascent: 10,
            baseline: 2,
            descent: 0,
            defaultSpacing: 1
        },
        glyphs: {},
        kerning: {},
        ligatures: {}
    };

    let state = {
        currentCodePoint: 0x41,
        currentTool: 'pencil',
        isDrawing: false,
        lineStart: null,
        history: [],
        historyIndex: -1,
        searchFilter: '',
        currentLigature: null,
        contextMenuCodePoint: null
    };

    let effectsState = {
        effects: [],
        currentFrame: 0,
        isPlaying: true,
        fps: 12,
        lastFrameTime: 0,
        animationId: null,
        draggedEffectId: null
    };

    const EFFECT_TYPES = {
        shadow: {
            name: '投影',
            isDynamic: false,
            defaultParams: {
                offsetX: 2,
                offsetY: 2,
                color: '#000000',
                opacity: 0.5
            }
        },
        stroke: {
            name: '描边',
            isDynamic: false,
            defaultParams: {
                width: 1,
                color: '#000000'
            }
        },
        gradient: {
            name: '渐变填色',
            isDynamic: false,
            defaultParams: {
                direction: 'vertical',
                startColor: '#6366f1',
                endColor: '#ec4899'
            }
        },
        wave: {
            name: '波浪变形',
            isDynamic: true,
            defaultParams: {
                amplitude: 2,
                frequency: 0.3
            }
        },
        typewriter: {
            name: '逐字出现',
            isDynamic: true,
            defaultParams: {
                speed: 3,
                holdFrames: 12
            }
        },
        neon: {
            name: '霓虹闪烁',
            isDynamic: true,
            defaultParams: {
                color1: '#6366f1',
                color2: '#ec4899',
                period: 24
            }
        }
    };

    let canvas, ctx, previewCanvas, previewCtx, ligatureCanvas, ligatureCtx;

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
        if (!fontData.glyphs[codePoint]) {
            fontData.glyphs[codePoint] = createEmptyGlyph(
                fontData.metadata.glyphWidth,
                fontData.metadata.glyphHeight
            );
        }
        return fontData.glyphs[codePoint];
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
        const currentGlyph = getGlyph(state.currentCodePoint);
        const snapshot = {
            codePoint: state.currentCodePoint,
            glyph: cloneGlyph(currentGlyph)
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
        fontData.glyphs[snapshot.codePoint] = cloneGlyph(snapshot.glyph);
        state.currentCodePoint = snapshot.codePoint;
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
        updateCurrentCharInfo();
    }

    function redo() {
        if (state.historyIndex >= state.history.length - 1) return;
        state.historyIndex++;
        const snapshot = state.history[state.historyIndex];
        fontData.glyphs[snapshot.codePoint] = cloneGlyph(snapshot.glyph);
        state.currentCodePoint = snapshot.codePoint;
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
        updateCurrentCharInfo();
    }

    function clearHistory() {
        state.history = [];
        state.historyIndex = -1;
        pushHistorySnapshot();
    }

    function renderGlyphCanvas() {
        const glyph = getGlyph(state.currentCodePoint);
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
        
        const ascentY = (glyph.height - fontData.metadata.ascent) * PIXEL_SIZE;
        const baselineY = (glyph.height - fontData.metadata.baseline) * PIXEL_SIZE;
        const descentY = (glyph.height - fontData.metadata.descent) * PIXEL_SIZE;
        
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

    function renderLigatureCanvas() {
        if (!state.currentLigature || !fontData.ligatures[state.currentLigature]) return;
        
        const ligature = fontData.ligatures[state.currentLigature];
        const width = ligature.width * PIXEL_SIZE;
        const height = ligature.height * PIXEL_SIZE;
        
        ligatureCanvas.width = width;
        ligatureCanvas.height = height;
        
        ligatureCtx.fillStyle = '#1a1a2e';
        ligatureCtx.fillRect(0, 0, width, height);
        
        for (let y = 0; y < ligature.height; y++) {
            for (let x = 0; x < ligature.width; x++) {
                const px = x * PIXEL_SIZE;
                const py = y * PIXEL_SIZE;
                
                if (getPixel(ligature, x, y)) {
                    ligatureCtx.fillStyle = '#ffffff';
                    ligatureCtx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
                }
                
                ligatureCtx.strokeStyle = '#2a2a4a';
                ligatureCtx.lineWidth = 1;
                ligatureCtx.strokeRect(px + 0.5, py + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
            }
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
        const { x, y } = getCanvasPixelCoords(e, canvas);
        const glyph = getGlyph(state.currentCodePoint);
        
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
            state.lineStart = null;
            saveHistory();
            state.drawingModified = false;
        } else {
            applyTool(x, y, glyph, canvas);
            state.drawingModified = true;
        }
        
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function handleCanvasMouseMove(e) {
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
        
        const glyph = getGlyph(state.currentCodePoint);
        applyTool(x, y, glyph, canvas);
        state.drawingModified = true;
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function handleCanvasMouseUp() {
        if (state.isDrawing && state.drawingModified) {
            saveHistory();
        }
        state.isDrawing = false;
        state.drawingModified = false;
    }

    function handleLigatureMouseDown(e) {
        if (!state.currentLigature || !fontData.ligatures[state.currentLigature]) return;
        
        const { x, y } = getCanvasPixelCoords(e, ligatureCanvas);
        const ligature = fontData.ligatures[state.currentLigature];
        
        state.isDrawing = true;
        
        if (state.currentTool === 'line' || state.currentTool === 'rect') {
            if (!state.lineStart) {
                state.lineStart = { x, y };
                renderLigatureCanvas();
                return;
            }
        }
        
        if (state.currentTool === 'line' && state.lineStart) {
            bresenhamLine(state.lineStart.x, state.lineStart.y, x, y, (lx, ly) => {
                setPixel(ligature, lx, ly, 1);
            });
            state.lineStart = null;
        } else {
            applyTool(x, y, ligature, ligatureCanvas);
        }
        
        renderLigatureCanvas();
        renderPreview();
    }

    function handleLigatureMouseMove(e) {
        if (!state.currentLigature || !fontData.ligatures[state.currentLigature]) return;
        if (!state.isDrawing) return;
        
        const { x, y } = getCanvasPixelCoords(e, ligatureCanvas);
        const ligature = fontData.ligatures[state.currentLigature];
        
        if (state.currentTool === 'line' || state.currentTool === 'rect') {
            return;
        }
        
        applyTool(x, y, ligature, ligatureCanvas);
        renderLigatureCanvas();
        renderPreview();
    }

    function handleLigatureMouseUp() {
        state.isDrawing = false;
    }

    function flipHorizontal() {
        const glyph = getGlyph(state.currentCodePoint);
        glyph.pixels = glyph.pixels.map(row => row.split('').reverse().join(''));
        glyph.modified = true;
        saveHistory();
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function flipVertical() {
        const glyph = getGlyph(state.currentCodePoint);
        glyph.pixels.reverse();
        glyph.modified = true;
        saveHistory();
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function flipDiagonal() {
        const glyph = getGlyph(state.currentCodePoint);
        const newPixels = [];
        for (let x = 0; x < glyph.width; x++) {
            let newRow = '';
            for (let y = 0; y < glyph.height; y++) {
                newRow += glyph.pixels[y][x];
            }
            newPixels.push(newRow);
        }
        glyph.pixels = newPixels;
        const temp = glyph.width;
        glyph.width = glyph.height;
        glyph.height = temp;
        glyph.modified = true;
        saveHistory();
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function moveGlyph(direction) {
        const glyph = getGlyph(state.currentCodePoint);
        const w = glyph.width;
        const h = glyph.height;
        
        if (direction === 'up') {
            glyph.pixels.shift();
            glyph.pixels.push('0'.repeat(w));
        } else if (direction === 'down') {
            glyph.pixels.pop();
            glyph.pixels.unshift('0'.repeat(w));
        } else if (direction === 'left') {
            glyph.pixels = glyph.pixels.map(row => row.substring(1) + '0');
        } else if (direction === 'right') {
            glyph.pixels = glyph.pixels.map(row => '0' + row.substring(0, w - 1));
        }
        
        glyph.modified = true;
        saveHistory();
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function clearGlyph() {
        const glyph = getGlyph(state.currentCodePoint);
        glyph.pixels = glyph.pixels.map(() => '0'.repeat(glyph.width));
        glyph.modified = true;
        saveHistory();
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
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

    function drawCharsetThumbnail(canvas, codePoint) {
        const glyph = getGlyph(codePoint);
        const ctx = canvas.getContext('2d');
        const scale = 2;
        const width = glyph.width * scale;
        const height = glyph.height * scale;
        
        canvas.width = width;
        canvas.height = height;
        
        ctx.fillStyle = '#1e1e3a';
        ctx.fillRect(0, 0, width, height);
        
        drawGlyphToCanvas(ctx, glyph, 0, 0, scale, '#ffffff');
    }

    function renderCharsetGrid() {
        const grid = document.getElementById('charset-grid');
        grid.innerHTML = '';
        
        const codePoints = Object.keys(fontData.glyphs)
            .map(Number)
            .sort((a, b) => a - b);
        
        const filtered = state.searchFilter 
            ? codePoints.filter(cp => {
                const char = String.fromCodePoint(cp);
                const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
                return char.includes(state.searchFilter) || hex.includes(state.searchFilter.toUpperCase());
            })
            : codePoints;
        
        filtered.forEach(codePoint => {
            const char = String.fromCodePoint(codePoint);
            const glyph = getGlyph(codePoint);
            const isEmpty = isGlyphEmpty(glyph);
            
            const item = document.createElement('div');
            item.className = 'charset-item';
            if (codePoint === state.currentCodePoint) item.classList.add('active');
            if (isEmpty) item.classList.add('empty');
            item.dataset.codePoint = codePoint;
            
            const canvas = document.createElement('canvas');
            canvas.className = 'charset-canvas';
            
            const label = document.createElement('div');
            label.className = 'charset-label';
            label.textContent = 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
            
            item.appendChild(canvas);
            item.appendChild(label);
            
            item.addEventListener('click', () => {
                state.currentCodePoint = codePoint;
                clearHistory();
                renderGlyphCanvas();
                renderCharsetGrid();
                updateCurrentCharInfo();
            });
            
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY, codePoint);
            });
            
            grid.appendChild(item);
            drawCharsetThumbnail(canvas, codePoint);
        });
    }

    function updateCurrentCharInfo() {
        const char = String.fromCodePoint(state.currentCodePoint);
        document.getElementById('current-char-display').textContent = char;
        document.getElementById('current-char-code').textContent = 
            'U+' + state.currentCodePoint.toString(16).toUpperCase().padStart(4, '0');
    }

    function processTextForRendering(text) {
        const result = [];
        let i = 0;
        
        const ligatureKeys = Object.keys(fontData.ligatures)
            .sort((a, b) => b.length - a.length);
        
        while (i < text.length) {
            let matched = false;
            
            for (const ligKey of ligatureKeys) {
                if (text.substring(i, i + ligKey.length) === ligKey) {
                    result.push({
                        type: 'ligature',
                        chars: ligKey,
                        glyph: fontData.ligatures[ligKey]
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
                    glyph: fontData.glyphs[codePoint] || null
                });
                i++;
            }
        }
        
        return result;
    }

    function exportPNG() {
        const link = document.createElement('a');
        link.download = `${fontData.metadata.name || 'pixel-font'}.png`;
        link.href = previewCanvas.toDataURL('image/png');
        link.click();
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
        const processed = processTextForRendering(text);
        const glyphHeight = fontData.metadata.glyphHeight;
        const defaultSpacing = fontData.metadata.defaultSpacing;
        const lineWidth = parseInt(document.getElementById('preview-linewidth').value);
        const lineSpacing = parseInt(document.getElementById('preview-linespacing').value);

        const lines = [];
        let currentLine = [];
        let currentWidth = 0;
        let currentWord = [];
        let currentWordWidth = 0;

        function flushWord() {
            if (currentWord.length > 0) {
                if (currentWidth + currentWordWidth > lineWidth && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = [];
                    currentWidth = 0;
                }
                currentLine.push(...currentWord);
                currentWidth += currentWordWidth;
                currentWord = [];
                currentWordWidth = 0;
            }
        }

        for (let i = 0; i < processed.length; i++) {
            const item = processed[i];
            let itemWidth;
            let glyph;

            if (item.type === 'ligature') {
                glyph = item.glyph;
                itemWidth = item.glyph.width + defaultSpacing;
            } else {
                glyph = item.glyph || createEmptyGlyph(fontData.metadata.glyphWidth, fontData.metadata.glyphHeight);
                let kerningOffset = 0;
                if (i > 0 && processed[i-1].type === 'char') {
                    const prevChar = processed[i-1].char;
                    const kerningKey = prevChar + item.char;
                    kerningOffset = fontData.kerning[kerningKey] || 0;
                }
                itemWidth = glyph.width + defaultSpacing + kerningOffset;
            }

            if (item.type === 'char' && (item.char === ' ' || item.char === '\n')) {
                flushWord();
                if (item.char === '\n') {
                    lines.push(currentLine);
                    currentLine = [];
                    currentWidth = 0;
                } else {
                    currentLine.push({ ...item, glyph, width: itemWidth, x: currentWidth });
                    currentWidth += itemWidth;
                }
            } else {
                currentWord.push({ ...item, glyph, width: itemWidth, x: 0 });
                currentWordWidth += itemWidth;
            }
        }

        flushWord();
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }

        const layoutLines = [];
        let y = 0;
        lines.forEach(line => {
            let x = 0;
            const layoutChars = [];
            line.forEach(item => {
                if (item.type === 'char') {
                    let kerningOffset = 0;
                    if (layoutChars.length > 0 && line[layoutChars.length - 1].type === 'char') {
                        const prevItem = line[layoutChars.length - 1];
                        const kerningKey = prevItem.char + item.char;
                        kerningOffset = fontData.kerning[kerningKey] || 0;
                    }
                    x += kerningOffset * scale;
                }
                layoutChars.push({
                    ...item,
                    x: x,
                    y: y,
                    glyph: item.glyph
                });
                x += item.width * scale;
            });
            layoutLines.push({ chars: layoutChars, y: y, width: x });
            y += (glyphHeight + lineSpacing) * scale;
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

    function drawGlyphWithOpacity(targetCtx, glyph, x, y, scale, color, opacity) {
        const rgb = hexToRgb(color);
        targetCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
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

    function renderShadowEffect(ctx, layout, scale, params) {
        const { offsetX, offsetY, color, opacity } = params;
        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                if (!char.glyph) return;
                drawGlyphWithOpacity(
                    ctx,
                    char.glyph,
                    char.x + offsetX * scale,
                    char.y + offsetY * scale,
                    scale,
                    color,
                    opacity
                );
            });
        });
    }

    function renderStrokeEffect(ctx, layout, scale, params) {
        const { width, color } = params;
        const directions = [];
        for (let dy = -width; dy <= width; dy++) {
            for (let dx = -width; dx <= width; dx++) {
                if (dx !== 0 || dy !== 0) {
                    directions.push({ dx, dy });
                }
            }
        }

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                if (!char.glyph) return;
                directions.forEach(dir => {
                    drawGlyphWithColor(
                        ctx,
                        char.glyph,
                        char.x + dir.dx * scale,
                        char.y + dir.dy * scale,
                        scale,
                        color
                    );
                });
            });
        });
    }

    function renderGradientEffect(ctx, layout, scale, params, charColors) {
        const { direction, startColor, endColor } = params;

        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                if (!char.glyph) return;
                const glyph = char.glyph;

                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (getPixel(glyph, gx, gy)) {
                            let t;
                            if (direction === 'vertical') {
                                t = glyph.height > 1 ? gy / (glyph.height - 1) : 0;
                            } else {
                                t = glyph.width > 1 ? gx / (glyph.width - 1) : 0;
                            }
                            const color = lerpColor(startColor, endColor, t);
                            charColors[lineIdx][charIdx][gy][gx] = color;
                        }
                    }
                }
            });
        });
    }

    function applyWaveEffect(layout, scale, params, frame) {
        const { amplitude, frequency } = params;
        let charIndex = 0;

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                const offset = amplitude * scale * Math.sin(charIndex * frequency + (frame * Math.PI * 2) / 60);
                char.yOffset = offset;
                charIndex++;
            });
        });
    }

    function applyTypewriterEffect(layout, scale, params, frame, visibleChars) {
        const { speed, holdFrames } = params;
        let totalChars = 0;
        layout.lines.forEach(line => {
            totalChars += line.chars.length;
        });

        const cycleLength = totalChars * speed + holdFrames;
        const frameInCycle = frame % cycleLength;
        const charsToShow = Math.min(totalChars, Math.floor(frameInCycle / speed));

        let charIndex = 0;
        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                visibleChars[lineIdx][charIdx] = charIndex < charsToShow;
                charIndex++;
            });
        });
    }

    function applyNeonEffect(layout, scale, params, frame, charColors) {
        const { color1, color2, period } = params;
        let charIndex = 0;

        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                if (!char.glyph) return;
                const phaseOffset = (charIndex * Math.PI * 2) / 8;
                const t = (Math.sin((frame * Math.PI * 2) / period + phaseOffset) + 1) / 2;
                const color = lerpColor(color1, color2, t);

                const glyph = char.glyph;
                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (getPixel(glyph, gx, gy)) {
                            charColors[lineIdx][charIdx][gy][gx] = color;
                        }
                    }
                }
                charIndex++;
            });
        });
    }

    function hasDynamicEffects() {
        return effectsState.effects.some(e => e.enabled && EFFECT_TYPES[e.type].isDynamic);
    }

    function getAnimationCycleFrames(layout) {
        const dynamicEffects = effectsState.effects.filter(e => e.enabled && EFFECT_TYPES[e.type].isDynamic);
        if (dynamicEffects.length === 0) return 1;

        const periods = [];
        let totalChars = 0;
        layout.lines.forEach(line => {
            totalChars += line.chars.length;
        });

        dynamicEffects.forEach(effect => {
            if (effect.type === 'wave') {
                periods.push(60);
            } else if (effect.type === 'neon') {
                periods.push(effect.params.period);
            } else if (effect.type === 'typewriter') {
                const { speed, holdFrames } = effect.params;
                periods.push(totalChars * speed + holdFrames);
            }
        });

        function gcd(a, b) {
            return b === 0 ? a : gcd(b, a % b);
        }

        function lcm(a, b) {
            return (a * b) / gcd(a, b);
        }

        return periods.reduce((acc, p) => lcm(acc, p), 1);
    }

    function initCharColors(layout) {
        return layout.lines.map(line =>
            line.chars.map(char => {
                if (!char.glyph) return [];
                return Array.from({ length: char.glyph.height }, () =>
                    Array.from({ length: char.glyph.width }, () => '#ffffff')
                );
            })
        );
    }

    function initVisibleChars(layout) {
        return layout.lines.map(line =>
            line.chars.map(() => true)
        );
    }

    function renderFrame(targetCtx, frame, text, scale, targetWidth, targetHeight) {
        const layout = getTextLayout(text, scale);
        const charColors = initCharColors(layout);
        const visibleChars = initVisibleChars(layout);

        layout.lines.forEach(line => {
            line.chars.forEach(char => {
                char.yOffset = 0;
            });
        });

        const enabledEffects = effectsState.effects.filter(e => e.enabled);

        enabledEffects.forEach(effect => {
            if (effect.type === 'wave') {
                applyWaveEffect(layout, scale, effect.params, frame);
            } else if (effect.type === 'typewriter') {
                applyTypewriterEffect(layout, scale, effect.params, frame, visibleChars);
            }
        });

        targetCtx.fillStyle = '#0f0f23';
        targetCtx.fillRect(0, 0, targetWidth, targetHeight);

        enabledEffects.forEach(effect => {
            if (effect.type === 'shadow') {
                renderShadowEffect(targetCtx, layout, scale, effect.params);
            } else if (effect.type === 'stroke') {
                renderStrokeEffect(targetCtx, layout, scale, effect.params);
            }
        });

        enabledEffects.forEach(effect => {
            if (effect.type === 'gradient') {
                renderGradientEffect(targetCtx, layout, scale, effect.params, charColors);
            } else if (effect.type === 'neon') {
                applyNeonEffect(layout, scale, effect.params, frame, charColors);
            }
        });

        layout.lines.forEach((line, lineIdx) => {
            line.chars.forEach((char, charIdx) => {
                if (!char.glyph || !visibleChars[lineIdx][charIdx]) return;
                const glyph = char.glyph;
                const y = char.y + (char.yOffset || 0);

                for (let gy = 0; gy < glyph.height; gy++) {
                    for (let gx = 0; gx < glyph.width; gx++) {
                        if (getPixel(glyph, gx, gy)) {
                            const color = charColors[lineIdx][charIdx][gy][gx] || '#ffffff';
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
        const scale = parseInt(document.getElementById('preview-scale').value);

        const layout = getTextLayout(text, scale);
        const padding = 20;
        const maxEffectOffset = 10;
        const totalWidth = Math.max(layout.totalWidth + padding * 2, 100);
        const totalHeight = Math.max(layout.totalHeight + padding * 2 + maxEffectOffset * 2, 50);

        previewCanvas.width = totalWidth;
        previewCanvas.height = totalHeight;

        previewCtx.save();
        previewCtx.translate(padding, padding + maxEffectOffset);

        renderFrame(previewCtx, effectsState.currentFrame, text, scale, totalWidth, totalHeight);

        previewCtx.restore();

        document.getElementById('frame-display').textContent = `帧: ${effectsState.currentFrame}`;
    }

    function addEffect(type) {
        if (!EFFECT_TYPES[type]) return;

        const effect = {
            id: Date.now() + Math.random(),
            type: type,
            enabled: true,
            params: { ...EFFECT_TYPES[type].defaultParams }
        };

        effectsState.effects.push(effect);
        renderEffectsPanel();
        resetAnimation();
    }

    function removeEffect(id) {
        effectsState.effects = effectsState.effects.filter(e => e.id !== id);
        renderEffectsPanel();
        resetAnimation();
    }

    function toggleEffect(id) {
        const effect = effectsState.effects.find(e => e.id === id);
        if (effect) {
            effect.enabled = !effect.enabled;
            renderEffectsPanel();
            resetAnimation();
        }
    }

    function updateEffectParam(id, paramName, value) {
        const effect = effectsState.effects.find(e => e.id === id);
        if (effect) {
            effect.params[paramName] = value;
            renderPreview();
        }
    }

    function reorderEffects(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= effectsState.effects.length) return;
        if (toIndex < 0 || toIndex >= effectsState.effects.length) return;

        const [removed] = effectsState.effects.splice(fromIndex, 1);
        effectsState.effects.splice(toIndex, 0, removed);
        renderEffectsPanel();
        resetAnimation();
    }

    function renderEffectsPanel() {
        const container = document.getElementById('effects-list');
        container.innerHTML = '';

        effectsState.effects.forEach((effect, index) => {
            const effectType = EFFECT_TYPES[effect.type];
            const item = document.createElement('div');
            item.className = 'effect-item';
            item.dataset.index = index;
            item.draggable = true;

            let paramsHtml = '';
            Object.keys(effect.params).forEach(paramName => {
                const value = effect.params[paramName];
                let inputHtml = '';

                if (paramName.includes('color') || paramName === 'color') {
                    inputHtml = `<input type="color" value="${value}" data-param="${paramName}">`;
                } else if (paramName === 'opacity') {
                    inputHtml = `
                        <input type="range" min="0" max="1" step="0.1" value="${value}" data-param="${paramName}">
                        <span style="font-size:10px;color:var(--text-muted)">${value}</span>
                    `;
                } else if (paramName === 'direction') {
                    inputHtml = `
                        <select data-param="${paramName}">
                            <option value="vertical" ${value === 'vertical' ? 'selected' : ''}>垂直</option>
                            <option value="horizontal" ${value === 'horizontal' ? 'selected' : ''}>水平</option>
                        </select>
                    `;
                } else if (paramName === 'offsetX' || paramName === 'offsetY') {
                    inputHtml = `
                        <input type="number" min="1" max="4" step="1" value="${value}" data-param="${paramName}">
                    `;
                } else if (paramName === 'width') {
                    inputHtml = `
                        <input type="number" min="1" max="2" step="1" value="${value}" data-param="${paramName}">
                    `;
                } else if (paramName === 'amplitude') {
                    inputHtml = `
                        <input type="number" min="0" max="10" step="0.5" value="${value}" data-param="${paramName}">
                    `;
                } else if (paramName === 'frequency') {
                    inputHtml = `
                        <input type="number" min="0.1" max="2" step="0.1" value="${value}" data-param="${paramName}">
                    `;
                } else if (paramName === 'speed') {
                    inputHtml = `
                        <input type="number" min="1" max="10" step="1" value="${value}" data-param="${paramName}">
                    `;
                } else if (paramName === 'holdFrames' || paramName === 'period') {
                    inputHtml = `
                        <input type="number" min="1" max="120" step="1" value="${value}" data-param="${paramName}">
                    `;
                } else {
                    inputHtml = `<input type="number" value="${value}" data-param="${paramName}">`;
                }

                const labelMap = {
                    offsetX: 'X偏移',
                    offsetY: 'Y偏移',
                    color: '颜色',
                    color1: '颜色1',
                    color2: '颜色2',
                    opacity: '透明度',
                    width: '宽度',
                    direction: '方向',
                    startColor: '起始色',
                    endColor: '结束色',
                    amplitude: '振幅',
                    frequency: '频率',
                    speed: '速度',
                    holdFrames: '停留帧',
                    period: '周期'
                };

                paramsHtml += `
                    <div class="effect-param">
                        <label>${labelMap[paramName] || paramName}</label>
                        ${inputHtml}
                    </div>
                `;
            });

            item.innerHTML = `
                <div class="effect-header">
                    <span class="effect-drag-handle">⋮⋮</span>
                    <span class="effect-name">${effectType.name}${effectType.isDynamic ? ' ⚡' : ''}</span>
                    <div class="effect-toggle ${effect.enabled ? 'active' : ''}" data-toggle></div>
                    <button class="effect-delete" data-delete>×</button>
                </div>
                <div class="effect-params">
                    ${paramsHtml}
                </div>
            `;

            item.addEventListener('dragstart', (e) => {
                effectsState.draggedEffectId = effect.id;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                effectsState.draggedEffectId = null;
                document.querySelectorAll('.effect-item').forEach(el => {
                    el.classList.remove('drag-over');
                });
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (effectsState.draggedEffectId !== effect.id) {
                    item.classList.add('drag-over');
                }
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-over');
                if (effectsState.draggedEffectId !== null && effectsState.draggedEffectId !== effect.id) {
                    const fromIndex = effectsState.effects.findIndex(e => e.id === effectsState.draggedEffectId);
                    const toIndex = parseInt(item.dataset.index);
                    reorderEffects(fromIndex, toIndex);
                }
            });

            item.querySelector('[data-toggle]').addEventListener('click', () => {
                toggleEffect(effect.id);
            });

            item.querySelector('[data-delete]').addEventListener('click', () => {
                removeEffect(effect.id);
            });

            item.querySelectorAll('[data-param]').forEach(input => {
                const paramName = input.dataset.param;
                input.addEventListener('input', (e) => {
                    let value = e.target.value;
                    if (input.type === 'number' || input.type === 'range') {
                        value = parseFloat(value);
                    }
                    updateEffectParam(effect.id, paramName, value);
                });
            });

            container.appendChild(item);
        });
    }

    function resetAnimation() {
        effectsState.currentFrame = 0;
        if (!hasDynamicEffects()) {
            stopAnimation();
            renderPreview();
        } else {
            startAnimation();
        }
    }

    function startAnimation() {
        if (effectsState.animationId) {
            cancelAnimationFrame(effectsState.animationId);
        }
        effectsState.lastFrameTime = 0;
        animate();
    }

    function stopAnimation() {
        if (effectsState.animationId) {
            cancelAnimationFrame(effectsState.animationId);
            effectsState.animationId = null;
        }
    }

    function animate(timestamp) {
        if (!effectsState.isPlaying || !hasDynamicEffects()) {
            effectsState.animationId = requestAnimationFrame(animate);
            return;
        }

        if (!effectsState.lastFrameTime) {
            effectsState.lastFrameTime = timestamp;
        }

        const frameInterval = 1000 / effectsState.fps;
        const elapsed = timestamp - effectsState.lastFrameTime;

        if (elapsed >= frameInterval) {
            effectsState.currentFrame++;
            effectsState.lastFrameTime = timestamp - (elapsed % frameInterval);
            renderPreview();
        }

        effectsState.animationId = requestAnimationFrame(animate);
    }

    function togglePlayPause() {
        effectsState.isPlaying = !effectsState.isPlaying;
        const btn = document.getElementById('btn-play-pause');
        btn.textContent = effectsState.isPlaying ? '⏸ 暂停' : '▶ 播放';
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
        const text = document.getElementById('preview-text').value;
        const scale = parseInt(document.getElementById('preview-scale').value);
        const fps = parseInt(document.getElementById('preview-fps').value);

        const layout = getTextLayout(text, scale);
        const padding = 20;
        const maxEffectOffset = 10;
        const totalWidth = Math.max(layout.totalWidth + padding * 2, 100);
        const totalHeight = Math.max(layout.totalHeight + padding * 2 + maxEffectOffset * 2, 50);

        const totalFrames = getAnimationCycleFrames(layout);

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = totalWidth;
        offscreenCanvas.height = totalHeight;
        const offCtx = offscreenCanvas.getContext('2d');

        const encoder = new GIFEncoder(totalWidth, totalHeight);
        const delay = Math.round(1000 / fps);

        const exportBtn = document.getElementById('btn-export-gif');
        const originalText = exportBtn.textContent;
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
        link.download = `${fontData.metadata.name || 'pixel-text'}-animation.gif`;
        link.href = url;
        link.click();

        URL.revokeObjectURL(url);

        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
    }

    function exportJSON() {
        const exportData = {
            metadata: { ...fontData.metadata },
            glyphs: {},
            kerning: { ...fontData.kerning },
            ligatures: {}
        };
        
        Object.keys(fontData.glyphs).forEach(cp => {
            const glyph = fontData.glyphs[cp];
            exportData.glyphs[cp] = {
                width: glyph.width,
                height: glyph.height,
                pixels: glyph.pixels
            };
        });
        
        Object.keys(fontData.ligatures).forEach(key => {
            const lig = fontData.ligatures[key];
            exportData.ligatures[key] = {
                width: lig.width,
                height: lig.height,
                pixels: lig.pixels
            };
        });
        
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `${fontData.metadata.name || 'pixel-font'}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    function importJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.metadata) {
                    fontData.metadata = { ...fontData.metadata, ...data.metadata };
                }
                
                fontData.glyphs = {};
                if (data.glyphs) {
                    Object.keys(data.glyphs).forEach(cp => {
                        const g = data.glyphs[cp];
                        fontData.glyphs[cp] = {
                            width: g.width,
                            height: g.height,
                            pixels: [...g.pixels],
                            modified: false
                        };
                    });
                }
                
                fontData.kerning = data.kerning || {};
                
                fontData.ligatures = {};
                if (data.ligatures) {
                    Object.keys(data.ligatures).forEach(key => {
                        const l = data.ligatures[key];
                        fontData.ligatures[key] = {
                            width: l.width,
                            height: l.height,
                            pixels: [...l.pixels],
                            modified: false
                        };
                    });
                }
                
                updateSettingsForm();
                clearHistory();
                renderGlyphCanvas();
                renderCharsetGrid();
                renderPreview();
                renderKerningList();
                renderLigatureList();
                updateCurrentCharInfo();
                
                alert('字体导入成功！');
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function exportBDF() {
        const lines = [];
        const { metadata, glyphs, kerning } = fontData;
        
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

    function showContextMenu(x, y, codePoint) {
        state.contextMenuCodePoint = codePoint;
        const menu = document.getElementById('glyph-context-menu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('active');
    }

    function hideContextMenu() {
        document.getElementById('glyph-context-menu').classList.remove('active');
        state.contextMenuCodePoint = null;
    }

    function updateSettingsForm() {
        document.getElementById('setting-name').value = fontData.metadata.name;
        document.getElementById('setting-author').value = fontData.metadata.author;
        document.getElementById('setting-version').value = fontData.metadata.version;
        document.getElementById('setting-glyph-width').value = fontData.metadata.glyphWidth;
        document.getElementById('setting-glyph-height').value = fontData.metadata.glyphHeight;
        document.getElementById('setting-ascent').value = fontData.metadata.ascent;
        document.getElementById('setting-baseline').value = fontData.metadata.baseline;
        document.getElementById('setting-descent').value = fontData.metadata.descent;
        document.getElementById('setting-default-spacing').value = fontData.metadata.defaultSpacing;
    }

    function saveSettings() {
        const newWidth = parseInt(document.getElementById('setting-glyph-width').value);
        const newHeight = parseInt(document.getElementById('setting-glyph-height').value);
        const newAscent = parseInt(document.getElementById('setting-ascent').value);
        const newBaseline = parseInt(document.getElementById('setting-baseline').value);
        const newDescent = parseInt(document.getElementById('setting-descent').value);
        
        if (newAscent > newHeight) {
            alert('上升线位置不能超过字形高度！');
            return;
        }
        if (newBaseline > newAscent) {
            alert('基线位置不能大于上升线位置！');
            return;
        }
        if (newDescent > newBaseline) {
            alert('下降线位置不能大于基线位置！');
            return;
        }
        
        fontData.metadata.name = document.getElementById('setting-name').value;
        fontData.metadata.author = document.getElementById('setting-author').value;
        fontData.metadata.version = document.getElementById('setting-version').value;
        fontData.metadata.glyphWidth = newWidth;
        fontData.metadata.glyphHeight = newHeight;
        fontData.metadata.ascent = newAscent;
        fontData.metadata.baseline = newBaseline;
        fontData.metadata.descent = newDescent;
        fontData.metadata.defaultSpacing = parseInt(document.getElementById('setting-default-spacing').value);
        
        Object.keys(fontData.glyphs).forEach(cp => {
            const glyph = fontData.glyphs[cp];
            const oldPixels = glyph.pixels;
            const newPixels = [];
            
            for (let y = 0; y < newHeight; y++) {
                let newRow = '';
                for (let x = 0; x < newWidth; x++) {
                    const oldY = y < oldPixels.length ? y : oldPixels.length - 1;
                    const oldRow = oldPixels[oldY] || '';
                    newRow += x < oldRow.length ? oldRow[x] : '0';
                }
                newPixels.push(newRow);
            }
            
            glyph.width = newWidth;
            glyph.height = newHeight;
            glyph.pixels = newPixels;
        });
        
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
        hideModal('settings-modal');
    }

    function renderKerningList() {
        const list = document.getElementById('kerning-list');
        list.innerHTML = '';
        
        Object.keys(fontData.kerning).sort().forEach(key => {
            const item = document.createElement('div');
            item.className = 'kerning-item';
            item.innerHTML = `
                <span class="kerning-pair">${key}</span>
                <span class="kerning-value">${fontData.kerning[key] > 0 ? '+' : ''}${fontData.kerning[key]}</span>
            `;
            item.addEventListener('click', () => {
                document.getElementById('kerning-left').value = key[0];
                document.getElementById('kerning-right').value = key[1];
                document.getElementById('kerning-slider').value = fontData.kerning[key];
                document.getElementById('kerning-value').textContent = fontData.kerning[key];
                updateKerningPreview();
            });
            list.appendChild(item);
        });
    }

    function renderSuggestionList() {
        const list = document.getElementById('suggestion-list');
        list.innerHTML = '';
        
        DEFAULT_KERNING_SUGGESTIONS.forEach(([left, right, value]) => {
            const key = left + right;
            if (fontData.kerning[key]) return;
            
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
                <span class="kerning-pair">${key}</span>
                <span class="kerning-value">${value > 0 ? '+' : ''}${value}</span>
                <span class="accept-btn">[接受]</span>
            `;
            item.addEventListener('click', () => {
                fontData.kerning[key] = value;
                renderKerningList();
                renderSuggestionList();
                renderPreview();
            });
            list.appendChild(item);
        });
    }

    function updateKerningPreview() {
        const left = document.getElementById('kerning-left').value;
        const right = document.getElementById('kerning-right').value;
        const value = parseInt(document.getElementById('kerning-slider').value);
        document.getElementById('kerning-value').textContent = value;
        document.getElementById('kerning-preview-text').textContent = left + right;
        document.getElementById('kerning-preview-text').style.letterSpacing = value + 'px';
    }

    function addKerning() {
        const left = document.getElementById('kerning-left').value;
        const right = document.getElementById('kerning-right').value;
        const value = parseInt(document.getElementById('kerning-slider').value);
        
        if (!left || !right) {
            alert('请输入左右字符！');
            return;
        }
        
        const key = left + right;
        if (value === 0) {
            delete fontData.kerning[key];
        } else {
            fontData.kerning[key] = value;
        }
        
        renderKerningList();
        renderSuggestionList();
        renderPreview();
    }

    function deleteKerning() {
        const left = document.getElementById('kerning-left').value;
        const right = document.getElementById('kerning-right').value;
        const key = left + right;
        delete fontData.kerning[key];
        renderKerningList();
        renderSuggestionList();
        renderPreview();
    }

    function renderLigatureList() {
        const list = document.getElementById('ligature-list');
        list.innerHTML = '';
        
        Object.keys(fontData.ligatures).sort((a, b) => b.length - a.length).forEach(key => {
            const item = document.createElement('div');
            item.className = 'ligature-item';
            if (state.currentLigature === key) item.classList.add('active');
            item.innerHTML = `<span class="kerning-pair">${key}</span>`;
            item.addEventListener('click', () => {
                state.currentLigature = key;
                document.getElementById('ligature-chars').value = key;
                document.getElementById('ligature-width').value = fontData.ligatures[key].width;
                renderLigatureList();
                renderLigatureCanvas();
            });
            list.appendChild(item);
        });
    }

    function addLigature() {
        const chars = document.getElementById('ligature-chars').value.trim();
        if (!chars || chars.length < 2) {
            alert('请输入至少2个字符的连字序列！');
            return;
        }
        
        if (!fontData.ligatures[chars]) {
            const width = parseInt(document.getElementById('ligature-width').value) || chars.length * fontData.metadata.glyphWidth;
            fontData.ligatures[chars] = createEmptyGlyph(width, fontData.metadata.glyphHeight);
        }
        
        state.currentLigature = chars;
        renderLigatureList();
        renderLigatureCanvas();
        renderPreview();
    }

    function deleteLigature() {
        const chars = document.getElementById('ligature-chars').value.trim();
        if (!chars) return;
        
        if (confirm(`确定要删除连字 "${chars}" 吗？`)) {
            delete fontData.ligatures[chars];
            if (state.currentLigature === chars) {
                state.currentLigature = null;
            }
            renderLigatureList();
            renderLigatureCanvas();
            renderPreview();
        }
    }

    function setLigatureWidth() {
        if (!state.currentLigature || !fontData.ligatures[state.currentLigature]) return;
        
        const newWidth = parseInt(document.getElementById('ligature-width').value);
        const ligature = fontData.ligatures[state.currentLigature];
        
        if (newWidth < 6 || newWidth > 32) {
            alert('连字宽度必须在6到32之间！');
            return;
        }
        
        const oldWidth = ligature.width;
        ligature.width = newWidth;
        
        ligature.pixels = ligature.pixels.map(row => {
            if (newWidth > oldWidth) {
                return row + '0'.repeat(newWidth - oldWidth);
            } else {
                return row.substring(0, newWidth);
            }
        });
        
        renderLigatureCanvas();
        renderPreview();
    }

    function batchImport(text) {
        let count = 0;
        for (let i = 0; i < text.length; i++) {
            const cp = text.codePointAt(i);
            if (cp >= 0x20 && !fontData.glyphs[cp]) {
                fontData.glyphs[cp] = createEmptyGlyph(
                    fontData.metadata.glyphWidth,
                    fontData.metadata.glyphHeight
                );
                count++;
            }
        }
        renderCharsetGrid();
        return count;
    }

    function copyGlyph(fromCodePoint, toCodePoint) {
        const fromGlyph = getGlyph(fromCodePoint);
        fontData.glyphs[toCodePoint] = cloneGlyph(fromGlyph);
        fontData.glyphs[toCodePoint].modified = true;
    }

    function createVariant(codePoint) {
        const newCodePoint = prompt('请输入新字形的Unicode码点（十进制或十六进制，如65或0x41）：');
        if (!newCodePoint) return;
        
        let cp;
        if (newCodePoint.startsWith('0x') || newCodePoint.startsWith('0X')) {
            cp = parseInt(newCodePoint, 16);
        } else {
            cp = parseInt(newCodePoint, 10);
        }
        
        if (isNaN(cp) || cp < 0) {
            alert('无效的码点！');
            return;
        }
        
        copyGlyph(codePoint, cp);
        renderCharsetGrid();
        alert(`已创建变体到 ${String.fromCodePoint(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`);
    }

    function deleteGlyph(codePoint) {
        if (codePoint === 0x20) {
            alert('不能删除空格字符！');
            return;
        }
        if (confirm(`确定要删除字符 ${String.fromCodePoint(codePoint)} (U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}) 吗？`)) {
            delete fontData.glyphs[codePoint];
            if (state.currentCodePoint === codePoint) {
                state.currentCodePoint = 0x41;
                clearHistory();
                updateCurrentCharInfo();
            }
            renderGlyphCanvas();
            renderCharsetGrid();
            renderPreview();
        }
    }

    function copyGlyphTo(codePoint) {
        const targetCodePoint = prompt('请输入目标码点（十进制或十六进制，如65或0x41）：');
        if (!targetCodePoint) return;
        
        let cp;
        if (targetCodePoint.startsWith('0x') || targetCodePoint.startsWith('0X')) {
            cp = parseInt(targetCodePoint, 16);
        } else {
            cp = parseInt(targetCodePoint, 10);
        }
        
        if (isNaN(cp) || cp < 0) {
            alert('无效的码点！');
            return;
        }
        
        copyGlyph(codePoint, cp);
        renderCharsetGrid();
        alert(`已复制到 ${String.fromCodePoint(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`);
    }

    function handleContextMenuAction(action) {
        if (!state.contextMenuCodePoint) return;
        
        switch (action) {
            case 'copy':
                copyGlyphTo(state.contextMenuCodePoint);
                break;
            case 'variant':
                createVariant(state.contextMenuCodePoint);
                break;
            case 'delete':
                deleteGlyph(state.contextMenuCodePoint);
                break;
        }
        
        hideContextMenu();
    }

    function createDemoFont() {
        const demoGlyphs = {
            'A': [
                '00111000',
                '01111100',
                '11000110',
                '11000110',
                '11111110',
                '11111110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'B': [
                '11111000',
                '11001100',
                '11000110',
                '11000110',
                '11111100',
                '11111100',
                '11000110',
                '11000110',
                '11000110',
                '11111100',
                '00000000',
                '00000000'
            ],
            'C': [
                '00111100',
                '01111110',
                '11000110',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000110',
                '01111110',
                '00000000',
                '00000000'
            ],
            'D': [
                '11111000',
                '11001100',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11111100',
                '00000000',
                '00000000'
            ],
            'E': [
                '11111110',
                '11000000',
                '11000000',
                '11000000',
                '11111000',
                '11111000',
                '11000000',
                '11000000',
                '11000000',
                '11111110',
                '00000000',
                '00000000'
            ],
            'F': [
                '11111110',
                '11000000',
                '11000000',
                '11000000',
                '11111000',
                '11111000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '00000000',
                '00000000'
            ],
            'G': [
                '00111100',
                '01111110',
                '11000110',
                '11000000',
                '11000000',
                '11011110',
                '11000110',
                '11000110',
                '11000110',
                '01111110',
                '00000000',
                '00000000'
            ],
            'H': [
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11111110',
                '11111110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'I': [
                '01111110',
                '00111100',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '01111110',
                '00000000',
                '00000000'
            ],
            'J': [
                '00111110',
                '00011110',
                '00001100',
                '00001100',
                '00001100',
                '00001100',
                '00001100',
                '00001100',
                '11001100',
                '01111000',
                '00000000',
                '00000000'
            ],
            'K': [
                '11000110',
                '11001100',
                '11011000',
                '11110000',
                '11110000',
                '11111000',
                '11011100',
                '11001110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'L': [
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '11111110',
                '00000000',
                '00000000'
            ],
            'M': [
                '11000110',
                '11101110',
                '11111110',
                '11111110',
                '11010110',
                '11010110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'N': [
                '11000110',
                '11100110',
                '11110110',
                '11011110',
                '11001110',
                '11001110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'O': [
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            'P': [
                '11111100',
                '11001110',
                '11000110',
                '11000110',
                '11001110',
                '11111100',
                '11000000',
                '11000000',
                '11000000',
                '11000000',
                '00000000',
                '00000000'
            ],
            'Q': [
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11001110',
                '11011110',
                '01110110',
                '00111110',
                '00000110',
                '00000000'
            ],
            'R': [
                '11111100',
                '11001110',
                '11000110',
                '11000110',
                '11001110',
                '11111100',
                '11011100',
                '11001110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'S': [
                '00111100',
                '01111110',
                '11000110',
                '11000000',
                '01111000',
                '00111100',
                '00001110',
                '00000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            'T': [
                '11111110',
                '11111110',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00000000',
                '00000000'
            ],
            'U': [
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            'V': [
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '01000100',
                '01101100',
                '00111000',
                '00111000',
                '00010000',
                '00000000',
                '00000000'
            ],
            'W': [
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11010110',
                '11010110',
                '11010110',
                '11111110',
                '01111110',
                '01000100',
                '00000000',
                '00000000'
            ],
            'X': [
                '11000110',
                '11000110',
                '01101100',
                '00111000',
                '00111000',
                '00010000',
                '00111000',
                '00111000',
                '01101100',
                '11000110',
                '00000000',
                '00000000'
            ],
            'Y': [
                '11000110',
                '11000110',
                '11000110',
                '01101100',
                '00111000',
                '00010000',
                '00010000',
                '00010000',
                '00010000',
                '00010000',
                '00000000',
                '00000000'
            ],
            'Z': [
                '11111110',
                '00000110',
                '00001100',
                '00011000',
                '00110000',
                '01100000',
                '11000000',
                '11000000',
                '11000000',
                '11111110',
                '00000000',
                '00000000'
            ],
            '0': [
                '00111100',
                '01111110',
                '11000110',
                '11001110',
                '11011110',
                '11110110',
                '11100110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            '1': [
                '00011000',
                '00111000',
                '01111000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '01111110',
                '00000000',
                '00000000'
            ],
            '2': [
                '00111100',
                '01111110',
                '11000110',
                '00000110',
                '00001100',
                '00011000',
                '00110000',
                '01100000',
                '11000000',
                '11111110',
                '00000000',
                '00000000'
            ],
            '3': [
                '00111100',
                '01111110',
                '11000110',
                '00000110',
                '00011100',
                '00001100',
                '00000110',
                '00000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            '4': [
                '00001100',
                '00011100',
                '00111100',
                '01101100',
                '11001100',
                '11001100',
                '11111110',
                '00001100',
                '00001100',
                '00001100',
                '00000000',
                '00000000'
            ],
            '5': [
                '11111110',
                '11000000',
                '11000000',
                '11111100',
                '11111110',
                '00000110',
                '00000110',
                '00000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            '6': [
                '00111100',
                '01111110',
                '11000110',
                '11000000',
                '11000000',
                '11111100',
                '11111110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            '7': [
                '11111110',
                '11111110',
                '00000110',
                '00001100',
                '00011000',
                '00110000',
                '00110000',
                '00110000',
                '00110000',
                '00110000',
                '00000000',
                '00000000'
            ],
            '8': [
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            '9': [
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '01111110',
                '00111110',
                '00000110',
                '00000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000'
            ],
            ' ': [
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000',
                '00000000'
            ],
            'e': [
                '00000000',
                '00000000',
                '00111100',
                '01111110',
                '11000110',
                '11111110',
                '11000000',
                '11000110',
                '01111110',
                '00111100',
                '00000000',
                '00000000'
            ],
            'h': [
                '00000000',
                '00000000',
                '11000110',
                '11000110',
                '11000110',
                '11111110',
                '11111110',
                '11000110',
                '11000110',
                '11000110',
                '00000000',
                '00000000'
            ],
            'l': [
                '00000000',
                '00000000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00000000',
                '00000000'
            ],
            'i': [
                '00000000',
                '00000000',
                '00011000',
                '00000000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00011000',
                '00000000',
                '00000000'
            ],
            'o': [
                '00000000',
                '00000000',
                '00111100',
                '01111110',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '01111110',
                '00111100',
                '00000000',
                '00000000'
            ],
            'r': [
                '00000000',
                '00000000',
                '00111100',
                '01100110',
                '01000000',
                '01000000',
                '01000000',
                '01000000',
                '01000000',
                '01000000',
                '00000000',
                '00000000'
            ],
            'd': [
                '00000000',
                '00000000',
                '00001100',
                '00001100',
                '00001100',
                '00001100',
                '00001100',
                '00111110',
                '01100110',
                '11000110',
                '01111110',
                '00111100'
            ],
            'w': [
                '00000000',
                '00000000',
                '11000110',
                '11000110',
                '11000110',
                '11000110',
                '11010110',
                '11010110',
                '11010110',
                '01101100',
                '00000000',
                '00000000'
            ]
        };
        
        Object.keys(demoGlyphs).forEach(char => {
            const cp = char.charCodeAt(0);
            fontData.glyphs[cp] = {
                width: 8,
                height: 12,
                pixels: [...demoGlyphs[char]],
                modified: true
            };
        });
        
        for (let cp = 0x20; cp <= 0x7E; cp++) {
            if (!fontData.glyphs[cp]) {
                fontData.glyphs[cp] = createEmptyGlyph(8, 12);
            }
        }
        
        fontData.kerning['AV'] = -1;
        fontData.kerning['VA'] = -1;
        
        fontData.ligatures['He'] = {
            width: 16,
            height: 12,
            pixels: [
                '0000000000000000',
                '0000000000000000',
                '1100011000000000',
                '1100011000000000',
                '1100011000111100',
                '1100011001111110',
                '1111111011000110',
                '1111111011111110',
                '1100011011000000',
                '1100011011000110',
                '0000000001111110',
                '0000000000111100'
            ],
            modified: true
        };
    }

    function initEventListeners() {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.currentTool = btn.dataset.tool;
                state.lineStart = null;
                renderGlyphCanvas();
            });
        });
        
        document.querySelectorAll('.tool-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                switch (action) {
                    case 'flip-h': flipHorizontal(); break;
                    case 'flip-v': flipVertical(); break;
                    case 'flip-d': flipDiagonal(); break;
                    case 'move-up': moveGlyph('up'); break;
                    case 'move-down': moveGlyph('down'); break;
                    case 'move-left': moveGlyph('left'); break;
                    case 'move-right': moveGlyph('right'); break;
                    case 'undo': undo(); break;
                    case 'redo': redo(); break;
                    case 'clear': clearGlyph(); break;
                }
            });
        });
        
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMouseMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('mouseleave', handleCanvasMouseUp);
        
        ligatureCanvas.addEventListener('mousedown', handleLigatureMouseDown);
        ligatureCanvas.addEventListener('mousemove', handleLigatureMouseMove);
        ligatureCanvas.addEventListener('mouseup', handleLigatureMouseUp);
        ligatureCanvas.addEventListener('mouseleave', handleLigatureMouseUp);
        
        document.getElementById('charset-search').addEventListener('input', (e) => {
            state.searchFilter = e.target.value;
            renderCharsetGrid();
        });
        
        document.getElementById('btn-batch-import').addEventListener('click', () => {
            showModal('batch-import-modal');
        });
        
        document.getElementById('btn-batch-import-confirm').addEventListener('click', () => {
            const text = document.getElementById('batch-import-text').value;
            const count = batchImport(text);
            alert(`已为 ${count} 个新字符创建空白模板！`);
            document.getElementById('batch-import-text').value = '';
            hideModal('batch-import-modal');
        });
        
        document.getElementById('preview-text').addEventListener('input', () => {
            resetAnimation();
        });
        document.getElementById('preview-scale').addEventListener('change', () => {
            resetAnimation();
        });
        document.getElementById('preview-linewidth').addEventListener('input', () => {
            resetAnimation();
        });
        document.getElementById('preview-linespacing').addEventListener('input', () => {
            resetAnimation();
        });
        document.getElementById('preview-fps').addEventListener('change', (e) => {
            effectsState.fps = parseInt(e.target.value);
        });

        document.getElementById('effect-type-select').addEventListener('change', (e) => {
            if (e.target.value) {
                addEffect(e.target.value);
                e.target.value = '';
            }
        });

        document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);
        document.getElementById('btn-export-gif').addEventListener('click', exportGIF);

        document.getElementById('btn-export-png').addEventListener('click', exportPNG);
        document.getElementById('btn-export-json').addEventListener('click', exportJSON);
        document.getElementById('btn-export-bdf').addEventListener('click', exportBDF);
        
        document.getElementById('btn-import-json').addEventListener('click', () => {
            document.getElementById('file-import-json').click();
        });
        
        document.getElementById('file-import-json').addEventListener('change', (e) => {
            if (e.target.files[0]) {
                importJSON(e.target.files[0]);
            }
        });
        
        document.getElementById('btn-settings').addEventListener('click', () => {
            updateSettingsForm();
            showModal('settings-modal');
        });
        
        document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
        
        document.getElementById('btn-kerning').addEventListener('click', () => {
            renderKerningList();
            renderSuggestionList();
            updateKerningPreview();
            showModal('kerning-modal');
        });
        
        document.getElementById('kerning-slider').addEventListener('input', updateKerningPreview);
        document.getElementById('kerning-left').addEventListener('input', updateKerningPreview);
        document.getElementById('kerning-right').addEventListener('input', updateKerningPreview);
        document.getElementById('btn-kerning-add').addEventListener('click', addKerning);
        document.getElementById('btn-kerning-delete').addEventListener('click', deleteKerning);
        
        document.getElementById('btn-ligature').addEventListener('click', () => {
            renderLigatureList();
            renderLigatureCanvas();
            showModal('ligature-modal');
        });
        
        document.getElementById('btn-ligature-add').addEventListener('click', addLigature);
        document.getElementById('btn-ligature-delete').addEventListener('click', deleteLigature);
        document.getElementById('btn-ligature-width-set').addEventListener('click', setLigatureWidth);
        
        document.querySelectorAll('.modal-close, .modal-btn[data-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                hideModal(btn.dataset.modal);
            });
        });
        
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
        
        document.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                handleContextMenuAction(item.dataset.action);
            });
        });
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.charset-item')) {
                hideContextMenu();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        redo();
                    } else {
                        undo();
                    }
                } else if (e.key === 'y') {
                    e.preventDefault();
                    redo();
                } else if (e.key === 's') {
                    e.preventDefault();
                    exportJSON();
                }
            }
        });
    }

    function init() {
        canvas = document.getElementById('glyph-canvas');
        ctx = canvas.getContext('2d');
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        ligatureCanvas = document.getElementById('ligature-canvas');
        ligatureCtx = ligatureCanvas.getContext('2d');
        
        createDemoFont();
        initEventListeners();
        clearHistory();

        effectsState.effects = [
            {
                id: 1,
                type: 'gradient',
                enabled: true,
                params: {
                    direction: 'vertical',
                    startColor: '#3b82f6',
                    endColor: '#8b5cf6'
                }
            },
            {
                id: 2,
                type: 'wave',
                enabled: true,
                params: {
                    amplitude: 2,
                    frequency: 0.3
                }
            }
        ];

        renderEffectsPanel();
        
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
        updateCurrentCharInfo();

        if (hasDynamicEffects()) {
            startAnimation();
        }
    }

    return {
        init,
        renderPreview,
        exportJSON,
        exportBDF,
        exportPNG,
        exportGIF
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    PixelFontEditor.init();
});
