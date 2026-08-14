'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Runtime (active outbound diagnostics)
 *
 * Shows what podkop/plus and the Clash view do NOT: a live probe of the USER's
 * active tunnel through the active section's Mixed Proxy — exit geo/provider,
 * per-service reachability (incl. TSPU/RKN blocks), download speed, and TSPU
 * 16 KB block detection. Reuses the bot's probe logic via the active_probe rpc.
 *
 * The probe is slow (downloads 1 MB, hits several services) so it runs on demand
 * and is cached; opening the tab shows the cached result immediately, a button
 * runs a fresh probe.
 */

var callActiveProbe = rpc.declare({ object:'podkop_bot', method:'active_probe', params:['cached','section','proxy','label'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });
var callTransportState = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callEnsureMixedProxy = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy', params:['section'] });

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
				E('span', {}, 'luci-app-podkop-bot v' + (a.luci_app_version || '?') + ' \u00b7 '),
				E('a', { 'href': a.repo || 'https://github.com/Medvedolog/luci-app-podkop-bot', 'target': '_blank', 'rel': 'noopener' }, _('репозиторий'))
			]);
		}
	}).catch(function(){});
	return box;
}

return view.extend({
	load: function() {
		pbInjectCss();
		/* sections list + cached probe of the active section for instant display */
		return Promise.all([
			callRuntimeSections().catch(function(){ return null; }),
			callActiveProbe('true', '', '', '').catch(function(){ return null; }),
			callTransportState().catch(function(){ return null; })
		]);
	},

	render: function(data) {
		var self = this;
		var sectionsData = data[0];
		var probeData = data[1];
		var transportData = data[2];
		/* selected section: active by default; user can switch */
		this.sections = (sectionsData && sectionsData.sections) ? sectionsData.sections : [];
		this.selectedSection = (sectionsData && sectionsData.active_section) ? sectionsData.active_section : '';
		this.sectionsMeta = sectionsData || {};

		/* transport-tier proxies from the Transport tab: tier1 Mixed Proxy,
		 * tier2 fallback_socks list, tier3 custom_proxy. Each becomes a probe
		 * target (endpoint + label) alongside the Podkop sections. */
		this.tierProxies = [];
		if (transportData && transportData.available) {
			var t1 = transportData.tier1;
			/* readable labels — raw socks5h://host:port is noise for a human.
			 * tier1 is the active section's Mixed Proxy; tier2/3 show host only. */
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
		/* current selection state: either a section name or a proxy endpoint */
		this.selectedProxy = '';   // '' = use section; otherwise endpoint
		this.selectedProxyLabel = '';

		var body = E('div', { 'id':'podkop-runtime-body' }, this.renderProbe(probeData));
		this.body = body;

		var runBtn = E('button', {
			'class':'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, 'runProbe')
		}, (this.sections.length > 1 || this.tierProxies.length > 0) ? _('Проверить выбранный') : _('Проверить сейчас'));
		this.runBtn = runBtn;

		/* combined selector: two optgroups — Podkop sections, then transport
		 * proxies. Shown when there's more than one thing to choose. */
		var selectorRow = E('span', {});
		var totalChoices = this.sections.length + this.tierProxies.length;
		if (totalChoices > 1) {
			var optSections = this.sections.map(function(s){
				return E('option', { 'value': 'sec:' + s.name, 'selected': (s.name === self.selectedSection && !self.selectedProxy) ? '' : null },
					s.name + (s.enabled_for_runtime ? '' : _(' (без Mixed Proxy)')));
			});
			var groups = [ E('optgroup', { 'label': _('Маршруты Podkop') }, optSections) ];
			if (this.tierProxies.length > 0) {
				var optProxies = this.tierProxies.map(function(p){
					return E('option', { 'value': 'proxy:' + p.endpoint, 'data-label': p.label }, p.label);
				});
				groups.push(E('optgroup', { 'label': _('Транспортные маршруты') }, optProxies));
			}
			var sel = E('select', { 'class':'cbi-input-select', 'style':'width:100%;max-width:420px;box-sizing:border-box;',
				'change': ui.createHandlerFn(this, 'onTargetChange')
			}, groups);
			this.targetSelect = sel;
			/* label ON TOP of a full-width select: on a phone an inline label +
			 * select collide; stacking keeps both readable. */
			selectorRow = E('div', { 'style':'margin-bottom:.5em;' }, [
				E('label', { 'style':'display:block;color:#888;font-size:90%;margin-bottom:.2em;' }, _('Маршрут проверки')),
				sel
			]);
		}

		var batchBtn = E('span', {});
		if (this.sections.length > 1 || this.tierProxies.length > 0) {
			batchBtn = E('button', {
				'class':'cbi-button',
				'click': ui.createHandlerFn(this, 'runAllProbes')
			}, _('Проверить все маршруты'));
			this.batchBtn = batchBtn;
		}

		/* Collapsible custom-proxy form: probe an arbitrary SOCKS/HTTP proxy
		 * (with optional auth) without saving it to Transport. Credentials are
		 * used for this one probe only — backend never caches or echoes them. */
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
		/* grid card — host/port no longer drift to opposite edges, collapses to
		 * one column under 600px (see .pb-manual-proxy-* in podkop-bot.css). */
		var cpForm = E('div', { 'class':'pb-manual-proxy-card', 'style':'display:none;' }, [
			E('h3', { 'style':'margin:0 0 .6em;' }, _('Ручной прокси')),
			E('div', { 'class':'pb-manual-proxy-grid' }, [ cpType, cpHost, cpPort ]),
			E('div', { 'class':'pb-manual-proxy-auth' }, [ cpUser, cpPass ]),
			E('div', { 'class':'pb-manual-proxy-actions' }, [
				E('button', { 'class':'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'runCustomProxy') }, _('Проверить через этот прокси'))
			]),
			E('p', { 'class':'pb-manual-proxy-note' }, _('Логин и пароль используются только для этой проверки — не сохраняются, не кэшируются, в результате пароль маскируется. Тип — это протокол прокси (curl -x), а не «проверить HTTPS-сайт».'))
		]);
		this.cpForm = cpForm;
		var cpToggle = E('button', {
			'class':'cbi-button',
			'click': function() {
				var open = cpForm.style.display !== 'none';
				cpForm.style.display = open ? 'none' : 'block';
				this.textContent = open ? _('Ручной прокси ▸') : _('Ручной прокси ▾');
			}
		}, _('Ручной прокси ▸'));

		return E('div', {}, [
			E('h2', {}, _('Runtime — активный сервер')),
			E('p', { 'class':'pb-muted' }, _('Проверка туннеля: страна и провайдер выхода, доступность 12 сервисов и их регионы, скорость, признаки блокировок ТСПУ. Маршрут — это через что идёт проверка: секция Podkop, транспортный или ручной прокси.')),
			E('p', { 'style':'color:#c60;font-size:90%;margin-top:-.4em;' }, _('⚠ Полная проверка идёт 15–40 секунд и нагружает роутер (параллельные запросы + загрузка ~3 МБ через туннель). Тест транспорт-прокси гоняет тот же полный набор.')),
			selectorRow,
			E('div', { 'style':'margin:.6em 0;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [ runBtn, batchBtn, cpToggle ]),
			cpForm,
			body,
			pbFooter()
		]);
	},

	/* Build an endpoint from the custom-proxy form and probe through it. Never
	 * persists — the endpoint (with creds) is passed once to active_probe. */
	runCustomProxy: function() {
		var self = this;
		var host = (this._cp.host.value || '').trim();
		var port = (this._cp.port.value || '').trim();
		var user = (this._cp.user.value || '').trim();
		var pass = (this._cp.pass.value || '');
		var type = this._cp.type.value || 'socks5h';
		var warn = function(msg){
			dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, dot('yellow', msg)));
		};
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
		return callActiveProbe('', '', endpoint, label).then(function(d) {
			dom.content(self.body, self.renderProbe(d));
		}).catch(function(e){
			dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [
				dot('red', _('Проба не завершилась (превышено время или ошибка вызова).')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '')
			]));
		}).finally(function(){ self.runBtn.disabled = false; });
	},

	/* Enable Mixed Proxy for a section (explicit user action from the degraded
	 * screen). Backend assigns a free non-colliding port. On success, re-fetch the
	 * sections list and run a fresh probe of the now-enabled section. */
	enableMixedProxy: function(section) {
		var self = this;
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' },
			dot('grey', _('Включаю Mixed Proxy для секции ') + section + '…')));
		return callEnsureMixedProxy(section).then(function(r) {
			if (r && (r.ok || r.already_enabled)) {
				return callRuntimeSections().catch(function(){ return self.sectionsMeta; }).then(function(sd) {
					if (sd && sd.sections) { self.sections = sd.sections; self.sectionsMeta = sd; }
					return callActiveProbe('', section).then(function(d) {
						dom.content(self.body, self.renderProbe(d));
					});
				});
			}
			dom.content(self.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [
				dot('yellow', _('Не удалось включить Mixed Proxy')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (r && r.detail) ? r.detail : (r && r.reason ? r.reason : ''))
			]));
		}).catch(function(e){
			dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [
				dot('red', _('Ошибка включения Mixed Proxy')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '')
			]));
		});
	},

	/* Switching section shows that section's cached probe immediately (per-section
	 * cache). No fresh probe — user presses "Проверить выбранную" for that. If the
	 * section has no cache yet, show the empty state. */
	/* target = either "sec:<name>" or "proxy:<endpoint>". Parse the prefix and
	 * remember the selection; show the cached probe if one exists. */
	onTargetChange: function(ev) {
		var self = this;
		var v = ev.target.value || '';
		if (v.indexOf('proxy:') === 0) {
			this.selectedProxy = v.slice(6);
			this.selectedSection = '';
			var opt = ev.target.options[ev.target.selectedIndex];
			this.selectedProxyLabel = (opt && opt.getAttribute('data-label')) || this.selectedProxy;
			return callActiveProbe('true', '', this.selectedProxy, this.selectedProxyLabel).then(function(d) {
				dom.content(self.body, self.renderProbe(d));
			}).catch(function(){ dom.content(self.body, self.renderProbe(null)); });
		}
		this.selectedProxy = '';
		this.selectedProxyLabel = '';
		this.selectedSection = (v.indexOf('sec:') === 0) ? v.slice(4) : v;
		return callActiveProbe('true', this.selectedSection, '', '').then(function(d) {
			dom.content(self.body, self.renderProbe(d));
		}).catch(function() {
			dom.content(self.body, self.renderProbe(null));
		});
	},

	runProbe: function() {
		var self = this;
		this.runBtn.disabled = true;
		if (this.batchBtn) this.batchBtn.disabled = true;
		var usingProxy = !!this.selectedProxy;
		var sec = usingProxy ? '' : (this.selectedSection || '');
		var prox = usingProxy ? this.selectedProxy : '';
		var lbl = usingProxy ? (this.selectedProxyLabel || '') : '';
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' }, dot('grey', _('Проверка… (15–40 секунд)'))));
		return callActiveProbe('', sec, prox, lbl).then(function(d) {
			dom.content(self.body, self.renderProbe(d));
		}).catch(function(e){
			dom.content(self.body, E('div', { 'class':'cbi-section pb-wide' }, [
				dot('red', _('Проба не завершилась (превышено время или ошибка вызова).')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '')
			]));
		}).finally(function(){ self.runBtn.disabled = false; if (self.batchBtn) self.batchBtn.disabled = false; });
	},

	/* Probe every runtime-capable section SEQUENTIALLY (roadmap 5: weak routers,
	 * don't hammer curl/jq/Clash in parallel). Shows a compact summary. */
	runAllProbes: function() {
		var self = this;
		this.runBtn.disabled = true;
		if (this.batchBtn) this.batchBtn.disabled = true;
		var probeable = this.sections.filter(function(s){ return s.enabled_for_runtime; });
		var results = [];
		dom.content(this.body, E('div', { 'class':'cbi-section pb-wide' },
			dot('grey', _('Последовательная проверка маршрутов…'))));

		var chain = Promise.resolve();
		/* sections first (probe via their Mixed Proxy) */
		probeable.forEach(function(s){
			chain = chain.then(function(){
				return callActiveProbe('', s.name, '', '').then(function(d){ results.push({ sec:s.name, d:d }); })
					.catch(function(){ results.push({ sec:s.name, d:null }); });
			});
		});
		/* then transport-tier proxies from the Transport tab (tier1/2/3) */
		(this.tierProxies || []).forEach(function(p){
			chain = chain.then(function(){
				return callActiveProbe('', '', p.endpoint, p.label).then(function(d){ results.push({ sec:p.label, d:d, isProxy:true }); })
					.catch(function(){ results.push({ sec:p.label, d:null, isProxy:true }); });
			});
		});
		return chain.then(function(){
			dom.content(self.body, self.renderBatch(results));
		}).finally(function(){ self.runBtn.disabled = false; if (self.batchBtn) self.batchBtn.disabled = false; });
	},

	renderBatch: function(results) {
		var self = this;
		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Сводка по маршрутам')),
			E('div', {}, results.map(function(r){
				if (!r.d || r.d.available === false) {
					return row(r.sec, dot('grey', _('нет данных / Mixed Proxy выключен')));
				}
				var d = r.d, g = d.geo || {};
				var tg = (d.services || []).filter(function(s){ return s.name === 'Telegram API'; })[0];
				var tgTxt = tg ? (', Telegram ' + (tg.status === 'ok' ? 'ok' : tg.status)) : '';
				var name = self.serverName(d);
				var speed = (d.speed && d.speed.mbps) ? (d.speed.mbps + ' Mbps') : '';
				return row(r.sec, E('span', {}, name + ' · ' + (g.country || '—') + tgTxt + (speed ? (' · ' + speed) : '')));
			}))
		]);
	},

	renderProbe: function(d) {
		var self = this;
		if (!d) {
			return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' },
				dot('grey', _('Нет данных по этой секции — нажмите кнопку проверки')));
		}
		if (d.available === false) {
			var reasons = {
				mixed_proxy_off: _('Mixed Proxy не включён на этой секции.'),
				no_cache: _('Нет сохранённого результата по этому маршруту — нажмите кнопку проверки.'),
				no_section: _('Секция не найдена.'),
				uci_missing: _('Podkop не установлен или не настроен.')
			};
			var kids = [ dot('yellow', reasons[d.reason] || d.detail || _('Проба недоступна')) ];
			/* Offer to enable Mixed Proxy for this section (assigns a free port that
			 * doesn't collide with other sections). Explicit button — we don't touch
			 * Podkop config silently. */
			if (d.reason === 'mixed_proxy_off') {
				var sec = d.section || self.selectedSection || '';
				kids.push(E('div', { 'style':'margin-top:.7em;' }, [
					E('button', {
						'class':'cbi-button cbi-button-action',
						'click': ui.createHandlerFn(self, 'enableMixedProxy', sec)
					}, _('Включить Mixed Proxy для секции ') + sec),
					E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' },
						_('Будет назначен свободный порт (без пересечения с другими секциями). Изменение вносится в конфигурацию Podkop.'))
				]));
			}
			return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, kids);
		}

		var geo = d.geo || {};
		var age = d.checked_at ? this.ago(d.checked_at) : '';
		var flag = this.flag(geo.country);
		var countryLabel = (geo.country || '—');

		return E('div', {}, [
			/* Active server (outbound) */
			E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Активный сервер (outbound)')),
				/* proxy mode has no sing-box "server" — show only the Target row
				 * (was duplicating the same endpoint in both Server and Target). */
				(d.section === '__proxy__')
					? row(_('Маршрут'), E('span', {}, d.proxy_human || d.endpoint || _('транспорт-прокси')))
					: row(_('Сервер'), this.serverDisplay(d, flag)),
				(d.section !== '__proxy__' && d.server_delay != null && d.server_delay > 0)
					? row(_('Задержка до сервера'), dot(d.server_delay < 300 ? 'green' : 'yellow', d.server_delay + _(' мс')))
					: E('span', {}),
				(d.section === '__proxy__')
					? E('span', {})
					: row(_('Секция'), E('span', {}, d.section || '—')),
				row(_('Страна выхода'), E('span', {}, countryLabel)),
				row(_('Провайдер'), E('span', {}, geo.org || '—')),
				row(_('IP выхода'), E('span', {}, geo.ip || '—')),
				(d.section === '__proxy__')
					? E('span', {})
					: row(_('Серверов в секции'), E('span', {}, String(d.servers != null ? d.servers : '—'))),
				(d.abuse && d.abuse !== 'unknown')
					? row(_('Тип IP'), d.abuse === 'clean'
						? dot('green', _('резидентный / чистый'))
						: dot('yellow', ({datacenter:_('датацентр/хостинг'), google_captcha:_('Google просит капчу'), proxy:_('прокси/VPN')}[d.abuse_why] || _('помечен'))))
					: E('span', {}),
				E('div', { 'style':'color:#888;font-size:82%;margin-top:.5em;' }, _('Транспорт к серверу: ') + (d.endpoint || '—'))
			]),

			/* Services */
			E('div', { 'class':'cbi-section pb-card' }, [
				E('h3', { 'style':'margin-top:0;margin-bottom:.6em;' }, _('Сервисы через туннель')),
				E('div', { 'style':'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.4em;' },
					(d.services || []).map(function(s) {
						var c = (s.status === 'ok') ? 'green'
							: (s.status === 'blocked') ? 'yellow'
							: (s.status === 'na') ? 'grey'
							: (s.status === 'timeout') ? 'grey' : 'yellow';
						var ms = (s.ms != null && s.ms > 0) ? (' · ' + s.ms + _(' мс')) : '';
						var geo = (s.geo && s.geo.trim()) ? (' · ' + s.geo) : '';
						/* N/A = probe didn't finish within the deadline; show it
						 * plainly instead of a misleading code/latency. */
						var label = (s.status === 'na')
							? (s.name + ' · N/A')
							: (s.name + (s.code && s.code !== '000' ? (' ' + s.code) : '') + ms + geo);
						/* justify-content:flex-start keeps the dot hugging its label
						 * instead of the grid cell stretching them to opposite edges
						 * on narrow screens. */
						return E('div', { 'style':'justify-self:start;' }, dot(c, label));
					}))
			]),

			/* Speed + TSPU */
			this.speedCard(d.speed || {}),

			age ? E('div', { 'style':'max-width:820px;color:#888;font-size:85%;text-align:right;margin-top:.5em;' },
				_('Данные: ') + (d.section === '__proxy__' ? (d.proxy_human || _('транспорт-прокси')) : (_('секция ') + (d.section || '—'))) + ' · ' + age) : E('span', {}),
			(this.selectedSection && d.section && this.selectedSection !== d.section)
				? E('div', { 'style':'max-width:820px;color:#e8a33d;font-size:85%;text-align:right;margin-top:.2em;' },
					_('Выбрана секция ') + this.selectedSection + _(', показан кеш секции ') + d.section + _('. Нажмите «Проверить выбранную».'))
				: E('span', {})
		]);
	},

	speedCard: function(sp) {
		var status = sp.status || 'unknown';
		var node, note;
		if (status === 'ok') {
			node = dot('green', (sp.mbps || '0') + ' Mbps');
			note = _('Туннель работает, блокировки скорости не обнаружено.');
		} else if (status === 'block16k') {
			node = dot('yellow', _('обрыв на ~16 КБ'));
			note = _('Похоже на блокировку ТСПУ/РКН: соединение рвётся после ~16 КБ. Крупные загрузки через этот выход работать не будут.');
		} else if (status === 'blocked') {
			node = dot('red', _('нет передачи данных'));
			note = _('Через активный выход данные не идут — туннель не работает или полностью заблокирован.');
		} else {
			node = dot('grey', _('неизвестно'));
			note = '';
		}
		return E('div', { 'class':'cbi-section pb-card' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Скорость и блокировки ТСПУ')),
			row(_('Скорость / статус'), node),
			note ? E('p', { 'style':'color:#888;font-size:90%;margin:.4em 0 0;' }, note) : E('span', {})
		]);
	},

	/* ISO-3166 alpha-2 → flag emoji, built reliably in JS (busybox printf can't). */
	/* sing-box tag → readable server label. "main-1-out" → "Сервер №1".
	 * The full pretty name from the proxy link is a deferred feature. */
	/* Prefer the human name from the subscription link; fall back to the tag
	 * turned into "Сервер №N", then the raw tag. */
	serverName: function(d) {
		if (d.proxy_human && d.proxy_human.trim()) return d.proxy_human;
		return this.serverLabel(d.proxy_name);
	},

	/* Compose "flag name", but don't prepend the geo flag if the resolved name
	 * already starts with a regional-indicator flag emoji (subscription names
	 * often embed their own flag, e.g. "🇷🇺 Russia") — avoids "🇷🇺 🇷🇺 Russia". */
	serverDisplay: function(d, flag) {
		var name = this.serverName(d);
		var startsWithFlag = /^[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name);
		if (flag && !startsWithFlag) return flag + ' ' + name;
		return name;
	},

	serverLabel: function(tag) {
		if (!tag) return _('неизвестен');
		var m = tag.match(/^(.+)-(\d+)-out$/);
		if (m) return _('Сервер №') + m[2] + ' · ' + tag;
		if (/-out$/.test(tag)) return tag;
		return tag;
	},

	flag: function(cc) {
		if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
		var up = cc.toUpperCase();
		return String.fromCodePoint(0x1F1E6 + up.charCodeAt(0) - 65,
		                            0x1F1E6 + up.charCodeAt(1) - 65);
	},

	ago: function(ts) {
		var s = Math.floor(Date.now()/1000) - ts;
		if (s < 60) return _('только что');
		if (s < 3600) return Math.floor(s/60) + _(' мин назад');
		if (s < 86400) return Math.floor(s/3600) + _(' ч назад');
		return Math.floor(s/86400) + _(' дн назад');
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
