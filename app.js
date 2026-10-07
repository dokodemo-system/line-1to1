/*
 * LINE 1to1 の LIFF 画面（単一ページ）。?view=register|book|change|admin|pending で切り替えます。
 * 判断したこと:
 *  - 予約→登録、一覧→入力などの画面移動は URL を変えずに JS で描き直します（戻るは画面内のボタンで行います）。
 *  - 登録は名前だけ必須です。次の連絡までの期間は「設定しない」も選べます（その人には久しぶり連絡を送りません）。
 *  - reschedule の戻り値の形は契約に無いため、reservation.label があれば使い、無ければ選んだ枠の表示を使います。
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var appEl = document.getElementById('app');
  var titleEl = document.getElementById('title');
  var busy = false; // 二重送信防止（送信中は他の送信を受け付けない）

  // ---------------------------------------------------------------
  // 小さなヘルパー（サーバーから来た文字列は必ず textContent で入れる）
  // ---------------------------------------------------------------
  function str(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  function h(tag, props, children) {
    const el = document.createElement(tag);
    let value;
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = str(v);
        else if (k === 'value') value = str(v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, str(v));
      });
    }
    add(el, children);
    if (value !== undefined) el.value = value;
    return el;
  }

  function add(el, children) {
    if (children === undefined || children === null || children === false) return;
    if (Array.isArray(children)) {
      children.forEach(function (c) { add(el, c); });
    } else if (children instanceof Node) {
      el.appendChild(children);
    } else {
      el.appendChild(document.createTextNode(str(children)));
    }
  }

  function render(nodes) {
    while (appEl.firstChild) appEl.removeChild(appEl.firstChild);
    add(appEl, nodes);
    window.scrollTo(0, 0);
  }

  function setTitle(t) {
    titleEl.textContent = t;
    document.title = t;
  }

  function inClient() {
    try { return liff.isInClient(); } catch (e) { return false; }
  }

  function appError(message, code) {
    const e = new Error(message);
    e.appMessage = message;
    e.code = code || '';
    return e;
  }

  function toMsg(err) {
    if (err && err.appMessage) return err.appMessage;
    return 'エラーが発生しました。画面を開き直してください。';
  }

  // 日本時間での表示（サーバーが label を返さなかったときの予備）
  var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtJst(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const d = new Date(t + 9 * 3600 * 1000);
    return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日(' + WEEK[d.getUTCDay()] + ') ' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function reservationLabel(r) {
    if (r.label) return str(r.label);
    const s = fmtJst(r.start);
    if (!s) return '';
    const e = fmtJst(r.end);
    return s + (e ? '〜' + e.slice(-5) : '〜');
  }

  // ---------------------------------------------------------------
  // 部品
  // ---------------------------------------------------------------
  function button(label, onClick, kind) {
    return h('button', { type: 'button', class: 'btn btn-' + (kind || 'primary'), text: label, onclick: onClick });
  }

  function closeBtn(label) {
    const note = h('p', { class: 'muted small center', hidden: true, text: 'ブラウザのタブを閉じて終了してください。' });
    const btn = h('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: label || '閉じる',
      onclick: function () {
        if (inClient()) {
          liff.closeWindow();
          return;
        }
        try { window.close(); } catch (e) { /* 閉じられないブラウザもある */ }
        note.hidden = false;
      }
    });
    return h('div', { class: 'stack' }, [btn, note]);
  }

  function errorBox() {
    const msg = h('p', { class: 'inline-error-text' });
    const actions = h('div', { class: 'stack' });
    const el = h('div', { class: 'inline-error', role: 'alert', hidden: true }, [msg, actions]);
    return {
      el: el,
      show: function (text, actionLabel, actionFn) {
        msg.textContent = text;
        while (actions.firstChild) actions.removeChild(actions.firstChild);
        if (actionLabel && actionFn) actions.appendChild(button(actionLabel, actionFn, 'secondary'));
        el.hidden = false;
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
      },
      clear: function () {
        msg.textContent = '';
        while (actions.firstChild) actions.removeChild(actions.firstChild);
        el.hidden = true;
      }
    };
  }

  function field(labelText, control, note, required, tag) {
    return h('label', { class: 'field' }, [
      h('span', { class: 'field-label' }, [
        h('span', { text: labelText }),
        required ? h('span', { class: 'badge badge-req', text: '必須' }) : h('span', { class: 'badge badge-opt', text: '任意' }),
        tag || null
      ]),
      note ? h('span', { class: 'field-note', text: note }) : null,
      control
    ]);
  }

  function doneHead(text) {
    return h('div', { class: 'done' }, [
      h('div', { class: 'done-mark', 'aria-hidden': 'true' }),
      h('p', { class: 'done-text', text: text })
    ]);
  }

  function reservationCard(r, heading) {
    const rows = [['日時', reservationLabel(r)], ['場所', str(r.place)]];
    if (r.status) rows.push(['状態', str(r.status)]);
    const dl = h('dl', { class: 'info' });
    rows.forEach(function (row) {
      if (!row[1]) return;
      dl.appendChild(h('dt', { text: row[0] }));
      dl.appendChild(h('dd', { text: row[1] }));
    });
    return h('div', { class: 'card' }, [heading ? h('p', { class: 'card-title', text: heading }) : null, dl]);
  }

  // 送信ボタンの共通処理（送信中はボタンを無効にし、表示を変える）
  async function runBusy(btn, busyLabel, fn) {
    if (busy) return;
    busy = true;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyLabel || '送信中です…';
    btn.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = original;
      btn.removeAttribute('aria-busy');
    }
  }

  // ---------------------------------------------------------------
  // 共通の画面
  // ---------------------------------------------------------------
  function showLoading(message) {
    render(h('div', { class: 'loading', role: 'status' }, [
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { text: message || '読み込み中です…' })
    ]));
  }

  function showError(message, retry, detail) {
    const nodes = [
      h('div', { class: 'card card-error', role: 'alert' }, [
        h('p', { class: 'strong', text: 'うまくいきませんでした' }),
        h('p', { text: message })
      ])
    ];
    if (detail) nodes.push(h('p', { class: 'muted small', text: '詳細：' + detail }));
    if (retry) nodes.push(button('もう一度読み込む', retry, 'primary'));
    nodes.push(closeBtn());
    render(nodes);
  }

  function showAuthError(message) {
    setTitle('開き直してください');
    const nodes = [
      h('div', { class: 'card card-error', role: 'alert' }, [
        h('p', { text: message || 'ログインの確認に失敗しました。画面を開き直してください。' })
      ])
    ];
    if (inClient()) {
      nodes.push(h('p', { class: 'muted', text: 'いったん閉じて、トーク画面のメニューからもう一度開いてください。' }));
      nodes.push(closeBtn());
    } else {
      nodes.push(button('ログインし直す', function () {
        try { liff.logout(); } catch (e) { /* 未ログインでも続ける */ }
        liff.login({ redirectUri: location.href });
      }, 'primary'));
    }
    render(nodes);
  }

  function showMessage(message, sub, actionLabel, actionFn) {
    const nodes = [
      h('div', { class: 'card' }, [
        h('p', { class: 'strong', text: message }),
        sub ? h('p', { class: 'muted', text: sub }) : null
      ])
    ];
    if (actionLabel && actionFn) nodes.push(button(actionLabel, actionFn, 'primary'));
    nodes.push(closeBtn());
    render(nodes);
  }

  function handleError(err, retry) {
    const code = err && err.code;
    if (code === 'auth') return showAuthError(toMsg(err));
    if (code === 'not_registered') return showNeedRegister();
    const detail = err && !err.appMessage && err.message ? err.message : '';
    showError(toMsg(err), code === 'forbidden' ? null : retry, detail);
  }

  function showDone(title, message, info, note) {
    setTitle(title);
    const nodes = [doneHead(message)];
    if (info) nodes.push(reservationCard(info));
    if (note) nodes.push(h('p', { class: 'muted center', text: note }));
    nodes.push(closeBtn());
    render(nodes);
  }

  // ---------------------------------------------------------------
  // GAS の API 呼び出し（text/plain で JSON を送る。独自ヘッダー・credentials なし）
  // ---------------------------------------------------------------
  async function api(action, data) {
    let idToken = null;
    try { idToken = liff.getIDToken(); } catch (e) { idToken = null; }
    if (!idToken) {
      throw appError('ログイン情報を取得できませんでした。画面を開き直してください。', 'auth');
    }
    const payload = Object.assign({}, data || {}, { action: action, idToken: idToken });
    let res;
    try {
      res = await fetch(CFG.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw appError('通信に失敗しました。電波の良いところで、もう一度お試しください。', 'network');
    }
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!json || typeof json !== 'object') {
      throw appError('サーバーから正しい応答がありませんでした。時間をおいて、もう一度お試しください。', 'network');
    }
    if (json.ok !== true) {
      throw appError(str(json.error) || 'エラーが発生しました。', json.code ? str(json.code) : '');
    }
    return json;
  }

  // ---------------------------------------------------------------
  // view=register
  // ---------------------------------------------------------------
  async function viewRegister(opts) {
    opts = opts || {};
    setTitle('登録');
    showLoading();
    let me;
    try { me = await api('me'); } catch (e) { return handleError(e, function () { viewRegister(opts); }); }

    const c = me.customer || {};
    let defaultName = str(c['名前']);
    if (!me.registered && !defaultName) {
      try {
        const p = await liff.getProfile();
        defaultName = str(p && p.displayName);
      } catch (e) { /* 取れなければ空のまま */ }
    }

    const nameIn = h('input', { type: 'text', name: 'name', autocomplete: 'name', maxlength: '50', required: true, value: defaultName });
    const companyIn = h('input', { type: 'text', name: 'company', autocomplete: 'organization', maxlength: '100', value: str(c['会社名']) });
    const industryIn = h('input', { type: 'text', name: 'industry', maxlength: '100', placeholder: '例：税理士、Web制作、不動産仲介', value: str(c['業種']) });
    const err = errorBox();
    const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: me.registered ? '登録内容を更新する' : '登録する' });

    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        err.clear();
        const name = nameIn.value.trim();
        if (!name) {
          err.show('お名前を入力してください。');
          nameIn.focus();
          return;
        }
        runBusy(submitBtn, '送信中です…', async function () {
          try {
            await api('register', { name: name, company: companyIn.value.trim(), industry: industryIn.value.trim() });
          } catch (e) {
            if (e.code === 'auth') return showAuthError(toMsg(e));
            return err.show(toMsg(e));
          }
          await showRegisterDone(!!me.registered, opts);
        });
      }
    }, [
      field('お名前', nameIn, null, true),
      field('会社名', companyIn),
      field('業種', industryIn, 'お仕事の内容が分かるように、自由に書いてください。'),
      err.el,
      submitBtn
    ]);

    render([
      h('p', { class: 'lead', text: me.registered ? '登録内容を変更できます。' : 'はじめに、お名前・会社名・業種を登録してください。' }),
      form
    ]);
  }

  async function showRegisterDone(updated, opts) {
    setTitle(updated ? '更新しました' : '登録しました');
    showLoading('確認しています…');
    let friend = null;
    try {
      const f = await liff.getFriendship();
      friend = !!(f && f.friendFlag);
    } catch (e) {
      friend = null; // 確認できないときは「閉じる」を出す
    }
    const nodes = [doneHead(updated ? '登録内容を更新しました。' : 'ご登録ありがとうございます。')];
    if (friend === false) {
      nodes.push(h('div', { class: 'card card-notice' }, [
        h('p', { class: 'strong', text: '公式LINEを友だち追加してください。' }),
        h('p', { class: 'muted', text: '友だち追加すると、トーク画面のメニューから予約や予約の確認ができ、前日のお知らせも届きます。' })
      ]));
    }
    if (opts && opts.from === 'book') nodes.push(button('続けて予約する', function () { viewBook(); }, 'primary'));
    if (friend !== false) nodes.push(closeBtn());
    render(nodes);
  }

  function showNeedRegister() {
    setTitle('登録が必要です');
    render([
      h('div', { class: 'card' }, [
        h('p', { class: 'strong', text: '1to1のご予約には、はじめに登録が必要です。' }),
        h('p', { class: 'muted', text: 'お名前・会社名・業種を登録すると、予約に進めます。' })
      ]),
      button('登録する', function () { viewRegister({ from: 'book' }); }, 'primary'),
      closeBtn()
    ]);
  }

  // ---------------------------------------------------------------
  // 日時の選択（予約と変更で共通）
  // o = { days, lead, current, confirmLabel, onConfirm(slot, day), reload, back }
  // ---------------------------------------------------------------
  function dayLabelNodes(label) {
    const m = /^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/.exec(str(label));
    if (!m) return [h('span', { class: 'd1', text: str(label) })];
    const wd = m[2];
    const cls = 'd2' + (wd === '土' ? ' sat' : wd === '日' ? ' sun' : '');
    return [h('span', { class: 'd1', text: m[1] }), h('span', { class: cls, text: '(' + wd + ')' })];
  }

  function renderPicker(o) {
    const days = (Array.isArray(o.days) ? o.days : []).filter(function (d) {
      return d && Array.isArray(d.slots) && d.slots.length > 0;
    });
    const top = [];
    if (o.lead) top.push(h('p', { class: 'lead', text: o.lead }));
    if (o.current) top.push(o.current);

    if (!days.length) {
      top.push(h('div', { class: 'card' }, [
        h('p', { class: 'strong', text: '現在、予約できる日時がありません。' }),
        h('p', { class: 'muted', text: '時間をおいて、もう一度お試しください。' })
      ]));
      if (o.back) top.push(button('戻る', o.back, 'secondary'));
      else top.push(closeBtn());
      render(top);
      return;
    }

    let selDay = null;
    let selSlot = null;
    const err = errorBox();
    const dayStrip = h('div', { class: 'days', role: 'group', 'aria-label': '日にち' });
    const timeGrid = h('div', { class: 'times', role: 'group', 'aria-label': '時間' });
    const confirmText = h('p', { class: 'confirm-text' });
    const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary', text: o.confirmLabel, disabled: true });
    const confirmBox = h('div', { class: 'card confirm', hidden: true }, [
      h('p', { class: 'muted small', text: '選んだ日時' }),
      confirmText,
      err.el,
      confirmBtn
    ]);

    const dayButtons = days.map(function (d) {
      const b = h('button', { type: 'button', class: 'day', 'aria-pressed': 'false' }, dayLabelNodes(d.label));
      b.addEventListener('click', function () { pickDay(d, b); });
      dayStrip.appendChild(b);
      return b;
    });

    function pickDay(d, btn) {
      if (busy) return;
      selDay = d;
      selSlot = null;
      dayButtons.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      while (timeGrid.firstChild) timeGrid.removeChild(timeGrid.firstChild);
      const timeButtons = [];
      d.slots.forEach(function (s) {
        const tb = h('button', { type: 'button', class: 'time', 'aria-pressed': 'false', text: str(s.label) });
        tb.addEventListener('click', function () {
          if (busy) return;
          selSlot = s;
          timeButtons.forEach(function (x) { x.setAttribute('aria-pressed', x === tb ? 'true' : 'false'); });
          confirmText.textContent = str(selDay.label) + ' ' + str(s.label) + '〜';
          confirmBox.hidden = false;
          confirmBtn.disabled = false;
          err.clear();
          try { confirmBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { confirmBox.scrollIntoView(); }
        });
        timeButtons.push(tb);
        timeGrid.appendChild(tb);
      });
      confirmBox.hidden = true;
      confirmBtn.disabled = true;
      err.clear();
    }

    confirmBtn.addEventListener('click', function () {
      if (!selSlot || !selDay) return;
      const slot = selSlot;
      const day = selDay;
      runBusy(confirmBtn, '送信中です…', async function () {
        try {
          await o.onConfirm(slot, day);
        } catch (e) {
          if (e.code === 'auth') return showAuthError(toMsg(e));
          if (e.code === 'not_registered') return showNeedRegister();
          if (e.code === 'taken' && o.reload) {
            return err.show(toMsg(e), '空き状況を更新する', function () { o.reload(); });
          }
          err.show(toMsg(e));
        }
      });
    });

    const nodes = top.concat([
      h('h2', { class: 'section-title', text: '日にちを選んでください' }),
      dayStrip,
      h('h2', { class: 'section-title', text: '時間を選んでください' }),
      timeGrid,
      confirmBox
    ]);
    if (o.back) nodes.push(button('戻る', function () { if (!busy) o.back(); }, 'secondary'));
    render(nodes);
    pickDay(days[0], dayButtons[0]);
  }

  // ---------------------------------------------------------------
  // view=book
  // ---------------------------------------------------------------
  async function viewBook() {
    setTitle('1to1予約');
    showLoading('空いている日時を確認しています…');
    let me;
    let data;
    try {
      const results = await Promise.all([api('me'), api('slots', {})]);
      me = results[0];
      data = results[1];
    } catch (e) {
      return handleError(e, viewBook);
    }
    if (!me.registered) return showNeedRegister();

    renderPicker({
      days: data.days,
      lead: 'ご希望の日にちと時間を選んでください。',
      confirmLabel: 'この日時で予約する',
      onConfirm: async function (slot, day) {
        const res = await api('book', { start: slot.start });
        const rv = res.reservation || {};
        showDone(
          '予約が完了しました',
          'ご予約を受け付けました。',
          { label: rv.label || (str(day.label) + ' ' + str(slot.label) + '〜'), place: rv.place },
          '前日にLINEでお知らせします。変更・キャンセルは、メニューの「予約変更・キャンセル」からできます。'
        );
      },
      reload: viewBook
    });
  }

  // ---------------------------------------------------------------
  // view=change（rid）
  // ---------------------------------------------------------------
  async function viewChange(params) {
    setTitle('予約の変更・キャンセル');
    const rid = params && params.rid;
    if (!rid) {
      return showMessage('予約が指定されていません。', 'トーク画面のメニュー「予約変更・キャンセル」から、変更したい予約を選んでください。');
    }
    showLoading();
    let r;
    try {
      const res = await api('reservation', { rid: rid });
      r = res.reservation || {};
    } catch (e) {
      return handleError(e, function () { viewChange(params); });
    }
    if (!r.rid) r.rid = rid;

    const nodes = [h('p', { class: 'lead', text: '現在のご予約です。' }), reservationCard(r)];
    if (r.status && r.status !== '予約中') {
      nodes.push(h('p', { class: 'muted', text: 'この予約は「' + str(r.status) + '」のため、変更やキャンセルはできません。' }));
      nodes.push(closeBtn());
    } else {
      nodes.push(button('日時を変更する', function () { startReschedule(r); }, 'primary'));
      nodes.push(button('この予約をキャンセルする', function () { confirmCancel(r); }, 'danger'));
      nodes.push(closeBtn());
    }
    render(nodes);
  }

  async function startReschedule(r) {
    setTitle('日時の変更');
    showLoading('空いている日時を確認しています…');
    let data;
    try { data = await api('slots', { rid: r.rid }); } catch (e) { return handleError(e, function () { startReschedule(r); }); }

    renderPicker({
      days: data.days,
      lead: '新しい日時を選んでください。',
      current: reservationCard({ label: r.label, start: r.start, end: r.end, place: r.place }, '現在のご予約'),
      confirmLabel: 'この日時に変更する',
      onConfirm: async function (slot, day) {
        const res = await api('reschedule', { rid: r.rid, start: slot.start });
        const nr = (res && res.reservation) || {};
        showDone(
          '予約を変更しました',
          '日時を変更しました。',
          { label: nr.label || (str(day.label) + ' ' + str(slot.label) + '〜'), place: nr.place || r.place },
          '前日にLINEでお知らせします。'
        );
      },
      reload: function () { startReschedule(r); },
      back: function () { viewChange({ rid: r.rid }); }
    });
  }

  function confirmCancel(r) {
    openModal({
      title: 'この予約をキャンセルしますか？',
      body: reservationLabel(r),
      confirmLabel: 'キャンセルする',
      cancelLabel: '戻る',
      danger: true,
      onConfirm: async function () {
        await api('cancel', { rid: r.rid });
        showDone(
          'キャンセルしました',
          '予約をキャンセルしました。',
          { label: r.label, start: r.start, end: r.end, place: r.place },
          'またのご予約をお待ちしています。'
        );
      }
    });
  }

  // 画面内の確認ダイアログ（window.confirm は使わない）
  function openModal(o) {
    const err = errorBox();
    const okBtn = h('button', { type: 'button', class: 'btn ' + (o.danger ? 'btn-danger-solid' : 'btn-primary'), text: o.confirmLabel });
    const noBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: o.cancelLabel || '戻る' });
    const panel = h('div', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' }, [
      h('h2', { id: 'modal-title', class: 'modal-title', text: o.title }),
      o.body ? h('p', { class: 'modal-body', text: o.body }) : null,
      err.el,
      okBtn,
      noBtn
    ]);
    const overlay = h('div', { class: 'modal' }, [panel]);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) {
      if (ev.key === 'Escape' && !busy) close();
    }
    noBtn.addEventListener('click', function () { if (!busy) close(); });
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay && !busy) close(); });
    okBtn.addEventListener('click', function () {
      noBtn.disabled = true;
      runBusy(okBtn, '送信中です…', async function () {
        try {
          await o.onConfirm();
          close();
        } catch (e) {
          if (e.code === 'auth') {
            close();
            return showAuthError(toMsg(e));
          }
          err.show(toMsg(e));
        }
      }).then(function () { noBtn.disabled = false; });
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    noBtn.focus();
  }

  // ---------------------------------------------------------------
  // view=admin（rid または cid）
  // ---------------------------------------------------------------
  async function viewAdmin(params, opts) {
    params = params || {};
    opts = opts || {};
    setTitle('1to1の記録');
    if (!params.rid && !params.cid) {
      return showMessage('入力する相手が指定されていません。', '入力待ち一覧から選んでください。', '入力待ち一覧を見る', function () { viewPending(); });
    }
    showLoading();
    let ctx;
    try {
      ctx = await api('adminContext', { rid: params.rid || undefined, cid: params.cid || undefined });
    } catch (e) {
      return handleError(e, function () { viewAdmin(params, opts); });
    }

    const cust = ctx.customer || {};
    const hist = ctx.history && typeof ctx.history === 'object' ? ctx.history : {};
    const hasHist = Object.keys(hist).length > 0;
    const periods = Array.isArray(ctx.periods) ? ctx.periods : [];

    const dateIn = h('input', { type: 'date', required: true, value: str(ctx.date) });
    const summaryIn = h('textarea', { rows: '5', maxlength: '2000', value: str(hist['概要']) });
    const memoIn = h('textarea', { rows: '5', maxlength: '5000', value: str(hist['自分用メモ']) });

    const curPeriod = str(hist['次の連絡までの期間']);
    const periodOptions = [h('option', { value: '', text: '設定しない（久しぶり連絡を送りません）' })];
    let found = false;
    periods.forEach(function (p) {
      const name = str(p['期間']);
      if (!name) return;
      if (name === curPeriod) found = true;
      const days = str(p['日数']);
      periodOptions.push(h('option', { value: name, text: days ? name + '（' + days + '日）' : name }));
    });
    if (curPeriod && !found) periodOptions.push(h('option', { value: curPeriod, text: curPeriod }));
    const periodSel = h('select', { value: curPeriod }, periodOptions);

    const frankSel = h('select', { value: str(hist['フランク度'] || '2') }, [
      h('option', { value: '1', text: '1 丁寧' }),
      h('option', { value: '2', text: '2 ふつう' }),
      h('option', { value: '3', text: '3 くだけた' })
    ]);

    const err = errorBox();
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: '保存する' });

    const form = h('form', {
      class: 'card',
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        err.clear();
        const date = dateIn.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          err.show('実施日を入力してください。');
          return;
        }
        const cid = str(cust['顧客ID']) || str(params.cid);
        if (!cid) {
          err.show('相手の情報が見つかりませんでした。画面を開き直してください。');
          return;
        }
        runBusy(saveBtn, '保存しています…', async function () {
          try {
            await api('adminSave', {
              rid: params.rid || undefined,
              cid: cid,
              date: date,
              summary: summaryIn.value.trim(),
              memo: memoIn.value.trim(),
              period: periodSel.value,
              frankness: Number(frankSel.value)
            });
          } catch (e) {
            if (e.code === 'auth') return showAuthError(toMsg(e));
            return err.show(toMsg(e));
          }
          showAdminDone(cust);
        });
      }
    }, [
      field('実施日', dateIn, null, true),
      field('概要', summaryIn, '相手のメニュー「1to1履歴」に表示されます。', false, h('span', { class: 'badge badge-public', text: '相手にも見えます' })),
      field('自分用メモ', memoIn, '自分だけが見るメモです。', false, h('span', { class: 'badge badge-private', text: '相手には見えません' })),
      field('次の連絡までの期間', periodSel, 'この期間がたつと、久しぶり連絡を自動で送ります（今後の予約がある方には送りません）。'),
      field('フランク度', frankSel, '久しぶり連絡の文面の口調に使います。'),
      err.el,
      saveBtn
    ]);

    const nodes = [
      h('div', { class: 'card person' }, [
        h('p', { class: 'person-name', text: (str(cust['名前']) || '（名前未登録）') + 'さん' }),
        cust['会社名'] ? h('p', { class: 'muted', text: str(cust['会社名']) }) : null
      ])
    ];
    if (hasHist) {
      nodes.push(h('div', { class: 'card card-notice' }, [
        h('p', { text: '入力済みの内容を表示しています。保存すると上書きします。' })
      ]));
    }
    nodes.push(form);
    if (opts.fromPending) nodes.push(button('一覧に戻る', function () { viewPending(); }, 'secondary'));
    render(nodes);
  }

  function showAdminDone(cust) {
    setTitle('保存しました');
    render([
      doneHead((str(cust['名前']) || '相手') + 'さんの記録を保存しました。'),
      button('入力待ち一覧を見る', function () { viewPending(); }, 'primary'),
      closeBtn()
    ]);
  }

  // ---------------------------------------------------------------
  // view=pending（管理者用）
  // ---------------------------------------------------------------
  async function viewPending() {
    setTitle('入力待ち一覧');
    showLoading();
    let r;
    try { r = await api('adminPending'); } catch (e) { return handleError(e, viewPending); }
    const items = Array.isArray(r.items) ? r.items : [];
    if (!items.length) {
      render([
        h('div', { class: 'card' }, [h('p', { class: 'strong', text: '入力待ちはありません。' })]),
        closeBtn()
      ]);
      return;
    }

    const list = h('ul', { class: 'list' }, items.map(function (it) {
      const isRes = it.kind === 'reservation' && it.rid;
      const target = isRes ? { rid: str(it.rid) } : { cid: str(it.cid) };
      const meta = [it.kind === 'first' ? '初回1to1' : '1to1', str(it.dateLabel)].filter(Boolean).join('　');
      return h('li', null, [
        h('button', {
          type: 'button',
          class: 'list-item',
          onclick: function () { viewAdmin(target, { fromPending: true }); }
        }, [
          h('span', { class: 'list-main' }, [
            h('span', { class: 'list-name', text: (str(it.name) || '（名前未登録）') + 'さん' }),
            it.company ? h('span', { class: 'list-sub', text: str(it.company) }) : null,
            h('span', { class: 'list-meta', text: meta })
          ]),
          h('span', { class: 'list-go', text: '入力する' })
        ])
      ]);
    }));

    render([
      h('p', { class: 'lead', text: '1to1の記録がまだの方です。選んで入力してください。' }),
      list,
      closeBtn()
    ]);
  }

  // ---------------------------------------------------------------
  // view が無い・不明
  // ---------------------------------------------------------------
  function viewUnknown() {
    setTitle('1to1');
    render([
      h('div', { class: 'card' }, [
        h('p', { class: 'strong', text: 'このページは、公式LINEのメニューから開いてください。' }),
        h('p', { class: 'muted', text: '登録や予約は、トーク画面の下にあるメニューからできます。' })
      ]),
      closeBtn()
    ]);
  }

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------
  function configReady() {
    const id = str(CFG.LIFF_ID).trim();
    const url = str(CFG.GAS_URL).trim();
    return !!id && id.indexOf('ここに') < 0 && /^https:\/\//.test(url);
  }

  // liff.init の then の中でだけ呼ぶ（init 前は URL に liff.state しか無いことがあるため）
  function readParams() {
    const out = {};
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (k.indexOf('liff.') === 0) return;
      out[k] = v;
    });
    return out;
  }

  function route(params) {
    switch (params.view) {
      case 'register': return viewRegister({});
      case 'book': return viewBook();
      case 'change': return viewChange(params);
      case 'admin': return viewAdmin(params, {});
      case 'pending': return viewPending();
      default: return viewUnknown();
    }
  }

  function main() {
    if (!configReady()) {
      setTitle('設定が必要です');
      render(h('div', { class: 'card card-error', role: 'alert' }, [
        h('p', { class: 'strong', text: 'config.js に LIFF_ID と GAS_URL を設定してください' })
      ]));
      return;
    }
    if (typeof liff === 'undefined') {
      setTitle('読み込みに失敗しました');
      showError('LINE の部品を読み込めませんでした。通信状況を確認して、画面を開き直してください。');
      return;
    }
    liff.init({ liffId: str(CFG.LIFF_ID).trim() }).then(function () {
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      route(readParams());
    }).catch(function (err) {
      setTitle('読み込みに失敗しました');
      showError('LINE の初期化に失敗しました。画面を開き直してください。', null, err && err.message ? str(err.message) : '');
    });
  }

  main();
})();
