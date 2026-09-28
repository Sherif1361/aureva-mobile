(() => {
  'use strict';
  const KEY = 'aureva-mobile-state-v1';
  const CONNECTION_KEY = 'aureva-mobile-connection-v1';
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  const fmtDate = new Intl.DateTimeFormat('ar-EG', {day:'numeric', month:'short', timeZone:'UTC'});
  const main = document.getElementById('main');
  const fileInput = document.getElementById('import-file');
  const connectionInput = document.getElementById('connection-file');
  const modeButton = document.getElementById('mode');
  const defaults = {v:2, rate:50.8, apartments:[], bookings:[], updatedAt:''};
  let data = load();
  let connection = loadConnection();
  let tab = 'today';
  let filter = 'upcoming';
  let search = '';
  let refreshing = false;
  let lastFailures = 0;

  function loadConnection() {
    try {
      const value = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
      return window.AurevaLive.validConnection(value) ? value : null;
    } catch { return null; }
  }

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || 'null');
      return valid(value) ? value : defaults;
    } catch { return defaults; }
  }
  function valid(value) {
    return !!value && Array.isArray(value.apartments) && Array.isArray(value.bookings)
      && value.apartments.length < 2000 && value.bookings.length < 50000;
  }
  function save(value) {
    localStorage.setItem(KEY, JSON.stringify(value));
    data = value;
    render();
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
    return fmtDate.format(new Date(value + 'T12:00:00Z'));
  }
  function money(booking) {
    const amount = Number(booking.amount);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    const cur = booking.cur === 'EGP' ? 'EGP' : 'USD';
    return new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(amount) + ' ' + cur;
  }
  function liveBookings() {
    return data.bookings.filter(b => b && apt(b.apt) && b.from && b.to && b.to > b.from
      && !/cancel|request|pending|inquir|declin|expir|رفض|طلب|انتظار|استفسار|ملغ/i.test(String(b.status || '')));
  }
  function apt(id) { return data.apartments.find(a => a.id === id); }
  function guestName(b) { return String(b.guest || 'ضيف'); }
  function status(b) {
    if (b.from <= today && b.to > today) return ['in','مقيم الآن'];
    if (b.from > today) return ['next','قادم'];
    return ['out','غادر'];
  }
  function stayCard(b) {
    const [tone,label] = status(b);
    const note = b.notes && !/^\d{8,}$/.test(String(b.notes).trim()) ? b.notes : b.guestCount;
    const info = [apt(b.apt)?.name || 'شقة غير محددة', b.platform || 'حجز', note || ''].filter(Boolean).join(' · ');
    const [day,month] = date(b.from).split(' ');
    return `<article class="stay"><div class="datebox"><strong>${esc(day)}</strong><span>${esc(month || '')}</span></div><div class="stay-main"><div class="name">${esc(guestName(b))}</div><div class="meta">${esc(info)}</div><div class="meta">${esc(date(b.from))} ← ${esc(date(b.to))}</div></div><div><span class="pill ${tone}">${label}</span>${money(b)?`<div class="amount" style="margin-top:9px">${esc(money(b))}</div>`:''}</div></article>`;
  }
  function empty(message) { return `<div class="empty">${message}</div>`; }
  function header(eyebrow,title,subtitle) { return `<p class="eyebrow">${eyebrow}</p><h1 class="title">${title}</h1><p class="subtitle">${subtitle}</p>`; }
  function noData() {
    return `<div class="card"><h2>ابدأ بنقل بياناتك</h2><p>استورد ملف JSON من Aureva Desk الحالي. النسخة دي بتحتفظ بالبيانات على جهازك وتفتح بسرعة حتى بدون إنترنت.</p><button class="primary" data-action="import">استيراد بيانات Aureva</button></div>`;
  }
  function renderToday() {
    const bookings = liveBookings();
    const active = bookings.filter(b => b.from <= today && b.to > today);
    const arriving = bookings.filter(b => b.from === today);
    const leaving = bookings.filter(b => b.to === today);
    const upcoming = bookings.filter(b => b.from > today).sort((a,b) => a.from.localeCompare(b.from));
    const sourceText = connection
      ? `آخر سحب من الشيت: ${data.updatedAt ? esc(new Date(data.updatedAt).toLocaleString('ar-EG',{dateStyle:'short',timeStyle:'short'})) : 'لم يتم بعد'}`
      : 'اربط الشيت علشان الحجوزات تتحدث تلقائيًا.';
    return header('مكتب Aureva','إقاماتك',sourceText) +
      (connection ? `<button type="button" class="refresh-button" data-action="refresh" ${refreshing?'disabled':''}>${refreshing?'جاري تحديث الحجوزات…':'↻ تحديث الحجوزات الآن'}</button>` : '') +
      `<div class="hero"><div class="label">الإقامات الجارية</div><div class="value">${active.length}</div><div class="foot">${arriving.length} وصول اليوم · ${leaving.length} مغادرة اليوم</div></div>
       <div class="stats"><div class="stat"><div class="label">الشقق</div><div class="value">${data.apartments.length}</div></div><div class="stat"><div class="label">الحجوزات القادمة</div><div class="value">${upcoming.length}</div></div></div>` +
      (data.apartments.length ? `<div class="section-head"><h2>القادم</h2><span class="count">أقرب 5 حجوزات</span></div><div class="list">${upcoming.slice(0,5).map(stayCard).join('') || empty('لا توجد حجوزات قادمة في البيانات المحفوظة.')}</div>` : noData());
  }
  function renderStays() {
    let rows = liveBookings();
    if (filter === 'upcoming') rows = rows.filter(b => b.to > today);
    else if (filter === 'active') rows = rows.filter(b => b.from <= today && b.to > today);
    else if (filter === 'past') rows = rows.filter(b => b.to <= today);
    if (search) rows = rows.filter(b => [b.guest,b.platform,b.code,b.notes,apt(b.apt)?.name].some(v => String(v || '').toLocaleLowerCase().includes(search.toLocaleLowerCase())));
    rows.sort((a,b) => filter === 'past' ? b.from.localeCompare(a.from) : a.from.localeCompare(b.from));
    return header('الإقامات','الحجوزات','ابحث عن الضيف أو الشقة أو رقم التأكيد.') +
      `<input id="search" class="search" type="search" placeholder="بحث في الحجوزات" value="${esc(search)}" aria-label="بحث في الحجوزات">
       <div class="filters">${[['upcoming','القادمة'],['active','الجارية'],['past','السابقة'],['all','الكل']].map(([id,label])=>`<button type="button" class="filter ${filter===id?'active':''}" data-filter="${id}">${label}</button>`).join('')}</div>
       <div class="section-head"><h2>النتائج</h2><span class="count">${rows.length} حجز</span></div><div class="list">${rows.slice(0,250).map(stayCard).join('') || empty('لا توجد حجوزات مطابقة.')}</div>`;
  }
  function renderFlats() {
    const rows = data.apartments.slice().sort((a,b) => ({my:0,beetak:1,cohost:2}[a.sec] ?? 3) - ({my:0,beetak:1,cohost:2}[b.sec] ?? 3) || a.name.localeCompare(b.name));
    const bookings = liveBookings();
    const linked = new Set(connection ? window.AurevaLive.targets(connection).flatMap(t => t.aptId ? [t.aptId] : connection.apartments.filter(a => a.sec === t.section).map(a => a.id)) : []);
    return header('الوحدات','الشقق','حالة كل شقة والحجوزات المسجلة لها.') +
      `<div class="list">${rows.map(a => {
        const stays = bookings.filter(b => b.apt === a.id);
        const current = stays.find(b => b.from <= today && b.to > today);
        const next = stays.filter(b => b.from > today).sort((x,y)=>x.from.localeCompare(y.from))[0];
        return `<article class="flat"><div class="flat-top"><div class="name">${esc(a.name)}</div><span class="pill ${current?'in':'next'}">${current?'مشغولة':'متاحة'}</span></div><div class="meta">${esc(({my:'شققك',beetak:'Beetak',cohost:'Co-hosts'}[a.sec] || a.sec || '') + (a.area?' · '+a.area:''))}</div><div class="flat-row"><span>${stays.length} إقامة مسجلة · ${linked.has(a.id)||a.id.startsWith('beetak:')?'متصل بالشيت':'نسخة الجهاز'}</span><strong>${current?'حتى '+date(current.to):next?'القادم '+date(next.from):'لا يوجد حجز قادم'}</strong></div></article>`;
      }).join('') || empty('لا توجد شقق في البيانات المحفوظة.')}</div>`;
  }
  function renderSettings() {
    return header('تفضيلاتك','الإعدادات','بياناتك محفوظة على هذا الجهاز.') +
      `<div class="card"><h2>تحديث مباشر من الشيت</h2><p>${connection?'الاتصال محفوظ على هذا الجهاز. التطبيق يسحب الحجوزات عند الفتح، وتقدر تحدثها يدويًا.':'استورد ملف اتصال Aureva الخاص بك مرة واحدة لتحديث الحجوزات مباشرة من Google Sheets.'}</p><button class="primary" data-action="connect">${connection?'تغيير ملف الاتصال':'ربط الشيت'}</button>${connection?`<button class="secondary connection-refresh" data-action="refresh" ${refreshing?'disabled':''}>${refreshing?'جاري التحديث…':'تحديث الآن'}</button>`:''}${lastFailures?`<p class="note danger">${lastFailures} شيت لم يرد في آخر محاولة؛ بياناته القديمة محفوظة.</p>`:''}</div>` +
      `<div class="card"><h2>استيراد بياناتك</h2><p>احفظ ملف Aureva JSON الخاص بك في تطبيق الملفات على iPhone، ثم اختَره هنا. الاستيراد يستبدل النسخة المحلية على هذا الجهاز فقط.</p><button class="primary" data-action="import">اختيار ملف JSON</button></div>
       <div class="card"><h2>نسخة احتياطية</h2><p>${data.updatedAt?'آخر تحديث في الملف: '+esc(data.updatedAt.slice(0,16).replace('T',' ')):'لم يتم استيراد بيانات بعد.'}</p><button class="secondary" data-action="export">تنزيل نسخة من البيانات</button></div>
       <div class="card"><h2>التثبيت على iPhone</h2><p>من Safari اختَر مشاركة ← إضافة إلى الشاشة الرئيسية، وفعّل «فتح كتطبيق». بعد التثبيت افتحه من أيقونة Aureva.</p><p class="note">الحجوزات للعرض، وتحديثها يعتمد على الشيتات المتصلة. الشقق غير المرتبطة تظل من النسخة المحفوظة.</p></div>`;
  }
  function render() {
    main.innerHTML = ({today:renderToday,stays:renderStays,flats:renderFlats,settings:renderSettings}[tab] || renderToday)();
    document.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    modeButton.textContent = refreshing ? '↻ جاري التحديث' : connection ? (lastFailures ? 'تحديث جزئي' : '↻ متصل بالشيت') : 'نسخة الجهاز';
  }

  async function refreshLive() {
    if (!connection || refreshing) return;
    refreshing = true; render();
    try {
      const result = await window.AurevaLive.refresh(connection, data);
      lastFailures = result.failures.length;
      save(result.data);
      toast(lastFailures ? `تم تحديث بعض الشيتات، وتعذر تحديث ${lastFailures}.` : 'الحجوزات محدثة من الشيت.');
    } catch (error) { toast(error.message || 'تعذر تحديث الحجوزات.'); }
    finally { refreshing = false; render(); }
  }
  function toast(message) {
    document.querySelector('.notice')?.remove();
    const element = document.createElement('div');
    element.className = 'notice'; element.textContent = message;
    document.body.append(element);
    setTimeout(() => element.remove(), 4500);
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-tab],[data-filter],[data-action]');
    if (!target) return;
    if (target.dataset.tab) { tab = target.dataset.tab; render(); window.scrollTo(0,0); }
    if (target.dataset.filter) { filter = target.dataset.filter; render(); }
    if (target.dataset.action === 'import') fileInput.click();
    if (target.dataset.action === 'connect') connectionInput.click();
    if (target.dataset.action === 'refresh') refreshLive();
    if (target.dataset.action === 'export') {
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'aureva-mobile-data.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'search') return;
    search = event.target.value;
    const pos = event.target.selectionStart;
    render();
    const input = document.getElementById('search'); input.focus(); input.setSelectionRange(pos,pos);
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5_000_000) { toast('الملف أكبر من الحد المسموح.'); return; }
    try {
      const incoming = JSON.parse(await file.text());
      if (!valid(incoming)) throw new Error('invalid');
      if (!confirm(`استيراد ${incoming.apartments.length} شقة و${incoming.bookings.length} حجز واستبدال النسخة المحلية؟`)) return;
      save(incoming); toast('تم استيراد البيانات بنجاح.');
    } catch { toast('ملف JSON غير صالح لبيانات Aureva.'); }
    finally { fileInput.value = ''; }
  });
  connectionInput.addEventListener('change', async () => {
    const file = connectionInput.files[0];
    if (!file) return;
    if (file.size > 100_000) { toast('ملف الاتصال كبير جدًا.'); return; }
    try {
      const incoming = JSON.parse(await file.text());
      if (!window.AurevaLive.validConnection(incoming)) throw new Error('invalid');
      localStorage.setItem(CONNECTION_KEY, JSON.stringify(incoming));
      connection = incoming;
      if (!data.apartments.length) save({...data,apartments:incoming.apartments.map(a => ({id:a.id,sec:a.sec,name:a.name,code:a.code||'',area:''}))});
      render();
      refreshLive();
    } catch { toast('ملف اتصال Aureva غير صالح.'); }
    finally { connectionInput.value = ''; }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  render();
  if (connection) refreshLive();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && connection && !refreshing && (!data.updatedAt || Date.now() - new Date(data.updatedAt).getTime() > 10 * 60 * 1000)) refreshLive();
  });
})();
