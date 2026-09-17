'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callCheckUpdate = rpc.declare({ object:'podkop_bot', method:'check_update', params:['force'] });
var callLuciUpdate  = rpc.declare({ object:'podkop_bot', method:'luci_update_check', params:['force'] });
var callLuciRun     = rpc.declare({ object:'podkop_bot', method:'luci_update_run' });
var callLuciLog     = rpc.declare({ object:'podkop_bot', method:'luci_update_log', params:['offset'] });
var callPodkopRun   = rpc.declare({ object:'podkop_bot', method:'podkop_update_run' });
var callPodkopLog   = rpc.declare({ object:'podkop_bot', method:'podkop_update_log', params:['offset'] });
var callUpdateUpload = rpc.declare({ object:'podkop_bot', method:'update_upload' });
var callWarpscoutStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callWarpscoutRun = rpc.declare({ object:'podkop_bot_warpscout', method:'run' });
var callWarpscoutRemove = rpc.declare({ object:'podkop_bot_warpscout', method:'remove' });
var callWarpscoutLog = rpc.declare({ object:'podkop_bot_warpscout', method:'log', params:['offset'] });
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

		var ghLog = E('pre', {'style':'display:none;max-width:760px;max-height:300px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;margin-top:.6em;'}, '');
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
					dom.content(ghStatus, dot('red', _('Ошибка вызова установщика')));
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
				.then(function() {
					dom.content(fileStatus, dot('grey', _('Проверка и установка…')));
					return callUpdateUpload().then(function(r) {
						if (!r || !r.ok) { dom.content(fileStatus, dot('red', self.errText(r))); return; }
						dom.content(fileStatus, dot(r.service_running ? 'green' : 'yellow', _('Установлен бот v') + (r.installed_version || '?') + (r.service_running ? _(' · служба запущена') : _(' · служба не запущена'))));
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
				if ((uninstInput.value||'').trim() !== 'REMOVE') { dom.content(uninstStatus, dot('yellow', _('Введите REMOVE для подтверждения'))); return; }
				uninstBtn.disabled = true;
				uninstLog.style.display = 'block'; uninstLog.textContent = '';
				self._ghOffset = 0; self._ghLog = '';
				dom.content(uninstStatus, dot('grey', _('Удаление…')));
				return callInstaller('uninstall', '', '').then(function(r) {
					if (!r || !r.ok) { dom.content(uninstStatus, dot('red', (r && r.detail) || _('не удалось запустить'))); uninstBtn.disabled = false; return; }
					return self.pollGhLog(uninstStatus, uninstLog, verLine, uninstBtn);
				}).catch(function(){ dom.content(uninstStatus, dot('red', _('Ошибка вызова установщика'))); uninstBtn.disabled = false; });
			})
		}, _('Удалить бота'));

		return E('div', {}, [
			E('h2', { 'style':'margin-bottom:.2em;' }, _('Обновление модулей')),
			E('p', { 'class':'pb-hint-90', 'style':'max-width:760px;margin-top:0;' }, _('Три независимых модуля: веб-интерфейс LuCI, Telegram-бот и Podkop. Каждый обновляется своим способом. WARPSCOUT устанавливается и удаляется отдельным блоком ниже.')),
			this.luciCard(),
			E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('Telegram-бот (podkop_bot)')),
				this.currentBlock(),
				E('div', { 'class':'pb-action-row', 'style':'margin:.8em 0 .3em;border-top:1px solid rgba(127,127,127,.15);padding-top:.8em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [ verLine, recheckBtn ]),
				E('div', { 'style':'margin-top:1em;' }, [ E('strong', {}, _('Обновление с GitHub')), E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0;' }, _('Запускает install.sh --action update: скачивает свежую версию бота с GitHub, при необходимости используя резерв через SOCKS, и устанавливает её. Журнал установки показан ниже.')), ghBtn, ghStatus, ghLog ]),
				E('div', { 'style':'margin-top:1em;border-top:1px solid rgba(127,127,127,.15);padding-top:.8em;' }, [ E('strong', {}, _('Установка из локального файла')), E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0;' }, _('Загружает полный podkop_bot.sh во временный файл на роутере, проверяет его и устанавливает с резервной копией текущего бота. Лимит: 2 МиБ.')), fileBtn, fileStatus ])
			]),
			this.podkopUpdateCard(),
			this.warpscoutUpdateCard(),
			(function(){
				var dangerBody = E('div', { 'style':'display:none;margin-top:.6em;' }, [
					E('p', { 'class':'pb-hint-90' }, _('Полностью удаляет бот через install.sh --action uninstall: останавливает службу, удаляет /usr/bin/podkop_bot, автозапуск и временные файлы. Конфигурация с токеном тоже удаляется. Введите REMOVE для подтверждения.')),
					E('div', { 'style':'display:flex;align-items:center;flex-wrap:wrap;gap:.5em;' }, [ uninstInput, uninstBtn ]), uninstStatus, uninstLog
				]);
				var dangerToggle = E('button', { 'class':'cbi-button', 'style':'color:#cc2b2b;', 'click': function() { var open = dangerBody.style.display !== 'none'; dangerBody.style.display = open ? 'none' : 'block'; this.textContent = open ? _('Удаление бота ▸') : _('Удаление бота ▾'); } }, _('Удаление бота ▸'));
				return E('div', { 'class':'cbi-section', 'style':'max-width:760px;margin-top:1em;' }, [ dangerToggle, dangerBody ]);
			})(),
			pbFooter()
		]);
	},

	luciCard: function() {
		var self = this;
		var line = E('div', { 'style':'margin:.3em 0;' }, dot('grey', _('проверяю…')));
		var actions = E('div', { 'style':'margin-top:.5em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' });
		var luciStatus = E('div', { 'style':'margin-top:.5em;' });
		var luciLog = E('pre', { 'style':'display:none;margin-top:.5em;max-height:260px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;font-size:85%;white-space:pre-wrap;' }, '');
		this._luciNodes = { status: luciStatus, log: luciLog, line: line, actions: actions };
		var recheck = E('button', { 'class':'cbi-button', 'click': function() { dom.content(line, dot('grey', _('Проверка…'))); callLuciUpdate('true').then(function(d){ self.fillLuci(line, actions, d); }); } }, _('Проверить версию'));
		this._luciRecheckBtn = recheck;
		var _force = _luciCheckedThisSession ? '' : 'true'; _luciCheckedThisSession = true;
		callLuciUpdate(_force).then(function(d){ self.fillLuci(line, actions, d); }).catch(function(){ dom.content(line, dot('grey', _('Не удалось проверить'))); });
		return E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, _('Веб-интерфейс (luci-app-podkop-bot)')), line, actions, luciStatus, luciLog ]);
	},

	pollPodkopLog: function(nodes, btn) {
		var self = this, n = nodes; if (!n) return;
		this._pkOffset = 0; this._pkLog = ''; n.log.style.display = 'block'; dom.content(n.status, dot('yellow', _('Обновление Podkop идёт…')));
		var tick = function() { callPodkopLog(self._pkOffset).then(function(r) {
			if (r && r.chunk) { self._pkLog += r.chunk; n.log.textContent = self._pkLog; n.log.scrollTop = n.log.scrollHeight; }
			if (r && typeof r.offset === 'number') self._pkOffset = r.offset;
			if (r && r.done) { dom.content(n.status, /podkop-update-exit 0/.test(self._pkLog) ? dot('green', _('Podkop обновлён. Проверьте версию.')) : dot('red', _('Обновление завершилось с ошибкой — см. журнал.'))); if (btn) btn.disabled = false; return; }
			setTimeout(tick, 1500);
		}).catch(function(){ setTimeout(tick, 2000); }); };
		tick();
	},

	pollLuciLog: function() {
		var self = this, n = this._luciNodes; if (!n) return;
		this._luciOffset = 0; this._luciLog = ''; n.log.style.display = 'block'; dom.content(n.status, dot('yellow', _('Установка идёт…')));
		var tick = function() { callLuciLog(self._luciOffset).then(function(r) {
			if (r && r.chunk) { self._luciLog += r.chunk; n.log.textContent = self._luciLog; n.log.scrollTop = n.log.scrollHeight; }
			if (r && typeof r.offset === 'number') self._luciOffset = r.offset;
			if (r && r.done) { if (/\[done\] exit 0/.test(self._luciLog)) dom.content(n.status, dot('green', _('Установка завершена. Обновите страницу (Ctrl/Cmd+Shift+R).'))); else if (/\[!!\]/.test(self._luciLog)) dom.content(n.status, dot('red', _('Установка завершилась с ошибкой — см. журнал.'))); else dom.content(n.status, dot('green', _('Готово. Обновите страницу.'))); return; }
			setTimeout(tick, 1500);
		}).catch(function(){ setTimeout(tick, 2000); }); };
		tick();
	},

	fillLuci: function(line, actions, d) {
		dom.content(actions, this._luciRecheckBtn ? [ this._luciRecheckBtn ] : '');
		if (!d || d.ok === false) { dom.content(line, dot('grey', _('Не удалось проверить версию'))); return; }
		if (d.latest === 'unknown') { dom.content(line, dot('yellow', _('Текущая: v') + (d.current||'?') + ' · ' + _('последнюю версию проверить не удалось ни напрямую, ни через SOCKS.'))); return; }
		var via = (d.via === 'socks') ? (' (' + _('через SOCKS') + ')') : (d.via === 'direct' ? (' (' + _('напрямую') + ')') : '');
		if (d.update_available) {
			var self = this; dom.content(line, dot('yellow', _('Доступно обновление: v') + d.current + ' → v' + d.latest + via));
			dom.content(actions, [ E('button', { 'class':'cbi-button cbi-button-apply', 'click': function() { this.disabled = true; callLuciRun().then(function(){ self.pollLuciLog(); }).catch(function(){ self.pollLuciLog(); }); } }, _('Обновить веб-интерфейс')), E('a', { 'class':'cbi-button', 'href': d.releases_url || 'https://github.com/Medvedolog/luci-app-podkop-bot/releases', 'target':'_blank', 'rel':'noopener' }, _('Скачать вручную')), this._luciRecheckBtn ]);
		} else { dom.content(line, dot('green', _('Установлено v') + (d.current||'?') + ' · ' + _('в репозитории v') + (d.latest||'?') + ' — ' + _('актуально') + via)); dom.content(actions, [ this._luciRecheckBtn ]); }
	},

	podkopUpdateCard: function() {
		var holder = E('div', { 'id':'podkop-fork-update' }, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')), dot('grey', _('проверяю…')) ]));
		this.fillPodkop(holder, ''); return holder;
	},

	fillPodkop: function(holder, force) {
		var self = this;
		callPodkopUpdate(force).then(function(d) {
			var recheck = E('button', { 'class':'cbi-button', 'style':'display:inline-flex;align-items:center;', 'click': function() { dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')), dot('grey', _('Проверка…')) ])); self.fillPodkop(holder, 'true'); } }, _('Проверить версию'));
			var inner;
			if (!d || !d.ok || d.available === false) {
				inner = [ E('h3', { 'style':'margin-top:0;' }, _('Обновление Podkop')), dot('grey', _('Не удалось проверить: GitHub недоступен напрямую и через прокси.')), (d && d.releases_url) ? E('div', { 'style':'margin-top:.5em;' }, [ E('a', { 'href': d.releases_url, 'target':'_blank', 'rel':'noopener' }, _('Открыть релизы')) ]) : E('span', {}), recheck ];
			} else {
				var upd = d.update_available;
				inner = [ E('h3', { 'style':'margin-top:0;' }, _('Обновление ') + (d.name || 'Podkop')), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('Вариант')), E('span', { 'class':'pb-row-val' }, d.variant || '—') ]), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('Установлено')), E('span', { 'class':'pb-row-val' }, d.current || '—') ]), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('В репозитории')), E('span', { 'class':'pb-row-val' }, [ upd ? dot('yellow', (d.latest||'—') + _(' — доступно')) : dot('green', (d.latest||'—') + _(' — актуально')) ]) ]), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('Проверено через')), E('span', { 'class':'pb-row-val' }, d.via === 'socks' ? _('прокси SOCKS') : (d.via === 'direct' ? _('напрямую') : '—')) ]), E('p', { 'style':'color:#888;font-size:88%;margin:.5em 0 0;' }, _('Обновление Podkop выполняется его штатным установщиком с GitHub от имени root. Перед запуском проверяются сеть и свободное место.')), (function(){
					var pkStatus = E('span', {}), pkLog = E('pre', { 'class':'pb-mono', 'style':'display:none;max-width:760px;max-height:260px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:80%;margin-top:.5em;' }), pkNodes = { status: pkStatus, log: pkLog }, _pkName = d.name || 'Podkop', pkClass = upd ? 'cbi-button cbi-button-action' : 'cbi-button';
					var pkBtn = E('button', { 'class':pkClass, 'style':'display:inline-flex;align-items:center;', 'click': ui.createHandlerFn(self, function(){ if (!confirm(_('Запустить обновление Podkop? Будет скачан и выполнен install.sh установленного варианта от root. Туннель может кратко прерваться.'))) return; pkBtn.disabled = true; return callPodkopRun().then(function(r){ if (r && r.ok) self.pollPodkopLog(pkNodes, pkBtn); else { var m = { already_running:_('обновление уже идёт'), download_failed:_('не удалось скачать install.sh'), bad_script:_('скачанный файл не является скриптом'), repos_unreachable:_('репозитории недоступны'), low_disk:_('мало места на диске') }; dom.content(pkStatus, dot('red', (m[r&&r.reason]||_('ошибка запуска')) + (r&&r.detail?(' · '+r.detail):''))); pkBtn.disabled = false; } }).catch(function(){ dom.content(pkStatus, dot('red', _('ошибка вызова'))); pkBtn.disabled = false; }); }) }, upd ? (_('Обновить ') + _pkName) : (_('Обновить ') + _pkName + _(' (актуально)'))); if (!upd) pkBtn.disabled = true;
					return E('div', { 'style':'margin-top:.5em;' }, [ E('div', { 'class':'pb-action-row', 'style':'display:flex;gap:.5em;flex-wrap:wrap;align-items:stretch;' }, [ E('a', { 'class':'cbi-button', 'style':'display:inline-flex;align-items:center;', 'href': d.releases_url || d.repo_url, 'target':'_blank', 'rel':'noopener' }, _('Страница релизов')), recheck, pkBtn ]), pkStatus, pkLog ]);
				})() ];
			}
			dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, inner));
		}).catch(function(){});
	},

	warpscoutUpdateCard: function() {
		var holder = E('div', { 'id':'warpscout-update' }, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, _('WARPSCOUT')), dot('grey', _('проверяю…')) ]));
		this.fillWarpscout(holder, ''); return holder;
	},

	fillWarpscout: function(holder, force) {
		var self = this;
		callWarpscoutStatus(force).then(function(d) {
			var opStatus = E('div', { 'style':'margin-top:.5em;' });
			var opLog = E('pre', { 'class':'pb-mono', 'style':'display:none;max-width:760px;max-height:280px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:80%;margin-top:.5em;' });
			var recheck = E('button', { 'class':'cbi-button', 'click': function() { dom.content(opStatus, dot('grey', _('Проверка…'))); self.fillWarpscout(holder, 'true'); } }, _('Проверить версию'));
			var installed = !!(d && d.installed), current = installed ? (d.current || '—') : _('не установлен'), latest = (d && d.latest) ? d.latest : '', updateAvailable = !!(d && d.update_available);
			var runBtn = E('button', { 'class':(!installed || updateAvailable) ? 'cbi-button cbi-button-action' : 'cbi-button', 'click': ui.createHandlerFn(self, function() {
				if (!confirm(installed ? _('Запустить официальный установщик WARPSCOUT? Он обновит или переустановит компонент.') : _('Установить WARPSCOUT официальным install.sh проекта?'))) return;
				runBtn.disabled = true; opLog.style.display = 'block'; opLog.textContent = ''; dom.content(opStatus, dot('yellow', _('Установка WARPSCOUT запущена…')));
				return callWarpscoutRun().then(function(r) { if (!r || !r.ok) { dom.content(opStatus, dot('red', (r && r.reason === 'already_running') ? _('установка уже выполняется') : _('не удалось запустить установку'))); runBtn.disabled = false; return; } self.pollWarpscoutLog(holder, opStatus, opLog, runBtn); }).catch(function() { dom.content(opStatus, dot('red', _('Ошибка вызова службы WARPSCOUT'))); runBtn.disabled = false; });
			}) }, installed ? (updateAvailable ? _('Обновить WARPSCOUT') : _('Переустановить WARPSCOUT')) : _('Установить WARPSCOUT'));
			var removeBtn = E('button', { 'class':'cbi-button cbi-button-negative', 'disabled':installed?null:'disabled', 'click':ui.createHandlerFn(self,function(){
				if(!confirm(_('Удалить WARPSCOUT полностью? Будут остановлены WARP Rescue и тестовый SOCKS, удалены программа, учётная запись WARP, найденные узлы и локальные настройки WARPSCOUT. Podkop и Telegram-бот не затрагиваются.'))) return;
				removeBtn.disabled=true; dom.content(opStatus,dot('yellow',_('Удаление WARPSCOUT…')));
				return callWarpscoutRemove().then(function(r){ if(!r||!r.ok){dom.content(opStatus,dot('red',_('Не удалось удалить WARPSCOUT: ')+((r&&r.reason)||'?')));removeBtn.disabled=false;return;} dom.content(opStatus,dot('green',_('WARPSCOUT удалён'))); self.fillWarpscout(holder,'true'); }).catch(function(){dom.content(opStatus,dot('red',_('Ошибка вызова службы WARPSCOUT')));removeBtn.disabled=false;});
			})},_('Удалить WARPSCOUT'));
			var latestNode = latest ? (updateAvailable ? dot('yellow', latest + _(' — доступно')) : dot('green', latest + (installed ? _(' — актуально') : ''))) : dot('yellow', _('последнюю версию проверить не удалось'));
			var inner = [ E('h3', { 'style':'margin-top:0;' }, _('WARPSCOUT')), E('p', { 'style':'color:#888;font-size:90%;margin:.3em 0 .7em;' }, _('Дополнительный инструмент для WARP. Удаление здесь останавливает WARP Rescue и очищает его локальную учётную запись, настройки и список найденных узлов, не затрагивая Podkop и Telegram-бот.')), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('Установлено')), E('span', { 'class':'pb-row-val' }, installed ? dot('green', current) : dot('grey', current)) ]), E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, _('В репозитории')), E('span', { 'class':'pb-row-val' }, latestNode) ]), E('div', { 'class':'pb-action-row', 'style':'margin-top:.7em;display:flex;gap:.5em;flex-wrap:wrap;align-items:center;' }, [ E('a', { 'class':'cbi-button', 'href': (d && d.releases_url) || 'https://github.com/vernette/warpscout/releases', 'target':'_blank', 'rel':'noopener' }, _('Страница WARPSCOUT')), recheck, runBtn, removeBtn ]), opStatus, opLog ];
			dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, inner));
		}).catch(function() { dom.content(holder, E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, _('WARPSCOUT')), dot('red', _('Служба WARPSCOUT недоступна')) ])); });
	},

	pollWarpscoutLog: function(holder, statusNode, logNode, btn) {
		var self = this, offset = 0, logText = '', failures = 0;
		var tick = function() { callWarpscoutLog(offset).then(function(r) {
			failures = 0; if (r && r.chunk) { logText += r.chunk; logNode.textContent = logText; logNode.scrollTop = logNode.scrollHeight; } if (r && typeof r.offset === 'number') offset = r.offset;
			if (r && r.done) { dom.content(statusNode, r.exit_code === 0 ? dot('green', _('WARPSCOUT установлен.')) : dot('red', _('Установка WARPSCOUT завершилась с ошибкой — см. журнал.'))); if (btn) btn.disabled = false; setTimeout(function(){ self.fillWarpscout(holder, 'true'); }, 500); return; }
			setTimeout(tick, 1200);
		}).catch(function() { failures++; if (failures >= 10) { dom.content(statusNode, dot('red', _('Не удалось получить временный журнал WARPSCOUT'))); if (btn) btn.disabled = false; return; } setTimeout(tick, 1800); }); };
		tick();
	},

	currentBlock: function() {
		var box = E('div', {}, dot('grey', _('загрузка…')));
		callStatus().then(function(s) { if (!s || s.available === false) { dom.content(box, dot('yellow', _('бот не установлен'))); return; } var rows = []; function r(l, v){ rows.push(E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, l), E('span', { 'class':'pb-row-val' }, v||'—') ])); } r(_('Версия бота'), s.bot_version); r(_('Вариант'), s.podkop_variant); r(_('Служба'), (s.service_running || s.running) ? _('работает') : _('остановлена')); r(_('Автозапуск'), s.autostart ? _('включён') : _('выключен')); dom.content(box, rows); }).catch(function(){ dom.content(box, dot('grey', '—')); });
		return box;
	},

	pollGhLog: function(statusNode, logNode, verLine, btn) {
		var self = this, offset = 0, logText = '', failures = 0; dom.content(statusNode, dot('yellow', _('Операция выполняется…')));
		return new Promise(function(resolve) { var tick = function() { callLogs(offset).then(function(r) { failures = 0; if (r && r.chunk) { logText += r.chunk; logNode.textContent = logText; logNode.scrollTop = logNode.scrollHeight; } if (r && typeof r.offset === 'number') offset = r.offset; if (r && r.done) { if (r.exit_code === 0) { dom.content(statusNode, dot('green', _('Операция завершена'))); callCheckUpdate('true').then(function(d){ dom.content(verLine, self.verNode(d)); }); } else dom.content(statusNode, dot('red', _('Установщик завершился с кодом ') + r.exit_code)); if (btn) btn.disabled = false; resolve(r); return; } setTimeout(tick, 1500); }).catch(function() { failures++; if (failures >= 10) { dom.content(statusNode, dot('red', _('Не удалось получить журнал установки'))); if (btn) btn.disabled = false; resolve({ ok:false, reason:'log_unavailable' }); return; } setTimeout(tick, 2000); }); }; tick(); });
	},

	verNode: function(d) {
		if (!d || d.ok === false) return dot('grey', _('Не удалось проверить версию'));
		if (d.latest === 'unknown') return E('span', {}, [ dot('yellow', _('Текущая: v') + (d.current||'?') + ' · ' + _('последнюю версию проверить не удалось ни напрямую, ни через SOCKS.')) ]);
		var via = (d.via === 'socks') ? (' (' + _('проверено через SOCKS') + ')') : (d.via === 'direct' ? (' (' + _('проверено напрямую') + ')') : '');
		if (d.update_available) return dot('yellow', _('Доступно обновление: v') + d.current + ' → v' + d.latest + via);
		return dot('green', _('Установлено v') + (d.current||'?') + ' · ' + _('в репозитории v') + (d.latest||'?') + ' — ' + _('актуально') + via);
	},

	errText: function(r) {
		var m = { empty: _('Пустой скрипт'), not_bot_script: _('Не похоже на скрипт бота: нет shebang/BOT_VERSION'), syntax_error: _('Синтаксические ошибки — установка отменена, текущий бот не тронут'), install_failed: _('Не удалось записать файл бота'), backup_failed: _('Не удалось создать резервную копию текущего бота'), upload_missing: _('Загруженный файл не найден'), file_too_large: _('Файл больше 2 МиБ'), read_failed: _('Не удалось прочитать загруженный файл'), already_running: _('Другая установка уже выполняется') };
		return _('Отклонено: ') + (m[r && r.reason] || (r && r.detail) || _('неизвестно'));
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
