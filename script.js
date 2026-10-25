(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const files = { html: null, css: null, js: null };
  let active = 'html',
    sig = '',
    timer;

  /* ---------- pomocné funkce ---------- */
  function toast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type || 'ok') + ' show';
    clearTimeout(timer);
    timer = setTimeout(() => t.classList.remove('show'), 5500);
  }
  const bytes = s => new Blob([s]).size;
  const kb = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' kB';
  const lines = s => s ? s.split('\n').length : 0;

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function safeName(v, def, ext) {
    v = (v || '').trim().replace(/\\/g, '/').replace(/[<>:"|?*\u0000-\u001f]/g, '');
    v = v.split('/').filter(p => p && p !== '.' && p !== '..').join('/') || def;
    return /\.[a-z0-9]+$/i.test(v) ? v : v + '.' + ext;
  }

  function names() {
    const n = {
      html: safeName($('htmlFileName').value, 'index.html', 'html').split('/').pop(),
      css: safeName($('cssFileName').value, 'style.css', 'css'),
      js: safeName($('jsFileName').value, 'script.js', 'js'),
      zip: safeName($('zipFileName').value, 'projekt.zip', 'zip').split('/').pop()
    };
    if (new Set([n.html, n.css, n.js].map(x => x.toLowerCase())).size < 3) {
      toast('Názvy HTML, CSS a JS souboru musí být navzájem různé.', 'err');
      return null;
    }
    return n;
  }
  const signature = () => [$('input').value, $('htmlFileName').value, $('cssFileName').value, $('jsFileName').value, $('dedent').checked, $('fmtOut').checked, $('fmtIndent').value, $('fmtWrap').value].join('\u0001');

  /* ---------- jádro: rozdělení projektu ---------- */
  function dedent(t) {
    t = t.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
    const L = t.split('\n');
    let min = Infinity;
    for (const l of L)
      if (l.trim()) min = Math.min(min, l.match(/^[ \t]*/)[0].length);
    if (!isFinite(min) || min === 0) return L.join('\n');
    return L.map(l => l.slice(Math.min(min, l.match(/^[ \t]*/)[0].length))).join('\n');
  }

  function attr(a, n) {
    const r = a.match(new RegExp('(?:^|\\s)' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
    return r ? (r[1] !== undefined ? r[1] : r[2] !== undefined ? r[2] : r[3]) : null;
  }
  const ATTRS = '((?:"[^"]*"|\'[^\']*\'|[^\'">])*)';
  const CLASSIC = /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/i;

  function splitProject(src, n, doDedent) {
    const cleanup = t => doDedent ? dedent(t) : t.replace(/\r\n?/g, '\n').trim();
    /* pořadí: komentář | <style> | <script> – komentáře se přeskočí beze změny */
    const re = new RegExp('<' + '!--[\\s\\S]*?--' + '>|([ \\t]*)<style\\b' + ATTRS + '>([\\s\\S]*?)<\\/style\\s*>[ \\t]*\\r?\\n?|([ \\t]*)<script\\b' + ATTRS + '>([\\s\\S]*?)<\\/script\\s*>[ \\t]*\\r?\\n?', 'gi');
    const css = [],
      js = [];
    let kept = 0,
      linkPlaced = false;
    const TOKEN = '\u0001CSSLINK\u0001';

    let out = src.replace(re, (m, si, sa, sb, ji, ja, jb) => {
      if (m.charAt(1) === '!') return m; // komentář
      if (sa !== undefined) { // <style>
        const body = cleanup(sb);
        if (!body) return '';
        const media = (attr(sa, 'media') || '').trim();
        css.push(media && media.toLowerCase() !== 'all' ? '@media ' + media + ' {\n' + body.replace(/^/gm, '  ') + '\n}' : body);
        if (linkPlaced) return '';
        linkPlaced = true;
        return si + TOKEN;
      }
      if (/\ssrc\s*=/i.test(' ' + ja)) return m; // externí skript
      const type = (attr(ja, 'type') || '').trim();
      if (type && !CLASSIC.test(type)) { kept++; return m; } // module, JSON-LD, importmap, šablony…
      const body = cleanup(jb);
      if (body) js.push(body);
      return '';
    });

    if (linkPlaced) out = out.replace(TOKEN, () => '<link rel="stylesheet" href="' + n.css + '">\n');
    if (js.length) {
      const tag = '<scr' + 'ipt src="' + n.js + '"></scr' + 'ipt>\n';
      const i = out.toLowerCase().lastIndexOf('</body');
      if (i >= 0) {
        const before = out.slice(0, i).replace(/[ \t]*$/, '');
        const prev = before.replace(/\s+$/, '').split('\n').pop();
        const ind = prev.match(/^[ \t]*/)[0] || '  ';
        out = before + (before.endsWith('\n') ? '' : '\n') + ind + tag + out.slice(i);
      } else out = out.replace(/\s*$/, '\n') + tag;
    }
    return { html: out.replace(/\r\n?/g, '\n').trim() + '\n', css: css.join('\n\n') + (css.length ? '\n' : ''), js: js.join('\n\n') + (js.length ? '\n' : ''), nCss: css.length, nJs: js.length, kept };
  }

  /* ---------- formátování ---------- */
  function fmtOpts() {
    const i = $('fmtIndent').value;
    return { tab: i === 'tab', size: parseInt(i, 10) || 2, wrap: parseInt($('fmtWrap').value, 10) || 0 };
  }

  function detect(s) {
    const t = s.trim();
    if (/^<(?:!doctype|html|head|body|[a-z][\w-]*[\s>\/])/i.test(t)) return 'html';
    if (/^(?:@[\w-]+[^{;]*[{;]|[^{};()=]+\{)/.test(t) && !/\b(?:function|const|let|var|return|class)\b|=>/.test(t)) return 'css';
    return 'js';
  }

  function beautify(code, lang) {
    if (typeof js_beautify === 'undefined' || typeof css_beautify === 'undefined' || typeof html_beautify === 'undefined') {
      throw new Error('Knihovna pro formátování se nenačetla. Zkontroluj připojení k internetu.');
    }
    const o = fmtOpts();
    const base = { indent_size: o.size, indent_char: o.tab ? '\t' : ' ', indent_with_tabs: o.tab, wrap_line_length: o.wrap, preserve_newlines: true, max_preserve_newlines: 2, end_with_newline: true, eol: '\n' };
    if (lang === 'css') return css_beautify(code, Object.assign({ newline_between_rules: true }, base));
    if (lang === 'html') return html_beautify(code, Object.assign({ indent_inner_html: true }, base));
    return js_beautify(code, Object.assign({ brace_style: 'collapse,preserve-inline' }, base));
  }
  const LANG = { html: 'HTML', css: 'CSS', js: 'JavaScript' };

  function formatInput() {
    const v = $('input').value;
    if (!v.trim()) { toast('Vlož kód, který chceš zformátovat.', 'err'); return; }
    const sel = $('fmtLang').value,
      lang = sel === 'auto' ? detect(v) : sel;
    try {
      $('input').value = beautify(v, lang);
      countUpdate();
      ledRun();
      toast('Zformátováno jako ' + LANG[lang] + '.', 'ok');
    } catch (e) { console.error(e);
      toast('Chyba při formátování: ' + e.message, 'err'); }
  }

  function formatOutput() {
    const f = files[active];
    if (!f) return;
    try { f.text = beautify(f.text, active);
      render();
      toast('Zformátováno: ' + f.name, 'ok'); } catch (e) { console.error(e);
      toast('Chyba při formátování: ' + e.message, 'err'); }
  }

  /* ---------- zobrazení ---------- */
  const TAB = { html: ['tHtml', 'mHtml', 'Žádný HTML kód.'], css: ['tCss', 'mCss', '/* Ve vstupu nebyl žádný vložený CSS kód. */'], js: ['tJs', 'mJs', '// Ve vstupu nebyl žádný vložený JavaScript.'] };

  function render() {
    for (const k in TAB) {
      const f = files[k];
      $(TAB[k][0]).textContent = f ? f.name : ({ html: 'index.html', css: 'style.css', js: 'script.js' })[k];
      $(TAB[k][1]).textContent = f ? lines(f.text) + ' řádků · ' + kb(bytes(f.text)) : 'prázdné';
    }
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.k === active)));
    const f = files[active];
    $('view').textContent = f ? f.text : TAB[active][2];
    $('bCopy').disabled = $('bOne').disabled = $('bFmtOne').disabled = !f;
  }

  function ledRun() {
    const l = $('leds');
    l.classList.remove('run');
    void l.offsetWidth;
    l.classList.add('run');
  }

  /* ---------- akce ---------- */
  function run(quiet) {
    const src = $('input').value;
    if (!src.trim()) { toast('Vlož HTML kód nebo načti soubor.', 'err'); return false; }
    const n = names();
    if (!n) return false;
    try {
      const r = splitProject(src, n, $('dedent').checked);
      let fmtErr = '';
      if ($('fmtOut').checked) {
        try {
          r.html = beautify(r.html, 'html');
          if (r.css) r.css = beautify(r.css, 'css');
          if (r.js) r.js = beautify(r.js, 'js');
        } catch (e) { fmtErr = e.message; }
      }
      files.html = { name: n.html, text: r.html };
      files.css = r.css ? { name: n.css, text: r.css } : null;
      files.js = r.js ? { name: n.js, text: r.js } : null;
      if (!files[active]) active = 'html';
      sig = signature();
      render();
      if (!quiet) {
        ledRun();
        const parts = ['Hotovo: vyjmuto ' + r.nCss + '× CSS a ' + r.nJs + '× JS.'];
        if (r.kept) parts.push('Ponecháno ' + r.kept + ' skriptů typu module / JSON / šablona.');
        if (fmtErr) parts.push('Formátování se nepovedlo (soubory zůstaly neformátované): ' + fmtErr);
        toast(parts.join(' '), fmtErr ? 'err' : r.nCss || r.nJs ? 'ok' : 'info');
      }
      return true;
    } catch (e) {
      console.error(e);
      toast('Chyba při rozdělování: ' + e.message, 'err');
      return false;
    }
  }
  async function makeZip() {
    if (typeof JSZip === 'undefined') { toast('Knihovna JSZip se nenačetla. Zkontroluj připojení k internetu.', 'err'); return; }
    if (!(files.html && sig === signature()) && !run(true)) return;
    const n = names();
    if (!n) return;
    const b = $('bZip');
    b.disabled = true;
    try {
      const z = new JSZip();
      for (const k in files)
        if (files[k]) z.file(files[k].name, files[k].text);
      saveBlob(await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }), n.zip);
      toast('ZIP „' + n.zip + '“ je stažený.', 'ok');
    } catch (e) {
      console.error(e);
      toast('Chyba při tvorbě ZIPu: ' + e.message, 'err');
    } finally { b.disabled = false; }
  }
  async function readFile(f) {
    if (!f) return;
    try {
      $('input').value = await f.text();
      if (/\.html?$/i.test(f.name)) $('htmlFileName').value = f.name;
      countUpdate();
      toast('Načteno: ' + f.name, 'info');
    } catch (e) { toast('Soubor se nepodařilo přečíst: ' + e.message, 'err'); }
  }

  function countUpdate() {
    const v = $('input').value;
    $('count').textContent = v ? lines(v) + ' řádků · ' + kb(bytes(v)) : 'Pole je prázdné.';
  }

  /* ---------- události ---------- */
  for (let i = 0; i < 18; i++) { const s = document.createElement('i');
    s.style.setProperty('--i', i);
    $('leds').appendChild(s); }
  $('bSplit').addEventListener('click', () => run(false));
  $('bZip').addEventListener('click', makeZip);
  $('bLoad').addEventListener('click', () => $('file').click());
  $('bFmt').addEventListener('click', formatInput);
  $('bFmtOne').addEventListener('click', formatOutput);
  $('file').addEventListener('change', e => { readFile(e.target.files[0]);
    e.target.value = ''; });
  $('bClear').addEventListener('click', () => {
    $('input').value = '';
    files.html = files.css = files.js = null;
    active = 'html';
    sig = '';
    countUpdate();
    render();
    toast('Vše vyčištěno.', 'info');
  });
  $('input').addEventListener('input', countUpdate);
  $('input').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault();
      run(false); } });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { active = t.dataset.k;
    render(); }));
  $('bCopy').addEventListener('click', async () => {
    const f = files[active];
    if (!f) return;
    try { await navigator.clipboard.writeText(f.text);
      toast('Zkopírováno: ' + f.name, 'ok'); } catch (e) { toast('Kopírování se nepovedlo. Označ text ručně a zkopíruj ho.', 'err'); }
  });
  $('bOne').addEventListener('click', () => {
    const f = files[active];
    if (f) saveBlob(new Blob([f.text], { type: 'text/plain;charset=utf-8' }), f.name);
  });
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault();
    $('input').classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault();
    $('input').classList.remove('drag'); }));
  document.addEventListener('drop', e => readFile(e.dataTransfer && e.dataTransfer.files[0]));

  countUpdate();
  render();
})();
