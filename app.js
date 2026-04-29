'use strict';

/* =====================================================
   ClipMind — app.js (v2: Cache + Summary + Smart Chat)
   ===================================================== */

// ── STATE ──────────────────────────────────────────────
let currentTheme  = 'dark';
let currentSource = 'youtube';
let currentView   = 'words';
let segments      = [];
let audioFmt      = 'mp3';
let exportOpen    = false;
let chatHistory   = [];
let generating    = { video: false, audio: false };
let currentVidHash = null; 

// ── HELPERS ────────────────────────────────────────────
function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function wordCount(segs) {
    return segs.reduce((acc, s) => acc + s.text.split(' ').length, 0);
}

function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(msg, duration = 3500) {
    let t = document.getElementById('_toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '_toast';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--bg2);border:1px solid var(--border2);color:var(--text);padding:10px 20px;border-radius:10px;font-size:13px;font-family:Outfit,sans-serif;z-index:9999;box-shadow:var(--shadow);opacity:0;transition:all 0.3s;pointer-events:none;max-width:340px;text-align:center;';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(20px)';
    }, duration);
}

function getYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function youtubeWithStart(url, sec) {
    if (!url) return '';
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    try {
        const u = new URL(url);
        u.searchParams.set('t', String(s) + 's');
        return u.toString();
    } catch {
        const join = url.includes('?') ? '&' : '?';
        return `${url.split('#')[0]}${join}t=${s}`;
    }
}

// ── THEME TOGGLE ──────────────────────────────────────
function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    const label = document.getElementById('themeLabel');
    const sun   = document.getElementById('sunIcon');
    const moon  = document.getElementById('moonIcon');
    if (currentTheme === 'light') {
        label.textContent = 'Dark';
        sun.style.display  = 'none';
        moon.style.display = 'block';
    } else {
        label.textContent  = 'Light';
        sun.style.display  = 'block';
        moon.style.display = 'none';
    }
}

// ── SOURCE TABS ───────────────────────────────────────
function switchSource(src) {
    currentSource = src;
    document.querySelectorAll('.source-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === src);
    });
    document.querySelectorAll('.source-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${src}`);
    });
}

// ── FILE UPLOAD ───────────────────────────────────────
function triggerUpload(inputId) { document.getElementById(inputId).click(); }

function onDragOver(e, zoneId) {
    e.preventDefault();
    document.getElementById(zoneId).classList.add('drag-active');
}

function onDragLeave(zoneId) {
    document.getElementById(zoneId).classList.remove('drag-active');
}

function onDrop(e, inputId, zoneId) {
    e.preventDefault();
    document.getElementById(zoneId).classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, inputId.includes('video') ? 'video' : 'audio');
}

function handleFileChange(input, type) {
    if (input.files[0]) handleFile(input.files[0], type);
}

function handleFile(file, type) {
    const maxMB = type === 'video' ? 4096 : 2048;
    if (file.size > maxMB * 1024 * 1024) {
        toast(`File too large. Maximum is ${maxMB >= 1024 ? maxMB / 1024 + ' GB' : maxMB + ' MB'}.`);
        return;
    }
    uploadAndTranscribeFile(file);
}

// ── TRANSCRIPTION ─────────────────────────────────────
async function transcribeYoutube() {
    const url = document.getElementById('youtubeUrl').value.trim();
    if (!url) { document.getElementById('youtubeUrl').focus(); toast('Please paste a YouTube URL first.'); return; }
    if (!url.includes('youtube') && !url.includes('youtu.be')) {
        toast('That does not look like a YouTube URL. Please check and try again.');
        return;
    }

    showProgress('Processing video…');

    try {
        const res  = await fetch('/load-youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentVidHash = data.vid_hash; 

        if (data.from_cache || data.from_db) {
            toast('✅ Loaded from database — no reprocessing needed!', 4000);
        } else {
            toast(`✅ Transcribed · Language: ${data.language}`);
        }

        await fetchAndRenderChunks();
        renderSummary(data.summary, data.from_cache || data.from_db);

    } catch (err) {
        hideProgress();
        toast('Error: ' + err.message);
    }
}

async function uploadAndTranscribeFile(file) {
    showProgress('Uploading and processing file…');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res  = await fetch('/load-file', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentVidHash = data.vid_hash; 

        if (data.from_cache || data.from_db) {
            toast('✅ Loaded from database — no reprocessing needed!', 4000);
        } else {
            toast(`✅ Transcribed · Language: ${data.language}`);
        }

        await fetchAndRenderChunks();
        renderSummary(data.summary, data.from_cache || data.from_db);

    } catch (err) {
        hideProgress();
        toast('Error: ' + err.message);
    }
}

async function fetchAndRenderChunks() {
    const res  = await fetch('/export-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vid_hash: currentVidHash })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    segments = data.chunks.map((c, i) => ({
        start: c.start, end: c.end,
        speaker: `Segment ${i + 1}`,
        text: c.text
    }));

    hideProgress();
    showTranscript();
}

// ── LIBRARY (saved videos) ────────────────────────────
async function loadLibrary() {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;
    grid.innerHTML = '<p class="library-loading">Loading library…</p>';
    try {
        const res = await fetch('/library');
        const data = await res.json();
        const vids = data.videos || [];
        if (!vids.length) {
            grid.innerHTML = '<p class="library-empty">No saved videos yet. Transcribe one above.</p>';
            setTimeout(scrollReveal, 50);
            return;
        }
        grid.innerHTML = vids.map((v) => {
            const titleText = (v.title || v.summary_preview || 'Untitled').trim() || 'Untitled';
            const srcAttr = String(v.thumbnail_url || '').replace(/"/g, '&quot;');
            const thumb = v.thumbnail_url
                ? `<img src="${srcAttr}" alt="" loading="lazy" />`
                : `<div class="library-card-placeholder" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M9 10l5 2.5L9 15v-5z" fill="currentColor" opacity="0.5"/></svg></div>`;
            const lang = v.language ? esc(v.language) : '—';
            const vh = JSON.stringify(v.vid_hash);
            return `
      <article class="library-card reveal" role="button" tabindex="0"
        onclick="selectLibraryVideo(${vh})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectLibraryVideo(${vh});}">
        <div class="library-card-thumb">${thumb}</div>
        <div class="library-card-body">
          <div class="library-card-title">${esc(titleText)}</div>
          <div class="library-card-meta">${lang}</div>
        </div>
      </article>`;
        }).join('');
        setTimeout(scrollReveal, 50);
    } catch (e) {
        grid.innerHTML = `<p class="library-empty">Could not load library (${esc(e.message)}).</p>`;
    }
}

async function selectLibraryVideo(vidHash) {
    if (!vidHash) return;
    currentVidHash = vidHash;
    showProgress('Loading from library…');
    try {
        const metaRes = await fetch('/video/' + encodeURIComponent(vidHash));
        const meta = await metaRes.json();
        if (!metaRes.ok) throw new Error(meta.error || 'Not found');
        await fetchAndRenderChunks();
        renderSummary(meta.summary, true);
        toast('Loaded from library');
        document.getElementById('upload-section').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        hideProgress();
        toast('Error: ' + err.message);
    }
}

// ── SUMMARY CARD ──────────────────────────────────────
function renderSummary(summaryText, fromCache) {
    const old = document.getElementById('summaryCard');
    if (old) old.remove();

    if (!summaryText) return;

    const card = document.createElement('div');
    card.id = 'summaryCard';
    card.className = 'summary-card reveal';
    card.innerHTML = `
      <div class="summary-header">
        <div class="summary-header-left">
          <div class="summary-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3h10M2 7h7M2 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="summary-title">AI Summary</span>
          ${fromCache ? '<span class="summary-cache-badge">from database</span>' : '<span class="summary-fresh-badge">just generated</span>'}
        </div>
        <button class="btn-copy-summary" onclick="copySummary()" title="Copy summary">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="3" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M5 3V2a1 1 0 011-1h5a1 1 0 011 1v8a1 1 0 01-1 1h-1" stroke="currentColor" stroke-width="1.3"/>
          </svg>
          Copy
        </button>
      </div>
      <div class="summary-body" id="summaryBody">${formatSummaryText(summaryText)}</div>
    `;

    const tc = document.getElementById('transcriptCard');
    tc.parentNode.insertBefore(card, tc.nextSibling);

    setTimeout(() => {
        card.classList.add('revealed');
        scrollReveal();
    }, 80);
}

function formatSummaryText(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^#{1,3}\s+(.+)$/gm, '<div class="sum-heading">$1</div>')
        .replace(/^\d+\.\s+\*\*(.+?)\*\*[:\s]*(.*)/gm, '<div class="sum-section"><span class="sum-num-label">$1</span><span class="sum-section-text">$2</span></div>')
        .replace(/^\d+\.\s+(.+)/gm, '<div class="sum-point"><span class="sum-dot">•</span><span>$1</span></div>')
        .replace(/^[-•]\s+(.+)/gm, '<div class="sum-point"><span class="sum-dot">•</span><span>$1</span></div>')
        .replace(/\n\n+/g, '</p><p>')
        .replace(/\n/g, '<br>');
}

function copySummary() {
    const body = document.getElementById('summaryBody');
    if (!body) return;
    navigator.clipboard.writeText(body.innerText)
        .then(() => toast('Summary copied!'))
        .catch(() => toast('Copy failed'));
}

// ── UI HELPERS ────────────────────────────────────────
function showProgress(msg) {
    document.getElementById('transcriptCard').style.display = 'none';
    const old = document.getElementById('summaryCard');
    if (old) old.remove();

    const pw = document.getElementById('progressWrap');
    const pf = document.getElementById('progressFill');
    const pl = document.getElementById('progressLabel');
    pw.style.display = 'block';
    pf.style.width   = '100%';
    pl.textContent   = msg;
}

function hideProgress() {
    document.getElementById('progressWrap').style.display = 'none';
}

function showTranscript() {
    renderTranscript();
    const tc = document.getElementById('transcriptCard');
    tc.style.display = 'block';
    tc.classList.add('reveal');
    setTimeout(() => tc.classList.add('revealed'), 50);
    scrollReveal();
}

// ── TRANSCRIPT RENDER ─────────────────────────────────
function renderTranscript() {
    const body = document.getElementById('tcBody');
    const meta = document.getElementById('tcMeta');

    body.innerHTML = segments.map((s, idx) => `
      <div class="t-seg" id="seg${idx}" onclick="activeSeg(${idx})">
        <span class="t-ts">${fmt(s.start)}</span>
        <div>
          <div class="t-sp" style="${currentView === 'words' ? 'display:none' : ''}">${esc(s.speaker)}</div>
          <span class="t-txt">${esc(s.text)}</span>
        </div>
      </div>`).join('');

    meta.textContent = `${segments.length} segments · ${wordCount(segments).toLocaleString()} words`;
}

function activeSeg(idx) {
    document.querySelectorAll('.t-seg').forEach(e => e.classList.remove('active'));
    const el = document.getElementById('seg' + idx);
    if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function setView(v) {
    currentView = v;
    document.getElementById('vWords').classList.toggle('active', v === 'words');
    document.getElementById('vSpeaker').classList.toggle('active', v === 'speaker');
    if (segments.length) renderTranscript();
}

function copyTranscript() {
    if (!segments.length) { toast('No transcript to copy yet.'); return; }
    const text = segments.map(s => `[${fmt(s.start)}] ${s.text}`).join('\n\n');
    navigator.clipboard.writeText(text)
        .then(() => toast('Transcript copied!'))
        .catch(() => toast('Copy failed — please select text manually.'));
}

function toggleExport() {
    exportOpen = !exportOpen;
    document.getElementById('exportMenu').style.display = exportOpen ? 'block' : 'none';
}

document.addEventListener('click', (e) => {
    if (exportOpen && !e.target.closest('.export-dropdown-wrap')) {
        exportOpen = false;
        document.getElementById('exportMenu').style.display = 'none';
    }
});

function exportAs(fmt_) {
    exportOpen = false;
    document.getElementById('exportMenu').style.display = 'none';
    if (!segments.length) { toast('Transcribe a video first to export.'); return; }

    let content  = '';
    const filename = `transcript.${fmt_.toLowerCase()}`;

    switch (fmt_) {
        case 'TXT':
            content = segments.map(s => `[${fmt(s.start)}] ${s.text}`).join('\n\n');
            break;
        case 'SRT':
            content = segments.map((s, i) => {
                const ts = t => {
                    const m = Math.floor(t / 60), sc = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
                    return `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
                };
                return `${i+1}\n${ts(s.start)} --> ${ts(s.end || s.start + 5)}\n${s.text}`;
            }).join('\n\n');
            break;
        case 'JSON':
            content = JSON.stringify({ segments: segments.map(s => ({ start: s.start, end: s.end, text: s.text })) }, null, 2);
            break;
        default:
            content = segments.map(s => `[${fmt(s.start)}]: ${s.text}`).join('\n\n');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    toast(`Downloading ${filename}…`);
}

function scrollToChat() {
    document.getElementById('chat-section').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => document.getElementById('chatInput').focus(), 600);
}


// ══════════════════════════════════════════
// CHAT (Smart Routing — source-aware)
// ══════════════════════════════════════════

const SOURCE_CONFIG = {
    rag:     { label: 'RAG · from transcript', color: 'var(--accent)',  icon: '🔍' },
    summary: { label: 'from summary',          color: 'var(--blue)',    icon: '📋' },
    llm:     { label: 'AI · general answer',    color: 'var(--green)',  icon: '🤖' },
};

function chatKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function useSuggestion(el) {
    document.getElementById('chatInput').value = el.textContent;
    sendChat();
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const msg   = input.value.trim();
    if (!msg) return;

    if (!currentVidHash) {
        toast('Please transcribe a video first!');
        return;
    }

    appendMsg('user', msg);
    input.value        = '';
    input.style.height = 'auto';
    chatHistory.push({ role: 'user', content: msg });

    const typingId = appendTyping();

    try {
        const res  = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                question: msg, 
                vid_hash: currentVidHash, 
                use_hyde: true 
            })
        });
        const data = await res.json();
        removeTyping(typingId);

        if (data.error) {
            appendMsg('ai', data.error, null);
        } else {
            let reply = data.answer;
            const ts = data.timestamp_s != null ? data.timestamp_s : 0;
            const ytAt = data.youtube_url ? youtubeWithStart(data.youtube_url, ts) : '';
            if (data.timestamp_label && ytAt) {
                reply += `<br><br><a href="${esc(ytAt)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;font-size:12px;">▶ Watch at ${esc(data.timestamp_label)}</a>`;
            } else if (data.timestamp_label) {
                reply += `<br><small style="opacity:0.6">📍 ${esc(data.timestamp_label)}</small>`;
            }

            if (data.source === 'rag' && data.rag_meta) {
                const rm = data.rag_meta;
                const ranges = Array.isArray(rm.snippet_ranges) ? rm.snippet_ranges : [];
                let metaHtml = '<div class="rag-meta-wrap">';
                if (rm.confidence_note) {
                    metaHtml += `<div class="rag-note">${esc(rm.confidence_note)}</div>`;
                }
                if (ranges.length) {
                    metaHtml += '<div class="rag-chips">' + ranges.map((r) =>
                        `<span class="rag-chip">${esc(fmt(r.start))}–${esc(fmt(r.end))}</span>`
                    ).join('') + '</div>';
                }
                metaHtml += '</div>';
                reply += metaHtml;
            }

            const msgDiv = appendMsg('ai', reply, data.source);
            chatHistory.push({ role: 'assistant', content: data.answer });

            if (data.source === 'rag' && data.youtube_url) {
                const videoId = getYouTubeId(data.youtube_url);
                if (videoId) {
                    const videoWrapper = document.createElement('div');
                    videoWrapper.style.cssText = "margin-top: 15px; border-radius: 10px; overflow: hidden; width: 100%; max-width: 480px; border: 1px solid var(--border2);";

                    videoWrapper.innerHTML = `
                        <div style="font-size: 11px; padding: 6px 12px; background: var(--bg3); color: var(--accent); font-family: 'JetBrains Mono', monospace; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border2);">
                            ▶ Reference Video Clip (${esc(fmt(ts))})
                        </div>
                        <iframe 
                            width="100%" height="250" 
                            src="https://www.youtube.com/embed/${videoId}?start=${Math.floor(Number(ts) || 0)}&autoplay=0" 
                            frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="display: block;">
                        </iframe>
                    `;

                    const bubbleWrap = msgDiv.querySelector('.msg-bubble-wrap');
                    if (bubbleWrap) {
                        bubbleWrap.appendChild(videoWrapper);
                    }

                    const container = document.getElementById('chatMessages');
                    container.scrollTop = container.scrollHeight;
                }
            }
        }
    } catch (err) {
        removeTyping(typingId);
        appendMsg('ai', 'Failed to connect to the server.', null);
    }
}

function appendMsg(role, text, source) {
    const container  = document.getElementById('chatMessages');
    const div        = document.createElement('div');
    div.className    = `chat-msg ${role}`;

    const avatarContent = role === 'ai'
        ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 3.5V8.5L6 11L1 8.5V3.5L6 1Z" fill="white"/></svg>'
        : 'U';

    const avatarClass = role === 'user' ? 'user-av' : 'ai-av';
    const bubbleClass = role === 'user' ? 'user-bubble' : 'ai-bubble';

    let sourceBadge = '';
    if (role === 'ai' && source && SOURCE_CONFIG[source]) {
        const cfg = SOURCE_CONFIG[source];
        sourceBadge = `<div class="msg-source-badge" style="border-color:${cfg.color};color:${cfg.color}">${cfg.icon} ${cfg.label}</div>`;
    }

    const formatted = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    div.innerHTML = `
      <div class="msg-avatar ${avatarClass}">${avatarContent}</div>
      <div class="msg-bubble-wrap">
        <div class="msg-bubble ${bubbleClass}">${formatted}</div>
        ${sourceBadge}
      </div>`;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function appendTyping() {
    const container = document.getElementById('chatMessages');
    const div       = document.createElement('div');
    div.className   = 'chat-msg ai';
    div.id          = 'typing_' + Date.now();
    div.innerHTML   = `
      <div class="msg-avatar ai-av"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 3.5V8.5L6 11L1 8.5V3.5L6 1Z" fill="white"/></svg></div>
      <div class="msg-bubble-wrap">
        <div class="msg-bubble ai-bubble">
          <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
        </div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div.id;
}

function removeTyping(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function clearChat() {
    chatHistory = [];
    document.getElementById('chatMessages').innerHTML = `
      <div class="chat-msg ai">
        <div class="msg-avatar ai-av"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 3.5V8.5L6 11L1 8.5V3.5L6 1Z" fill="white"/></svg></div>
        <div class="msg-bubble-wrap">
          <div class="msg-bubble ai-bubble">
            <p>Chat cleared. Ready for new questions!</p>
            <p style="margin-top:8px;opacity:0.7;font-size:12px">Transcribe a video above, then ask me anything.</p>
          </div>
        </div>
      </div>`;
}

// ── GENERATE (UI) ─────────────────────────────────────
function updateSpeed(val) {
    document.getElementById('speedVal').textContent = (Math.round(val) / 100).toFixed(1) + '×';
}

function setAudioFmt(f) {
    audioFmt = f;
    document.getElementById('fmtMp3').classList.toggle('active', f === 'mp3');
    document.getElementById('fmtWav').classList.toggle('active', f === 'wav');
    document.getElementById('audioFileName').textContent = `narration.${f}`;
}

function generateMedia(type) {
    if (generating[type]) return;
    generating[type] = true;
    const btnId = type === 'video' ? 'genVideoBtn' : 'genAudioBtn';
    const dlId  = type === 'video' ? 'videoDownload' : 'audioDownload';
    const btn   = document.getElementById(btnId);
    const orig  = btn.innerHTML;

    btn.disabled  = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="animation:spin 1s linear infinite"><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.41 1.41M9.66 9.66l1.41 1.41M2.93 11.07l1.41-1.41M9.66 4.34l1.41-1.41" stroke="white" stroke-width="1.3" stroke-linecap="round"/></svg> Generating…`;

    if (!document.getElementById('_spinStyle')) {
        const s = document.createElement('style');
        s.id = '_spinStyle';
        s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(s);
    }

    setTimeout(() => {
        btn.disabled  = false;
        btn.innerHTML = orig;
        generating[type] = false;
        const dl = document.getElementById(dlId);
        dl.style.display = 'flex';
        dl.style.flexDirection = 'column';
        toast(`${type === 'video' ? 'Video' : 'Audio'} ready to download!`);
    }, 2500);
}

function triggerDownload(type) {
    toast(`Downloading ${type === 'video' ? 'output_captioned.mp4' : `narration.${audioFmt}`}…`);
}

// ── SCROLL REVEAL ─────────────────────────────────────
function scrollReveal() {
    const items = document.querySelectorAll('.reveal:not(.revealed)');
    if (!items.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = parseInt(entry.target.dataset.delay || '0', 10);
                setTimeout(() => entry.target.classList.add('revealed'), delay);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    items.forEach(el => observer.observe(el));
}

// ── INIT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    scrollReveal();
    loadLibrary();
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => setTimeout(scrollReveal, 200));
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exportOpen) {
        exportOpen = false;
        document.getElementById('exportMenu').style.display = 'none';
    }
});