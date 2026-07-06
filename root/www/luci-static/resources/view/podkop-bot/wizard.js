'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

/*
 * luci-app-podkop-bot — Setup Wizard (v0.16.2 slice, TZ section 9)
 *
 * 7 steps: Environment → Mixed Proxy → Token → Admin → Transport → Apply → Result.
 * Stateful: this.state holds collected fields; each step renders into a single
 * container and navigation re-renders in place (no page reload).
 *
 * Backend methods used (all confirmed working on-device):
 *   status, test_github, ensure_mixed_proxy, test_telegram, installer, logs.
 *
 * Apply (step 6) writes /tmp/podkop_bot_install.json via installer? No — the
 * config file is written by the frontend through a dedicated rpc is not
 * available, so we pass fields to installer which the backend persists. For this
 * slice the backend `installer{install}` reads /tmp/podkop_bot_install.json; we
 * therefore need a way to write it. We add it through the install action by
 * having the backend accept an inline config (see note in step 6).
 */

var callStatus       = rpc.declare({ object:'podkop_bot', method:'status' });
var callTestGithub   = rpc.declare({ object:'podkop_bot', method:'test_github' });
var callTestTelegram = rpc.declare({ object:'podkop_bot', method:'test_telegram', params:['token'] });
var callEnsureMixed  = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy' });
var callInstaller    = rpc.declare({ object:'podkop_bot', method:'installer', params:['action','config_path','config_inline'] });
var callLogs         = rpc.declare({ object:'podkop_bot', method:'logs', params:['offset'] });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };

/* Telegram deep link. handle may be '@name', 'name', or a full t.me URL. */
function tgLink(handle, text) {
	var h = String(handle || '').replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
	return E('a', { 'href':'https://t.me/'+h, 'target':'_blank', 'rel':'noopener' }, text || ('@'+h));
}


function dot(colour, label) {
	return E('span', { 'style':'display:inline-flex;align-items:center;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:0 0 auto;background:'+(COLOURS[colour]||COLOURS.grey)+';' }),
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

function row(label, valueNode) {
	return E('div', { 'class':'pb-row' }, [
		E('span', { 'class':'pb-row-label' }, label),
		E('span', { 'class':'pb-row-val' }, (valueNode instanceof Node) ? valueNode : String(valueNode == null ? '—' : valueNode))
	]);
}

/* Validate a fallback_socks list (TZ 9.6): scheme socks5/socks5h, host non-empty,
 * port 1-65535, no host:port duplicates. Returns {ok, error, normalized}. */
function validateSocksList(text) {
	var seen = {}, out = [];
	var items = (text || '').split(/\s+/).filter(function(s){ return s.length; });
	for (var i = 0; i < items.length; i++) {
		var m = items[i].match(/^(socks5h?):\/\/([^:\/]+):(\d+)$/);
		if (!m) return { ok:false, error:_('Неверный формат: ')+items[i]+_(' (ожидается socks5:// или socks5h://host:port)') };
		var port = parseInt(m[3], 10);
		if (port < 1 || port > 65535) return { ok:false, error:_('Порт вне диапазона 1–65535: ')+items[i] };
		var key = m[2]+':'+m[3];
		if (seen[key]) return { ok:false, error:_('Дубликат host:port: ')+key };
		seen[key] = true; out.push(items[i]);
	}
	return { ok:true, normalized: out.join(' ') };
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
	state: null,

	load: function() {
		pbInjectCss();
		return callStatus().catch(function(){ return { available:false }; });
	},

	render: function(data) {
		this.status0 = data || {};
		this.state = {
			step: 1,
			env: null,            // step 1 result
			github: null,
			mixed_choice: null,   // 'auto'|'self'|'skip'
			token: '',
			token_result: null,
			chat_id: '',
			admin_ids: '',
			anon_admins: true,
			transport_policy: 'auto',
			fallback_socks: '',
			bind_interface: '',
			install_offset: 0,
			install_log: '',
			install_done: false,
			install_exit: null
		};
		this.container = E('div', { 'id':'wizard-body' });
		this.renderStep();
		return E('div', {}, [
			E('h2', {}, _('Мастер настройки Podkop Bot')),
			this.container,
			pbFooter()
		]);
	},

	/* shell with title, step indicator, body, nav buttons */
	shell: function(title, bodyNodes, navNodes) {
		var ind = E('div', { 'style':'color:#888;font-size:90%;margin-bottom:.6em;' },
			_('Шаг %d из 7').format(this.state.step));
		var card = E('div', { 'style':'max-width:640px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.2em;' },
			[ ind, E('h3', { 'style':'margin-top:0;' }, title) ].concat(bodyNodes));
		var nav = E('div', { 'style':'max-width:640px;display:flex;gap:.5em;margin-top:1em;' }, navNodes || []);
		return [ card, nav ];
	},

	renderStep: function() {
		var fn = this['step' + this.state.step];
		var self = this;
		dom.content(this.container, E('div', {}, [ E('em', { 'style':'color:#888;' }, _('Загрузка…')) ]));
		Promise.resolve(fn.call(this)).then(function(nodes) {
			dom.content(self.container, E('div', {}, nodes));
		});
	},

	go: function(n) { this.state.step = n; this.renderStep(); },

	btn: function(label, cls, handler) {
		return E('button', { 'class':'cbi-button '+cls, 'click': handler }, label);
	},

	/* ---- Step 1: Environment ---- */
	step1: function() {
		var self = this, st = this.status0;
		var installed = (st.available !== false) && (st.installed === true);
		/* GitHub check can hang on a blocked network — don't block rendering on it.
		 * Show the step immediately with a "checking…" placeholder, fill it async. */
		var ghCell = E('span', { 'id':'wiz-github-cell' }, dot('grey', _('проверяю…')));
		callTestGithub().catch(function(){ return { reachable:false, route:'none' }; }).then(function(gh) {
			self.state.github = gh;
			var el = document.getElementById('wiz-github-cell');
			if (el) dom.content(el, gh.reachable ? dot('green', gh.route) : dot('yellow', _('недоступен напрямую')));
		});
		var body = [
			row(_('OpenWrt'), st.openwrt_version || '—'),
			row(_('Менеджер пакетов'), st.pkg_manager || '—'),
			row(_('Podkop'), st.podkop_variant ? (st.podkop_variant + ' ' + (st.podkop_version||'')) : dot('grey', _('не найден'))),
			row(_('GitHub'), ghCell),
			row(_('Бот уже установлен'), installed ? dot('yellow', _('да — мастер можно пропустить')) : dot('grey', _('нет')))
		];
		return self.shell(_('Шаг 1 — Проверка окружения'), body, [
			self.btn(_('Далее'), 'cbi-button-action', function(){ self.go(2); })
		]);
	},


	/* ---- Step 2: Mixed Proxy ---- */
	step2: function() {
		var self = this, mp = (this.status0 && this.status0.mixed_proxy) || {};
		var body = [];
		if (mp.available && mp.enabled) {
			body.push(E('div', { 'style':'margin:.4em 0;' }, dot('green',
				_('Mixed Proxy включён · порт ') + (mp.port||'?') + ' · ' + (mp.section||''))));
			body.push(E('p', {}, _('Шаг выполнен — можно продолжать.')));
			return self.shell(_('Шаг 2 — Mixed Proxy'), body, [
				self.btn(_('Назад'),'cbi-button',function(){self.go(1);}),
				self.btn(_('Далее'),'cbi-button-action',function(){ self.state.mixed_choice='ok'; self.go(3); })
			]);
		}
		body.push(E('div', { 'style':'margin:.4em 0;' }, dot('yellow', _('Mixed Proxy выключен или недоступен'))));
		body.push(E('p', {}, _('Для отказоустойчивого транспорта podkop_bot нужен Mixed Proxy.')));
		var statusLine = E('div', { 'style':'margin:.5em 0;color:#888;' });
		body.push(statusLine);
		return self.shell(_('Шаг 2 — Mixed Proxy'), body, [
			self.btn(_('Назад'),'cbi-button',function(){self.go(1);}),
			self.btn(_('Включить автоматически'),'cbi-button-apply', ui.createHandlerFn(self, function(){
				dom.content(statusLine, _('Включаю…'));
				return callEnsureMixed().then(function(r){
					if (r && r.ok) { self.state.mixed_choice='auto'; self.go(3); }
					else dom.content(statusLine, dot('red', (r&&r.detail)||_('не удалось включить')));
				}).catch(function(){ dom.content(statusLine, dot('red', _('ошибка вызова'))); });
			})),
			self.btn(_('Я включу сам'),'cbi-button',function(){ self.state.mixed_choice='self'; self.go(3); }),
			self.btn(_('Пропустить'),'cbi-button',function(){ self.state.mixed_choice='skip'; self.go(3); })
		]);
	},

	/* ---- Step 3: Token ---- */
	step3: function() {
		var self = this;
		var input = E('input', { 'type':'text', 'class':'cbi-input-text', 'style':'width:100%;',
			'placeholder':'123456789:ABCdef...', 'value': self.state.token });
		input.addEventListener('input', function(){ self.state.token = input.value; });
		var result = E('div', { 'style':'margin-top:.6em;' });
		if (self.state.token_result) result.appendChild(self.renderTokenResult(self.state.token_result));
		var body = [
			E('label', {}, _('Токен Telegram-бота (от @BotFather)')),
			E('p', { 'style':'color:#888;font-size:90%;margin:.2em 0 .5em;' }, [
				_('Создайте бота у '), tgLink('BotFather', '@BotFather'),
				_(' командой /newbot и вставьте выданный токен.')
			]),
			input, result
		];
		return self.shell(_('Шаг 3 — Токен бота'), body, [
			self.btn(_('Назад'),'cbi-button',function(){self.go(2);}),
			self.btn(_('Проверить токен'),'cbi-button-action', ui.createHandlerFn(self, function(){
				if (!self.state.token) { dom.content(result, dot('yellow', _('Введите токен'))); return; }
				dom.content(result, _('Проверяю через installer (с SOCKS-fallover)…'));
				return callTestTelegram(self.state.token).then(function(r){
					self.state.token_result = r;
					dom.content(result, self.renderTokenResult(r));
				}).catch(function(){ dom.content(result, dot('red', _('ошибка вызова'))); });
			})),
			self.btn(_('Далее'),'cbi-button-action',function(){ self.go(4); })
		]);
	},

	renderTokenResult: function(r) {
		if (r && r.valid) {
			return E('span', { 'style':'display:inline-flex;align-items:center;gap:.4em;' }, [
				E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;background:'+COLOURS.green+';' }),
				E('span', {}, _('Токен валиден · ')),
				tgLink(r.username, '@'+(r.username||'?')),
				E('span', {}, ' · ' + (r.route||''))
			]);
		}
		var reasons = {
			empty_token: _('токен не указан'),
			token_invalid: _('Telegram отклонил токен'),
			telegram_unreachable: _('Telegram недоступен (direct + нет SOCKS)'),
			network_timeout: _('нет ответа (таймаут/транспорт)'),
			installer_missing: _('установщик не найден'),
			installer_error: _('установщик не вернул результат')
		};
		return dot('red', _('Не проверен: ') + (reasons[r && r.reason] || (r && r.detail) || _('неизвестно')));
	},

	/* ---- Step 4: Admin ---- */
	step4: function() {
		var self = this;
		var chat = E('input', { 'type':'text','class':'cbi-input-text','style':'width:100%;','value':self.state.chat_id,'placeholder':'123456789' });
		chat.addEventListener('input', function(){ self.state.chat_id = chat.value; });
		var admins = E('input', { 'type':'text','class':'cbi-input-text','style':'width:100%;','value':self.state.admin_ids,'placeholder':_('111111 222222 (через пробел)') });
		admins.addEventListener('input', function(){ self.state.admin_ids = admins.value; });
		var anon = E('input', { 'type':'checkbox' });
		anon.checked = self.state.anon_admins;
		anon.addEventListener('change', function(){ self.state.anon_admins = anon.checked; });
		var body = [
			E('label', {}, _('Основной Chat/User ID')), chat,
			E('p', { 'style':'color:#888;font-size:90%;margin:.2em 0 .5em;' }, [
				_('Узнать свой ID можно у '), tgLink('userinfobot', '@userinfobot'),
				_(' — отправьте ему любое сообщение.')
			]),
			E('label', { 'style':'display:block;margin-top:.6em;' }, _('Дополнительные Admin ID')), admins,
			E('label', { 'style':'display:flex;align-items:center;gap:.5em;margin-top:.6em;' }, [ anon, E('span', {}, _('Разрешить анонимных админов группы')) ])
		];
		return self.shell(_('Шаг 4 — Администратор'), body, [
			self.btn(_('Назад'),'cbi-button',function(){self.go(3);}),
			self.btn(_('Далее'),'cbi-button-action',function(){
				if (!self.state.chat_id) { ui.addNotification(null, E('p',{}, _('Укажите основной Chat/User ID')), 'warning'); return; }
				self.go(5);
			})
		]);
	},

	/* ---- Step 5: Transport ---- */
	step5: function() {
		var self = this;
		var policy = E('select', { 'class':'cbi-input-select' }, [
			E('option', { 'value':'auto' }, _('auto')),
			E('option', { 'value':'socks' }, _('только SOCKS')),
			E('option', { 'value':'direct' }, _('только direct'))
		]);
		policy.value = self.state.transport_policy;
		policy.addEventListener('change', function(){ self.state.transport_policy = policy.value; });
		var socks = E('textarea', { 'class':'cbi-input-textarea','style':'width:100%;','rows':'3',
			'placeholder':'socks5h://10.0.0.5:1080 socks5h://10.0.0.6:1080' }, self.state.fallback_socks);
		socks.addEventListener('input', function(){ self.state.fallback_socks = socks.value; });
		var err = E('div', { 'style':'margin-top:.4em;' });
		var body = [
			E('label', {}, _('Политика транспорта')), policy,
			E('label', { 'style':'display:block;margin-top:.6em;' }, _('Резервные SOCKS')), socks,
			E('p', { 'style':'color:#888;font-size:90%;' }, _('socks5h:// рекомендуется — DNS резолвится через прокси.')),
			err
		];
		return self.shell(_('Шаг 5 — Транспорт'), body, [
			self.btn(_('Назад'),'cbi-button',function(){self.go(4);}),
			self.btn(_('Далее'),'cbi-button-action',function(){
				var v = validateSocksList(self.state.fallback_socks);
				if (!v.ok) { dom.content(err, dot('red', v.error)); return; }
				self.state.fallback_socks = v.normalized;
				self.go(6);
			})
		]);
	},

	/* ---- Step 6: Apply ---- */
	step6: function() {
		var self = this;
		var logBox = E('pre', { 'style':'max-width:640px;max-height:300px;overflow:auto;background:rgba(127,127,127,.08);padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:85%;' }, self.state.install_log || _('(лог появится здесь)'));
		var statusLine = E('div', { 'style':'margin:.5em 0;' });
		var body = [
			E('p', {}, _('Будет создан конфиг и запущен установщик с live-логом.')),
			statusLine, logBox
		];
		var startBtn = self.btn(_('Установить'),'cbi-button-apply', ui.createHandlerFn(self, function(){
			return self.runInstall(statusLine, logBox);
		}));
		return self.shell(_('Шаг 6 — Установка'), body, [
			self.btn(_('Назад'),'cbi-button',function(){self.go(5);}),
			startBtn
		]);
	},

	buildConfig: function() {
		var s = this.state;
		return {
			lang: 'ru',
			bot_token: s.token,
			chat_id: s.chat_id,
			admin_ids: s.admin_ids,
			allow_anonymous_admins: s.anon_admins ? '1' : '0',
			fallback_socks: s.fallback_socks,
			setup_init: '1',
			start_now: '1'
		};
	},

	runInstall: function(statusLine, logBox) {
		var self = this;
		dom.content(statusLine, _('Запуск установщика…'));
		var cfg = JSON.stringify(self.buildConfig());
		/* Pass config inline; backend writes it to /tmp with chmod 600 then runs
		 * installer --action install --config that path. */
		return callInstaller('install', '', cfg).then(function(r){
			if (!r || !r.ok) { dom.content(statusLine, dot('red', (r&&r.detail)||_('не удалось запустить'))); return; }
			self.state.install_offset = 0;
			self.pollLog(statusLine, logBox);
		}).catch(function(){ dom.content(statusLine, dot('red', _('ошибка вызова installer'))); });
	},

	pollLog: function(statusLine, logBox) {
		var self = this;
		dom.content(statusLine, dot('yellow', _('Установка идёт…')));
		var tick = function() {
			callLogs(self.state.install_offset).then(function(r){
				if (r && r.chunk) { self.state.install_log += r.chunk; logBox.textContent = self.state.install_log; logBox.scrollTop = logBox.scrollHeight; }
				if (r && typeof r.offset === 'number') self.state.install_offset = r.offset;
				if (r && r.done) {
					self.state.install_done = true;
					self.state.install_exit = r.exit_code;
					if (r.exit_code === 0) { dom.content(statusLine, dot('green', _('Установка завершена'))); setTimeout(function(){ self.go(7); }, 800); }
					else dom.content(statusLine, dot('red', _('Установщик завершился с кодом ') + r.exit_code));
					return;
				}
				setTimeout(tick, 1500);
			}).catch(function(){ setTimeout(tick, 2000); });
		};
		tick();
	},

	/* ---- Step 7: Result ---- */
	step7: function() {
		var self = this;
		return callStatus().catch(function(){ return { available:false }; }).then(function(st) {
			var installed = (st.available !== false) && (st.installed === true);
			var mp = st.mixed_proxy || {};

			/* Collapsible install log — the run's log is kept in state from the
			 * step-6 polling. Hidden by default; a button toggles it. This is the
			 * minimum so the log isn't lost the moment the wizard finishes
			 * (persistent log in the Runtime tab is a later slice). */
			var logPre = E('pre', {
				'style':'display:none;max-width:640px;max-height:320px;overflow:auto;' +
				        'background:rgba(127,127,127,.08);padding:.6em;border-radius:6px;' +
				        'white-space:pre-wrap;font-size:85%;margin-top:.6em;'
			}, self.state.install_log || _('(лог установки пуст)'));

			var toggleBtn = self.btn(_('Показать лог установки'), 'cbi-button', function() {
				if (logPre.style.display === 'none') {
					logPre.style.display = 'block';
					toggleBtn.textContent = _('Скрыть лог установки');
				} else {
					logPre.style.display = 'none';
					toggleBtn.textContent = _('Показать лог установки');
				}
			});

			var copyBtn = self.btn(_('Скопировать лог'), 'cbi-button', function() {
				var txt = self.state.install_log || '';
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(txt).then(function(){
						ui.addNotification(null, E('p', {}, _('Лог скопирован')), 'info');
					});
				} else {
					/* fallback: select the pre's text */
					logPre.style.display = 'block';
					var r = document.createRange(); r.selectNodeContents(logPre);
					var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
				}
			});

			var uname = (self.state.token_result && self.state.token_result.username) || '';
			var startLine = uname
				? E('p', { 'style':'margin-top:1em;' }, [
					_('Дальше: откройте '), tgLink(uname, '@'+uname),
					_(' и отправьте /start')
				])
				: E('p', { 'style':'margin-top:1em;' }, _('Дальше: откройте вашего бота в Telegram и отправьте /start'));

			var body = [
				row(_('Установлен'), installed ? dot('green', _('да')) : dot('red', _('нет'))),
				row(_('Служба'), (st.service_running||st.running) ? dot('green', _('работает')) : dot('yellow', _('остановлена'))),
				row(_('Токен'), (self.state.token_result && self.state.token_result.valid) ? dot('green', _('валиден')) : dot('grey', _('не проверялся'))),
				row(_('Mixed Proxy'), mp.available ? (mp.enabled ? dot('green', _('включён')) : dot('yellow', _('выключен'))) : dot('grey', _('недоступен'))),
				(self.state.install_exit != null
					? row(_('Код установщика'), (self.state.install_exit === 0)
						? dot('green', '0')
						: dot('red', String(self.state.install_exit)))
					: E('div')),
				E('div', { 'style':'display:flex;gap:.5em;margin-top:1em;' }, [ toggleBtn, copyBtn ]),
				logPre,
				startLine
			];
			return self.shell(_('Шаг 7 — Результат'), body, [
				self.btn(_('Готово'),'cbi-button-action',function(){ window.location = L.url('admin/services/podkop-bot'); })
			]);
		});
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
