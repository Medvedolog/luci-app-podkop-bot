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
var callUpdatePaste = rpc.declare({ object:'podkop_bot', method:'update_paste', params:['body'] });
var callInstaller   = rpc.declare({ object:'podkop_bot', method:'installer', params:['action','config_path','config_inline'] });
var callStatus      = rpc.declare({ object:'podkop_bot', method:'status' });
var callPodkopUpdate = rpc.declare({ object:'podkop_bot', method:'podkop_update_check' });
var callLogs        = rpc.declare({ object:'podkop_bot', method:'logs', params:['offset'] });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) {
	return E('span', { 'style':'display:inline-flex;align-items:center;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;background:'+(COLOURS[c]||COLOURS.grey)+';' }),
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

		return E('div', {}, [
			E('h2', {}, _('Обновление Podkop Bot')),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Текущая установка')),
				this.currentBlock(),
			]),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Версия')),
				verLine,
				recheckBtn
			]),
			this.podkopUpdateCard(),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Обновление с GitHub')),
				E('p', { 'style':'color:#888;font-size:90%;' }, _('Запускает install.sh --action update: скачивает свежий бот с GitHub (с SOCKS-fallover) и устанавливает. Лог установки — ниже.')),
				ghBtn,
				ghStatus,
				ghLog
			]),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Автономная установка из текста')),
				E('p', { 'style':'color:#888;font-size:90%;' }, [
					_('Когда GitHub и Telegram недоступны: вставьте содержимое свежего '),
					E('code', {}, 'podkop_bot.sh'),
					_(' и установите. Скрипт проверяется (shebang, BOT_VERSION, синтаксис), текущая версия сохраняется в .bak, бот перезапускается.')
				]),
				ta,
				E('div', { 'style':'margin-top:.6em;' }, [ installBtn ]),
				result
			]),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(204,43,43,.4);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;color:#cc2b2b;' }, _('Удаление')),
				E('p', { 'style':'color:#888;font-size:90%;' }, _('Полностью удаляет бот (install.sh --action uninstall): останавливает службу, убирает /usr/bin/podkop_bot, автозапуск и runtime-файлы. Конфиг с токеном тоже удаляется. Введите REMOVE для подтверждения.')),
				E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;' }, [ uninstInput, uninstBtn ]),
				uninstStatus,
				uninstLog
			]),
			pbFooter()
		]);
	},

	/* Current installation summary, filled async from status. */
	/* Podkop/fork update card — async, does not block render. Shows variant, repo,
	 * current→latest, and a Releases link. The bot manages ITS OWN update via
	 * install.sh; updating Podkop itself is the fork's job, so we link to releases
	 * rather than auto-installing (out of scope — TZ boundary). */
	podkopUpdateCard: function() {
		var holder = E('div', { 'id':'podkop-fork-update' },
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')),
				dot('grey', _('проверяю…'))
			]));
		callPodkopUpdate('').then(function(d) {
			var inner;
			if (!d || !d.ok || d.available === false) {
				inner = [
					E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')),
					dot('grey', _('Не удалось проверить (GitHub недоступен напрямую и через прокси).')),
					(d && d.releases_url) ? E('div', { 'style':'margin-top:.5em;' }, [
						E('a', { 'href': d.releases_url, 'target':'_blank', 'rel':'noopener' }, _('Открыть релизы'))
					]) : E('span', {})
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
						E('span', { 'class':'pb-row-label' }, _('Последняя')),
						E('span', { 'class':'pb-row-val' }, [
							upd ? dot('yellow', d.latest + _(' — доступно')) : dot('green', (d.latest||'—') + _(' — актуально'))
						])
					]),
					E('div', { 'class':'pb-row pb-row--plain' }, [
						E('span', { 'class':'pb-row-label' }, _('Проверено через')), E('span', { 'class':'pb-row-val' }, d.via === 'socks' ? _('прокси (SOCKS)') : (d.via === 'direct' ? _('напрямую') : '—'))
					]),
					E('p', { 'style':'color:#888;font-size:88%;margin:.5em 0 0;' },
						_('Обновление самого Podkop выполняется его средствами (не ботом). Ссылка ведёт на страницу релизов.')),
					E('div', { 'style':'margin-top:.4em;' }, [
						E('a', { 'class':'cbi-button', 'href': d.releases_url || d.repo_url, 'target':'_blank', 'rel':'noopener' }, _('Страница релизов'))
					])
				];
			}
			dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, inner));
		}).catch(function(){});
		return holder;
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
		return dot('green', _('Установлена последняя версия: v') + (d.current||'?') + via);
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
