'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Overview (live, v0.16.2)
 *
 * status  → service card (service state, versions, mixed proxy) OR degraded card.
 * service → start/stop/restart, re-renders the card in place (no page reload).
 *
 * §18-quater: a failed rpc becomes a degraded object, never a blank screen.
 * mixed_proxy is an independent sub-layer: it may be unavailable while the rest
 * of the card renders fine (§18q.2).
 * Colours (§18t.1): green ok / grey expected-inactive / yellow config / red broken.
 */

var callStatus  = rpc.declare({ object: 'podkop_bot', method: 'status' });
var callService = rpc.declare({ object: 'podkop_bot', method: 'service', params: [ 'action' ] });
var callResources = rpc.declare({ object: 'podkop_bot', method: 'resources' });
var callCheckUpdate = rpc.declare({ object: 'podkop_bot', method: 'check_update', params: [ 'force' ] });
var callSingboxInfo = rpc.declare({ object: 'podkop_bot', method: 'singbox_info' });
var callAppInfo = rpc.declare({ object: 'podkop_bot', method: 'app_info' });
var callTestGithub = rpc.declare({ object: 'podkop_bot', method: 'test_github' });
var callPodkopUpdate = rpc.declare({ object: 'podkop_bot', method: 'podkop_update_check' });

/* visiblePoller: runs tick() every `ms`, but only while the page is BOTH
 * visible and focused. Pauses on tab-hide and on window blur, resumes on
 * return/focus, so background or unfocused tabs don't keep polling the router.
 * A module-level singleton is stopped before a new one starts, so navigating
 * back into Overview can't leave a second timer running. */
var _activePoller = null;
function visiblePoller(ms, tick) {
	if (_activePoller) { _activePoller.stop(); _activePoller = null; }

	var timer = null, stopped = false, focused = document.hasFocus();
	function active() { return document.visibilityState === 'visible' && focused; }
	function schedule() { if (!stopped) timer = setTimeout(loop, ms); }
	function loop() {
		if (stopped) return;
		if (active()) Promise.resolve(tick()).catch(function(){}).then(schedule);
		else schedule();
	}
	function onFocus() {
		focused = true;
		if (timer) { clearTimeout(timer); timer = null; }
		loop();
	}
	function onBlur() { focused = false; }
	function onVis() { if (document.visibilityState === 'visible') onFocus(); }

	document.addEventListener('visibilitychange', onVis);
	window.addEventListener('focus', onFocus);
	window.addEventListener('blur', onBlur);
	loop();

	var handle = {
		stop: function() {
			stopped = true;
			if (timer) { clearTimeout(timer); timer = null; }
			document.removeEventListener('visibilitychange', onVis);
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('blur', onBlur);
			if (_activePoller === handle) _activePoller = null;
		}
	};
	_activePoller = handle;
	return handle;
}

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };

function dot(colour, label) {
	return E('span', { 'style':'display:inline-flex;align-items:center;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:0 0 auto;background:'+(COLOURS[colour]||COLOURS.grey)+';' }),
		E('span', {}, label)
	]);
}

/* Inject the shared stylesheet once (idempotent by id). Called from load().
 * Uses L.resource() so the path tracks the active LuCI static base. */
function pbInjectCss() {
	if (document.getElementById('pb-css')) return;
	document.querySelector('head').appendChild(E('link', {
		'id':'pb-css', 'rel':'stylesheet', 'type':'text/css',
		'href': L.resource('css/podkop-bot/podkop-bot.css')
	}));
}

function row(label, valueNode) {
	return E('div', { 'class':'pb-row' }, [
		E('span', { 'class':'pb-row-label' }, label),
		E('span', { 'class':'pb-row-val' },
			(valueNode instanceof Node) ? valueNode : (valueNode == null ? '—' : String(valueNode)))
	]);
}

function card(children) {
	return E('div', { 'class':'cbi-section', 'style':'max-width:600px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' },
		children);
}

/* Map a degraded reason to a colour per §18q.3. */
function reasonColour(reason) {
	var red    = [ 'bot_not_installed','installer_missing','installer_error','rpc_error','init_missing' ];
	var yellow = [ 'token_not_configured','mixed_proxy_disabled' ];
	if (red.indexOf(reason) >= 0)    return 'red';
	if (yellow.indexOf(reason) >= 0) return 'yellow';
	return 'grey';
}

/* mixed_proxy → a value node (independent sub-layer). */
function mixedNode(mp) {
	if (!mp || mp.available === false) {
		/* expected/neutral: schema not resolvable here — grey, not red (§18t.1) */
		return dot('grey', (mp && mp.detail) ? mp.detail : _('недоступно'));
	}
	if (mp.enabled === true) {
		var txt = _('Включён') + (mp.port ? (' · ' + _('порт') + ' ' + mp.port) : '')
		          + (mp.section ? (' · ' + mp.section) : '');
		return dot('green', txt);
	}
	/* disabled is a config state → yellow, not red */
	return dot('yellow', _('Выключен'));
}

/* Deprecation banner → node|null. Rendered above the status card when the
 * installed podkop is below the supported floor. Mixed Proxy is gated on the
 * backend for such versions; this explains why and points at releases. */
function deprecationBanner(dep, releasesUrl) {
	if (!dep || dep.deprecated !== true) return null;
	var cur = dep.current || '?', min = dep.min_supported || '?';
	var kids = [
		E('p', { 'style':'margin:0 0 .4em;font-weight:500;' },
			_('Устаревшая версия Podkop')),
		E('p', { 'style':'margin:0;' },
			_('Установлен Podkop %s — ниже минимально поддерживаемой %s. Функции вроде Mixed Proxy отключены. Обновите Podkop.')
				.format(cur, min))
	];
	if (releasesUrl) {
		kids.push(E('a', {
			'style':'display:inline-block;margin-top:.5em;', 'href': releasesUrl,
			'target':'_blank', 'rel':'noopener'
		}, _('Страница релизов Podkop')));
	}
	return E('div', {
		'style':'max-width:600px;margin:0 0 1em;padding:.7em 1em;border:1px solid #e8a33d;border-radius:6px;background:rgba(232,163,61,.08);'
	}, kids);
}

return view.extend({
	load: function() {
		pbInjectCss();
		return callStatus().catch(function() {
			return { available:false, reason:'rpc_error', detail:_('Нет связи с роутером'),
			         action:{ label:_('Повторить'), method:'status', arg:'' } };
		});
	},

	/* Build just the card node for given data — reused on re-render. */
	buildCard: function(data) {
		var self = this;
		if (!data || data.available === false) {
			var children = [ E('div', { 'style':'margin:.3em 0 1em;' },
				dot(reasonColour(data && data.reason), (data && data.detail) || _('Недоступно'))) ];
			/* First-run: bot not installed → offer the Setup Wizard (TZ 9.1).
			 * A banner+button, not a hard redirect — the user may have opened
			 * Overview deliberately while the bot is broken. */
			if (data && (data.reason === 'bot_not_installed' || data.reason === 'installer_missing')) {
				children.push(E('div', {
					'style':'margin:.6em 0;padding:.7em 1em;border:1px solid #e8a33d;border-radius:6px;background:rgba(232,163,61,.08);'
				}, [
					E('p', { 'style':'margin:0 0 .5em;' }, _('Бот ещё не установлен. Мастер настройки проведёт через установку шаг за шагом.')),
					E('button', {
						'class':'cbi-button cbi-button-action',
						'click': function(){ window.location = L.url('admin/services/podkop-bot/wizard'); }
					}, _('Открыть Мастер настройки'))
				]));
			}
			if (data && data.action && data.action.label) {
				children.push(E('button', {
					'class':'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(self, 'handleAction', data.action)
				}, data.action.label));
			}
			return card(children);
		}

		var running = (data.service_running === true) || (data.running === true);
		var autostart = (data.autostart === true);

		var btns = E('div', { 'style':'margin-top:1em;display:flex;gap:.5em;flex-wrap:wrap;' }, [
			running
				? E('button', { 'class':'cbi-button cbi-button-reset',
				    'click': ui.createHandlerFn(self, 'handleService', 'stop_bot') }, _('Остановить'))
				: E('button', { 'class':'cbi-button cbi-button-apply',
				    'click': ui.createHandlerFn(self, 'handleService', 'start_bot') }, _('Запустить')),
			E('button', { 'class':'cbi-button cbi-button-action',
			    'click': ui.createHandlerFn(self, 'handleService', 'restart_bot') }, _('Перезапустить')),
			autostart
				? E('button', { 'class':'cbi-button',
				    'click': ui.createHandlerFn(self, 'handleService', 'disable_bot') }, _('Отключить автозапуск'))
				: E('button', { 'class':'cbi-button',
				    'click': ui.createHandlerFn(self, 'handleService', 'enable_bot') }, _('Включить автозапуск'))
		]);

		var statusCard = card([
			row(_('Служба'), running ? dot('green', _('Работает')) : dot('red', _('Остановлена'))),
			row(_('Автозапуск'), autostart ? dot('green', _('Включён')) : dot('yellow', _('Отключён'))),
			row(_('Версия бота'), data.bot_version),
			row(_('Вариант Podkop'), data.podkop_variant),
			row(_('Версия Podkop'), E('span', { 'id':'podkop-ver-cell' }, data.podkop_version || '—')),
			this._sbRow = E('div', { 'class':'pb-row pb-row--plain' }, [
				E('span', { 'class':'pb-row-label' }, _('sing-box')),
				E('span', { 'class':'pb-row-val', 'id':'podkop-sb-type' }, _('…'))
			]),
			row(_('Mixed Proxy'), mixedNode(data.mixed_proxy)),
			this._ghRow = E('div', { 'class':'pb-row pb-row--plain' }, [
				E('span', { 'class':'pb-row-label' }, _('GitHub напрямую')),
				E('span', { 'class':'pb-row-val', 'id':'podkop-gh-direct' }, _('…'))
			]),
			btns
		]);

		/* Prepend a deprecation banner when podkop is below the supported
		 * floor. releases_url isn't in the status payload, so build the same
		 * link the update-check uses; the async badge may refine it later. */
		var banner = deprecationBanner(data.podkop_deprecated);
		if (banner) return E('div', {}, [ banner, statusCard ]);
		return statusCard;
	},

	/* Build the live resources mini-card (sing-box PID/RSS, RAM). */
	buildResources: function(r) {
		if (!r || r.ok === false) {
			/* Use the resources layout (not card(), which hardcodes a "Podkop
			 * Bot" h3) so the placeholder/error reads "Ресурсы", not a 2nd card. */
			return E('div', { 'class':'cbi-section', 'style':'max-width:600px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Ресурсы')),
				row(_('Состояние'), dot('grey', _('недоступно')))
			]);
		}
		var sb = r.singbox || {}, ram = r.ram || {};
		var sbNode = sb.running
			? dot('green', _('работает') + ' · PID ' + ((sb.pids && sb.pids.length) ? sb.pids.join(', ') : '?')
			      + (sb.count > 1 ? (' (' + sb.count + ')') : '') + ' · RSS ' + (sb.rss_mb != null ? sb.rss_mb : '?') + ' MB')
			: dot('red', _('не запущен'));
		/* RAM colour: green normally, yellow when free is getting low (<60 MB),
		 * matching the bot's own low-RAM concern (~30 MB alert). */
		var ramColour = (ram.avail_mb != null && ram.avail_mb < 60) ? 'yellow' : 'green';
		var ramNode = dot(ramColour,
			(ram.avail_mb != null ? ram.avail_mb : '?') + ' / ' + (ram.total_mb != null ? ram.total_mb : '?')
			+ ' MB ' + _('свободно') + (ram.used_pct != null ? (' · ' + ram.used_pct + '% занято') : ''));

		return E('div', { 'class':'cbi-section', 'style':'max-width:600px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Ресурсы')),
			row('sing-box', sbNode),
			row(_('Оперативная память'), ramNode)
		]);
	},

	render: function(data) {
		this.data = data;
		var container = E('div', { 'id':'podkop-bot-card' }, [ this.buildCard(data) ]);
		this.container = container;

		var resBox = E('div', { 'id':'podkop-bot-resources' }, [ this.buildResources(null) ]);
		this.resBox = resBox;

		/* Update badge: single cached check (force=false → daily TTL in backend),
		 * NOT part of the 5s poll. Shows a line + small button only if an update
		 * is available. */
		var updBadge = E('div', { 'id':'podkop-bot-updbadge' });
		this.updBadge = updBadge;
		var self2 = this;
		callCheckUpdate('false').then(function(d) {
			if (d && d.ok && d.update_available) {
				dom.content(updBadge, E('div', {
					'style':'margin:.6em 0;padding:.6em .9em;border:1px solid #e8a33d;border-radius:6px;background:rgba(232,163,61,.08);display:flex;align-items:center;gap:.8em;flex-wrap:wrap;'
				}, [
					E('span', {}, _('Доступно обновление бота: v') + d.current + ' → v' + d.latest),
					E('button', {
						'class':'cbi-button cbi-button-action',
						'style':'padding:.1em .6em;font-size:90%;',
						'click': function(){ window.location = L.url('admin/services/podkop-bot/update'); }
					}, _('Обновить'))
				]));
			}
		}).catch(function(){});

		/* Podkop/fork update badge — async, filled into the "Версия Podkop" row
		 * itself (compact, next to the version), never blocks the card. Three
		 * states: ✓ up to date, 🔔 update available, ? check failed. The title
		 * attribute acts as a hover balloon with current/latest/via details. */
		callPodkopUpdate('').then(function(d) {
			var cell = document.getElementById('podkop-ver-cell');
			if (!cell || !d || !d.ok) {
				if (cell && d && d.available === false) {
					dom.content(cell, [
						E('span', {}, (d.current || '—') + ' '),
						E('span', { 'title': _('Не удалось проверить обновление (GitHub недоступен напрямую и через прокси).') }, '?')
					]);
				}
				return;
			}
			var mark, tip;
			if (d.update_available) {
				mark = E('span', { 'style':'cursor:help;', 'title': (d.name||'Podkop') + ': v' + d.current + ' → v' + d.latest + ' — ' + _('доступно обновление') + ' (' + (d.via==='socks'?_('через прокси'):_('напрямую')) + ')' }, '🔔');
			} else {
				mark = E('span', { 'style':'cursor:help;', 'title': (d.name||'Podkop') + ' ' + _('актуален') + ' (v' + d.latest + ', ' + (d.via==='socks'?_('через прокси'):_('напрямую')) + ')' }, '✓');
			}
			dom.content(cell, [
				E('span', {}, (d.current || '—') + ' '),
				mark,
				d.update_available ? E('a', { 'style':'margin-left:.5em;font-size:88%;', 'href': d.releases_url || d.repo_url, 'target':'_blank', 'rel':'noopener' }, _('релизы')) : E('span', {})
			]);
		}).catch(function(){});

		/* Start the visible-only 5s poll. Done here (not in a maybe-unsupported
		 * lifecycle hook) so it reliably starts; setTimeout(0) lets the DOM mount
		 * first. visiblePoller pauses itself when the tab is hidden. */
		var self = this;
		setTimeout(function() {
			self.poller = visiblePoller(5000, function() {
				return callResources().then(function(r) {
					if (self.resBox) dom.content(self.resBox, self.buildResources(r));
				}).catch(function(){});
			});
		}, 0);
		window.addEventListener('beforeunload', function(){ if (self.poller) self.poller.stop(); });

		/* Fill the sing-box type/version row (read-only). Installing/switching
		 * flavours is a podkop-plus function, not the bot's — we only display. */
		callSingboxInfo().then(function(si) {
			var el = document.getElementById('podkop-sb-type');
			if (el && si && si.ok) {
				var fl = (si.flavour === 'extended') ? ' · extended' : (si.flavour ? (' · ' + si.flavour) : '');
				el.textContent = (si.version || 'unknown') + fl;
			} else if (el) { el.textContent = '—'; }
		}).catch(function(){
			var el = document.getElementById('podkop-sb-type'); if (el) el.textContent = '—';
		});

		/* GitHub reachability DIRECT (not via tunnel): green if reachable, grey if
		 * not — a blocked GitHub under RKN is expected, not a fault, so grey. */
		callTestGithub().then(function(gh) {
			var el = document.getElementById('podkop-gh-direct');
			if (!el) return;
			if (gh && gh.reachable) dom.content(el, dot('green', _('доступен')));
			else dom.content(el, dot('grey', _('недоступен напрямую')));
		}).catch(function(){
			var el = document.getElementById('podkop-gh-direct'); if (el) dom.content(el, dot('grey', '—'));
		});

		var appFooter = E('div', { 'style':'max-width:600px;margin-top:.8em;color:#888;font-size:85%;text-align:right;' }, [
			E('span', { 'id':'podkop-app-ver' }, '')
		]);
		callAppInfo().then(function(a) {
			var el = document.getElementById('podkop-app-ver');
			if (el && a && a.ok) {
				dom.content(el, [
					E('span', {}, _('luci-app-podkop-bot v') + (a.luci_app_version||'?') + ' · '),
					E('a', { 'href': a.repo || 'https://github.com/Medvedolog/luci-app-podkop-bot', 'target':'_blank', 'rel':'noopener' }, _('репозиторий'))
				]);
			}
		}).catch(function(){});

		return E('div', {}, [ E('h2', {}, _('Podkop Bot')), updBadge, container, resBox, appFooter ]);
	},

	/* Re-fetch status and swap the card content in place. */
	refresh: function() {
		var self = this;
		return callStatus().catch(function() {
			return { available:false, reason:'rpc_error', detail:_('Нет связи с роутером'),
			         action:{ label:_('Повторить'), method:'status', arg:'' } };
		}).then(function(data) {
			self.data = data;
			dom.content(self.container, self.buildCard(data));
		});
	},

	handleService: function(action /*, ev */) {
		var self = this;
		ui.showModal(_('Управление службой'), [
			E('p', { 'class':'spinning' }, _('Выполняется: %s…').format(action))
		]);
		return callService(action).then(function() {
			ui.hideModal();
			return self.refresh();
		}).catch(function() {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, _('Не удалось выполнить действие')), 'error');
		});
	},

	/* Degraded-card action button (installer/retry). Retry just refreshes. */
	handleAction: function(action /*, ev */) {
		var self = this;
		if (action && action.method === 'status') {
			return self.refresh();
		}
		/* installer/install means "bot not installed" — send to the Wizard,
		 * which is the real install path, instead of a dead "next slice" toast. */
		if (action && action.method === 'installer') {
			window.location = L.url('admin/services/podkop-bot/wizard');
			return;
		}
		ui.addNotification(null,
			E('p', {}, _('Действие «%s» появится в следующем срезе.').format(action ? action.label : '')),
			'info');
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
