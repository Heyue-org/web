// analytics.js
// 在页面里引入此脚本（放在 body 末尾），会尝试在 localStorage/cookie/indexedDB 中持久化 visitor_id 并向 /api/collect 发送一次打点。
// 目的：一年内按 visitor_id 去重，识别回访用户（在同一浏览器/设备上）。
(function(){
  function uuidv4(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
  function sha1(s){
    // 简单非加密 hash 以减少上传体积（用于 fingerprint）
    var h = 0;
    for (var i=0;i<s.length;i++){ h = (h<<5)-h + s.charCodeAt(i); h |= 0; }
    return (h>>>0).toString(16);
  }
  try {
    var KEY = 'heyue_vid_v1';
    var vid = null;
    try { vid = localStorage.getItem(KEY); } catch(e){}
    if (!vid){
      // try cookie
      var m = document.cookie.match(new RegExp('(^| )'+KEY+'=([^;]+)'));
      if (m) vid = decodeURIComponent(m[2]);
    }
    if (!vid){
      // try indexedDB (best-effort)
      try {
        var req = indexedDB.open('heyue-analytics',1);
        req.onsuccess = function(){ try {
          var db=req.result, tx=db.transaction('store','readonly'), st=tx.objectStore('store');
          var r=st.get(KEY); r.onsuccess = function(){ if (r.result) { vid = r.result; localStorage.setItem(KEY, vid); } };
        } catch(e){} };
      } catch(e){}
    }
    if (!vid){
      vid = uuidv4();
      try { localStorage.setItem(KEY, vid); } catch(e){}
      try { document.cookie = KEY + "=" + encodeURIComponent(vid) + "; path=/; max-age=" + (60*60*24*365); } catch(e){}
      try {
        var req2 = indexedDB.open('heyue-analytics',1);
        req2.onupgradeneeded = function(){ req2.result.createObjectStore('store'); };
        req2.onsuccess = function(){ var db=req2.result, tx=db.transaction('store','readwrite'); tx.objectStore('store').put(vid, KEY); };
      } catch(e){}
    }

    var fp = sha1(navigator.userAgent + '|' + screen.width + 'x' + screen.height + '|' + navigator.language + '|' + Intl.DateTimeFormat().resolvedOptions().timeZone);

    var payload = {
      visitor_id: vid,
      fingerprint: fp,
      path: location.pathname + location.search,
      referrer: document.referrer || null,
      ua: navigator.userAgent,
      ts: new Date().toISOString()
    };

    fetch('/api/collect', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function(){ /* 忽略 */ });
  } catch(e){ console.error('analytics error', e); }
})();
