'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Transport / Rescue (TZ section 11)
 *
 * Answers "how will the bot reach Telegram if direct Telegram is blocked?".
 * Shows the 6-tier fallback chain with per-tier configured/probe state, the
 * bot's live active route (last_ok from its state file), and lets the user
 * probe each tier or the whole chain. fallback_socks CRUD is a follow-up slice;
 * this slice is read + probe + Enable Mixed Proxy.
 */

var callState   = rpc.declare({ object:'podkop_bot', method:'transport_state' });
var callProbe   = rpc.declare({ object:'podkop_bot', method:'transport_probe', params:['target'] });
var callEnsureMP = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy' });
var callSetPolicy = rpc.declare({ object:'podkop_bot', method:'set_transport_policy', params:['policy'] });
var callFbCrud = rpc.declare({ object:'podkop_bot', method:'fallback_crud', params:['op','value','index'] });
var callListIfaces = rpc.declare({ object:'podkop_bot', method:'list_interfaces' });
var callSetField = rpc.declare({ object:'podkop_bot', method:'set_uci_field', params:['field','value'] });
var callSetTier1Port = rpc.declare({ object:'podkop_bot', method:'set_tier1_port', params:['value','section'] });
var callRuntimeSections = rpc.declare({ object:'podkop_bot', method:'runtime_sections' });

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
		return Promise.all([
			callState().catch(function(e){ return { ok:false, detail:String(e) }; }),
			callRuntimeSections().catch(function(){ return null; })
		]);
	},

	render: function(data) {
		var self = this;
		var stateData = Array.isArray(data) ? data[0] : data;
		var sectionsData = Array.isArray(data) ? data[1] : null;
		this.state = stateData;
		this.sectionsData = sectionsData;
		data = stateData;

		if (!data || data.ok === false || data.available === false) {
			return E('div', {}, [
				E('h2', {}, _('Транспорт / Спасение')),
				E('div', { 'class':'cbi-section' }, dot('grey', _('Состояние транспорта недоступно')))
			]);
		}

		/* Build the tier rows. Active tier (state.last_ok) is highlighted. */
		var tiers = this.buildTiers(data);
		var chainBox = E('div', { 'id':'podkop-tiers' }, this.renderTiers(tiers, data));
		this.chainBox = chainBox;
		this.tiers = tiers;

		var testAllBtn = E('button', {
			'class':'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, 'testFullChain')
		}, _('Тест всей цепочки'));

		var reloadBtn = E('button', {
			'class':'cbi-button',
			'style':'margin-left:.5em;',
			'click': ui.createHandlerFn(this, function() {
				return callState().then(function(d){
					self.state = d;
					self.tiers = self.buildTiers(d);
					dom.content(self.chainBox, self.renderTiers(self.tiers, d));
				});
			})
		}, _('Обновить состояние'));

		return E('div', {}, [
			E('h2', {}, _('Транспорт бота')),
			E('p', { 'style':'color:#888;' }, _('Как бот связывается с api.telegram.org, если прямой доступ заблокирован. Активный путь подсвечен.')),
			this.botTransportCard(data),
			E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Цепочка fallback')),
				chainBox,
				this.addFbRow(),
				E('div', { 'style':'margin-top:1em;' }, [ testAllBtn, reloadBtn ])
			]),
			this.sectionSocksCard(),
			pbFooter()
		]);
	},

	/* Additional Mixed Proxy SOCKS from OTHER podkop sections. The bot auto-adds
	 * these to its fallback chain (each section with mixed_proxy on a different
	 * port is an independent transport path). Shown SEPARATELY from the user's
	 * explicit fallback_socks (tier2) so it's clear these are auto-discovered and
	 * read-only (managed in Podkop, not here). Roadmap 6. */
	sectionSocksCard: function() {
		return E('div', { 'id':'podkop-section-socks' }, this.sectionSocksInner());
	},

	sectionSocksInner: function() {
		var sd = this.sectionsData;
		if (!sd || !sd.sections || sd.sections.length < 2) return E('span', {});
		var primary = sd.primary_section;
		var extras = sd.sections.filter(function(s){
			return s.name !== primary && s.enabled_for_runtime && s.endpoint;
		});
		if (!extras.length) return E('span', {});
		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Дополнительные SOCKS секций Podkop')),
			E('p', { 'style':'color:#888;font-size:90%;margin-top:0;' },
				_('Mixed Proxy других секций. Бот автоматически добавляет их в цепочку как дополнительные пути к Telegram (каждая секция на своём порту — независимый выход). Задаются в Podkop, здесь не редактируются.')),
			E('div', {}, extras.map(function(s){
				return E('div', { 'class':'pb-row pb-row--plain' }, [
					E('span', { 'class':'pb-row-label' }, s.name + ' (' + (s.mode || 'proxy') + ')'),
					E('span', { 'class':'pb-row-val pb-row-val--mono' }, s.endpoint)
				]);
			}))
		]);
	},

	/* Bot Transport vs Active route summary (TZ 11.3). */
	botTransportCard: function(d) {
		var self = this;
		var routeLabel = (d.last_ok && d.last_ok !== 'unknown') ? d.last_ok : (d.route || 'unknown');
		var tgColour = (d.tg === 'ok') ? 'green' : (d.tg === 'fail' ? 'red' : 'grey');
		/* Active route colour reflects whether a transport tier was last working
		 * (last_ok), NOT the aggregate Telegram state. A live Mixed Proxy with
		 * Telegram-through-transport failing must not paint the route red — those
		 * are separate conditions (see 0.16.52 NetShift regression). */
		var routeColour = (d.last_ok && d.last_ok !== 'unknown') ? 'green' : 'grey';
		var directColour = (d.tg_direct === 'ok') ? 'green' : (d.tg_direct === 'fail' ? 'yellow' : 'grey');
		var transportColour = (d.tg_transport === 'ok') ? 'green' : (d.tg_transport === 'fail' ? 'red' : 'grey');

		/* Editable transport policy: a select + Save. socks/direct narrow how the
		 * bot reaches Telegram and can strand it under blocking, so warn. */
		var sel = E('select', { 'class':'cbi-input-select', 'style':'padding:.15em .4em;font-size:90%;height:auto;line-height:1.3;margin-right:.4em;' }, [
			E('option', { 'value':'auto' }, _('auto (direct → SOCKS)')),
			E('option', { 'value':'socks' }, _('только SOCKS')),
			E('option', { 'value':'direct' }, _('только direct'))
		]);
		sel.value = d.policy || 'auto';
		var policyStatus = E('span', { 'style':'margin-left:.5em;color:#888;font-size:85%;' });
		var warnNode = E('div', { 'style':'color:#e8a33d;margin:.2em 0 0;font-size:85%;' });
		function updateWarn() {
			warnNode.textContent = (sel.value === 'socks' || sel.value === 'direct')
				? _('Режим «') + sel.value + _('» может отключить бота в условиях блокировок.') : '';
		}
		sel.addEventListener('change', updateWarn); updateWarn();
		var saveBtn = E('button', {
			'class':'cbi-button cbi-button-apply',
			'style':'padding:.15em .6em;font-size:90%;',
			'click': ui.createHandlerFn(this, function() {
				dom.content(policyStatus, _('сохранение…'));
				return callSetPolicy(sel.value).then(function(r) {
					if (r && r.ok) dom.content(policyStatus, _('сохранено · ') + (r.service_running ? _('бот работает') : _('бот остановлен')));
					else dom.content(policyStatus, _('ошибка'));
				}).catch(function(){ dom.content(policyStatus, _('ошибка вызова')); });
			})
		}, _('Сохранить'));

		return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Состояние')),
			this.row(_('Активный маршрут'), dot(routeColour, routeLabel)),
			this.row(_('Telegram напрямую'), dot(directColour, d.tg_direct === 'fail' ? _('заблокирован (ожидаемо)') : (d.tg_direct||'unknown'))),
			this.row(_('Telegram через транспорт'), dot(transportColour, d.tg_transport||'unknown')),
			E('div', { 'style':'display:flex;align-items:center;padding:.3em 0;gap:.5em;' }, [
				E('span', { 'style':'color:#888;flex:none;' }, _('Политика транспорта')),
				E('span', { 'style':'flex:1;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;' }, [ sel, saveBtn, policyStatus ])
			]),
			warnNode
		]);
	},

	/* Assemble tier descriptors from state. */
	buildTiers: function(d) {
		var t = [];
		var t1 = d.tier1 || {};
		t.push({ id:'tier1', name:_('Podkop SOCKS5 / Mixed Proxy (tier1)'),
			configured: !!t1.mixed_proxy_enabled,
			endpoint: t1.endpoint || '',
			note: t1.mixed_proxy_enabled ? (t1.section ? (_('секция ')+t1.section) : '') : _('Mixed Proxy выключен') });
		(d.tier2_fallback_socks || []).forEach(function(fb, i) {
			t.push({ id:'tier2_'+(i+1), name:_('Резервный SOCKS')+' #'+(i+1)+' (tier2.'+(i+1)+')', configured:true, endpoint:fb, note:'', _fbIndex:i });
		});
		t.push({ id:'tier3', name:_('Свой прокси (tier3)'),
			configured: !!(d.tier3_custom_proxy && d.tier3_custom_proxy.length),
			endpoint: d.tier3_custom_proxy || '', note: (d.tier3_custom_proxy ? '' : _('не задан')) });
		t.push({ id:'tier4', name:_('Прямой выход WAN (tier4)'),
			configured: (d.tier4_wan_if && d.tier4_wan_if !== 'unknown'),
			endpoint:'direct', note: (d.tier4_wan_if && d.tier4_wan_if !== 'unknown') ? (_('интерфейс ')+d.tier4_wan_if) : _('WAN не определён') });
		t.push({ id:'tier5', name:_('Аварийные IP Telegram (tier5)'), configured:true, endpoint:'', note:_('аварийные IP') });
		return t;
	},

	renderTiers: function(tiers, d) {
		var self = this;
		var active = (d.last_ok && d.last_ok !== 'unknown') ? d.last_ok : null;
		return E('div', {}, tiers.map(function(t) {
			var isActive = (t.id === active);
			t._active = isActive;
			/* Colour semantics (TZ 18t.1):
			 *   green  — active path, or a probe that just succeeded
			 *   grey   — configured-but-inactive, OR not configured (expected,
			 *            optional tiers like custom_proxy left empty)
			 *   yellow — only after a probe FAILED on a configured tier (a real
			 *            problem). Not configured ≠ problem, so never yellow.
			 *   red    — reserved
			 * Probe results recolour the dot live via probeOne(). */
			var cfgColour = isActive ? 'green' : 'grey';
			var dotNode = dot(cfgColour, t.name + (isActive ? '  ✓ '+_('активен') : ''));
			t._dotNode = dotNode;
			var probeBtn = (t.endpoint && t.endpoint !== '')
				? E('button', {
					'class':'cbi-button',
					'style':'padding:.1em .6em;font-size:90%;margin-left:.5em;',
					'click': ui.createHandlerFn(self, 'probeOne', t)
				}, _('Тест'))
				: E('span', {});
			/* tier3 (custom_proxy): single editable value → pencil.
			 * tier4 (Direct WAN): bind_interface picker → gear. */
			var probeResult = E('span', { 'id':'probe-'+t.id, 'style':'margin-left:.6em;color:#888;font-size:90%;' });
			t._resultNode = probeResult;

			/* tier3 (custom_proxy): single editable value → pencil.
			 * tier4 (Direct WAN): bind_interface picker → gear. */
			var extraBtn = E('span', {});
			if (t.id === 'tier1') {
				extraBtn = E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;margin-left:.5em;', 'title':_('изменить порт Mixed Proxy'),
					'click': ui.createHandlerFn(self, 'editTier1Port', t.endpoint) }, '✎');
			} else if (t.id === 'tier3') {
				extraBtn = E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;margin-left:.5em;', 'title':_('задать/изменить custom proxy'),
					'click': ui.createHandlerFn(self, 'editCustomProxy', t.endpoint) }, '✎');
			} else if (t.id === 'tier4') {
				extraBtn = E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;margin-left:.5em;', 'title':_('выбрать интерфейс привязки'),
					'click': ui.createHandlerFn(self, 'editBindIface') }, '⚙');
			}

			/* fallback (tier2_*) entries get edit controls: move up/down, delete.
			 * The index within the fallback_socks list is t._fbIndex (set in
			 * buildTiers). */
			var crudBtns = E('span', {});
			if (t.id.indexOf('tier2_') === 0 && t._fbIndex != null) {
				crudBtns = E('span', { 'style':'margin-left:.5em;' }, [
					E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;', 'title':_('редактировать'),
						'click': ui.createHandlerFn(self, 'fbEdit', t._fbIndex, t.endpoint) }, '✎'),
					E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;margin-left:.2em;', 'title':_('выше в очереди'),
						'click': ui.createHandlerFn(self, 'fbMove', t._fbIndex, 'move_up') }, '↑'),
					E('button', { 'class':'cbi-button', 'style':'padding:.1em .4em;font-size:85%;margin-left:.2em;', 'title':_('ниже в очереди'),
						'click': ui.createHandlerFn(self, 'fbMove', t._fbIndex, 'move_down') }, '↓'),
					E('button', { 'class':'cbi-button cbi-button-remove', 'style':'padding:.1em .4em;font-size:85%;margin-left:.2em;', 'title':_('удалить'),
						'click': ui.createHandlerFn(self, 'fbDelete', t._fbIndex, t.endpoint) }, '✕')
				]);
			}
			var dotWrap = E('span', {}, [ dotNode ]);
			t._dotWrap = dotWrap;
			return E('div', {
				'style':'padding:.5em .2em;border-bottom:1px solid rgba(127,127,127,.12);' + (isActive ? 'background:rgba(51,160,44,.06);' : '')
			}, [
				E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;' }, [
					dotWrap,
					probeBtn, probeResult, extraBtn, crudBtns
				]),
				(t.endpoint && t.endpoint !== 'direct')
					? E('div', { 'style':'color:#888;font-size:85%;margin-left:1.1em;font-family:monospace;' }, t.endpoint)
					: (t.note ? E('div', { 'style':'color:#888;font-size:85%;margin-left:1.1em;' }, t.note) : E('span', {})),
				(t.id === 'tier1' && !t.configured)
					? E('button', {
						'class':'cbi-button cbi-button-action',
						'style':'margin:.4em 0 .2em 1.1em;padding:.1em .6em;font-size:90%;',
						'click': ui.createHandlerFn(self, 'enableMixedProxy')
					}, _('Включить Mixed Proxy'))
					: E('span', {})
			]);
		}));
	},

	refreshState: function() {
		var self = this;
		return Promise.all([
			callState(),
			callRuntimeSections().catch(function(){ return self.sectionsData; })
		]).then(function(res){
			var d = res[0];
			self.state = d;
			self.sectionsData = res[1];
			self.tiers = self.buildTiers(d);
			dom.content(self.chainBox, self.renderTiers(self.tiers, d));
			var holder = document.getElementById('podkop-section-socks');
			if (holder) dom.content(holder, self.sectionSocksInner());
		});
	},

	fbAdd: function(input, status) {
		var self = this;
		var v = (input.value || '').trim();
		if (!v) { dom.content(status, _('введите адрес')); return; }
		dom.content(status, _('добавление…'));
		return callFbCrud('add', v, 0).then(function(r) {
			if (r && r.ok) { input.value = ''; dom.content(status, _('добавлено')); return self.refreshState(); }
			var m = { bad_format:_('неверный формат (socks5://IP:PORT)'), duplicate:_('уже в списке') };
			dom.content(status, _('ошибка: ') + (m[r && r.reason] || (r && r.detail) || '?'));
		}).catch(function(){ dom.content(status, _('ошибка вызова')); });
	},

	fbDelete: function(index, endpoint) {
		var self = this;
		ui.showModal(_('Удалить резервный SOCKS'), [
			E('p', {}, _('Удалить ') + (endpoint||'') + '?'),
			E('div', { 'class':'right' }, [
				E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
				' ',
				E('button', { 'class':'cbi-button cbi-button-negative', 'click': ui.createHandlerFn(this, function(){
					ui.hideModal();
					return callFbCrud('delete', '', index).then(function(){ return self.refreshState(); });
				}) }, _('Удалить'))
			])
		]);
	},

	fbMove: function(index, op) {
		var self = this;
		return callFbCrud(op, '', index).then(function(){ return self.refreshState(); });
	},

	fbEdit: function(index, current) {
		var self = this;
		var input = E('input', {
			'type':'text', 'class':'cbi-input-text',
			'style':'width:100%;font-family:monospace;',
			'value': current || ''
		});
		var err = E('div', { 'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;' });
		ui.showModal(_('Редактировать резервный SOCKS'), [
			E('p', {}, _('Адрес SOCKS (socks5:// или socks5h://):')),
			input, err,
			E('div', { 'class':'right', 'style':'margin-top:.6em;' }, [
				E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
				' ',
				E('button', { 'class':'cbi-button cbi-button-apply', 'click': ui.createHandlerFn(this, function(){
					var v = (input.value||'').trim();
					return callFbCrud('edit', v, index).then(function(r){
						if (r && r.ok) { ui.hideModal(); return self.refreshState(); }
						var m = { bad_format:_('неверный формат (socks5://IP:PORT)'), duplicate:_('такой адрес уже есть') };
						dom.content(err, m[r && r.reason] || (r && r.detail) || _('ошибка'));
					}).catch(function(){ dom.content(err, _('ошибка вызова')); });
				}) }, _('Сохранить'))
			])
		]);
	},

	addFbRow: function() {
		var self = this;
		var input = E('input', {
			'type':'text', 'class':'cbi-input-text',
			'style':'flex:1;min-width:220px;font-family:monospace;',
			'placeholder':'socks5h://192.168.2.238:18088'
		});
		var status = E('span', { 'style':'margin-left:.6em;color:#888;font-size:90%;' });
		var btn = E('button', {
			'class':'cbi-button cbi-button-add',
			'style':'margin-left:.5em;',
			'click': ui.createHandlerFn(this, function(){ return self.fbAdd(input, status); })
		}, _('Добавить'));
		return E('div', { 'style':'margin-top:.8em;padding-top:.8em;border-top:1px solid rgba(127,127,127,.12);' }, [
			E('div', { 'style':'color:#888;font-size:85%;margin-bottom:.8em;line-height:1.7;' }, [
				E('div', { 'style':'margin-bottom:.3em;' }, _('Редактирование доступно не для всех уровней:')),
				E('div', { 'style':'padding-left:.6em;' }, [
					E('div', {}, _('• Podkop SOCKS5 (tier1): ✎ изменить порт Mixed Proxy — если вы сменили его в Podkop или автоопределение не сработало')),
					E('div', {}, _('• Резервные SOCKS (tier2): ✎ изменить · ↑ ↓ порядок перебора · ✕ удалить')),
					E('div', {}, _('• Свой прокси (tier3): ✎ задать или изменить')),
					E('div', {}, _('• Прямой выход WAN (tier4): ⚙ выбрать интерфейс привязки (auto, wan, tailscale0, awg0…)')),
					E('div', {}, _('• Аварийные IP Telegram (tier5) не редактируются — заданы в боте'))
				])
			]),
			E('div', { 'style':'color:#888;font-size:90%;margin-bottom:.4em;' },
				_('Добавить резервный SOCKS. Формат: socks5:// или socks5h:// (рекомендуется socks5h — DNS резолвится через прокси):')),
			E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;' }, [ input, btn, status ])
		]);
	},


	editTier1Port: function(endpoint) {
		var self = this;
		var curPort = '';
		var m = (endpoint || '').match(/:(\d+)$/);
		if (m) curPort = m[1];
		var input = E('input', { 'type':'text', 'class':'cbi-input-text', 'style':'width:100%;font-family:monospace;', 'value': curPort, 'placeholder':'2080' });
		var err = E('div', { 'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;' });
		ui.showModal(_('Порт Mixed Proxy (tier1)'), [
			E('p', {}, _('Обычно порт определяется автоматически. Задайте вручную, если вы изменили порт Mixed Proxy в Podkop (например, из-за конфликта портов) или автоопределение не сработало.')),
			E('p', { 'style':'color:#888;font-size:90%;' }, _('Значение записывается в активную секцию Podkop — тот же источник, из которого порт читает сам бот.')),
			input, err,
			E('div', { 'class':'right', 'style':'margin-top:.6em;' }, [
				E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
				' ',
				E('button', { 'class':'cbi-button cbi-button-apply', 'click': ui.createHandlerFn(this, function(){
					var v = (input.value||'').trim();
					return callSetTier1Port(v, (self.sectionsData && self.sectionsData.primary_section) ? self.sectionsData.primary_section : '').then(function(r){
						if (r && r.ok) { ui.hideModal(); return self.refreshState(); }
						var mm = { bad_port:_('порт должен быть в диапазоне 1–65535'), no_section:_('активная секция не найдена'), commit_failed:_('ошибка записи конфигурации') };
						dom.content(err, mm[r && r.reason] || (r && r.detail) || _('ошибка'));
					}).catch(function(){ dom.content(err, _('ошибка вызова')); });
				}) }, _('Сохранить'))
			])
		]);
	},

	editCustomProxy: function(current) {
		var self = this;
		var input = E('input', { 'type':'text', 'class':'cbi-input-text', 'style':'width:100%;font-family:monospace;', 'value': current || '', 'placeholder':'socks5h://host:port (пусто = убрать)' });
		var err = E('div', { 'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;' });
		ui.showModal(_('Custom proxy (tier3)'), [
			E('p', {}, _('socks5://, socks5h://, http:// или https:// IP:PORT. Пусто — убрать tier3.')),
			input, err,
			E('div', { 'class':'right', 'style':'margin-top:.6em;' }, [
				E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
				' ',
				E('button', { 'class':'cbi-button cbi-button-apply', 'click': ui.createHandlerFn(this, function(){
					return callSetField('custom_proxy', (input.value||'').trim()).then(function(r){
						if (r && r.ok) { ui.hideModal(); return self.refreshState(); }
						var m = { bad_format:_('неверный формат') };
						dom.content(err, m[r && r.reason] || (r && r.detail) || _('ошибка'));
					}).catch(function(){ dom.content(err, _('ошибка вызова')); });
				}) }, _('Сохранить'))
			])
		]);
	},

	editBindIface: function() {
		var self = this;
		/* Populate the picker with real interfaces so tailscale0/awg0 appear as
		 * they come up; the bot validates with `ip link show`, we mirror that. */
		return callListIfaces().then(function(d) {
			var ifaces = (d && d.interfaces) || [];
			var current = (d && d.current) || '';
			var sel = E('select', { 'class':'cbi-input-select', 'style':'width:100%;' },
				[ E('option', { 'value':'' }, _('auto (без привязки)')) ].concat(
					ifaces.map(function(i){ return E('option', { 'value':i }, i); })
				));
			sel.value = current || '';
			var err = E('div', { 'style':'color:#cc2b2b;font-size:90%;margin-top:.4em;' });
			ui.showModal(_('Интерфейс привязки (Direct WAN)'), [
				E('p', {}, _('К какому интерфейсу привязывать прямой выход. auto — выбирает система.')),
				sel, err,
				E('div', { 'class':'right', 'style':'margin-top:.6em;' }, [
					E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
					' ',
					E('button', { 'class':'cbi-button cbi-button-apply', 'click': ui.createHandlerFn(self, function(){
						return callSetField('bind_interface', sel.value).then(function(r){
							if (r && r.ok) { ui.hideModal(); return self.refreshState(); }
							dom.content(err, (r && r.detail) || _('ошибка'));
						}).catch(function(){ dom.content(err, _('ошибка вызова')); });
					}) }, _('Сохранить'))
				])
			]);
		}).catch(function(){ ui.addNotification(null, E('p', {}, _('Не удалось получить список интерфейсов')), 'error'); });
	},

	probeOne: function(t) {
		var node = t._resultNode;
		var self = this;
		dom.content(node, _('проверка…'));
		var target = (t.id === 'tier4') ? 'direct' : t.endpoint;
		function recolour(c) {
			if (t._dotWrap) dom.content(t._dotWrap, [ dot(c, t.name + (t._active ? '  ✓ '+_('активен') : '')) ]);
		}
		return callProbe(target).then(function(r) {
			if (r && r.result === 'ok') {
				var ms = (r.latency_ms != null && r.latency_ms > 0) ? (' · ' + r.latency_ms + ' мс') : '';
				dom.content(node, '✓ ok' + (r.http ? (' ('+r.http+')') : '') + ms);
				recolour('green');
			}
			else if (r && r.result === 'unknown') { dom.content(node, '— ' + (r.reason || 'unknown')); }
			else {
				dom.content(node, '✗ fail' + (r && r.http ? (' ('+r.http+')') : ''));
				/* configured but unreachable → yellow (a real, actionable problem) */
				recolour('yellow');
			}
		}).catch(function(){ dom.content(node, '✗ ' + _('ошибка')); recolour('yellow'); });
	},

	testFullChain: function() {
		var self = this;
		/* Probe every tier with an endpoint, sequentially, top to bottom. */
		var seq = this.tiers.filter(function(t){ return t.endpoint && t.endpoint !== ''; });
		var i = 0;
		function next() {
			if (i >= seq.length) return Promise.resolve();
			return self.probeOne(seq[i]).then(function(){ i++; return next(); });
		}
		ui.addNotification(null, E('p', {}, _('Проверяю цепочку сверху вниз…')), 'info');
		return next();
	},

	enableMixedProxy: function() {
		var self = this;
		ui.showModal(_('Включить Mixed Proxy'), [
			E('p', {}, _('Включить Mixed Proxy для primary-секции? Это нужно, чтобы tier1 (быстрый SOCKS) работал.')),
			E('div', { 'class':'right' }, [
				E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
				' ',
				E('button', { 'class':'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, function() {
					ui.hideModal();
					return callEnsureMP().then(function(r) {
						if (r && r.ok) {
							var msg = r.already_enabled ? _('Mixed Proxy уже включён')
								: (r.probe === 'ok' ? _('Mixed Proxy включён, SOCKS отвечает') : _('Mixed Proxy включён'));
							ui.addNotification(null, E('p', {}, msg + (r.endpoint ? (' · ' + r.endpoint) : '')), 'info');
							return callState().then(function(d){ self.state=d; self.tiers=self.buildTiers(d); dom.content(self.chainBox, self.renderTiers(self.tiers, d)); });
						}
						var rm = {
							not_proxy_section: _('Секция не является proxy — Mixed Proxy неприменим'),
							probe_failed: _('Включён, но SOCKS не ответил — откат выполнен'),
							variant_unknown: _('Вариант podkop не определён'),
							uci_missing: _('Конфиг podkop не найден'),
							commit_failed: _('Ошибка записи конфига')
						};
						ui.addNotification(null, E('p', {}, _('Не удалось включить: ') + (rm[r && r.reason] || (r && r.detail) || '?')), 'error');
					}).catch(function(){ ui.addNotification(null, E('p', {}, _('Ошибка вызова')), 'error'); });
				}) }, _('Включить'))
			])
		]);
	},

	row: function(label, valNode) {
		return E('div', { 'class':'pb-row pb-row--plain' }, [
			E('span', { 'class':'pb-row-label' }, label),
			E('span', { 'class':'pb-row-val' }, [ valNode ])
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
