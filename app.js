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

    function saveHistory() {
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
        
        if (state.currentTool === 'line' || state.currentTool === 'rect') {
            if (!state.lineStart) {
                state.lineStart = { x, y };
                renderGlyphCanvas();
                return;
            }
        }
        
        saveHistory();
        
        if (state.currentTool === 'line' && state.lineStart) {
            bresenhamLine(state.lineStart.x, state.lineStart.y, x, y, (lx, ly) => {
                setPixel(glyph, lx, ly, 1);
            });
            state.lineStart = null;
        } else {
            applyTool(x, y, glyph, canvas);
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
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function handleCanvasMouseUp() {
        state.isDrawing = false;
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
        saveHistory();
        glyph.pixels = glyph.pixels.map(row => row.split('').reverse().join(''));
        glyph.modified = true;
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function flipVertical() {
        const glyph = getGlyph(state.currentCodePoint);
        saveHistory();
        glyph.pixels.reverse();
        glyph.modified = true;
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function flipDiagonal() {
        const glyph = getGlyph(state.currentCodePoint);
        saveHistory();
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
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function moveGlyph(direction) {
        const glyph = getGlyph(state.currentCodePoint);
        saveHistory();
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
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
    }

    function clearGlyph() {
        const glyph = getGlyph(state.currentCodePoint);
        saveHistory();
        glyph.pixels = glyph.pixels.map(() => '0'.repeat(glyph.width));
        glyph.modified = true;
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

    function renderPreview() {
        const text = document.getElementById('preview-text').value;
        const scale = parseInt(document.getElementById('preview-scale').value);
        const lineWidth = parseInt(document.getElementById('preview-linewidth').value);
        const lineSpacing = parseInt(document.getElementById('preview-linespacing').value);
        
        const processed = processTextForRendering(text);
        const glyphHeight = fontData.metadata.glyphHeight;
        const defaultSpacing = fontData.metadata.defaultSpacing;
        
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
            
            if (item.type === 'ligature') {
                itemWidth = item.glyph.width + defaultSpacing;
            } else {
                const glyph = item.glyph || createEmptyGlyph(fontData.metadata.glyphWidth, fontData.metadata.glyphHeight);
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
                    currentLine.push(item);
                    currentWidth += itemWidth;
                }
            } else {
                currentWord.push(item);
                currentWordWidth += itemWidth;
            }
        }
        
        flushWord();
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
        
        const totalHeight = lines.length * (glyphHeight + lineSpacing) * scale;
        const totalWidth = Math.min(lineWidth, Math.max(...lines.map(line => {
            let w = 0;
            line.forEach((item, idx) => {
                if (item.type === 'ligature') {
                    w += item.glyph.width + defaultSpacing;
                } else {
                    const glyph = item.glyph || createEmptyGlyph(fontData.metadata.glyphWidth, fontData.metadata.glyphHeight);
                    let kerningOffset = 0;
                    if (idx > 0 && line[idx-1].type === 'char') {
                        const prevChar = line[idx-1].char;
                        const kerningKey = prevChar + item.char;
                        kerningOffset = fontData.kerning[kerningKey] || 0;
                    }
                    w += glyph.width + defaultSpacing + kerningOffset;
                }
            });
            return w * scale;
        })));
        
        previewCanvas.width = Math.max(totalWidth, 100);
        previewCanvas.height = Math.max(totalHeight, 50);
        
        previewCtx.fillStyle = '#0f0f23';
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        
        let y = 0;
        lines.forEach(line => {
            let x = 0;
            line.forEach((item, idx) => {
                if (item.type === 'ligature') {
                    drawGlyphToCanvas(previewCtx, item.glyph, x, y, scale);
                    x += (item.glyph.width + defaultSpacing) * scale;
                } else {
                    const glyph = item.glyph || createEmptyGlyph(fontData.metadata.glyphWidth, fontData.metadata.glyphHeight);
                    let kerningOffset = 0;
                    if (idx > 0 && line[idx-1].type === 'char') {
                        const prevChar = line[idx-1].char;
                        const kerningKey = prevChar + item.char;
                        kerningOffset = fontData.kerning[kerningKey] || 0;
                    }
                    x += kerningOffset * scale;
                    
                    if (!item.glyph) {
                        previewCtx.fillStyle = '#ef4444';
                        previewCtx.fillRect(x, y, glyph.width * scale, glyph.height * scale);
                    } else {
                        drawGlyphToCanvas(previewCtx, glyph, x, y, scale);
                    }
                    x += (glyph.width + defaultSpacing) * scale;
                }
            });
            y += (glyphHeight + lineSpacing) * scale;
        });
    }

    function exportPNG() {
        const link = document.createElement('a');
        link.download = `${fontData.metadata.name || 'pixel-font'}.png`;
        link.href = previewCanvas.toDataURL('image/png');
        link.click();
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
        
        if (newAscent + newDescent > newHeight) {
            alert('上升线 + 下降线 不能超过字形高度！');
            return;
        }
        if (newBaseline > newDescent) {
            alert('基线位置不能大于下降线位置！');
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
        
        document.getElementById('preview-text').addEventListener('input', renderPreview);
        document.getElementById('preview-scale').addEventListener('change', renderPreview);
        document.getElementById('preview-linewidth').addEventListener('input', renderPreview);
        document.getElementById('preview-linespacing').addEventListener('input', renderPreview);
        
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
        
        renderGlyphCanvas();
        renderCharsetGrid();
        renderPreview();
        updateCurrentCharInfo();
    }

    return {
        init,
        renderPreview,
        exportJSON,
        exportBDF,
        exportPNG
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    PixelFontEditor.init();
});
