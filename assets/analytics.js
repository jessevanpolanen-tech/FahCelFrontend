// Basic consent mode: no Google script, requests or analytics cookies before opt-in.
(function () {
  'use strict';
  var config = window.FahCelAnalyticsConfig || {};
  var id = config.measurementId || '';
  var configured = /^G-[A-Z0-9]+$/.test(id) && (config.allowedHosts || []).indexOf(location.hostname) !== -1;
  var key = 'fahcel_analytics_consent_v1';
  var lifetime = 180 * 24 * 60 * 60 * 1000;
  var lang = document.documentElement.lang.split('-')[0];
  var copy = {
    en: {
      title: 'Your privacy, your choice',
      body: 'May we use Google Analytics cookies to understand which pages and language versions are most popular? Only if you agree will Google receive usage data, including your IP address and page visits. The site works without analytics. We remember your choice for six months; you can change it anytime using Cookie settings.',
      accept: 'Allow analytics', reject: 'Reject analytics', settings: 'Cookie settings'
    },
    nl: {
      title: 'Jouw privacy, jouw keuze',
      body: 'Mogen we Google Analytics-cookies gebruiken om te zien welke pagina’s en taalversies het populairst zijn? Alleen met jouw toestemming ontvangt Google gebruiksgegevens, waaronder je IP-adres en paginabezoeken. De site werkt ook zonder analytics. We onthouden je keuze zes maanden; je kunt die altijd wijzigen via Cookie-instellingen.',
      accept: 'Analytics toestaan', reject: 'Analytics weigeren', settings: 'Cookie-instellingen'
    },
    de: {
      title: 'Deine Privatsphäre, deine Wahl',
      body: 'Dürfen wir Google-Analytics-Cookies verwenden, um zu erfahren, welche Seiten und Sprachversionen am beliebtesten sind? Nur mit deiner Zustimmung erhält Google Nutzungsdaten, einschließlich deiner IP-Adresse und Seitenaufrufe. Die Website funktioniert auch ohne Analytics. Wir speichern deine Wahl sechs Monate; du kannst sie jederzeit über Cookie-Einstellungen ändern.',
      accept: 'Analytics erlauben', reject: 'Analytics ablehnen', settings: 'Cookie-Einstellungen'
    }
  };
  if (!copy[lang]) lang = 'en';
  var text = copy[lang];
  var choice = null;
  var started = false;
  try {
    var saved = JSON.parse(localStorage.getItem(key));
    if (saved && Date.now() - saved.at < lifetime && ['granted', 'denied'].indexOf(saved.value) !== -1) choice = saved.value;
  } catch (e) { /* Storage can be unavailable; keep consent in memory for this page. */ }

  function startAnalytics() {
    if (!configured || choice !== 'granted' || started) return;
    started = true;
    window['ga-disable-' + id] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    // Use page language, not GA's built-in browser-language dimension.
    var page = location.pathname.replace(/\.html$/, '').replace(/\/$/, '').replace(/^\/(nl|de)(?=\/|$)/, '');
    if (!page || page === '/index') page = '/';
    // Do not send arbitrary query parameters, fragments or form values to Google.
    window.gtag('config', id, {
      send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: location.origin + location.pathname,
      page_referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : '',
      site_language: lang, page_group: page
    });
    window.gtag('event', 'page_view', {
      page_title: document.title, page_location: location.origin + location.pathname,
      site_language: lang, page_group: page
    });
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(script);
  }

  function clearAnalyticsCookies() {
    var parts = location.hostname.split('.');
    var domains = [''];
    for (var i = 0; i < parts.length - 1; i++) domains.push(parts.slice(i).join('.'));
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.trim().split('=')[0];
      if (!/^_ga(?:_|$)/.test(name)) return;
      domains.forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  var settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'fc-cookie-settings';
  settings.textContent = text.settings;
  settings.setAttribute('aria-controls', 'fc-consent');
  var banner = document.createElement('section');
  banner.id = 'fc-consent';
  banner.className = 'fc-consent';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-labelledby', 'fc-consent-title');
  banner.innerHTML = '<h2 id="fc-consent-title"></h2><p></p><div class="fc-consent-actions"><button type="button" data-consent="denied"></button><button type="button" data-consent="granted"></button></div>';
  banner.querySelector('h2').textContent = text.title;
  banner.querySelector('p').textContent = text.body;
  banner.querySelector('[data-consent="denied"]').textContent = text.reject;
  banner.querySelector('[data-consent="granted"]').textContent = text.accept;
  function show(open) {
    banner.hidden = !open;
    settings.hidden = open;
    settings.setAttribute('aria-expanded', String(open));
  }
  settings.addEventListener('click', function () {
    show(true);
    banner.querySelector('button').focus();
  });
  banner.querySelectorAll('button').forEach(function (button) {
    button.addEventListener('click', function () {
      choice = button.dataset.consent;
      try { localStorage.setItem(key, JSON.stringify({ value: choice, at: Date.now() })); } catch (e) {}
      if (choice === 'denied') {
        window['ga-disable-' + id] = true;
        clearAnalyticsCookies();
        // Unload Google's timers/listeners too; do not switch to cookieless pings.
        if (started) { location.reload(); return; }
      } else startAnalytics();
      show(false);
      settings.focus();
    });
  });
  document.body.appendChild(settings);
  document.body.appendChild(banner);
  show(choice === null);
  if (choice !== 'granted') clearAnalyticsCookies();
  startAnalytics();
})();
