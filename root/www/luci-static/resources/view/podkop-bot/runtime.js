'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callActiveProbe = rpc.declare({ object:'podkop_bot', method:'active_probe', params:['cached','section','proxy','label'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });
var callTransportState = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callTransportProbe = rpc.declare({ object:'podkop_bot', method:'transport_probe', params:['target'] });
var callEnsureMixedProxy = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy', params:['section'] });
var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callWarpShortlist = rpc.declare({ object:'podkop_bot_warpscout', method:'shortlist' });
var callWarpRtStatus = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'status' });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) {
	return E('span', { 'style':'display:inline-flex;align-items:flex-start;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';' }),
		E('span', {}, label)
	]);
}
function pbInjectCss() {
	if (document.getElementById('pb-css')) return;
	document.querySelector('head').appendChild(E('link', {
		'id':'pb-css', 'rel':'stylesheet', 'type':'text/css',
		'href': L.resource('css/podkop-bot/podkop-bot.css')
	}));
}
function row(label, valNode) {
	return E('div', { 'class':'pb-row pb-row--plain' }, [
		E('span', { 'class':'pb-row-label' }, label),
		E('span', { 'class':'pb-row-val' }, [ valNode ])
	]);
}
function pbFooter() {
	var callAppInfo = rpc.declare({ object: 'podkop_bot', method: 'app_info' });
	var span = E('span', {}, '');
	var box = E('div', { 'style': 'max-width:820px;margin-top:1.2em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.15);color:#888;font-size:85%;text-align:right;' }, [ span ]);
	callAppInfo().then(function(a) {
		if (a && a.ok) {
			dom.content(span, [
				E('span', {}, 'luci-app-podkop-bot v' + (a.luci_app_version || '?') + ' · '),
				E('a', { 'href': a.repo || 'https://github.com/Medvedolog/luci-app-podkop-bot', 'target': '_blank', 'rel': 'noopener' }, _('репозиторий'))
			]);
		}
	}).catch(function(){});
	return box;
}

return view.extend({
	load: function() {
		pbInjectCss();
		return Promise.all([
			callRuntimeSections().catch(function(){ return null; }),
			callActiveProbe('true', '', '', '').catch(function(){ return null; }),
			callTransportState().catch(function(){ return null; }),
			callWarpStatus('').catch(function(){ return null; }),
			callWarpShortlist().catch(function(){ return null; }),
			callWarpRtStatus().catch(function(){ return null; })
		]);
	},

	render: function(data) {
		var self = this;
		var sectionsData = data[0];
		var probeData = data[1];
		var transportData = data[2];
		this.warpStatus = data[3] || null;
		this.warpShortlist = data[4] || null;
		this.warpRuntime = data[5] || null;
		this.sections = (sectionsData && sectionsData.sections) ? sectionsData.sections : [];
		this.selectedSection = (sectionsData && sectionsData.active_section) ? sectionsData.active_section : '';
		this.sectionsMeta = sectionsData || {};
		this.tierProxies = [];
		if (transportData && transportData.available) {
			var t1 = transportData.tier1;
			if (t1 && t1.endpoint) {
				var t1host = t1.endpoint.replace(/^socks5h?:\/\//, '');
				this.tierProxies.push({ endpoint: t1.endpoint, label: _('tier1 · Mixed Proxy') + ' — ' + t1host });
			}
			(transportData.tier2_fallback_socks || []).forEach(function(ep, i){
				if (ep) {
					var h = ep.replace(/^socks5h?:\/\//, '').replace(/^[^@]*@/, '');
					self.tierProxies.push({ endpoint: ep, label: _('tier2 · резерв #') + (i+1) + ' — ' + h });
				}
			});
			if (transportData.tier3_custom_proxy) {
				var t3 = transportData.tier3_custom_proxy;
				var t3h = t3.replace(/^socks5h?:\/\//, '').replace(/^[^@]*@/, '');
				this.tierProxies.push({ endpoint: t3, label: _('tier3 · свой прокси') + ' — ' + t3h });
			}
		}
		if (this.warpRuntime && this.warpRuntime.running && this.warpRuntime.proxy) {
			this.tierProxies.push({ endpoint: this.warpRuntime.proxy, label: _('WARP Rescue · WARPSCOUT · test route') + ' — ' + this.warpRuntime.proxy });
		}
		this.selectedProxy = '';
		this.selectedProxyLabel = '';

		var body = E('div', { 'id':'podkop-runtime-body' }, this.renderProbe(probeData));
		this.body = body;
		var runBtn = E('button', {
			'class':'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, 'runProbe')
		}, (this.sections.length > 1 || this.tierProxies.length > 0) ? _('Проверить выбранный') : _('Проверить сейчас'));
		this.runBtn = runBtn;
		var tgBody = E('div', { 'id':'podkop-runtime-tg', 'style':'margin:.5em 0;' });
		this.tgBody = tgBody;
		var tgBtn = E('button', { 'class':'cbi-button', 'click': ui.createHandlerFn(this, 'runTelegramProbe') }, _('Проверить Telegram API'));
		this.tgBtn = tgBtn;
		var selectorRow = E('span', {});
		var totalChoices = this.sections.length + this.tierProxies.length;
		if (totalChoices > 1) {
			var optSections = this.sections.map(function(s){
				return E('option', { 'value': 'sec:' + s.name, 'selected': (s.name === self.selectedSection && !self.selectedProxy) ? '' : null }, s.name + (s.enabled_for_runtime ? '' : _(' (без Mixed Proxy)')));
			});
			var groups = [ E('optgroup', { 'label': _('Маршруты Podkop') }, optSections) ];
			if (this.tierProxies.length > 0) {
				var optProxies = this.tierProxies.map(function(p){ return E('option', { 'value': 'proxy:' + p.endpoint, 'data-label': p.label }, p.label); });
				groups.push(E('optgroup', { 'label': _('Транспортные маршруты') }, optProxies));
			}
			var sel = E('select', { 'class':'cbi-input-select', 'style':'width:100%;max-width:500px;box-sizing:border-box;', 'change': ui.createHandlerFn(this, 'onTargetChange') }, groups);
			this.targetSelect = sel;
			selectorRow = E('div', { 'style':'margin-bottom:.5em;' }, [
				E('label', { 'style':'display:block;color:#888;font-size:90%;margin-bottom:.2em;' }, _('Маршрут проверки')),
				sel
			]);
			/* Browsers may restore a previous <select> value without firing change.
			 * Keep JS routing state aligned with what the user actually sees. */
			window.setTimeout(function(){ self.syncSelectedTarget(); }, 0);
		}
		var batchBtn = E('span', {});
		if (this.sections.length > 1 || this.tierProxies.length > 0) {
			batchBtn = E('button', { 'class':'cbi-button', 'click': ui.createHandlerFn(this, 'runAllProbes') }, _('Проверить все маршруты'));
			this.batchBtn = batchBtn;
		}
		var cpHost = E('input', { 'type':'text', 'class':'cbi-input-text pb-mono', 'placeholder':_('хост / IP') });
		var cpPort = E('input', { 'type':'text', 'class':'cbi-input-text pb-mono', 'placeholder':_('порт') });
		var cpUser = E('input', { 'type':'text', 'class':'cbi-input-text pb-mono', 'placeholder':_('логин, необязательно') });
		var cpPass = E('input', { 'type':'password', 'class':'cbi-input-text pb-mono', 'placeholder':_('пароль, необязательно') });
		var cpType = E('select', { 'class':'cbi-input-select' }, [
			E('option', { 'value':'socks5h' }, 'socks5h — DNS через прокси'),
			E('option', { 'value':'socks5' }, 'socks5 — DNS локально'),
			E('option', { 'value':'http' }, 'http'),
			E('option', { 'value':'https' }, 'https')
		]);
		this._cp = { host: cpHost, port: cpPort, user: cpUser, pass: cpPass, type: cpType };
		var cpForm = E('div', { 'class':'pb-manual-proxy-card', 'style':'display:none;' }, [
			E('h3', { 'style':'margin:0 0 .6em;' }, _('Ручной прокси')),
			E('div', { 'class':'pb-manual-proxy-grid' }, [ cpType, cpHost, cpPort ]),
			E('div', { 'class':'pb-manual-proxy-auth' }, [ cpUser, cpPass ]),
			E('div', { 'class':'pb-manual-proxy-actions' }, [ E('button', { 'class':'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'runCustomProxy') }, _('Проверить через этот прокси')) ]),
			E('p', { 'class':'pb-manual-proxy-note' }, _('Логин и пароль используются только для этой проверки — не сохраняются, не кэшируются, в результате пароль маскируется. Тип — это протокол прокси (curl -x), а не «проверить HTTPS-сайт».'))
		]);
		this.cpForm = cpForm;
		var cpToggle = E('button', { 'class':'cbi-button', 'click': function() { var open = cpForm.style.display !== 'none'; cpForm.style.display = open ? 'none' : 'block'; this.textContent = open ? _('Ручной прокси ▸') : _('Ручной прокси ▾'); } }, _('Ручной прокси ▸'));

		return E('div', {}, [
			E('h2', {}, _('Runtime — тест сервисов')),
			E('p', { 'class':'pb-muted' }, _('Проверка туннеля: страна и провайдер выхода, доступность 12 сервисов и их регионы, скорость, признаки блокировок ТСПУ. Маршрут — это через что идёт проверка: секция Podkop, транспортный, WARP или ручной прокси.')),
			E('p', { 'style':'color:#c60;font-size:90%;margin-top:-.4em;' }, _('⚠ Полная проверка идёт 15–60 секунд и нагружает роутер (параллельные запросы + загрузка до 8 МиБ через туннель). Быстрая кнопка Telegram API проверяет только реальный getMe и почти не создаёт трафика.')),
			selectorRow,
			E('div', { 'style':'margin:.6em 0;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [ runBtn, batchBtn, cpToggle, tgBtn ]),
			cpForm,
			tgBody,
			body,
			pbFooter()
		]);
	},

	renderWarpRuntime: function() {
		var st = this.warpStatus, sl = this.warpShortlist, rt = this.warpRuntime;
		if (!st || !st.installed) return E('span', {});
		var cfg = st.config || {}, active = cfg.active_endpoint || '—', item = st.active_snapshot || null;
		if (!item) (sl && sl.items || []).some(function(x){ if (x.endpoint === active) { item = x; return true; } return false; });
		var tg = rt && rt.telegram || {}, tgNode = dot('grey', _('ещё не проверялся'));
		if (tg.status === 'OK') tgNode = dot('green', _('OK') + (tg.http ? (' · HTTP ' + tg.http) : ''));
		else if (tg.status === 'RATE_LIMITED') tgNode = dot('yellow', _('Telegram доступен · rate limited (429)'));
		else if (tg.status === 'AUTH_ERROR') tgNode = dot('yellow', _('Telegram доступен · auth error (401)'));
		else if (tg.status === 'API_DENIED') tgNode = dot('yellow', _('Telegram доступен · API denied (403)'));
		else if (tg.status === 'OTHER_API_RESPONSE') tgNode = dot('yellow', _('Telegram отвечает · HTTP ') + (tg.http || '?'));
		else if (tg.status === 'NETWORK_FAIL') tgNode = dot('red', _('NETWORK_FAIL') + (tg.curl_rc ? (' · curl ' + tg.curl_rc) : ''));
		var checked = item && item.checked_at ? this.ago(parseInt(item.checked_at,10)) : '—';
		var tgChecked = tg.checked_at ? this.ago(parseInt(tg.checked_at,10)) : '—';
		return E('div', { 'class':'cbi-section pb-card', 'style':'max-width:820px;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('WARPSCOUT / WARP Rescue')),
			E('p', { 'class':'pb-muted' }, _('Только наблюдение. Scout snapshot и состояние тестового SOCKS показаны отдельно, чтобы не принимать старый scan за живой tunnel state.')),
			row(_('Active endpoint'), E('span', {}, active)),
			row(_('Protocol'), E('span', {}, String(cfg.protocol || '—').toUpperCase())),
			row(_('NODE'), E('span', {}, item && item.node || '—')),
			row(_('NODE LOCATION'), E('span', {}, item && item.node_location || '—')),
			row(_('SEEN AS'), E('span', {}, item && item.seen_as || '—')),
			row(_('Endpoint ping'), E('span', {}, item && item.endpoint_ping || '—')),
			row(_('Tunnel ping / loss'), E('span', {}, (item && item.tunnel_ping || '—') + ' / ' + (item && item.loss || '—'))),
			row(_('Scout data age'), E('span', {}, checked)),
			row(_('SOCKS process'), rt && rt.running ? dot('green', _('running') + (rt.pid ? (' · PID ' + rt.pid) : '') + (rt.rss_mb != null ? (' · RSS ' + rt.rss_mb + ' MB') : '')) : dot('grey', rt && rt.state || _('stopped'))),
			row(_('Local SOCKS'), E('span', {}, rt && rt.proxy || ('socks5h://127.0.0.1:' + (cfg.socks_port || 18191)))),
			row(_('Telegram API'), tgNode),
			(tg.proxy ? row(_('Telegram test route'), E('span', {}, tg.proxy)) : E('span', {})),
			(tg.error ? row(_('Telegram error'), E('span', {}, tg.error)) : E('span', {})),
			row(_('Telegram test age'), E('span', {}, tgChecked)),
			E('div', { 'style':'margin-top:.7em;' }, [ E('a', { 'class':'cbi-button', 'href':L.url('admin/services/podkop-bot/transport/warpscout') }, _('Открыть WARP Rescue')) ])
		]);
	},

	renderTelegramProbe: function(d, label) {
		if (!d) return E('div', { 'class':'cbi-section pb-wide' }, dot('red', _('Telegram probe не завершился.')));
		var colour = d.verified_bot_api ? 'green' : (d.telegram_reached ? 'yellow' : 'red');
		var text;
		if (d.verified_bot_api) text = _('Telegram Bot API подтверждён') + (d.bot_username ? (' · @' + d.bot_username) : '');
		else if (d.telegram_reached) text = _('Telegram отвечает, но getMe не подтверждён') + (d.reason ? (' · ' + d.reason) : '');
		else text = _('Telegram через этот маршрут недоступен') + (d.reason ? (' · ' + d.reason) : '');
		return E('div', { 'class':'cbi-section pb-wide', 'style':'margin:.5em 0;padding:.65em .9em;' }, [ dot(colour, text), E('div', { 'style':'color:#888;font-size:85%;margin-top:.3em;' }, (label || d.target || '') + (d.http ? (' · HTTP ' + d.http) : '') + (d.latency_ms != null ? (' · ' + d.latency_ms + ' ms') : '')) ]);
	},

	syncSelectedTarget: function() {
		if (!this.targetSelect) return;
		var sel = this.targetSelect, v = sel.value || '';
		if (v.indexOf('proxy:') === 0) {
			this.selectedProxy = v.slice(6);
			this.selectedSection = '';
			var opt = sel.options[sel.selectedIndex];
			this.selectedProxyLabel = (opt && opt.getAttribute('data-label')) || this.selectedProxy;
		} else {
			this.selectedProxy = '';
			this.selectedProxyLabel = '';
			this.selectedSection = (v.indexOf('sec:') === 0) ? v.slice(4) : v;
		}
	},

	runTelegramProbe: function() {
		var self = this, target = '', label = '';
		this.syncSelectedTarget();
		if (this.selectedProxy) { target = this.selectedProxy; label = this.selectedProxyLabel || target; }
		else {
			var name = this.selectedSection || '';
			var sec = (this.sections || []).filter(function(x){ return x.name === name; })[0];
			if (sec) { target = sec.endpoint || ''; label = sec.name + (target ? (' · ' + target) : ''); }
		}
		if (!target) { dom.content(this.tgBody, this.renderTelegramProbe({ telegram_reached:false, reason:'mixed_proxy_disabled' }, label)); return; }
		this.tgBtn.disabled = true;
		dom.content(this.tgBody, E('div', {}, dot('grey', _('Проверяю реальный Telegram getMe через: ') + label)));
		return callTransportProbe(target).then(function(d) { dom.content(self.tgBody, self.renderTelegramProbe(d, label)); self.tgBtn.disabled = false; }).catch(function() { dom.content(self.tgBody, self.renderTelegramProbe(null, label)); self.tgBtn.disabled = false; });
	},

	runCustomProxy: function() {
		var self = this;
		var host = (this._cp.host.value || '').trim(), port = (this._cp.port.value || '').trim(), user = (this._cp.user.value || '').trim(), pass = (this._cp.pass.value || ''), type = this._cp.type.value || 'socks5h';
		var warn = function(msg){ dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, dot('yellow', msg))); };
		if (['socks5h','socks5','http','https'].indexOf(type) < 0) { warn(_('Недопустимый тип прокси.')); return; }
		if (!host) { warn(_('Укажите хост или IP.')); return; }
		var pnum = parseInt(port, 10);
		if (!/^[0-9]+$/.test(port) || pnum < 1 || pnum > 65535) { warn(_('Порт должен быть числом 1–65535.')); return; }
		if (pass && !user) { warn(_('Пароль указан без логина — уберите пароль или добавьте логин.')); return; }
		var auth = user ? (encodeURIComponent(user) + (pass ? ':' + encodeURIComponent(pass) : '') + '@') : '';
		var endpoint = type + '://' + auth + host + ':' + port;
		var label = type + '://' + (user ? (user + ':***@') : '') + host + ':' + port;
		this.runBtn.disabled = true;
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' }, dot('grey', _('Проверка ручного прокси… (15–40 секунд)'))));
		return callActiveProbe('', '', endpoint, label).then(function(d) { dom.content(self.body, self.renderProbe(d)); }).catch(function(e){ dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [ dot('red', _('Проба не завершилась (превышено время или ошибка вызова).')), E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '') ])); }).finally(function(){ self.runBtn.disabled = false; });
	},

	enableMixedProxy: function(section) {
		var self = this;
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' }, dot('grey', _('Включаю Mixed Proxy для секции ') + section + '…')));
		return callEnsureMixedProxy(section).then(function(r) {
			if (r && (r.ok || r.already_enabled)) {
				return callRuntimeSections().catch(function(){ return self.sectionsMeta; }).then(function(sd) {
					if (sd && sd.sections) { self.sections = sd.sections; self.sectionsMeta = sd; }
					return callActiveProbe('', section).then(function(d) { dom.content(self.body, self.renderProbe(d)); });
				});
			}
			dom.content(self.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [ dot('yellow', _('Не удалось включить Mixed Proxy')), E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (r && r.detail) ? r.detail : (r && r.reason ? r.reason : '')) ]));
		}).catch(function(e){ dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [ dot('red', _('Ошибка включения Mixed Proxy')), E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '') ])); });
	},

	onTargetChange: function(ev) {
		var self = this;
		this.syncSelectedTarget();
		if (this.selectedProxy) {
			return callActiveProbe('true', '', this.selectedProxy, this.selectedProxyLabel).then(function(d) { dom.content(self.body, self.renderProbe(d)); }).catch(function(){ dom.content(self.body, self.renderProbe(null)); });
		}
		return callActiveProbe('true', this.selectedSection, '', '').then(function(d) { dom.content(self.body, self.renderProbe(d)); }).catch(function() { dom.content(self.body, self.renderProbe(null)); });
	},

	runProbe: function() {
		var self = this; this.runBtn.disabled = true; if (this.batchBtn) this.batchBtn.disabled = true;
		this.syncSelectedTarget();
		var usingProxy = !!this.selectedProxy, sec = usingProxy ? '' : (this.selectedSection || ''), prox = usingProxy ? this.selectedProxy : '', lbl = usingProxy ? (this.selectedProxyLabel || '') : '';
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' }, dot('grey', _('Проверка… (15–40 секунд)'))));
		return callActiveProbe('', sec, prox, lbl).then(function(d) { dom.content(self.body, self.renderProbe(d)); }).catch(function(e){ dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [ dot('red', _('Проба не завершилась (превышено время или ошибка вызова).')), E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '') ])); }).finally(function(){ self.runBtn.disabled = false; if (self.batchBtn) self.batchBtn.disabled = false; });
	},

	runAllProbes: function() {
		var self = this; this.runBtn.disabled = true; if (this.batchBtn) this.batchBtn.disabled = true;
		var probeable = this.sections.filter(function(s){ return s.enabled_for_runtime; }), results = [], chain = Promise.resolve();
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' }, dot('grey', _('Последовательная проверка маршрутов…'))));
		probeable.forEach(function(s){ chain = chain.then(function(){ return callActiveProbe('', s.name, '', '').then(function(d){ results.push({ sec:s.name, d:d }); }).catch(function(){ results.push({ sec:s.name, d:null }); }); }); });
		(this.tierProxies || []).forEach(function(p){ chain = chain.then(function(){ return callActiveProbe('', '', p.endpoint, p.label).then(function(d){ results.push({ sec:p.label, d:d, isProxy:true }); }).catch(function(){ results.push({ sec:p.label, d:null, isProxy:true }); }); }); });
		return chain.then(function(){ dom.content(self.body, self.renderBatch(results)); }).finally(function(){ self.runBtn.disabled = false; if (self.batchBtn) self.batchBtn.disabled = false; });
	},

	renderBatch: function(results) {
		var self = this;
		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Сводка по маршрутам')),
			E('div', {}, results.map(function(r){
				if (!r.d || r.d.available === false) return row(r.sec, dot('grey', _('нет данных / Mixed Proxy выключен')));
				var d = r.d, g = d.geo || {}, tg = (d.services || []).filter(function(s){ return s.name === 'Telegram API'; })[0];
				var tgTxt = tg ? (', Telegram ' + (tg.status === 'ok' ? 'ok' : tg.status)) : '', name = self.serverName(d), speed = (d.speed && d.speed.mbps) ? (d.speed.mbps + ' Mbps') : '';
				return row(r.sec, E('span', {}, name + ' · ' + (g.country || '—') + tgTxt + (speed ? (' · ' + speed) : '')));
			}))
		]);
	},

	renderProbe: function(d) {
		var self = this;
		if (!d) return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, dot('grey', _('Нет данных по этой секции — нажмите кнопку проверки')));
		if (d.available === false) {
			var reasons = { mixed_proxy_off: _('Mixed Proxy не включён на этой секции.'), no_cache: _('Нет сохранённого результата по этому маршруту — нажмите кнопку проверки.'), no_section: _('Секция не найдена.'), uci_missing: _('Podkop не установлен или не настроен.') };
			var kids = [ dot('yellow', reasons[d.reason] || d.detail || _('Проба недоступна')) ];
			if (d.reason === 'mixed_proxy_off') {
				var sec = d.section || self.selectedSection || '';
				kids.push(E('div', { 'style':'margin-top:.7em;' }, [ E('button', { 'class':'cbi-button cbi-button-action', 'click': ui.createHandlerFn(self, 'enableMixedProxy', sec) }, _('Включить Mixed Proxy для секции ') + sec), E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, _('Будет назначен свободный порт (без пересечения с другими секциями). Изменение вносится в конфигурацию Podkop.')) ]));
			}
			return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, kids);
		}
		var geo = d.geo || {}, age = d.checked_at ? this.ago(d.checked_at) : '', flag = this.flag(geo.country), countryLabel = (geo.country || '—');
		return E('div', {}, [
			E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Активный сервер (outbound)')),
				(d.section === '__proxy__') ? row(_('Маршрут'), E('span', {}, d.proxy_human || d.endpoint || _('транспорт-прокси'))) : row(_('Сервер'), this.serverDisplay(d, flag)),
				(d.section !== '__proxy__' && d.server_delay != null && d.server_delay > 0) ? row(_('Задержка до сервера'), dot(d.server_delay < 300 ? 'green' : 'yellow', d.server_delay + _(' мс'))) : E('span', {}),
				(d.section === '__proxy__') ? E('span', {}) : row(_('Секция'), E('span', {}, d.section || '—')),
				row(_('Страна выхода'), E('span', {}, countryLabel)), row(_('Провайдер'), E('span', {}, geo.org || '—')), row(_('IP выхода'), E('span', {}, geo.ip || '—')),
				(d.section === '__proxy__') ? E('span', {}) : row(_('Серверов в секции'), E('span', {}, String(d.servers != null ? d.servers : '—'))),
				(d.abuse && d.abuse !== 'unknown') ? row(_('Тип IP'), d.abuse === 'clean' ? dot('green', _('резидентный / чистый')) : dot('yellow', ({datacenter:_('датацентр/хостинг'), google_captcha:_('Google просит капчу'), proxy:_('прокси/VPN')}[d.abuse_why] || _('помечен')))) : E('span', {}),
				E('div', { 'style':'color:#888;font-size:82%;margin-top:.5em;' }, _('Транспорт к серверу: ') + (d.endpoint || '—'))
			]),
			E('div', { 'class':'cbi-section pb-card' }, [ E('h3', { 'style':'margin-top:0;margin-bottom:.6em;' }, _('Сервисы через туннель')), E('div', { 'style':'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.4em;' }, (d.services || []).map(function(s) { var c = (s.status === 'ok') ? 'green' : (s.status === 'blocked') ? 'yellow' : (s.status === 'na') ? 'grey' : (s.status === 'timeout') ? 'grey' : 'yellow'; var ms = (s.ms != null && s.ms > 0) ? (' · ' + s.ms + _(' мс')) : '', ge = (s.geo && s.geo.trim()) ? (' · ' + s.geo) : ''; var label = (s.status === 'na') ? (s.name + ' · N/A') : (s.name + (s.code && s.code !== '000' ? (' ' + s.code) : '') + ms + ge); return E('div', { 'style':'justify-self:start;' }, dot(c, label)); })) ]),
			this.speedCard(d.speed || {}),
			age ? E('div', { 'style':'max-width:820px;color:#888;font-size:85%;text-align:right;margin-top:.5em;' }, _('Данные: ') + (d.section === '__proxy__' ? (d.proxy_human || _('транспорт-прокси')) : (_('секция ') + (d.section || '—'))) + ' · ' + age) : E('span', {}),
			(this.selectedSection && d.section && this.selectedSection !== d.section) ? E('div', { 'style':'max-width:820px;color:#e8a33d;font-size:85%;text-align:right;margin-top:.2em;' }, _('Выбрана секция ') + this.selectedSection + _(', показан кеш секции ') + d.section + _('. Нажмите «Проверить выбранную».')) : E('span', {})
		]);
	},

	speedCard: function(sp) {
		var status = sp.status || 'unknown', node, note;
		if (status === 'ok') { node = dot('green', (sp.mbps || '0') + ' Mbps'); note = _('Туннель работает, блокировки скорости не обнаружено.'); }
		else if (status === 'block16k') { node = dot('yellow', _('обрыв на ~16 КБ')); note = _('Похоже на блокировку ТСПУ/РКН: соединение рвётся после ~16 КБ. Крупные загрузки через этот выход работать не будут.'); }
		else if (status === 'blocked') { node = dot('red', _('нет передачи данных')); note = _('Через активный выход данные не идут — туннель не работает или полностью заблокирован.'); }
		else { node = dot('grey', _('неизвестно')); note = ''; }
		return E('div', { 'class':'cbi-section pb-card' }, [ E('h3', { 'style':'margin-top:0;' }, _('Скорость и блокировки ТСПУ')), row(_('Скорость / статус'), node), note ? E('p', { 'style':'color:#888;font-size:90%;margin:.4em 0 0;' }, note) : E('span', {}) ]);
	},

	serverName: function(d) { if (d.proxy_human && d.proxy_human.trim()) return d.proxy_human; return this.serverLabel(d.proxy_name); },
	serverDisplay: function(d, flag) { var name = this.serverName(d); var startsWithFlag = /^[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name); if (flag && !startsWithFlag) return flag + ' ' + name; return name; },
	serverLabel: function(tag) { if (!tag) return _('неизвестен'); var m = tag.match(/^(.+)-(\d+)-out$/); if (m) return _('Сервер №') + m[2] + ' · ' + tag; if (/-out$/.test(tag)) return tag; return tag; },
	flag: function(cc) { if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return ''; var up = cc.toUpperCase(); return String.fromCodePoint(0x1F1E6 + up.charCodeAt(0) - 65, 0x1F1E6 + up.charCodeAt(1) - 65); },
	ago: function(ts) { var s = Math.floor(Date.now()/1000) - ts; if (s < 60) return _('только что'); if (s < 3600) return Math.floor(s/60) + _(' мин назад'); if (s < 86400) return Math.floor(s/3600) + _(' ч назад'); return Math.floor(s/86400) + _(' дн назад'); },
	handleSave: null, handleSaveApply: null, handleReset: null
});
