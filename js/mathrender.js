/**
 * SIBER-UJIAN — mathrender.js
 * Menampilkan rumus matematika (LaTeX) di teks soal dan pilihan jawaban.
 *
 * Penulisan rumus di Google Sheets:
 *   $x^2 + 3x$            rumus di dalam kalimat
 *   $$\frac{a}{b}$$       rumus di baris sendiri (tengah)
 *   \( ... \)  dan  \[ ... \]   juga didukung
 *   \$                    tanda dolar biasa (bukan rumus)
 *
 * Catatan teknis:
 *  - Memakai KaTeX yang disimpan lokal di vendor/katex (tanpa CDN), sehingga tetap jalan OFFLINE
 *    dan sesuai Content-Security-Policy (script-src 'self'; style-src 'self').
 *  - KaTeX menghasilkan atribut style="..." di HTML-nya. CSP memblokir atribut itu,
 *    jadi atribut diganti sebelum diurai, lalu gayanya dipasang lewat CSSOM (element.style.setProperty).
 *  - Teks biasa selalu dimasukkan sebagai text node (bukan innerHTML), jadi aman dari injeksi HTML.
 *  - Jika KaTeX gagal dimuat, teks ditampilkan apa adanya (soal tetap bisa dikerjakan).
 */
const MathRender = (function () {
  'use strict';

  /* ---------- 1. Memecah teks menjadi bagian biasa dan bagian rumus ---------- */

  function findClose(text, from, closer) {
    for (let j = from; j < text.length; j++) {
      const c = text.charAt(j);
      if (c === '\\') { // lewati karakter yang di-escape, mis. \$ atau \\
        if (closer === '\\)' || closer === '\\]') {
          if (text.charAt(j + 1) === closer.charAt(1)) return j;
        }
        j++;
        continue;
      }
      if (closer === '$$' && c === '$' && text.charAt(j + 1) === '$') return j;
      if (closer === '$' && c === '$') {
        if (text.charAt(j + 1) === '$') { j++; continue; }
        return j;
      }
      if (closer === '$' && c === '\n' && text.charAt(j + 1) === '\n') return -1; // tidak lintas paragraf
    }
    return -1;
  }

  function tokenize(text) {
    const out = [];
    let buf = '';
    let i = 0;

    function flush() {
      if (buf) { out.push({ type: 'text', value: buf }); buf = ''; }
    }

    while (i < text.length) {
      const c = text.charAt(i);
      const n = text.charAt(i + 1);

      if (c === '\\' && n === '$') { buf += '$'; i += 2; continue; }

      if (c === '\\' && (n === '(' || n === '[')) {
        const closer = n === '(' ? '\\)' : '\\]';
        const end = findClose(text, i + 2, closer);
        if (end > i + 2) {
          flush();
          out.push({ type: 'math', value: text.slice(i + 2, end), display: n === '[', raw: text.slice(i, end + 2) });
          i = end + 2;
          continue;
        }
      }

      if (c === '$') {
        if (n === '$') {
          const end = findClose(text, i + 2, '$$');
          if (end > i + 2) {
            flush();
            out.push({ type: 'math', value: text.slice(i + 2, end), display: true, raw: text.slice(i, end + 2) });
            i = end + 2;
            continue;
          }
          buf += '$$'; i += 2; continue;
        }
        // $...$ : tanda buka tidak diikuti spasi; tanda tutup tidak didahului spasi dan tidak diikuti angka
        // (supaya "harga $5 dan $10" tidak dianggap rumus)
        if (n && !/\s/.test(n)) {
          const end = findClose(text, i + 1, '$');
          if (end > i + 1 && !/\s/.test(text.charAt(end - 1)) && !/[0-9]/.test(text.charAt(end + 1))) {
            flush();
            out.push({ type: 'math', value: text.slice(i + 1, end), display: false, raw: text.slice(i, end + 1) });
            i = end + 1;
            continue;
          }
        }
      }

      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /* ---------- 2. Merender satu rumus menjadi node DOM yang patuh CSP ---------- */

  function applyInlineStyle(node, cssText) {
    cssText.split(';').forEach(function (decl) {
      const k = decl.indexOf(':');
      if (k < 1) return;
      const name = decl.slice(0, k).trim();
      const value = decl.slice(k + 1).trim();
      if (name && value) node.style.setProperty(name, value);
    });
  }

  function renderMathNode(tex, display) {
    const html = window.katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    });

    // Ganti style="..." menjadi data-ks="..." SEBELUM diurai, supaya browser tidak pernah
    // melihat atribut style (yang diblokir CSP). Lalu gaya dipasang lewat CSSOM.
    const safe = html.replace(/\sstyle="([^"]*)"/g, ' data-ks="$1"');
    const parsed = new DOMParser().parseFromString(safe, 'text/html');

    const frag = document.createDocumentFragment();
    Array.prototype.forEach.call(parsed.body.childNodes, function (n) {
      frag.appendChild(document.importNode(n, true));
    });
    frag.querySelectorAll('[data-ks]').forEach(function (n) {
      applyInlineStyle(n, n.getAttribute('data-ks'));
      n.removeAttribute('data-ks');
    });
    return frag;
  }

  /* ---------- 3. Fungsi utama ---------- */

  /** Mengisi elemen dengan teks; bagian rumus dirender, sisanya tetap teks biasa. */
  function render(target, text) {
    const str = text == null ? '' : String(text);
    const kids = [];

    if (!window.katex || str.indexOf('$') === -1 && str.indexOf('\\(') === -1 && str.indexOf('\\[') === -1) {
      target.textContent = str.replace(/\\\$/g, '$');
      return;
    }

    tokenize(str).forEach(function (t) {
      if (t.type === 'text') {
        kids.push(document.createTextNode(t.value));
        return;
      }
      try {
        kids.push(renderMathNode(t.value, t.display));
      } catch (e) {
        const raw = t.display ? '$$' + t.value + '$$' : '$' + t.value + '$';
        kids.push(document.createTextNode(raw));
      }
    });
    target.replaceChildren.apply(target, kids);
  }

  /**
   * Memotong teks sekitar n karakter TANPA memotong rumus di tengah-tengah
   * (memotong "$\\frac{a" akan merusak tampilan). Hasilnya tetap berupa teks LaTeX
   * yang bisa diberikan ke render().
   */
  function truncate(text, n) {
    const str = text == null ? '' : String(text);
    if (str.length <= n) return str;
    const toks = tokenize(str);
    let used = 0;
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'math') {
        if (used + t.raw.length > n && used > 0) return out + '…';
        out += t.raw;
        used += t.raw.length;
      } else {
        const room = n - used;
        if (t.value.length > room) {
          out += t.value.substring(0, Math.max(room - 1, 0)).replace(/\$/g, '\\$') + '…';
          return out;
        }
        out += t.value.replace(/\$/g, '\\$');
        used += t.value.length;
      }
    }
    return out;
  }

  return { render: render, tokenize: tokenize, truncate: truncate };
})();
