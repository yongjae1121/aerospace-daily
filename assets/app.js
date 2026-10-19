/* Aerospace Daily — 빌드 도구 없이 동작하는 정적 학습 사이트.
 * 데이터: window.COURSE (scripts/build.py가 data/course.js로 생성)
 * 진도: localStorage 'aerodaily.v1' (이 브라우저에만 저장, 설정에서 백업 가능)
 */
(() => {
  'use strict';

  const C = window.COURSE;
  const app = document.getElementById('app');
  if (!C) {
    app.innerHTML = '<div class="empty">강좌 데이터(data/course.js)를 불러오지 못했어요.<br>' +
      '<code>python scripts/build.py</code>를 실행했는지 확인하세요.</div>';
    return;
  }
  if (window.marked) marked.use({ gfm: true, breaks: false });

  /* ------------------------------------------------------------ utils */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
  const todayStr = () => ymd(new Date());
  const DOW = '일월화수목금토';
  const fmtDate = (s, dow = true) => { const d = parseDate(s); return `${d.getMonth() + 1}월 ${d.getDate()}일${dow ? ` (${DOW[d.getDay()]})` : ''}`; };
  const fmtShort = s => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sample = (a, n) => shuffle(a).slice(0, Math.max(0, n));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fmtNum = x => (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : String(+x.toPrecision(6)));

  /* ------------------------------------------------------------ store */
  const KEY = 'aerodaily.v1';
  const blank = () => ({ done: {}, quiz: {}, tests: [], vocab: {}, active: [], settings: { theme: 'system', rate: 0.9 } });
  function load() {
    const base = blank();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') return { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
    } catch (e) { /* 저장소를 쓸 수 없는 환경: 메모리에서만 동작 */ }
    return base;
  }
  let S = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ } };
  function touch() {
    const t = todayStr();
    if (!S.active.includes(t)) S.active.push(t);
    save();
  }
  function streak() {
    const set = new Set(S.active);
    let d = todayStr(), n = 0;
    if (!set.has(d)) d = addDays(d, -1);
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ------------------------------------------------------------ course model */
  const START = C.meta.start;
  const ALL = C.units.flatMap(u => u.lessons.map(l => ({ ...l, unit: u })));
  const BY_DAY = new Map(ALL.map(l => [l.day, l]));
  const TOTAL = ALL.length;
  const dateOf = day => addDays(START, day - 1);
  const curDay = () => daysBetween(START, todayStr()) + 1;
  const unlocked = day => day <= curDay();
  const data = day => C.lessons[String(day)] || null;
  const isDone = day => !!S.done[day];
  const unitNo = u => parseInt(u.id.slice(1), 10);
  const unitChip = u => `<span class="chip accent">${u.icon} ${unitNo(u)}단원 · ${esc(u.title)}</span>`;

  function vocabRange(from, to) {
    const out = [], seen = new Set();
    for (let d = 1; d <= Math.min(to, TOTAL); d++) {
      const L = data(d);
      if (!L) continue;
      for (const v of L.vocab) {
        const key = v.en.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (d >= from) out.push({ ...v, key, day: d });
      }
    }
    return out;
  }
  const openVocab = () => vocabRange(1, curDay());
  const INTERVALS = [0, 1, 3, 7, 16, 35];
  const vst = w => S.vocab[w.key] || null;
  const isDue = w => { const s = vst(w); return !s || s.due <= todayStr(); };
  const isMastered = w => (vst(w)?.box || 0) >= 4;

  function gradeWord(w, ok) {
    const s = S.vocab[w.key] || { box: 0 };
    s.box = ok ? Math.min((s.box || 0) + 1, 5) : 1;
    s.due = addDays(todayStr(), ok ? INTERVALS[s.box] : 1);
    s.seen = (s.seen || 0) + 1;
    S.vocab[w.key] = s;
    touch();
  }

  /* ------------------------------------------------------------ markdown + math */
  const CALLOUTS = {
    note: ['📌', '참고'], tip: ['💡', '팁'], warning: ['⚠️', '주의'], key: ['🔑', '핵심 정리'],
    fact: ['🔭', '알고 있나요?'], history: ['📜', '역사 이야기'], career: ['🎓', '진로 노트'],
    think: ['🤔', '생각해 보기'], example: ['✏️', '예제'],
  };

  function tex(src, display) {
    if (!window.katex) return `<code>${esc(src)}</code>`;
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
    } catch (e) {
      return `<span class="math-err">${esc(src)}</span>`;
    }
  }
  function protectMath(src, store) {
    return src
      .replace(/\\\$/g, 'KXDOLLARKX')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => { store.push([t, true]); return `KXM${store.length - 1}KX`; })
      .replace(/\$([^$\n]+?)\$/g, (_, t) => { store.push([t, false]); return `KXM${store.length - 1}KX`; });
  }
  function restoreMath(html, store) {
    return html
      .replace(/<p>\s*KXM(\d+)KX\s*<\/p>/g, (m, i) => (store[i][1] ? `<div class="math-display">${tex(store[i][0], true)}</div>` : m))
      .replace(/KXM(\d+)KX/g, (_, i) => (store[i][1] ? `<span class="math-display">${tex(store[i][0], true)}</span>` : tex(store[i][0], false)))
      .replace(/KXDOLLARKX/g, () => '$');
  }
  // 마크다운 결과 후처리: > [!TIP] 형식의 인용문을 강조 박스로 바꾸고, 표는 가로 스크롤 상자로 감싼다.
  function enhance(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    for (const t of box.querySelectorAll('table')) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.replaceWith(wrap);
      wrap.appendChild(t);
    }
    for (const bq of box.querySelectorAll('blockquote')) {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') continue;
      const m = p.innerHTML.match(/^\s*\[!(\w+)\][ \t]*([^\n<]*)/);
      if (!m) continue;
      const type = CALLOUTS[m[1].toLowerCase()] ? m[1].toLowerCase() : 'note';
      const [icon, label] = CALLOUTS[type];
      p.innerHTML = p.innerHTML.slice(m[0].length).replace(/^\s*(<br>)?\s*/, '');
      if (!p.innerHTML.trim()) p.remove();
      const aside = document.createElement('aside');
      aside.className = `callout c-${type}`;
      const title = m[2].trim();
      aside.innerHTML = `<div class="callout-head"><span class="callout-label">${icon} ${label}</span>${title ? `<span class="callout-title">${title}</span>` : ''}</div>`;
      while (bq.firstChild) aside.appendChild(bq.firstChild);
      bq.replaceWith(aside);
    }
    return box.innerHTML;
  }
  function md(src, inline = false) {
    const store = [];
    // '**양력(lift)**은'처럼 닫는 ** 앞이 문장부호이고 뒤가 한글이면 CommonMark는 굵게 처리하지 않으므로 미리 태그로 바꾼다.
    const s = protectMath(String(src ?? ''), store).replace(/\*\*(\S(?:[^*\n]*?\S)?)\*\*/g, '<strong>$1</strong>');
    let html;
    if (window.marked) html = inline ? marked.parseInline(s) : enhance(marked.parse(s));
    else html = inline ? esc(s) : s.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('');
    return restoreMath(html, store);
  }
  const paras = text => String(text).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  function highlightVocab(text, vocab) {
    const terms = vocab.map(v => v.en).sort((a, b) => b.length - a.length);
    if (!terms.length) return esc(text);
    const ko = new Map(vocab.map(v => [v.en.toLowerCase(), v.ko]));
    const alt = terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
    const re = new RegExp(`\\b(${alt})(?:s|es|ed|d|ing)?\\b`, 'gi');
    return esc(text).replace(re, (m, base) => {
      const k = ko.get(base.toLowerCase().replace(/\s+/g, ' ')) || '';
      return `<mark class="vw" tabindex="0" data-ko="${esc(k)}">${m}</mark>`;
    });
  }

  /* ------------------------------------------------------------ speech */
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let voices = [];
  if (canSpeak) {
    const loadVoices = () => { voices = speechSynthesis.getVoices(); };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function pickVoice() {
    const en = voices.filter(v => /^en[-_]/i.test(v.lang));
    return en.find(v => /en[-_]US/i.test(v.lang) && /natural|online|google|aria|jenny|samantha/i.test(v.name)) ||
      en.find(v => /en[-_]US/i.test(v.lang)) || en[0] || null;
  }
  function speak(text, onend) {
    if (!canSpeak) { toast('이 브라우저는 음성 읽기를 지원하지 않아요.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = S.settings.rate || 0.9;
    const v = pickVoice();
    if (v) u.voice = v;
    if (onend) { u.onend = onend; u.onerror = onend; }
    speechSynthesis.speak(u);
  }
  const SAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const sayBtn = (text, cls = '') => (canSpeak
    ? `<button class="say ${cls}" type="button" data-say="${esc(text)}" aria-label="발음 듣기: ${esc(text)}" title="발음 듣기">${SAY}</button>`
    : '');

  /* ------------------------------------------------------------ small UI helpers */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  const level = n => `<span class="level" title="난이도 ${n}/5" aria-label="난이도 ${n}/5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const bar = (p, cls = '') => `<div class="bar ${cls}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, Math.max(0, p))}%"></i></div>`;

  let disposers = [];
  const onCleanup = fn => disposers.push(fn);
  function cleanup() {
    disposers.forEach(fn => { try { fn(); } catch (e) { /* 무시 */ } });
    disposers = [];
    $('#readProgress').hidden = true;
  }

  /* ------------------------------------------------------------ questions */
  const TYPE_LABEL = { mc: '객관식', ox: 'O / X', num: '계산' };

  function qHTML(q, i, tag = '', withCheck = false) {
    let body;
    if (q.type === 'mc') {
      body = `<div class="opts">${q.choices.map((c, j) =>
        `<button type="button" class="opt" data-i="${j}"><span class="mk">${j + 1}</span><span>${md(c, true)}</span></button>`).join('')}</div>`;
    } else if (q.type === 'ox') {
      body = '<div class="opts ox"><button type="button" class="opt" data-i="1">O</button><button type="button" class="opt" data-i="0">X</button></div>';
    } else {
      body = `<div class="num-row"><input type="text" inputmode="decimal" autocomplete="off" placeholder="숫자로 입력" aria-label="답 입력">` +
        `${q.unit ? `<span class="unit">${esc(q.unit)}</span>` : ''}` +
        `${withCheck ? '<button type="button" class="btn small" data-check>확인</button>' : ''}</div>`;
    }
    return `<div class="card q" data-q="${i}"><div class="q-head"><span class="q-num">Q${i + 1}</span>` +
      `<span class="chip">${TYPE_LABEL[q.type]}</span>${tag}</div><div class="q-text">${md(q.q)}</div>${body}<div class="explain" hidden></div></div>`;
  }
  function parseNum(s) {
    const t = String(s).trim().replace(/[−–]/g, '-').replace(/[,\s]/g, '').replace(/[×xX*]10\^/, 'e');
    return t ? Number(t) : NaN;
  }
  function isRight(q, ans) {
    if (q.type === 'num') {
      const x = parseNum(ans);
      if (!Number.isFinite(x)) return false;
      const tol = q.tol ?? 0.02;
      return q.answer === 0 ? Math.abs(x) <= tol : Math.abs(x - q.answer) <= Math.abs(q.answer) * tol;
    }
    return ans === q.answer;
  }
  function correctText(q) {
    if (q.type === 'num') return `정답: ${fmtNum(q.answer)}${q.unit ? ` ${esc(q.unit)}` : ''}`;
    if (q.type === 'ox') return `정답: ${q.answer ? 'O' : 'X'}`;
    return `정답: ${q.answer + 1}번`;
  }
  function reveal(card, q, right) {
    const opts = $$('.opt', card);
    opts.forEach(b => { b.disabled = true; });
    if (q.type === 'num') {
      const inp = $('input', card);
      inp.disabled = true;
      inp.classList.add(right ? 'right' : 'wrong');
      $('[data-check]', card)?.remove();
    } else {
      const ci = q.type === 'ox' ? (q.answer ? '1' : '0') : String(q.answer);
      opts.forEach(b => {
        if (b.dataset.i === ci) b.classList.add('right');
        else if (b.classList.contains('sel')) b.classList.add('wrong');
      });
    }
    const ex = $('.explain', card);
    ex.innerHTML = `<div class="verdict ${right ? 'right' : 'wrong'}">${right ? '정답이에요! 👏' : '아쉬워요'} <span class="muted">— ${correctText(q)}</span></div>${md(q.explain)}`;
    ex.hidden = false;
  }
  function shuffledChoices(q) {
    if (q.type !== 'mc') return q;
    const perm = shuffle(q.choices.map((_, i) => i));
    return { ...q, choices: perm.map(i => q.choices[i]), answer: perm.indexOf(q.answer) };
  }

  /* ------------------------------------------------------------ router */
  const ROUTES = [
    [/^#\/?$/, () => home(), 'home'],
    [/^#\/lesson\/(\d+)$/, m => lessonPage(+m[1]), 'roadmap'],
    [/^#\/roadmap$/, () => roadmap(), 'roadmap'],
    [/^#\/vocab$/, () => vocabPage(), 'vocab'],
    [/^#\/vocab\/review$/, () => reviewPage(), 'vocab'],
    [/^#\/tests$/, () => testsPage(), 'tests'],
    [/^#\/test\/([\w-]+)$/, m => testPage(m[1]), 'tests'],
    [/^#\/settings$/, () => settingsPage(), 'settings'],
  ];
  function route() {
    const h = location.hash || '#/';
    if (canSpeak) speechSynthesis.cancel();
    cleanup();
    for (const [re, fn, tab] of ROUTES) {
      const m = h.match(re);
      if (!m) continue;
      $$('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
      window.scrollTo(0, 0);
      fn(m);
      return;
    }
    location.replace('#/');
  }

  /* ------------------------------------------------------------ home */
  function todayCard(day) {
    const l = BY_DAY.get(day), L = data(day);
    const head = `<div class="unit-line">${unitChip(l.unit)}<span class="chip">Day ${day}</span>${isDone(day) ? '<span class="chip ok">✓ 완료</span>' : ''}</div>`;
    if (!L) {
      return `<div class="card today pending">${head}<h2>${esc(l.title)}</h2><p class="title-en">${esc(l.title_en)}</p>
        <p class="summary">오늘 강좌를 준비하고 있어요. 새 강좌는 매일 새벽 자동으로 작성되어 올라옵니다. 그동안 단어를 복습하거나 지난 강좌를 다시 읽어 보세요.</p></div>`;
    }
    return `<div class="card today">${head}
      <h2>${esc(L.title)}</h2><p class="title-en">${esc(L.title_en)}</p>
      <p class="summary">${md(L.summary, true)}</p>
      <div class="meta"><span>⏱ ${L.minutes}분</span><span>난이도 ${level(L.level)}</span><span>단어 ${L.vocab.length}개</span><span>문제 ${L.quiz.length}개</span></div>
      <div class="btn-row"><a class="btn primary" href="#/lesson/${day}">${isDone(day) ? '다시 보기' : '강좌 시작하기'} →</a></div></div>`;
  }

  function home() {
    const cd = curDay();
    const t = todayStr();
    const day = Math.min(Math.max(cd, 1), TOTAL);
    const words = openVocab();
    const due = words.filter(isDue).length;
    const mastered = words.filter(isMastered).length;
    const quizzes = Object.values(S.quiz);
    const qs = quizzes.reduce((a, q) => a + q.score, 0), qt = quizzes.reduce((a, q) => a + q.total, 0);
    const avail = ALL.filter(l => unlocked(l.day) && data(l.day)).length;

    let hero;
    if (cd < 1) {
      hero = `<div class="hero-top"><div><div class="eyebrow">D-${1 - cd} · 코스 시작 ${fmtDate(START)}</div><h1>곧 첫 강좌가 열려요</h1></div></div>${todayCard(1)}`;
    } else if (cd > TOTAL) {
      hero = `<div class="hero-top"><div><div class="eyebrow">Day ${cd} · ${fmtDate(t)}</div><h1>커리큘럼 완주! 🎉</h1></div></div>
        <div class="card today"><p class="summary">준비된 ${TOTAL}개 강좌를 모두 열었어요. 새 단원이 추가되면 여기에 나타납니다. 그동안 단어 복습과 테스트로 실력을 다져 보세요.</p></div>`;
    } else {
      hero = `<div class="hero-top"><div><div class="eyebrow">Day ${cd} · ${fmtDate(t)}</div><h1>오늘의 강좌</h1></div>
        <a class="btn ghost small" href="#/roadmap">전체 로드맵 →</a></div>${todayCard(day)}`;
    }

    const stats = `<div class="stats">
      <div class="card stat"><div class="k">🔥 연속 학습</div><div class="v">${streak()}<small>일</small></div></div>
      <div class="card stat"><div class="k">📚 완료한 강좌</div><div class="v">${Object.keys(S.done).length}<small>/ ${avail}</small></div></div>
      <div class="card stat"><div class="k">🔤 외운 단어</div><div class="v">${mastered}<small>/ ${words.length}</small></div></div>
      <div class="card stat"><div class="k">🎯 퀴즈 정답률</div><div class="v">${qt ? pct(qs, qt) : '–'}<small>${qt ? '%' : ''}</small></div></div></div>`;

    // 오늘 할 일
    const todos = [];
    if (cd >= 1 && cd <= TOTAL && data(day)) {
      todos.push({ href: `#/lesson/${day}`, done: isDone(day), t: `오늘의 강좌 읽기 — Day ${day}`, s: `${data(day).minutes}분` });
    }
    if (words.length) todos.push({ href: '#/vocab/review', done: due === 0, t: '영단어 복습', s: due ? `${due}개 대기 중` : '오늘 분량 끝!' });
    const pendingTest = allTests().find(x => x.open() && x.kind !== 'practice' && !bestScore(x.id) && x.build && hasLessons(x));
    if (pendingTest) todos.push({ href: `#/test/${pendingTest.id}`, done: false, t: `${pendingTest.title} 보기`, s: pendingTest.sub });
    const missed = ALL.filter(l => l.day < cd && data(l.day) && !isDone(l.day));
    if (missed.length) todos.push({ href: `#/lesson/${missed[0].day}`, done: false, t: `밀린 강좌 ${missed.length}개`, s: `Day ${missed[0].day}부터` });
    const todoHTML = todos.length ? `<div class="todo-list">${todos.map(x =>
      `<a class="card todo-item ${x.done ? 'done' : ''}" href="${x.href}"><span class="check">✓</span><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s)}</span></a>`).join('')}</div>` : '';

    // 이번 주
    let week = '';
    if (cd >= 1 && cd <= TOTAL) {
      const w = Math.ceil(day / 7), from = (w - 1) * 7 + 1, to = Math.min(w * 7, TOTAL);
      const cells = [];
      for (let d = from; d <= to; d++) {
        const ds = dateOf(d), open = unlocked(d), cls = [isDone(d) ? 'done' : '', d === cd ? 'today-cell' : '', open ? '' : 'locked'].join(' ');
        const inner = `<span class="d">D${d}</span><span class="w">${DOW[parseDate(ds).getDay()]} ${fmtShort(ds)}</span><span class="dot"></span>`;
        cells.push(open && data(d) ? `<a class="${cls}" href="#/lesson/${d}" title="${esc(BY_DAY.get(d).title)}">${inner}</a>` : `<span class="cell ${cls}">${inner}</span>`);
      }
      const wt = allTests().find(x => x.id === `w${w}`);
      if (wt) {
        const inner = `<span class="d">TEST</span><span class="w">${fmtShort(dateOf(wt.to))}</span><span class="dot"></span>`;
        cells.push(wt.open() ? `<a class="test-cell" href="#/test/${wt.id}">${inner}</a>` : `<span class="cell test-cell locked">${inner}</span>`);
      }
      week = `<section class="section"><div class="section-head"><h2>${w}주차 진도</h2><span class="more">Day ${from}–${to}</span></div><div class="week">${cells.join('')}</div></section>`;
    }

    // 다가오는 강좌
    const next = ALL.filter(l => l.day > cd).slice(0, 3);
    const upcoming = next.length ? `<section class="section"><div class="section-head"><h2>다가오는 강좌</h2><a class="more" href="#/roadmap">로드맵 보기</a></div>
      <div class="upcoming">${next.map(l => `<div class="card row"><span class="dd">${fmtShort(dateOf(l.day))} · D${l.day}</span><span class="tt">${esc(l.title)}<small>${esc(l.title_en)}</small></span></div>`).join('')}</div></section>` : '';

    app.innerHTML = `<section class="hero">${hero}</section>
      <section class="section">${stats}</section>
      ${todoHTML ? `<section class="section"><div class="section-head"><h2>오늘 할 일</h2></div>${todoHTML}</section>` : ''}
      ${week}${upcoming}`;
  }

  /* ------------------------------------------------------------ lesson */
  function lockedBox(icon, title, text, extra = '') {
    return `<div class="card locked-box"><div class="ico">${icon}</div><h2>${title}</h2><p class="muted">${text}</p>${extra}
      <div class="btn-row"><a class="btn" href="#/roadmap">로드맵</a><a class="btn primary" href="#/">오늘의 강좌</a></div></div>`;
  }

  function lessonPage(day) {
    const l = BY_DAY.get(day);
    if (!l) { app.innerHTML = lockedBox('🛰️', '없는 강좌예요', `Day ${day}는 커리큘럼에 없어요.`); return; }
    const L = data(day);
    if (!unlocked(day)) {
      app.innerHTML = lockedBox('🔒', `Day ${day} — ${esc(l.title)}`, `${fmtDate(dateOf(day))}에 열려요. 하루에 한 걸음씩!`,
        `<p class="muted">미리 보기: ${l.topics.map(esc).join(' · ')}</p>`);
      return;
    }
    if (!L) {
      app.innerHTML = lockedBox('🛠️', `Day ${day} — ${esc(l.title)}`, '이 강좌는 아직 작성 중이에요. 보통 새벽에 자동으로 올라옵니다.');
      return;
    }
    const u = l.unit;
    const prev = BY_DAY.get(day - 1), next = BY_DAY.get(day + 1);
    const pagerCell = (x, cls, label) => {
      if (!x) return '<span></span>';
      const ok = unlocked(x.day) && data(x.day);
      const inner = `<small>${label} · Day ${x.day}</small><span>${esc(x.title)}</span>`;
      return ok ? `<a class="card ${cls}" href="#/lesson/${x.day}">${inner}</a>` : `<span class="card ${cls}">${inner}</span>`;
    };
    const readingParas = paras(L.reading.en).map(p => `<p>${highlightVocab(p, L.vocab)}</p>`).join('');

    app.innerHTML = `<article class="lesson">
      <nav class="crumbs"><a href="#/roadmap">로드맵</a><span>›</span><span>${u.icon} ${unitNo(u)}단원 ${esc(u.title)}</span></nav>
      <header class="lesson-head">
        <div class="eyebrow">Day ${pad(day, 3)} · ${fmtDate(dateOf(day))}</div>
        <h1>${esc(L.title)}</h1>
        <p class="title-en">${esc(L.title_en)}</p>
        <div class="meta"><span>⏱ ${L.minutes}분</span><span>난이도 ${level(L.level)}</span><span>단어 ${L.vocab.length}개</span><span>확인 문제 ${L.quiz.length}개</span>${isDone(day) ? '<span class="chip ok">✓ 완료</span>' : ''}</div>
        <p class="summary">${md(L.summary, true)}</p>
      </header>
      <section class="objectives"><h2>🎯 학습 목표</h2><ul>${L.objectives.map(o => `<li>${md(o, true)}</li>`).join('')}</ul></section>
      <nav class="jump" id="jump" aria-label="이 강좌의 목차"></nav>
      <div class="prose" id="prose">${md(L.body)}</div>

      <section class="block" id="sec-vocab">
        <div class="block-head"><h2>📘 핵심 영단어</h2><span class="en">Key Vocabulary</span></div>
        <div class="vocab-grid">${L.vocab.map(v => `<div class="card vcard">
          <div class="top-row"><span class="word">${esc(v.en)}</span>${v.pron ? `<span class="pron">/${esc(v.pron)}/</span>` : ''}${sayBtn(v.en)}</div>
          <div><span class="pos">${esc(v.pos)}</span> <span class="ko">${esc(v.ko)}</span></div>
          <div class="def">${md(v.def, true)}</div>
          <div class="ex">${md(v.ex, true)}</div><div class="ex-ko">${md(v.ex_ko, true)}</div></div>`).join('')}</div>
      </section>

      <section class="block" id="sec-reading">
        <div class="block-head"><h2>📖 English Reading</h2><span class="en">밑줄 친 단어를 누르면 뜻이 보여요</span></div>
        <div class="card reading">
          <h3>${esc(L.reading.title)}</h3>
          <div class="reading-en">${readingParas}</div>
          <div class="btn-row">
            ${canSpeak ? '<button type="button" class="btn small" id="readAloud">🔊 원어민 발음으로 듣기</button>' : ''}
            <button type="button" class="btn small" id="toggleKo">해석 보기</button>
          </div>
          <div class="reading-ko" id="readingKo" hidden>${paras(L.reading.ko).map(p => `<p>${esc(p)}</p>`).join('')}</div>
        </div>
      </section>

      <section class="block" id="sec-quiz">
        <div class="block-head"><h2>✏️ 확인 문제</h2><span class="en">Check Your Understanding</span></div>
        <div class="qlist" id="quiz">${L.quiz.map((q, i) => qHTML(q, i, '', true)).join('')}</div>
        <div id="quizScore"></div>
      </section>

      ${L.further && L.further.length ? `<section class="block further"><div class="block-head"><h2>🔗 더 알아보기</h2></div><ul>${L.further.map(f =>
        `<li><a class="card" href="${esc(f.url)}" target="_blank" rel="noopener">${f.lang ? `<span class="lang">${esc(f.lang.toUpperCase())}</span>` : ''}<span>${esc(f.title)}</span></a></li>`).join('')}</ul></section>` : ''}

      <div class="card complete-box" id="completeBox"></div>
      <nav class="pager">${pagerCell(prev, 'prev', '← 이전')}${pagerCell(next, 'next', '다음 →')}</nav>
    </article>`;

    // 목차
    const heads = $$('#prose h2');
    heads.forEach((h, i) => { h.id = `sec-${i + 1}`; });
    $('#jump').innerHTML = heads.map(h => `<button type="button" class="card" data-jump="${h.id}">${esc(h.textContent)}</button>`).join('') +
      '<button type="button" class="card" data-jump="sec-vocab">영단어</button><button type="button" class="card" data-jump="sec-reading">English Reading</button><button type="button" class="card" data-jump="sec-quiz">확인 문제</button>';

    // 영어 지문
    $('#toggleKo').addEventListener('click', e => {
      const box = $('#readingKo');
      box.hidden = !box.hidden;
      e.currentTarget.textContent = box.hidden ? '해석 보기' : '해석 숨기기';
    });
    const ra = $('#readAloud');
    if (ra) {
      let playing = false;
      const reset = () => { playing = false; ra.textContent = '🔊 원어민 발음으로 듣기'; };
      ra.addEventListener('click', () => {
        if (playing) { speechSynthesis.cancel(); reset(); return; }
        playing = true;
        ra.textContent = '⏹ 그만 듣기';
        speak(`${L.reading.title}. ${paras(L.reading.en).join(' ')}`, reset);
      });
    }

    bindLessonQuiz(day, L.quiz);
    renderComplete(day);

    // 읽기 진행 막대
    const rp = $('#readProgress');
    rp.hidden = false;
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      rp.style.width = `${h > 0 ? Math.min(100, (scrollY / h) * 100) : 0}%`;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    onCleanup(() => removeEventListener('scroll', onScroll));
  }

  function bindLessonQuiz(day, qs) {
    const answered = new Array(qs.length).fill(false);
    let score = 0, count = 0;
    const prevRec = S.quiz[day];
    if (prevRec) $('#quizScore').innerHTML = `<p class="muted">지난 기록: ${prevRec.score} / ${prevRec.total} (${fmtDate(prevRec.date, false)})</p>`;
    $$('#quiz .q').forEach(card => {
      const i = +card.dataset.q, q = qs[i];
      const commit = ans => {
        if (answered[i]) return;
        answered[i] = true;
        const ok = isRight(q, ans);
        if (ok) score++;
        count++;
        reveal(card, q, ok);
        if (count === qs.length) finish();
      };
      $$('.opt', card).forEach(b => b.addEventListener('click', () => {
        if (answered[i]) return;
        b.classList.add('sel');
        commit(q.type === 'ox' ? b.dataset.i === '1' : +b.dataset.i);
      }));
      const inp = $('input', card);
      if (inp) {
        const go = () => { if (inp.value.trim()) commit(inp.value); else inp.focus(); };
        $('[data-check]', card).addEventListener('click', go);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      }
    });
    function finish() {
      S.quiz[day] = { score, total: qs.length, date: todayStr() };
      touch();
      const p = pct(score, qs.length);
      const msg = p === 100 ? '완벽해요! 오늘 내용을 확실히 이해했어요.' : p >= 60 ? '좋아요! 틀린 문제의 해설을 한 번 더 읽어 보세요.' : '본문을 한 번 더 훑어보고 다시 풀어 보면 훨씬 잘할 거예요.';
      $('#quizScore').innerHTML = `<div class="card score-box"><div class="big">${score} / ${qs.length}</div><div class="msg">${msg}</div>
        <button type="button" class="btn small" id="retryQuiz">다시 풀기</button></div>`;
      $('#retryQuiz').addEventListener('click', () => {
        $('#quiz').innerHTML = qs.map((q, i) => qHTML(q, i, '', true)).join('');
        $('#quizScore').innerHTML = '';
        bindLessonQuiz(day, qs);
      });
      if (p === 100) toast('🎯 만점! 대단해요');
    }
  }

  function renderComplete(day) {
    const box = $('#completeBox');
    if (isDone(day)) {
      box.innerHTML = `<div style="font-size:32px">🚀</div><h2>Day ${day} 완료!</h2><p class="muted">${fmtDate(S.done[day])}에 완료했어요. 연속 학습 ${streak()}일째.</p>
        <div class="btn-row"><a class="btn primary" href="#/vocab/review">단어 복습하기</a><button type="button" class="btn ghost small" id="undoDone">완료 취소</button></div>`;
      $('#undoDone').addEventListener('click', () => { delete S.done[day]; save(); renderComplete(day); });
    } else {
      box.innerHTML = `<p class="muted">본문, 단어, 영어 지문, 확인 문제까지 마쳤다면</p>
        <button type="button" class="btn primary" id="markDone">✓ 오늘 학습 완료</button>`;
      $('#markDone').addEventListener('click', () => {
        S.done[day] = todayStr();
        touch();
        renderComplete(day);
        toast(`🎉 Day ${day} 완료! 연속 ${streak()}일째 공부 중`);
      });
    }
  }

  /* ------------------------------------------------------------ roadmap */
  function roadmap() {
    const cd = curDay();
    const opened = ALL.filter(l => unlocked(l.day)).length;
    const doneN = ALL.filter(l => isDone(l.day)).length;
    const curUnit = (BY_DAY.get(Math.min(Math.max(cd, 1), TOTAL)) || ALL[0]).unit.id;
    const units = C.units.map((u, ui) => {
      const ls = u.lessons;
      const ud = ls.filter(l => isDone(l.day)).length;
      const first = ls[0].day, last = ls[ls.length - 1].day;
      const isOpen = u.id === curUnit || (C.units[ui - 1] && C.units[ui - 1].id === curUnit);
      const rows = ls.map(l => {
        const open = unlocked(l.day), written = !!data(l.day), done = isDone(l.day);
        let st;
        if (done) st = '<span class="chip ok">✓ 완료</span>';
        else if (l.day === cd) st = '<span class="chip accent">오늘</span>';
        else if (open && written) st = '<span class="chip warn">읽기 전</span>';
        else if (open) st = '<span class="chip">준비 중</span>';
        else st = `<span class="muted">🔒 ${fmtShort(dateOf(l.day))}</span>`;
        const cls = `lrow ${open ? '' : 'locked'} ${l.day === cd ? 'is-today' : ''}`;
        const inner = `<span class="dn">Day ${l.day}</span><span class="dt">${fmtShort(dateOf(l.day))} ${DOW[parseDate(dateOf(l.day)).getDay()]}</span>
          <span class="tt">${esc(l.title)}<small>${esc(l.title_en)}</small></span><span class="st">${st}</span>`;
        return `<li>${open && written ? `<a class="${cls}" href="#/lesson/${l.day}">${inner}</a>` : `<div class="${cls}">${inner}</div>`}</li>`;
      }).join('');
      return `<details class="card unit" ${isOpen ? 'open' : ''}>
        <summary><span class="u-ico">${u.icon}</span>
          <span class="u-title">${unitNo(u)}단원 · ${esc(u.title)}<small>${esc(u.title_en)}</small></span>
          <span class="u-side"><span>Day ${first}–${last} · ${ud}/${ls.length}</span>${bar(pct(ud, ls.length), 'ok')}</span></summary>
        <p class="u-desc">${esc(u.desc)}</p>
        <ol class="lrows">${rows}</ol></details>`;
    }).join('');
    app.innerHTML = `<div class="page-head"><div class="eyebrow">Curriculum</div><h1>로드맵</h1>
      <p>기초 물리에서 시작해 로켓·공기역학·궤도역학·엔진·구조·우주선 시스템까지, ${TOTAL}일 동안 하루 한 강좌씩 열립니다.</p></div>
      <div class="card overall"><div class="row"><span>열린 강좌 ${Math.max(0, opened)} / ${TOTAL}</span><span>완료 ${doneN}개 · ${pct(doneN, TOTAL)}%</span></div>${bar(pct(doneN, TOTAL), 'ok')}</div>
      ${units}`;
  }

  /* ------------------------------------------------------------ vocab */
  function vocabPage() {
    const words = openVocab();
    const due = words.filter(isDue).length;
    const mastered = words.filter(isMastered).length;
    let filter = 'all', query = '';
    app.innerHTML = `<div class="page-head"><div class="eyebrow">Vocabulary</div><h1>단어장</h1>
      <p>강좌에서 배운 항공우주 영단어가 모두 모여요. 간격 반복(spaced repetition)으로 잊어버릴 때쯤 다시 보여 줍니다.</p></div>
      <div class="card review-cta"><div><div class="muted">오늘 복습할 단어</div><div class="big">${due}<small class="muted" style="font-size:15px"> / 전체 ${words.length} · 외운 단어 ${mastered}</small></div></div>
        <a class="btn primary" href="#/vocab/review" ${due ? '' : 'aria-disabled="true"'}>${due ? '플래시카드 복습 시작 →' : '오늘 복습 끝! 🎉'}</a></div>
      <div class="toolbar"><input type="search" id="vq" placeholder="영어 또는 한국어로 검색" aria-label="단어 검색">
        <div class="seg" id="vf"><button type="button" data-f="all" class="on">전체</button><button type="button" data-f="learning">학습 중</button><button type="button" data-f="mastered">외운 단어</button></div></div>
      <div id="vlist"></div>`;
    const draw = () => {
      const q = query.trim().toLowerCase();
      const list = words.filter(w => (filter === 'all' || (filter === 'mastered' ? isMastered(w) : !isMastered(w))) &&
        (!q || w.en.toLowerCase().includes(q) || w.ko.includes(q)));
      if (!list.length) { $('#vlist').innerHTML = `<div class="empty">${words.length ? '조건에 맞는 단어가 없어요.' : '아직 열린 강좌가 없어요.'}</div>`; return; }
      const groups = new Map();
      list.forEach(w => { if (!groups.has(w.day)) groups.set(w.day, []); groups.get(w.day).push(w); });
      $('#vlist').innerHTML = [...groups].map(([d, ws]) => `<div class="vgroup"><h3>Day ${d} · ${esc(BY_DAY.get(d).title)}</h3><div class="card vlist">${ws.map(w => {
        const box = vst(w)?.box || 0;
        return `<div class="vrow"><div class="vrow-line">${sayBtn(w.en, 'small')}<button type="button" class="vrow-main" aria-expanded="false">
          <span class="w">${esc(w.en)}${w.pron ? `<small>/${esc(w.pron)}/</small>` : ''}</span><span class="k">${esc(w.ko)}</span>
          <span class="boxdots" title="암기 단계 ${box}/5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= box ? 'on' : ''}"></i>`).join('')}</span></button></div>
          <div class="vrow-more" hidden><div>${md(w.def, true)}</div><div>“${md(w.ex, true)}”</div><div class="ex-ko">${md(w.ex_ko, true)}</div></div></div>`;
      }).join('')}</div></div>`).join('');
    };
    draw();
    $('#vq').addEventListener('input', e => { query = e.target.value; draw(); });
    $('#vf').addEventListener('click', e => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filter = b.dataset.f;
      $$('#vf button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    });
    $('#vlist').addEventListener('click', e => {
      const b = e.target.closest('.vrow-main');
      if (!b) return;
      const more = b.closest('.vrow').querySelector('.vrow-more');
      more.hidden = !more.hidden;
      b.setAttribute('aria-expanded', String(!more.hidden));
    });
  }

  function reviewPage() {
    const due = openVocab().filter(isDue);
    const old = shuffle(due.filter(w => vst(w)));
    const fresh = due.filter(w => !vst(w)).slice(0, 20);
    const queue = [...old, ...fresh];
    if (!queue.length) {
      app.innerHTML = lockedBox('🎉', '오늘 복습할 단어가 없어요', '새 강좌를 읽으면 새 단어가 추가되고, 외운 단어는 잊어버릴 때쯤 다시 나타나요.');
      return;
    }
    const total = queue.length;
    let i = 0, flipped = false, known = 0;
    const retried = new Set();
    const draw = () => {
      if (i >= queue.length) {
        app.innerHTML = `<div class="fc-wrap"><div class="card locked-box"><div class="ico">✅</div><h2>복습 완료!</h2>
          <p class="muted">${total}개 단어 중 ${known}개를 바로 알았어요. 내일 또 만나요.</p>
          <div class="btn-row"><a class="btn" href="#/vocab">단어장</a><a class="btn primary" href="#/">홈으로</a></div></div></div>`;
        return;
      }
      const w = queue[i];
      app.innerHTML = `<div class="fc-wrap">
        <div class="fc-top"><a href="#/vocab">← 단어장</a><span>${Math.min(i + 1, queue.length)} / ${queue.length}</span></div>
        ${bar(pct(i, queue.length))}
        <div class="card fc" id="fc" role="button" tabindex="0" aria-label="카드 뒤집기">
          <div class="word">${esc(w.en)}</div>${w.pron ? `<div class="pron">/${esc(w.pron)}/</div>` : ''}
          <div>${sayBtn(w.en)}</div>
          ${flipped ? `<div class="ko">${esc(w.ko)} <span class="muted" style="font-size:14px;font-weight:400">${esc(w.pos)}</span></div>
            <div class="def">${md(w.def, true)}</div><div class="ex">${md(w.ex, true)}<div class="ex-ko">${md(w.ex_ko, true)}</div></div>`
          : '<div class="hint">뜻을 떠올린 다음 카드를 눌러 확인하세요</div>'}
        </div>
        ${flipped ? `<div class="fc-actions"><button type="button" class="btn bad-soft" data-a="0">😕 몰랐어요</button><button type="button" class="btn ok-soft" data-a="1">🙂 알았어요</button></div>`
          : '<div class="fc-actions"><button type="button" class="btn primary" style="grid-column:1/-1" data-flip>뜻 보기</button></div>'}
        <div class="kbd-hint"><kbd>Space</kbd> 뒤집기 · <kbd>1</kbd> 몰랐어요 · <kbd>2</kbd> 알았어요</div></div>`;
    };
    const flip = () => { if (!flipped) { flipped = true; draw(); } };
    const answer = ok => {
      if (!flipped) return;
      const w = queue[i];
      gradeWord(w, ok);
      if (ok && !retried.has(w.key)) known++;
      if (!ok && !retried.has(w.key)) { retried.add(w.key); queue.push(w); }
      i++;
      flipped = false;
      draw();
    };
    app.onclick = e => {
      if (e.target.closest('[data-say]')) return;
      if (e.target.closest('[data-flip]') || e.target.closest('#fc')) flip();
      const a = e.target.closest('[data-a]');
      if (a) answer(a.dataset.a === '1');
    };
    const onKey = e => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
      else if (e.key === '1') answer(false);
      else if (e.key === '2') answer(true);
    };
    addEventListener('keydown', onKey);
    onCleanup(() => { removeEventListener('keydown', onKey); app.onclick = null; });
    draw();
  }

  /* ------------------------------------------------------------ tests */
  const qPool = (from, to, keys = ['test']) => {
    const out = [];
    for (let d = from; d <= to; d++) {
      const L = data(d);
      if (!L || !unlocked(d)) continue;
      keys.forEach(k => L[k].forEach(q => out.push({ ...q, src: d })));
    }
    return out;
  };

  function vocabQs(words, n, pool) {
    return sample(words, n).map(w => {
      const others = shuffle(pool.filter(o => o.key !== w.key));
      const mode = Math.random() * 3 | 0;
      let q, right, wrongs;
      if (mode === 0) { q = `다음 단어의 뜻으로 알맞은 것은?\n\n**${w.en}**`; right = w.ko; wrongs = others.map(o => o.ko); }
      else if (mode === 1) { q = `‘${w.ko}’에 해당하는 영어 단어는?`; right = w.en; wrongs = others.map(o => o.en); }
      else { q = `다음 영어 정의(definition)에 해당하는 단어는?\n\n*${w.def}*`; right = w.en; wrongs = others.map(o => o.en); }
      const uniq = [...new Set(wrongs.filter(x => x !== right))].slice(0, 3);
      if (uniq.length < 2) return null;
      const choices = shuffle([right, ...uniq]);
      return { type: 'mc', q, choices, answer: choices.indexOf(right), explain: `**${w.en}**${w.pron ? ` /${w.pron}/` : ''} — ${w.ko}. ${w.def}`, kind: 'vocab', src: w.day };
    }).filter(Boolean);
  }

  const hasLessons = t => t.from && ALL.some(l => l.day >= t.from && l.day <= t.to && data(l.day) && unlocked(l.day));

  function allTests() {
    const tests = [];
    for (let w = 1; w <= Math.ceil(TOTAL / 7); w++) {
      const from = (w - 1) * 7 + 1, to = Math.min(w * 7, TOTAL);
      tests.push({
        id: `w${w}`, kind: 'weekly', title: `${w}주차 테스트`, from, to, sub: `Day ${from}–${to} · 약 25문제`,
        open: () => unlocked(to),
        build: () => {
          let qs = sample(qPool(from, to), 15).map(q => ({ ...q, kind: 'concept' }));
          if (qs.length < 15) qs = qs.concat(sample(qPool(from, to, ['quiz']), 15 - qs.length).map(q => ({ ...q, kind: 'concept' })));
          const review = sample(qPool(1, from - 1, ['quiz', 'test']), 3).map(q => ({ ...q, kind: 'review' }));
          const pool = openVocab();
          return [...shuffle(qs), ...review, ...vocabQs(vocabRange(from, to), 7, pool)];
        },
      });
    }
    C.units.forEach(u => {
      const from = u.lessons[0].day, to = u.lessons[u.lessons.length - 1].day;
      tests.push({
        id: u.id.toLowerCase(), kind: 'unit', title: `${unitNo(u)}단원 평가`, unit: u, from, to, sub: `${u.icon} ${u.title} · 약 25문제`,
        open: () => unlocked(to),
        build: () => {
          const qs = sample(qPool(from, to, ['test', 'quiz']), 20).map(q => ({ ...q, kind: 'concept' }));
          return [...qs, ...vocabQs(vocabRange(from, to), 5, openVocab())];
        },
      });
    });
    tests.push({
      id: 'practice', kind: 'practice', title: '랜덤 연습', sub: '지금까지 배운 전체 범위에서 15문제', from: 1, to: TOTAL,
      open: () => true,
      build: () => [...sample(qPool(1, curDay(), ['quiz', 'test']), 10).map(q => ({ ...q, kind: 'concept' })), ...vocabQs(openVocab(), 5, openVocab())],
    });
    tests.push({
      id: 'vocab', kind: 'practice', title: '영단어 테스트', sub: '배운 단어 중 20문제', from: 1, to: TOTAL,
      open: () => true,
      build: () => {
        const words = openVocab();
        const weak = words.filter(w => !isMastered(w));
        const pick = weak.length >= 20 ? weak : weak.concat(sample(words.filter(isMastered), 20 - weak.length));
        return vocabQs(pick, 20, words);
      },
    });
    return tests;
  }
  const bestScore = id => S.tests.filter(t => t.id === id).reduce((b, t) => (!b || t.score / t.total > b.score / b.total ? t : b), null);

  function testsPage() {
    const tests = allTests();
    const card = t => {
      const open = t.open(), ready = open && hasLessons(t), best = bestScore(t.id);
      const status = !open ? `<span class="muted">🔒 ${fmtDate(dateOf(t.to))} 공개</span>`
        : best ? `<span class="best">최고 ${pct(best.score, best.total)}% (${best.score}/${best.total})</span>`
          : '<span class="chip orange">응시 가능</span>';
      return `<div class="card tcard ${open ? '' : 'locked'}"><h3>${esc(t.title)}</h3><div class="sub">${esc(t.sub)}</div>${status}
        ${ready ? `<a class="btn small ${best ? '' : 'primary'}" href="#/test/${t.id}">${best ? '다시 보기' : '시작하기'}</a>` : ''}</div>`;
    };
    const weekly = tests.filter(t => t.kind === 'weekly');
    const shownWeekly = weekly.filter(t => t.open() || t === weekly.find(x => !x.open()));
    const units = tests.filter(t => t.kind === 'unit');
    const shownUnits = units.filter(t => t.open() || t === units.find(x => !x.open()));
    const hist = S.tests.slice().reverse().slice(0, 30);
    app.innerHTML = `<div class="page-head"><div class="eyebrow">Tests</div><h1>테스트</h1>
      <p>7일마다 주간 테스트, 단원이 끝나면 단원 평가가 열려요. 주간 테스트는 강좌에서 보여 주지 않은 새 문제와 지난 내용 복습, 영단어 문제로 구성됩니다.</p></div>
      <section class="section"><div class="section-head"><h2>📅 주간 테스트</h2></div><div class="test-grid">${shownWeekly.map(card).join('')}</div></section>
      <section class="section"><div class="section-head"><h2>🏁 단원 평가</h2></div><div class="test-grid">${shownUnits.map(card).join('')}</div></section>
      <section class="section"><div class="section-head"><h2>🎲 자유 연습</h2></div><div class="test-grid">${tests.filter(t => t.kind === 'practice').map(card).join('')}</div></section>
      <section class="section"><div class="section-head"><h2>📊 응시 기록</h2></div>
        ${hist.length ? `<div class="card history">${hist.map(h => `<div class="hrow"><span class="d">${fmtShort(h.date)}</span><span>${esc(h.title)}</span>${bar(pct(h.score, h.total), pct(h.score, h.total) >= 80 ? 'ok' : '')}<span class="p">${pct(h.score, h.total)}%</span></div>`).join('')}</div>`
          : '<div class="empty">아직 응시 기록이 없어요.</div>'}</section>`;
  }

  function testPage(id) {
    const t = allTests().find(x => x.id === id);
    if (!t) { app.innerHTML = lockedBox('🛰️', '없는 테스트예요', '테스트 목록에서 다시 선택해 주세요.'); return; }
    if (!t.open()) { app.innerHTML = lockedBox('🔒', esc(t.title), `${fmtDate(dateOf(t.to))}에 열려요.`); return; }
    const qs = t.build().map(shuffledChoices);
    if (!qs.length) { app.innerHTML = lockedBox('📭', esc(t.title), '아직 출제할 문제가 없어요. 강좌가 더 열리면 다시 와 주세요.'); return; }
    const tagOf = q => (q.kind === 'vocab' ? '<span class="chip orange src">영단어</span>'
      : q.kind === 'review' ? `<span class="chip warn src">복습 · Day ${q.src}</span>` : `<span class="chip src">Day ${q.src}</span>`);
    const answers = new Array(qs.length).fill(undefined);
    app.innerHTML = `<div class="lesson"><div class="test-head"><div class="eyebrow">${esc(t.sub)}</div><h1>${esc(t.title)}</h1>
      <p class="muted">${qs.length}문제 · 모두 푼 뒤 아래의 제출 버튼을 누르세요. 계산 문제는 숫자만 입력하면 되고, 약간의 반올림 오차는 정답으로 처리돼요.</p></div>
      <div id="result"></div>
      <div class="qlist" id="tq">${qs.map((q, i) => qHTML(q, i, tagOf(q))).join('')}</div>
      <div class="card submit-bar" id="submitBar"><span id="progressTxt" class="muted">0 / ${qs.length} 답함</span><button type="button" class="btn primary" id="submitBtn">제출하고 채점하기</button></div></div>`;
    const upd = () => { $('#progressTxt').textContent = `${answers.filter(a => a !== undefined && a !== '').length} / ${qs.length} 답함`; };
    $$('#tq .q').forEach(card => {
      const i = +card.dataset.q, q = qs[i];
      $$('.opt', card).forEach(b => b.addEventListener('click', () => {
        $$('.opt', card).forEach(x => x.classList.toggle('sel', x === b));
        answers[i] = q.type === 'ox' ? b.dataset.i === '1' : +b.dataset.i;
        upd();
      }));
      const inp = $('input', card);
      if (inp) inp.addEventListener('input', () => { answers[i] = inp.value.trim() || undefined; upd(); });
    });
    $('#submitBtn').addEventListener('click', () => {
      const left = answers.filter(a => a === undefined).length;
      if (left && !confirm(`아직 ${left}문제를 풀지 않았어요. 그래도 제출할까요?`)) return;
      let score = 0;
      $$('#tq .q').forEach(card => {
        const i = +card.dataset.q, q = qs[i];
        const ok = answers[i] !== undefined && isRight(q, answers[i]);
        if (ok) score++;
        reveal(card, q, ok);
      });
      S.tests.push({ id: t.id, title: t.title, date: todayStr(), score, total: qs.length });
      touch();
      const p = pct(score, qs.length);
      const msg = p >= 90 ? '훌륭해요! 이 범위는 확실히 내 것이 됐어요.' : p >= 70 ? '잘했어요. 틀린 문제의 해설과 해당 Day를 다시 보면 완벽해질 거예요.' : '괜찮아요. 틀린 문제 옆의 Day 표시를 보고 그 강좌를 복습한 뒤 다시 도전해 보세요.';
      const wrongDays = [...new Set(qs.filter((q, i) => !(answers[i] !== undefined && isRight(q, answers[i]))).filter(q => q.kind !== 'vocab').map(q => q.src))].sort((a, b) => a - b);
      $('#result').innerHTML = `<div class="card result"><div class="eyebrow">결과</div><div class="big">${p}<small>% · ${score}/${qs.length}</small></div>${bar(p, p >= 80 ? 'ok' : '')}
        <p>${msg}</p>${wrongDays.length ? `<p class="muted">복습 추천: ${wrongDays.map(d => `<a href="#/lesson/${d}">Day ${d}</a>`).join(', ')}</p>` : ''}
        <div class="btn-row"><button type="button" class="btn primary" id="retake">새 문제로 다시 보기</button><a class="btn" href="#/tests">테스트 목록</a></div></div>`;
      $('#retake').addEventListener('click', () => route());
      $('#submitBar').remove();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ------------------------------------------------------------ settings */
  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function settingsPage() {
    const built = C.meta.built ? C.meta.built.replace('T', ' ').slice(0, 16) : '–';
    app.innerHTML = `<div class="page-head"><div class="eyebrow">Settings</div><h1>설정</h1></div>
      <div class="set-list">
        <div class="card set"><h2>화면 모드</h2><div class="seg" id="theme">
          ${[['system', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([v, k]) => `<button type="button" data-v="${v}" class="${S.settings.theme === v ? 'on' : ''}">${k}</button>`).join('')}</div></div>
        <div class="card set"><h2>영어 읽기 속도 <span class="muted" id="rateVal" style="font-weight:400">${S.settings.rate.toFixed(2)}×</span></h2>
          <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}">
          <div><button type="button" class="btn small" id="rateTest">🔊 들어 보기</button></div>
          ${canSpeak ? '' : '<p>이 브라우저는 음성 읽기를 지원하지 않아요.</p>'}</div>
        <div class="card set"><h2>학습 기록 백업</h2>
          <p>진도·점수·단어 암기 기록은 이 기기의 브라우저에만 저장돼요. 다른 기기로 옮기거나 브라우저 데이터를 지우기 전에 백업 파일을 저장해 두세요.</p>
          <div class="btn-row"><button type="button" class="btn small" id="exportBtn">백업 파일 저장</button>
          <label class="btn small">백업 불러오기<input type="file" id="importFile" accept="application/json,.json" hidden></label></div></div>
        <div class="card set"><h2>사이트 정보</h2>
          <p>코스 시작일 ${fmtDate(START)} · 오늘은 Day ${curDay()}<br>작성된 강좌 ${C.meta.written} / ${C.meta.total} · 마지막 업데이트 ${esc(built)}</p></div>
        <div class="card set danger"><h2>기록 초기화</h2><p>이 기기에 저장된 모든 학습 기록을 지웁니다. 되돌릴 수 없어요.</p>
          <div><button type="button" class="btn small" id="resetBtn">초기화</button></div></div>
      </div>`;
    $('#theme').addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      S.settings.theme = b.dataset.v;
      save();
      applyTheme();
      $$('#theme button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('#rate').addEventListener('input', e => {
      S.settings.rate = +e.target.value;
      $('#rateVal').textContent = `${S.settings.rate.toFixed(2)}×`;
      save();
    });
    $('#rateTest').addEventListener('click', () => speak('The rocket equation tells us how much velocity change a vehicle can achieve.'));
    $('#exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aerospace-daily-backup-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#importFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        if (!raw || typeof raw !== 'object' || !('done' in raw)) throw new Error('형식 오류');
        const base = blank();
        S = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
        save();
        applyTheme();
        toast('백업을 불러왔어요.');
        settingsPage();
      } catch (err) {
        toast('백업 파일을 읽을 수 없어요.');
      }
    });
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('정말 모든 학습 기록을 지울까요?')) return;
      S = blank();
      save();
      applyTheme();
      toast('기록을 초기화했어요.');
      settingsPage();
    });
  }

  /* ------------------------------------------------------------ global handlers */
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-say]');
    if (s) { e.preventDefault(); speak(s.dataset.say); return; }
    const j = e.target.closest('[data-jump]');
    if (j) { document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const m = e.target.closest('mark.vw');
    $$('mark.vw.show').forEach(x => { if (x !== m) x.classList.remove('show'); });
    if (m) m.classList.toggle('show');
  });

  function footer() {
    const built = C.meta.built ? fmtDate(C.meta.built.slice(0, 10), false) + ' ' + C.meta.built.slice(11, 16) : '';
    $('#foot').innerHTML = `<p>${esc(C.meta.title)} · ${esc(C.meta.subtitle)} — 새 강좌는 매일 새벽 자동으로 추가됩니다.</p>
      <p>작성된 강좌 ${C.meta.written} / ${C.meta.total}${built ? ` · 마지막 업데이트 ${built}` : ''}</p>`;
  }

  applyTheme();
  footer();
  addEventListener('hashchange', route);
  route();
})();
