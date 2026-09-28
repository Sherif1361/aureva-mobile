/* Google Sheets bridge reader. The private connection file is never published. */
(() => {
  'use strict';

  const BAD_STATUS = /cancel|request|pending|inquir|declin|expir|tentative|رفض|طلب|انتظار|استفسار|ملغ/i;
  const pick = (row, keys) => keys.map(key => row[key]).find(value => value !== undefined && value !== null && String(value).trim() !== '') || '';
  const asText = value => String(value == null ? '' : value).trim();
  const asDate = value => /^\d{4}-\d{2}-\d{2}$/.test(asText(value)) ? asText(value) : '';
  const asAmount = value => {
    const number = Number(asText(value).replace(/,/g, ''));
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  function validConnection(config) {
    return !!config && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(asText(config.url))
      && Array.isArray(config.apartments) && config.apartments.length > 0 && config.apartments.length < 200
      && config.apartments.every(a => typeof a.id === 'string' && typeof a.name === 'string')
      && (!config.beetakSheetId || /^[A-Za-z0-9_-]+$/.test(config.beetakSheetId));
  }

  function targets(config) {
    const own = config.apartments.filter(a => a.sheetId).map(a => ({
      sheetId:a.sheetId, tab:a.sheetTab || 'Revenue', aptId:a.id, section:a.sec,
    }));
    if (config.beetakSheetId) own.push({
      sheetId:config.beetakSheetId, tab:config.beetakTab || 'Operations Tracker', section:'beetak',
    });
    // The shared Aureva book contains units outside this personal 18-flat list.
    // Add it only when an explicit apartment-code mapping is available.
    return own;
  }

  function apartmentFor(row, target, config) {
    if (target.aptId) return config.apartments.find(a => a.id === target.aptId);
    const code = asText(pick(row, ['apartment', 'apartment code', 'code'])).toUpperCase();
    return config.apartments.find(a => a.sec === target.section && asText(a.code).toUpperCase() === code)
      || (target.section === 'beetak' && /^APT\d+$/.test(code)
        ? {id:'beetak:' + code,sec:'beetak',code,name:'Beetak · ' + code,area:''} : null);
  }

  function bookingFromRow(row, target, config) {
    const apartment = apartmentFor(row, target, config);
    if (!apartment) return null;
    const from = asDate(pick(row, ['from date', 'check-in date', 'check-in', 'from']));
    const to = asDate(pick(row, ['to date', 'check-out date', 'checkout', 'to']));
    if (!from || !to || to <= from) return null;
    const bookingStatus = asText(pick(row, ['reservation status', 'booking status', 'status', 'progress']));
    if (BAD_STATUS.test(bookingStatus)) return null;
    const platform = asText(pick(row, ['booking method', 'platform'])) || 'حجز';
    const amount = asAmount(pick(row, ['received amount', 'total payout', 'amount', 'payout']));
    const code = asText(pick(row, ['confirmation code', 'confirmation number', 'ref', 'operation booking id']));
    const guest = asText(pick(row, ['guest name', 'guest'])) || 'ضيف';
    const guestCount = asText(pick(row, ['number of guests', 'guests']));
    const notes = asText(pick(row, ['notes', 'note']));
    // Future Airbnb dates without a confirmation or a recorded payment can be
    // calendar holds and requests. Never present those as confirmed stays.
    if (/airbnb/i.test(platform) && from >= new Date().toISOString().slice(0, 10) && !code && !amount) return null;
    return {
      id:`sheet:${target.sheetId}:${target.tab}:${row._row || code || from}`,
      apt:apartment.id, guest, platform, from, to, amount,
      cur:asText(pick(row, ['received currency', 'currency'])) || 'USD',
      notes, guestCount, status:'confirmed', code, source:'sheet-live',
    };
  }

  async function pullTarget(config, target, fetcher = fetch) {
    const response = await fetcher(config.url, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({secret:config.secret || '',action:'pull',data:{sheetId:target.sheetId,tab:target.tab}}),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.json();
    if (!body || body.ok !== true || !Array.isArray(body.rows)) throw new Error('Bridge rejected pull');
    return body.rows.map(row => bookingFromRow(row, target, config)).filter(Boolean);
  }

  async function refresh(config, current, fetcher = fetch) {
    const plans = targets(config);
    const settled = await Promise.allSettled(plans.map(target => pullTarget(config, target, fetcher)));
    const successful = settled.flatMap((result, index) => result.status === 'fulfilled' ? [{target:plans[index], rows:result.value}] : []);
    const failures = settled.flatMap((result, index) => result.status === 'rejected' ? [{target:plans[index], reason:String(result.reason?.message || result.reason)}] : []);
    if (!successful.length) throw new Error('تعذر تحديث كل الشيتات. تحقق من الاتصال وحاول مرة أخرى.');
    const refreshedApts = new Set(successful.flatMap(({target}) => target.aptId
      ? [target.aptId]
      : config.apartments.filter(a => a.sec === target.section).map(a => a.id)));
    successful.flatMap(item => item.rows).forEach(booking => refreshedApts.add(booking.apt));
    const apartments = Array.isArray(current.apartments) && current.apartments.length
      ? current.apartments.slice() : config.apartments.map(a => ({id:a.id,sec:a.sec,name:a.name,code:a.code||'',area:''}));
    successful.flatMap(item => item.rows).forEach(booking => {
      if (apartments.some(apartment => apartment.id === booking.apt)) return;
      if (booking.apt.startsWith('beetak:')) {
        const code = booking.apt.slice('beetak:'.length);
        apartments.push({id:booking.apt,sec:'beetak',name:'Beetak · ' + code,code,area:''});
      }
    });
    const bookings = [
      ...(current.bookings || []).filter(b => !refreshedApts.has(b.apt)),
      ...successful.flatMap(item => item.rows),
    ];
    return {data:{...current,apartments,bookings,updatedAt:new Date().toISOString()},
      refreshedApts:[...refreshedApts], failures};
  }

  const api = {validConnection,targets,bookingFromRow,refresh};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AurevaLive = api;
})();
