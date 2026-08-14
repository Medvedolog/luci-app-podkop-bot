'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Update (autonomous bot update)
 *
 * Three independent update paths are exposed here: the LuCI package, the
 * Telegram bot, and Podkop/the detected fork. Bot updates can use GitHub or a
 * local .sh file. The local path uses ui.uploadFile() (cgi-upload) and a fixed
 * temporary path, avoiding the ubus JSON body limit for the ~730 KiB script.
 */

var callCheckUpdate = rpc.declare({ object:'podkop_bot', method:'check_update', params:['force'] });
var callLuciUpdate  = rpc.declare({ object:'podkop_bot', method:'luci_update_check', params:['force'] });
var callLuciRun     = rpc.declare({ object:'podkop_bot', method:'luci_update_run' });
var callLuciLog     = rpc.declare({ object:'podkop_bot', method:'luci_update_log', params:['offset'] });
var callPodkopRun   = rpc.declare({ object:'podkop_bot', method:'podkop_update_run' });
var callPodkopLog   = rpc.declare({ object:'podkop_bot', method:'podkop_update_log', params:['offset'] });
var callUpdateUpload = rpc.declare({ object:'podkop_bot', method:'update_upload' });

/* Force one fresh LuCI version check per page session (module scope survives
 * tab re-renders but resets on full reload). Without this the daily cache could
 * hide a just-published release until the user hits the button. */
var _luciCheckedThisSession = false;
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
		/* Use the cached result on tab open (backend TTL is 1 day). Only the
		 * explicit "Проверить версию" buttons force a fresh network check —
		 * opening the tab shouldn't hit GitHub every time. */
		return callCheckUpdate('').catch(function(){ return { ok:false }; });
	},

	render: function(data) {
		var self = this;

		var verLine = E('div', { 'style':'margin:.5em 0;' }, this.verNode(data));


		var recheckBtn = E('button', {
			'class':'cbi-button',
			'click': function() {
				dom.content(verLine, dot('grey', _('Проверка…')));
				callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
			}
		}, _('Проверить версию'));

		var ghLog = E('pre', {
			'style':'display:none;max-width:760px;max-height:300px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.6em;'
		}, '');
		var ghStatus = E('div', { 'style':'margin-top:.5em;' });
		this._ghOffset = 0; this._ghLog = '';

		var ghBtn = E('button', {
			'class':'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function() {
				ghBtn.disabled = true;
				ghLog.style.display = 'block';
				ghLog.textContent = '';
				self._ghOffset = 0; self._ghLog = '';
				dom.content(ghStatus, dot('grey', _('Запуск обновления с GitHub…')));
				return callInstaller('update', '', '').then(function(r) {
					if (!r || !r.ok) {
						dom.content(ghStatus, dot('red', (r && r.detail) || _('не удалось запустить')));
						ghBtn.disabled = false;
						return;
					}
					return self.pollGhLog(ghStatus, ghLog, verLine, ghBtn);
				}).catch(function(){
					dom.content(ghStatus, dot('red', _('Ошибка вызова installer')));
					ghBtn.disabled = false;
				});
			})
		}, _('Обновить с GitHub'));

		var fileStatus = E('div', { 'style':'margin-top:.5em;' });
		var fileBtn = E('button', {
			'class':'cbi-button',
			'click': ui.createHandlerFn(this, function() {
				dom.content(fileStatus, dot('grey', _('Выбор и загрузка файла…')));
				return ui.uploadFile('/tmp/podkop_bot_upload.sh', null,
					_('Будут проверены shebang, BOT_VERSION и синтаксис ash; текущий бот сохранится в .bak.'))
				.then(function(meta) {
					dom.content(fileStatus, dot('grey', _('Проверка и установка…')));
					return callUpdateUpload().then(function(r) {
						if (!r || !r.ok) {
							dom.content(fileStatus, dot('red', self.errText(r)));
							return;
						}
						dom.content(fileStatus, dot(r.service_running ? 'green' : 'yellow',
						_('Установлен bot v') + (r.installed_version || '?') +
						(r.service_running ? _(' · служба запущена') : _(' · служба не запущена'))));
						return callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
					});
				}).catch(function(err) {
					var msg = (err && err.message) ? err.message : _('Загрузка отменена или завершилась ошибкой');
					dom.content(fileStatus, dot('yellow', msg));
				});
			})
		}, _('Установить из файла .sh'));

		var uninstLog = E('pre', { 'style':'display:none;max-width:760px;max-height:240px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.6em;' }, '');
		var uninstStatus = E('div', { 'style':'margin-top:.5em;' });
		var uninstInput = E('input', { 'type':'text', 'class':'cbi-input-text pb-mono', 'placeholder':'REMOVE' });
		var uninstBtn = E('button', {
			'class':'cbi-button cbi-button-negative',
			'click': ui.createHandlerFn(this, function() {
				if ((uninstInput.value||'').trim() !== 'REMOVE') {
					dom.content(uninstStatus, dot('yellow', _('Введите REMOVE для подтверждения')));
					return;
				}
				uninstBtn.disabled = true;
				uninstLog.style.display = 'block'; uninstLog.textContent = '';
				self._ghOffset = 0; self._ghLog = '';
				dom.content(uninstStatus, dot('grey', _('Удаление…')));
				return callInstaller('uninstall', '', '').then(function(r) {
					if (!r || !r.ok) { dom.content(uninstStatus, dot('red', (r && r.detail) || _('не удалось запустить'))); uninstBtn.disabled = false; return; }
					return self.pollGhLog(uninstStatus, uninstLog, verLine, uninstBtn);
				}).catch(function(){ dom.content(uninstStatus, dot('red', _('Ошибка вызова installer'))); uninstBtn.disabled = false; });
			})
		}, _('Удалить бота'));


		return E('div', {}, [
			E('h2', { 'style':'margin-bottom:.2em;' }, _('Обновление модулей')),
			E('p', { 'class':'pb-hint-90', 'style':'max-width:760px;margin-top:0;' },
				_('Три независимых модуля: сам веб-интерфейс (LuCI), Telegram-бот и Podkop. Каждый обновляется своим способом.')),

			/* ─── Card 1: this LuCI app ─────────────────────────────────── */
			this.luciCard(),

			/* ─── Card 2: the bot — version + all update methods together ── */
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Telegram-бот (podkop_bot)')),
				this.currentBlock(),
				E('div', { 'class':'pb-action-row', 'style':'margin:.8em 0 .3em;border-top:1px solid rgba(127,127,127,.15);padding-top:.8em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [ verLine, recheckBtn ]),

				/* update method: GitHub */
				E('div', { 'style':'margin-top:1em;' }, [
					E('strong', {}, _('Обновление с GitHub')),
					E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0;' }, _('Запускает install.sh --action update: скачивает свежий бот с GitHub (с SOCKS-fallback) и устанавливает. Лог установки — ниже.')),
					ghBtn, ghStatus, ghLog
				]),

				/* offline/local file: cgi-upload, not JSON-RPC body */
				E('div', { 'style':'margin-top:1em;border-top:1px solid rgba(127,127,127,.15);padding-top:.8em;' }, [
					E('strong', {}, _('Установка из локального файла')),
					E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0;' },
						_('Загружает полный podkop_bot.sh напрямую во временный файл на роутере, проверяет его и устанавливает с резервной копией текущего бота. Лимит: 2 МиБ.')),
					fileBtn, fileStatus
				]),
			]),

			/* ─── Card 3: Podkop / fork ─────────────────────────────────── */
			this.podkopUpdateCard(),

			/* ─── Danger zone: uninstall the bot (collapsed by default) ─── */
			(function(){
				var dangerBody = E('div', { 'style':'display:none;margin-top:.6em;' }, [
					E('p', { 'class':'pb-hint-90' }, _('Полностью удаляет бот (install.sh --action uninstall): останавливает службу, убирает /usr/bin/podkop_bot, автозапуск и runtime-файлы. Конфиг с токеном тоже удаляется. Введите REMOVE для подтверждения.')),
					E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;gap:.5em;' }, [ uninstInput, uninstBtn ]),
					uninstStatus,
					uninstLog
				]);
				var dangerToggle = E('button', {
					'class':'cbi-button',
					'style':'color:#cc2b2b;',
					'click': function() {
						var open = dangerBody.style.display !== 'none';
						dangerBody.style.display = open ? 'none' : 'block';
						this.textContent = open ? _('Удаление бота ▸') : _('Удаление бота ▾');
					}
				}, _('Удаление бота ▸'));
				return E('div', { 'class':'cbi-section', 'style':'max-width:760px;margin-top:1em;' }, [
					dangerToggle,
					dangerBody
				]);
			})(),
			pbFooter()
		]);
	},

	/* This LuCI app's own version card. It can self-update through the bundled
	 * installer, while retaining a manual Releases link as fallback. */
	luciCard: function() {
		var self = this;
		var line = E('div', { 'style':'margin:.3em 0;' }, dot('grey', _('проверяю…')));
		/* single row: update/download buttons AND recheck live together so they
		 * align on one baseline (was: recheck on its own line below actions). */
		var actions = E('div', { 'style':'margin-top:.5em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' });
		var luciStatus = E('div', { 'style':'margin-top:.5em;' });
		var luciLog = E('pre', {
			'style':'display:none;margin-top:.5em;max-height:260px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;font-size:85%;white-space:pre-wrap;'
		}, '');
		this._luciNodes = { status: luciStatus, log: luciLog, line: line, actions: actions };
		var recheck = E('button', {
			'class':'cbi-button',
			'click': function() {
				dom.content(line, dot('grey', _('Проверка…')));
				callLuciUpdate('true').then(function(d){ self.fillLuci(line, actions, d); });
			}
		}, _('Проверить версию'));
		this._luciRecheckBtn = recheck;
		/* First open in this page session → force a fresh network check, past
		 * the daily cache. Subsequent re-renders use the cache. */
		var _force = _luciCheckedThisSession ? '' : 'true';
		_luciCheckedThisSession = true;
		callLuciUpdate(_force).then(function(d){ self.fillLuci(line, actions, d); })
			.catch(function(){ dom.content(line, dot('grey', _('Не удалось проверить'))); });
		return E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [
			E('h3', { 'style':'margin-top:0;' }, _('Веб-интерфейс (luci-app-podkop-bot)')),
			line, actions, luciStatus, luciLog
		]);
	},

	/* Poll the LuCI self-update log until the installer writes a done/error
	 * marker. Mirrors pollGhLog but for luci_update_log. */
	/* Poll the podkop-core update log (mirrors pollLuciLog). Runs the fork's own
	 * install.sh via the backend and streams its output; "done" on the exit
	 * marker. */
	pollPodkopLog: function(nodes, btn) {
		var self = this;
		var n = nodes; if (!n) return;
		this._pkOffset = 0; this._pkLog = '';
		n.log.style.display = 'block';
		dom.content(n.status, dot('yellow', _('Обновление Podkop идёт…')));
		var tick = function() {
			callPodkopLog(self._pkOffset).then(function(r) {
				if (r && r.chunk) { self._pkLog += r.chunk; n.log.textContent = self._pkLog; n.log.scrollTop = n.log.scrollHeight; }
				if (r && typeof r.offset === 'number') self._pkOffset = r.offset;
				if (r && r.done) {
					if (/podkop-update-exit 0/.test(self._pkLog)) {
						dom.content(n.status, dot('green', _('Podkop обновлён. Проверьте версию.')));
					} else {
						dom.content(n.status, dot('red', _('Обновление завершилось с ошибкой — см. лог.')));
					}
					if (btn) btn.disabled = false;   // release only after completion
					return;
				}
				setTimeout(tick, 1500);
			}).catch(function(){ setTimeout(tick, 2000); });
		};
		tick();
	},

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
		dom.content(actions, this._luciRecheckBtn ? [ this._luciRecheckBtn ] : '');
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
				}, _('Скачать вручную')),
				this._luciRecheckBtn
			]);
		} else {
			dom.content(line, dot('green', _('Установлено v') + (d.current||'?') + ' · ' +
				_('в репозитории v') + (d.latest||'?') + ' — ' + _('актуально') + via));
			dom.content(actions, [ this._luciRecheckBtn ]);
		}
	},

	/* Podkop/fork update card — async, does not block render. Shows variant,
	 * current→latest, a Releases link, and invokes the detected fork installer. */
	podkopUpdateCard: function() {
		var self = this;
		var holder = E('div', { 'id':'podkop-fork-update' },
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [
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
				'class':'cbi-button', 'style':'display:inline-flex;align-items:center;',
				'click': function() {
					dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [
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
						_('Обновление самого Podkop выполняется его установщиком с GitHub (запускается от root, как кнопка в боте). Пре-проверки сети и диска — как у бота.')),
					(function(){
						var pkStatus = E('span', {});
						var pkLog = E('pre', { 'class':'pb-mono', 'style':'display:none;max-width:760px;max-height:260px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:80%;margin-top:.5em;' });
						var pkNodes = { status: pkStatus, log: pkLog };
						/* Only a call to action (blue) when there's actually a newer
						 * version; if already up to date, a plain disabled button so
						 * it doesn't invite a pointless root-script run. */
						var _pkName = d.name || 'Podkop';
						var pkClass = upd ? 'cbi-button cbi-button-action' : 'cbi-button';
						var pkBtn = E('button', { 'class':pkClass, 'style':'display:inline-flex;align-items:center;', 'click': ui.createHandlerFn(self, function(){
							if (!confirm(_('Запустить обновление Podkop? Будет скачан и выполнен install.sh форка от root. Туннель может кратко прерваться.'))) return;
							pkBtn.disabled = true;   // real button, not `this` (which is self here)
							return callPodkopRun().then(function(r){
								if (r && r.ok) {
									// keep disabled until polling reports done
									self.pollPodkopLog(pkNodes, pkBtn);
								} else {
									var m = { already_running:_('обновление уже идёт'), download_failed:_('не удалось скачать install.sh'), bad_script:_('скачанный файл не скрипт'), repos_unreachable:_('репозитории недоступны'), low_disk:_('мало места на диске') };
									dom.content(pkStatus, dot('red', (m[r&&r.reason]||_('ошибка запуска')) + (r&&r.detail?(' · '+r.detail):'')));
									pkBtn.disabled = false;
								}
							}).catch(function(){ dom.content(pkStatus, dot('red', _('ошибка вызова'))); pkBtn.disabled = false; });
						}) }, upd ? (_('Обновить ') + _pkName) : (_('Обновить ') + _pkName + _(' (актуально)')));
						if (!upd) pkBtn.disabled = true;
						return E('div', { 'style':'margin-top:.5em;' }, [
							E('div', { 'class':'pb-action-row', 'style':'display:flex;gap:.5em;flex-wrap:wrap;align-items:stretch;' }, [
								E('a', { 'class':'cbi-button', 'style':'display:inline-flex;align-items:center;', 'href': d.releases_url || d.repo_url, 'target':'_blank', 'rel':'noopener' }, _('Страница релизов')),
								recheck,
								pkBtn
							]),
							pkStatus,
							pkLog
						]);
					})()
				];
			}
			dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, inner));
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
			r(_('Служба'), (s.service_running || s.running) ? _('работает') : _('остановлена'));
			r(_('Автозапуск'), s.autostart ? _('включён') : _('выключен'));
			dom.content(box, rows);
		}).catch(function(){ dom.content(box, dot('grey', '—')); });
		return box;
	},

	/* Poll the install log while the GitHub update runs (same mechanism as the
	 * Wizard). Stops when the backend reports done, then refreshes the version. */
	pollGhLog: function(statusNode, logNode, verLine, btn) {
		var self = this, offset = 0, logText = '', failures = 0;
		dom.content(statusNode, dot('yellow', _('Операция выполняется…')));
		return new Promise(function(resolve) {
			var tick = function() {
				callLogs(offset).then(function(r) {
					failures = 0;
					if (r && r.chunk) { logText += r.chunk; logNode.textContent = logText; logNode.scrollTop = logNode.scrollHeight; }
					if (r && typeof r.offset === 'number') offset = r.offset;
					if (r && r.done) {
						if (r.exit_code === 0) {
							dom.content(statusNode, dot('green', _('Операция завершена')));
							callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); });
						} else {
							dom.content(statusNode, dot('red', _('Установщик завершился с кодом ') + r.exit_code));
						}
						if (btn) btn.disabled = false;
						resolve(r);
						return;
					}
					setTimeout(tick, 1500);
				}).catch(function() {
					failures++;
					if (failures >= 10) {
						dom.content(statusNode, dot('red', _('Не удалось получить журнал установки')));
						if (btn) btn.disabled = false;
						resolve({ ok:false, reason:'log_unavailable' });
						return;
					}
					setTimeout(tick, 2000);
				});
			};
			tick();
		});
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
			install_failed: _('Не удалось записать файл бота'),
			backup_failed: _('Не удалось создать резервную копию текущего бота'),
			upload_missing: _('Загруженный файл не найден'),
			file_too_large: _('Файл больше 2 МиБ'),
			read_failed: _('Не удалось прочитать загруженный файл'),
			already_running: _('Другая установка уже выполняется')
		};
		return _('Отклонено: ') + (m[r && r.reason] || (r && r.detail) || _('неизвестно'));
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
