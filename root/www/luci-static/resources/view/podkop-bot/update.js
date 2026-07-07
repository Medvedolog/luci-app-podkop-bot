'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Update (autonomous bot update)
 *
 * Two things:
 *  - version check (current vs latest from version.txt), forced here (the
 *    Overview badge uses the daily-cached check instead).
 *  - paste-install: paste a fresh podkop_bot.sh body; backend validates it the
 *    same way the bot's "Upload Bot Script" does (shebang + BOT_VERSION +
 *    syntax), backs up to .bak, installs, restarts. Paste (not file-upload) is
 *    the simplest LuCI-native path — plain string over rpcd, no cgi-io.
 */

var callCheckUpdate = rpc.declare({ object:'podkop_bot', method:'check_update', params:['force'] });
var callLuciUpdate  = rpc.declare({ object:'podkop_bot', method:'luci_update_check', params:['force'] });
var callLuciRun     = rpc.declare({ object:'podkop_bot', method:'luci_update_run' });
var callLuciLog     = rpc.declare({ object:'podkop_bot', method:'luci_update_log', params:['offset'] });
var callUpdatePaste = rpc.declare({ object:'podkop_bot', method:'update_paste', params:['body'] });
var callInstaller   = rpc.declare({ object:'podkop_bot', method:'installer', params:['action','config_path','config_inline'] });
var callStatus      = rpc.declare({ object:'podkop_bot', method:'status' });
var callPodkopUpdate = rpc.declare({ object:'podkop_bot', method:'podkop_update_check' });
var callLogs        = rpc.declare({ object:'podkop_bot', method:'logs', params:['offset'] });

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
		return callCheckUpdate('true').catch(function(){ return { ok:false }; });
	},

	render: function(data) {
		var self = this;

		var verLine = E('div', { 'style':'margin:.5em 0;' }, this.verNode(data));

		var ta = E('textarea', {
			'class':'cbi-input-textarea',
			'style':'width:100%;min-height:200px;font-family:monospace;font-size:85%;',
			'placeholder':_('Вставьте сюда содержимое podkop_bot.sh целиком…')
		});

		var result = E('div', { 'style':'margin-top:.6em;' });

		var installBtn = E('button', {
			'class':'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function() {
				var body = ta.value || '';
				if (body.trim().length < 100) {
					dom.content(result, dot('yellow', _('Вставьте полный скрипт бота')));
					return;
				}
				dom.content(result, dot('grey', _('Проверка и установка…')));
				return callUpdatePaste(body).then(function(r) {
					if (r && r.ok) {
						dom.content(result, dot('green',
							_('Установлено: v') + (r.installed_version||'?') +
							' · ' + (r.service_running ? _('служба работает') : _('служба остановлена')) +
							' · ' + _('бэкап: ') + (r.backup||'')));
						/* refresh version line */
						callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
					} else {
						dom.content(result, dot('red', self.errText(r)));
					}
				}).catch(function(){
					dom.content(result, dot('red', _('Ошибка вызова')));
				});
			})
		}, _('Проверить и установить'));

		var recheckBtn = E('button', {
			'class':'cbi-button',
			'style':'margin-left:.5em;',
			'click': function() {
				dom.content(verLine, dot('grey', _('Проверка…')));
				callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
			}
		}, _('Проверить версию'));

		var ghLog = E('pre', {
			'style':'display:none;max-width:760px;max-height:300px;overflow:auto;background:rgba(127,127,127,.08);padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.6em;'
		}, '');
		var ghStatus = E('div', { 'style':'margin-top:.5em;' });
		this._ghOffset = 0; this._ghLog = '';

		var ghBtn = E('button', {
			'class':'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function() {
				ghLog.style.display = 'block';
				ghLog.textContent = '';
				self._ghOffset = 0; self._ghLog = '';
				dom.content(ghStatus, dot('grey', _('Запуск обновления с GitHub…')));
				return callInstaller('update', '', '').then(function(r) {
					if (!r || !r.ok) {
						dom.content(ghStatus, dot('red', (r && r.detail) || _('не удалось запустить')));
						return;
					}
					self.pollGhLog(ghStatus, ghLog, verLine);
				}).catch(function(){
					dom.content(ghStatus, dot('red', _('Ошибка вызова installer')));
				});
			})
		}, _('Обновить с GitHub'));

		var uninstLog = E('pre', { 'style':'display:none;max-width:760px;max-height:240px;overflow:auto;background:rgba(127,127,127,.08);padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.6em;' }, '');
		var uninstStatus = E('div', { 'style':'margin-top:.5em;' });
		var uninstInput = E('input', { 'type':'text', 'class':'cbi-input-text', 'style':'font-family:monospace;', 'placeholder':'REMOVE' });
		var uninstBtn = E('button', {
			'class':'cbi-button cbi-button-negative',
			'style':'margin-left:.5em;',
			'click': ui.createHandlerFn(this, function() {
				if ((uninstInput.value||'').trim() !== 'REMOVE') {
					dom.content(uninstStatus, dot('yellow', _('Введите REMOVE для подтверждения')));
					return;
				}
				uninstLog.style.display = 'block'; uninstLog.textContent = '';
				self._ghOffset = 0; self._ghLog = '';
				dom.content(uninstStatus, dot('grey', _('Удаление…')));
				return callInstaller('uninstall', '', '').then(function(r) {
					if (!r || !r.ok) { dom.content(uninstStatus, dot('red', (r && r.detail) || _('не удалось запустить'))); return; }
					self.pollGhLog(uninstStatus, uninstLog, verLine);
				}).catch(function(){ dom.content(uninstStatus, dot('red', _('Ошибка вызова installer'))); });
			})
		}, _('Удалить бота'));

		/* Collapsible offline-install block (folded by default). */
		var offlineBody = E('div', { 'style':'display:none;margin-top:.6em;' }, [
			E('p', { 'style':'color:#888;font-size:90%;' }, [
				_('Когда GitHub и Telegram недоступны: вставьте содержимое свежего '),
				E('code', {}, 'podkop_bot.sh'),
				_(' и установите. Скрипт проверяется (shebang, BOT_VERSION, синтаксис), текущая версия сохраняется в .bak, бот перезапускается.')
			]),
			ta,
			E('div', { 'style':'margin-top:.6em;' }, [ installBtn ]),
			result
		]);
		var offlineToggle = E('button', {
			'class':'cbi-button',
			'style':'margin-top:.8em;',
			'click': function() {
				var open = offlineBody.style.display !== 'none';
				offlineBody.style.display = open ? 'none' : 'block';
				this.textContent = open ? _('Автономная установка из текста ▸')
				                        : _('Автономная установка из текста ▾');
			}
		}, _('Автономная установка из текста ▸'));

		return E('div', {}, [
			E('h2', {}, _('Обновление модулей')),
			E('p', { 'style':'color:#888;font-size:90%;max-width:760px;margin-top:-.4em;' },
				_('Три независимых модуля: сам веб-интерфейс (LuCI), Telegram-бот и Podkop. Каждый обновляется своим способом.')),

			/* ─── Card 1: this LuCI app ─────────────────────────────────── */
			this.luciCard(),

			/* ─── Card 2: the bot — version + all update methods together ── */
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Telegram-бот (podkop_bot)')),
				this.currentBlock(),
				E('div', { 'style':'margin:.8em 0 .3em;border-top:1px solid rgba(127,127,127,.15);padding-top:.8em;' }, [ verLine, recheckBtn ]),

				/* update method: GitHub */
				E('div', { 'style':'margin-top:1em;' }, [
					E('strong', {}, _('Обновление с GitHub')),
					E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0;' }, _('Запускает install.sh --action update: скачивает свежий бот с GitHub (с SOCKS-fallback) и устанавливает. Лог установки — ниже.')),
					ghBtn, ghStatus, ghLog
				]),

				/* update method: offline paste (collapsible) */
				offlineToggle,
				offlineBody
			]),

			/* ─── Card 3: Podkop / fork ─────────────────────────────────── */
			this.podkopUpdateCard(),

			/* ─── Danger zone: uninstall the bot ────────────────────────── */
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(204,43,43,.4);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;color:#cc2b2b;' }, _('Удаление бота')),
				E('p', { 'style':'color:#888;font-size:90%;' }, _('Полностью удаляет бот (install.sh --action uninstall): останавливает службу, убирает /usr/bin/podkop_bot, автозапуск и runtime-файлы. Конфиг с токеном тоже удаляется. Введите REMOVE для подтверждения.')),
				E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;' }, [ uninstInput, uninstBtn ]),
				uninstStatus,
				uninstLog
			]),
			pbFooter()
		]);
	},

	/* This LuCI app's own version card. Shows installed version and, when a
	 * newer release exists in the repo (checked over the network with the same
	 * direct→SOCKS fallback as the bot), a button to the Releases page. The app
	 * does not self-update; it points the user at the release to install. */
	luciCard: function() {
		var self = this;
		var line = E('div', { 'style':'margin:.3em 0;' }, dot('grey', _('проверяю…')));
		var actions = E('div', { 'style':'margin-top:.5em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' });
		var luciStatus = E('div', { 'style':'margin-top:.5em;' });
		var luciLog = E('pre', {
			'style':'display:none;margin-top:.5em;max-height:260px;overflow:auto;background:rgba(127,127,127,.08);padding:.6em;border-radius:6px;font-size:85%;white-space:pre-wrap;'
		}, '');
		this._luciNodes = { status: luciStatus, log: luciLog, line: line, actions: actions };
		var recheck = E('button', {
			'class':'cbi-button', 'style':'margin-top:.5em;',
			'click': function() {
				dom.content(line, dot('grey', _('Проверка…')));
				callLuciUpdate('true').then(function(d){ self.fillLuci(line, actions, d); });
			}
		}, _('Проверить версию'));
		callLuciUpdate('').then(function(d){ self.fillLuci(line, actions, d); })
			.catch(function(){ dom.content(line, dot('grey', _('Не удалось проверить'))); });
		return E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Веб-интерфейс (luci-app-podkop-bot)')),
			line, actions, recheck, luciStatus, luciLog
		]);
	},

	/* Poll the LuCI self-update log until the installer writes a done/error
	 * marker. Mirrors pollGhLog but for luci_update_log. */
	pollLuciLog: function() {
		var self = this;
		var n = this._luciNodes; if (!n) return;
		this._luciOffset = 0; this._luciLog = '';
		n.log.style.display = 'block';
		dom.content(n.status, dot('yellow', _('Установка идёт…')));
		var tick = function() {
			callLuciLog(self._luciOffset).then(function(r) {
				if (r && r.chunk) { self._luciLog += r.chunk; n.log.textContent = self._luciLog; n.log.scrollTop = n.log.scrollHeight; }
				if (r && typeof r.offset === 'number') self._luciOffset = r.offset;
				if (r && r.done) {
					if (/\[done\] exit 0/.test(self._luciLog)) {
						dom.content(n.status, dot('green', _('Установка завершена. Обновите страницу (Ctrl/Cmd+Shift+R).')));
					} else if (/\[!!\]/.test(self._luciLog)) {
						dom.content(n.status, dot('red', _('Установка завершилась с ошибкой — см. лог.')));
					} else {
						dom.content(n.status, dot('green', _('Готово. Обновите страницу.')));
					}
					return;
				}
				setTimeout(tick, 1500);
			}).catch(function(){ setTimeout(tick, 2000); });
		};
		tick();
	},

	fillLuci: function(line, actions, d) {
		dom.content(actions, '');
		if (!d || d.ok === false) { dom.content(line, dot('grey', _('Не удалось проверить версию'))); return; }
		if (d.latest === 'unknown') {
			dom.content(line, dot('yellow', _('Текущая: v') + (d.current||'?') + ' · ' +
				_('последнюю проверить не удалось (ни напрямую, ни через SOCKS).')));
			return;
		}
		var via = (d.via === 'socks') ? (' (' + _('через SOCKS') + ')')
			: (d.via === 'direct' ? (' (' + _('напрямую') + ')') : '');
		if (d.update_available) {
			dom.content(line, dot('yellow', _('Доступно обновление: v') + d.current + ' → v' + d.latest + via));
			var self = this;
			dom.content(actions, [
				E('button', {
					'class':'cbi-button cbi-button-apply',
					'click': function() {
						this.disabled = true;
						callLuciRun().then(function(){ self.pollLuciLog(); })
							.catch(function(){ self.pollLuciLog(); });
					}
				}, _('Обновить веб-интерфейс')),
				E('a', {
					'class':'cbi-button',
					'href': d.releases_url || 'https://github.com/Medvedolog/luci-app-podkop-bot/releases',
					'target':'_blank', 'rel':'noopener'
				}, _('Скачать вручную'))
			]);
		} else {
			dom.content(line, dot('green', _('Установлено v') + (d.current||'?') + ' · ' +
				_('в репозитории v') + (d.latest||'?') + ' — ' + _('актуально') + via));
		}
	},

	/* Current installation summary, filled async from status. */
	/* Podkop/fork update card — async, does not block render. Shows variant, repo,
	 * current→latest, and a Releases link. The bot manages ITS OWN update via
	 * install.sh; updating Podkop itself is the fork's job, so we link to releases
	 * rather than auto-installing (out of scope — TZ boundary). */
	podkopUpdateCard: function() {
		var self = this;
		var holder = E('div', { 'id':'podkop-fork-update' },
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')),
				dot('grey', _('проверяю…'))
			]));
		this.fillPodkop(holder, '');
		return holder;
	},

	fillPodkop: function(holder, force) {
		var self = this;
		callPodkopUpdate(force).then(function(d) {
			var recheck = E('button', {
				'class':'cbi-button', 'style':'margin-top:.6em;',
				'click': function() {
					dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
						E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')),
						dot('grey', _('Проверка…'))
					]));
					self.fillPodkop(holder, 'true');
				}
			}, _('Проверить версию'));
			var inner;
			if (!d || !d.ok || d.available === false) {
				inner = [
					E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')),
					dot('grey', _('Не удалось проверить (GitHub недоступен напрямую и через прокси).')),
					(d && d.releases_url) ? E('div', { 'style':'margin-top:.5em;' }, [
						E('a', { 'href': d.releases_url, 'target':'_blank', 'rel':'noopener' }, _('Открыть релизы'))
					]) : E('span', {}),
					recheck
				];
			} else {
				var upd = d.update_available;
				inner = [
					E('h3', { 'style':'margin-top:0;' }, _('Обновление ') + (d.name || 'Podkop')),
					E('div', { 'class':'pb-row pb-row--plain' }, [
						E('span', { 'class':'pb-row-label' }, _('Вариант')), E('span', { 'class':'pb-row-val' }, d.variant || '—')
					]),
					E('div', { 'class':'pb-row pb-row--plain' }, [
						E('span', { 'class':'pb-row-label' }, _('Установлено')), E('span', { 'class':'pb-row-val' }, d.current || '—')
					]),
					E('div', { 'class':'pb-row pb-row--plain' }, [
						E('span', { 'class':'pb-row-label' }, _('В репозитории')),
						E('span', { 'class':'pb-row-val' }, [
							upd ? dot('yellow', (d.latest||'—') + _(' — доступно')) : dot('green', (d.latest||'—') + _(' — актуально'))
						])
					]),
					E('div', { 'class':'pb-row pb-row--plain' }, [
						E('span', { 'class':'pb-row-label' }, _('Проверено через')), E('span', { 'class':'pb-row-val' }, d.via === 'socks' ? _('прокси (SOCKS)') : (d.via === 'direct' ? _('напрямую') : '—'))
					]),
					E('p', { 'style':'color:#888;font-size:88%;margin:.5em 0 0;' },
						_('Обновление самого Podkop выполняется его средствами (не ботом). Ссылка ведёт на страницу релизов.')),
					E('div', { 'style':'margin-top:.4em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [
						E('a', { 'class':'cbi-button', 'href': d.releases_url || d.repo_url, 'target':'_blank', 'rel':'noopener' }, _('Страница релизов')),
						recheck
					])
				];
			}
			dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, inner));
		}).catch(function(){});
	},

	currentBlock: function() {
		var box = E('div', {}, dot('grey', _('загрузка…')));
		callStatus().then(function(s) {
			if (!s || s.available === false) { dom.content(box, dot('yellow', _('бот не установлен'))); return; }
			var rows = [];
			function r(l, v){ rows.push(E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, l), E('span', { 'class':'pb-row-val' }, v||'—') ])); }
			r(_('Версия бота'), s.bot_version);
			r(_('Вариант'), s.podkop_variant);
			r(_('Служба'), s.running ? _('работает') : _('остановлена'));
			r(_('Автозапуск'), s.autostart ? _('включён') : _('выключен'));
			dom.content(box, rows);
		}).catch(function(){ dom.content(box, dot('grey', '—')); });
		return box;
	},

	/* Poll the install log while the GitHub update runs (same mechanism as the
	 * Wizard). Stops when the backend reports done, then refreshes the version. */
	pollGhLog: function(statusNode, logNode, verLine) {
		var self = this;
		dom.content(statusNode, dot('yellow', _('Обновление идёт…')));
		var tick = function() {
			callLogs(self._ghOffset).then(function(r) {
				if (r && r.chunk) { self._ghLog += r.chunk; logNode.textContent = self._ghLog; logNode.scrollTop = logNode.scrollHeight; }
				if (r && typeof r.offset === 'number') self._ghOffset = r.offset;
				if (r && r.done) {
					if (r.exit_code === 0) {
						dom.content(statusNode, dot('green', _('Обновление завершено')));
						callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
					} else {
						dom.content(statusNode, dot('red', _('Установщик завершился с кодом ') + r.exit_code));
					}
					return;
				}
				setTimeout(tick, 1500);
			}).catch(function(){ setTimeout(tick, 2000); });
		};
		tick();
	},

	verNode: function(d) {
		if (!d || d.ok === false) return dot('grey', _('Не удалось проверить версию'));
		if (d.latest === 'unknown') {
			return E('span', {}, [ dot('yellow',
				_('Текущая: v') + (d.current||'?') + ' · ' +
				_('последнюю проверить не удалось (ни напрямую, ни через SOCKS).')) ]);
		}
		var via = (d.via === 'socks') ? (' (' + _('проверено через SOCKS') + ')')
			: (d.via === 'direct' ? (' (' + _('проверено напрямую') + ')') : '');
		if (d.update_available) {
			return dot('yellow', _('Доступно обновление: v') + d.current + ' → v' + d.latest + via);
		}
		return dot('green', _('Установлено v') + (d.current||'?') + ' · ' +
			_('в репозитории v') + (d.latest||'?') + ' — ' + _('актуально') + via);
	},

	errText: function(r) {
		var m = {
			empty: _('Пустой скрипт'),
			not_bot_script: _('Не похоже на скрипт бота (нет shebang/BOT_VERSION)'),
			syntax_error: _('Синтаксические ошибки — установка отменена, текущий бот не тронут'),
			install_failed: _('Не удалось записать файл бота')
		};
		return _('Отклонено: ') + (m[r && r.reason] || (r && r.detail) || _('неизвестно'));
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
