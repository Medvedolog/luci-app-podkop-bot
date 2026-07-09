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

var callActiveProbe = rpc.declare({ object:'podkop_bot', method:'active_probe', params:['cached','section'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });
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
			callActiveProbe('true', '').catch(function(){ return null; })
		]);
	},

	render: function(data) {
		var self = this;
		var sectionsData = data[0];
		var probeData = data[1];
		/* selected section: active by default; user can switch */
		this.sections = (sectionsData && sectionsData.sections) ? sectionsData.sections : [];
		this.selectedSection = (sectionsData && sectionsData.active_section) ? sectionsData.active_section : '';
		this.sectionsMeta = sectionsData || {};

		var body = E('div', { 'id':'podkop-runtime-body' }, this.renderProbe(probeData));
		this.body = body;

		var runBtn = E('button', {
			'class':'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, 'runProbe')
		}, (this.sections.length > 1) ? _('Проверить выбранную') : _('Проверить сейчас'));
		this.runBtn = runBtn;

		/* section selector — only shown when there's more than one proxy section */
		var selectorRow = E('span', {});
		if (this.sections.length > 1) {
			var sel = E('select', { 'class':'cbi-input-select', 'style':'margin-right:.5em;',
				'change': ui.createHandlerFn(this, 'onSectionChange')
			}, this.sections.map(function(s){
				return E('option', { 'value': s.name, 'selected': (s.name === self.selectedSection) ? '' : null },
					s.name + (s.enabled_for_runtime ? '' : _(' (без Mixed Proxy)')));
			}));
			this.sectionSelect = sel;
			selectorRow = E('span', { 'style':'margin-right:.5em;' }, [
				E('span', { 'style':'color:#888;margin-right:.4em;' }, _('Секция:')), sel
			]);
		}

		var batchBtn = E('span', {});
		if (this.sections.length > 1) {
			batchBtn = E('button', {
				'class':'cbi-button', 'style':'margin-left:.5em;',
				'click': ui.createHandlerFn(this, 'runAllProbes')
			}, _('Проверить все секции'));
			this.batchBtn = batchBtn;
		}

		return E('div', {}, [
			E('h2', {}, _('Runtime — активный сервер')),
			E('p', { 'style':'color:#888;' }, _('Проверка туннеля через Mixed Proxy выбранной секции: страна и провайдер выхода, доступность сервисов, скорость, признаки блокировок ТСПУ. Проверка занимает 10–30 секунд (загружается около 1 МБ).')),
			E('div', { 'style':'margin:.6em 0;display:flex;align-items:center;flex-wrap:wrap;' }, [ selectorRow, runBtn, batchBtn ]),
			body,
			pbFooter()
		]);
	},

	/* Enable Mixed Proxy for a section (explicit user action from the degraded
	 * screen). Backend assigns a free non-colliding port. On success, re-fetch the
	 * sections list and run a fresh probe of the now-enabled section. */
	enableMixedProxy: function(section) {
		var self = this;
		dom.content(this.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;' },
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
			dom.content(self.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;' }, [
				dot('yellow', _('Не удалось включить Mixed Proxy')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (r && r.detail) ? r.detail : (r && r.reason ? r.reason : ''))
			]));
		}).catch(function(e){
			dom.content(self.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;' }, [
				dot('red', _('Ошибка включения Mixed Proxy')),
				E('div', { 'style':'color:#888;font-size:85%;margin-top:.4em;' }, (e && e.message) ? String(e.message) : '')
			]));
		});
	},

	/* Switching section shows that section's cached probe immediately (per-section
	 * cache). No fresh probe — user presses "Проверить выбранную" for that. If the
	 * section has no cache yet, show the empty state. */
	onSectionChange: function(ev) {
		var self = this;
		this.selectedSection = ev.target.value;
		return callActiveProbe('true', this.selectedSection).then(function(d) {
			dom.content(self.body, self.renderProbe(d));
		}).catch(function() {
			dom.content(self.body, self.renderProbe(null));
		});
	},

	runProbe: function() {
		var self = this;
		this.runBtn.disabled = true;
		if (this.batchBtn) this.batchBtn.disabled = true;
		var sec = this.selectedSection || '';
		dom.content(this.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;' }, dot('grey', _('Проверка… (до 30 секунд)'))));
		return callActiveProbe('', sec).then(function(d) {
			dom.content(self.body, self.renderProbe(d));
		}).catch(function(e){
			dom.content(self.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;' }, [
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
		dom.content(this.body, E('div', { 'class':'cbi-section', 'style':'max-width:820px;' },
			dot('grey', _('Последовательная проверка секций…'))));

		var chain = Promise.resolve();
		probeable.forEach(function(s){
			chain = chain.then(function(){
				return callActiveProbe('', s.name).then(function(d){ results.push({ sec:s.name, d:d }); })
					.catch(function(){ results.push({ sec:s.name, d:null }); });
			});
		});
		return chain.then(function(){
			dom.content(self.body, self.renderBatch(results));
		}).finally(function(){ self.runBtn.disabled = false; if (self.batchBtn) self.batchBtn.disabled = false; });
	},

	renderBatch: function(results) {
		var self = this;
		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Сводка по секциям')),
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
			return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' },
				dot('grey', _('Нет данных по этой секции — нажмите кнопку проверки')));
		}
		if (d.available === false) {
			var reasons = {
				mixed_proxy_off: _('Mixed Proxy не включён на этой секции.'),
				no_cache: _('Нет сохранённого результата по этой секции — нажмите кнопку проверки.'),
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
			return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;' }, kids);
		}

		var geo = d.geo || {};
		var age = d.checked_at ? this.ago(d.checked_at) : '';
		var flag = this.flag(geo.country);
		var countryLabel = (geo.country || '—');

		return E('div', {}, [
			/* Active server (outbound) */
			E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Активный сервер (outbound)')),
				row(_('Сервер'), this.serverDisplay(d, flag)),
				(d.server_delay != null && d.server_delay > 0)
					? row(_('Задержка до сервера'), dot(d.server_delay < 300 ? 'green' : 'yellow', d.server_delay + _(' мс')))
					: E('span', {}),
				row(_('Секция'), E('span', {}, d.section || '—')),
				row(_('Страна выхода'), E('span', {}, countryLabel)),
				row(_('Провайдер'), E('span', {}, geo.org || '—')),
				row(_('IP выхода'), E('span', {}, geo.ip || '—')),
				row(_('Серверов в секции'), E('span', {}, String(d.servers != null ? d.servers : '—'))),
				(d.abuse && d.abuse !== 'unknown')
					? row(_('Тип IP'), d.abuse === 'clean'
						? dot('green', _('резидентный / чистый'))
						: dot('yellow', ({datacenter:_('датацентр/хостинг'), google_captcha:_('Google просит капчу'), proxy:_('прокси/VPN')}[d.abuse_why] || _('помечен'))))
					: E('span', {}),
				E('div', { 'style':'color:#888;font-size:82%;margin-top:.5em;' }, _('Транспорт к серверу: ') + (d.endpoint || '—'))
			]),

			/* Services */
			E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Сервисы через туннель')),
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
				_('Данные: секция ') + (d.section || '—') + ' · ' + age) : E('span', {}),
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
		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
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
