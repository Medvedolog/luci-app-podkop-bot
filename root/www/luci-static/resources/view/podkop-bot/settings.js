'use strict';
'require view';
'require form';
'require rpc';
'require ui';
'require uci';
'require dom';

/*
 * luci-app-podkop-bot — Settings (TZ section 10)
 *
 * CBI form editing /etc/config/podkop_bot, section `settings` (type `settings`,
 * created by the installer as a NAMED section). Only fields the bot (v0.15.6)
 * actually reads are exposed — quiet-hours / daily-report / language from TZ
 * 10.4 are omitted because the bot has no UCI keys for them; rendering settings
 * the bot ignores would be a lie.
 *
 * Extra actions (Restart, Reset runtime, Danger Zone) use the existing
 * podkop_bot rpcd `service` method and are appended after the CBI form rather
 * than by overriding CBI internals (keeps it robust across LuCI versions).
 */

var callService = rpc.declare({ object:'podkop_bot', method:'service', params:['action'] });

function actionButtons() {
	var dangerBody = E('div', {
		'style':'display:none;border:1px solid #cc2b2b;border-radius:6px;padding:.8em;margin-top:.6em;max-width:640px;'
	}, [
		E('p', { 'style':'color:#cc2b2b;margin-top:0;' }, _('Опасные действия — необратимы.')),
		E('button', {
			'class':'cbi-button cbi-button-reset',
			'click': ui.createHandlerFn(this, function() {
				return callService('stop_bot').then(function(){
					ui.addNotification(null, E('p', {}, _('Бот остановлен')), 'warning');
				}).catch(function(){
					ui.addNotification(null, E('p', {}, _('Не удалось остановить')), 'error');
				});
			})
		}, _('Остановить бота')),
		' ',
		E('button', {
			'class':'cbi-button cbi-button-negative',
			'click': ui.createHandlerFn(this, function() {
				ui.showModal(_('Очистка конфига'), [
					E('p', {}, _('Это удалит токен, chat_id и все настройки из /etc/config/podkop_bot. Необратимо.')),
					E('div', { 'class':'right' }, [
						E('button', { 'class':'cbi-button', 'click': ui.hideModal }, _('Отмена')),
						' ',
						E('button', { 'class':'cbi-button cbi-button-negative', 'click': ui.createHandlerFn(this, function(){
							ui.hideModal();
							var sec = uci.get('podkop_bot', 'settings');
							if (sec) Object.keys(sec).forEach(function(k){
								if (k.charAt(0) !== '.') uci.unset('podkop_bot', 'settings', k);
							});
							return uci.save().then(function(){ return uci.apply(); }).then(function(){
								/* Stop the bot too — otherwise it keeps running with
								 * the old token in memory until a manual restart. */
								return callService('stop_bot').catch(function(){});
							}).then(function(){
								ui.addNotification(null, E('p', {}, _('Конфиг очищен, бот остановлен')), 'warning');
								window.location.reload();
							});
						}) }, _('Очистить конфиг'))
					])
				]);
			})
		}, _('Очистить конфиг'))
	]);

	return E('div', { 'style':'margin-top:1.5em;' }, [
		E('h4', {}, _('Действия')),
		E('button', {
			'class':'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, function() {
				return callService('restart_bot').then(function(){
					ui.addNotification(null, E('p', {}, _('Бот перезапущен')), 'info');
				}).catch(function(){
					ui.addNotification(null, E('p', {}, _('Не удалось перезапустить')), 'error');
				});
			})
		}, _('Перезапустить бота')),
		' ',
		E('button', {
			'class':'cbi-button',
			'click': function(){ dangerBody.style.display = (dangerBody.style.display==='none')?'block':'none'; }
		}, _('Danger Zone')),
		dangerBody
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
		/* Returns true if the config loaded, false if absent. form.Map throws an
		 * ubus "Resource not found" if /etc/config/podkop_bot doesn't exist (bot
		 * not installed), so we must NOT build a Map in that case. */
		return uci.load('podkop_bot').then(function(){ return true; }).catch(function(){ return false; });
	},

	render: function(cfgLoaded) {
		if (cfgLoaded === false) {
			return E('div', {}, [
				E('h2', {}, _('Настройки Podkop Bot')),
				E('div', { 'class':'cbi-section', 'style':'max-width:760px;border:1px solid rgba(232,163,61,.4);border-radius:8px;padding:1em 1.2em;' }, [
					E('p', {}, _('Бот ещё не установлен — /etc/config/podkop_bot отсутствует.')),
					E('p', { 'style':'color:#888;' }, [
						_('Пройдите '),
						E('a', { 'href': L.url('admin/services/podkop-bot/wizard') }, _('Мастер настройки')),
						_(' или установите бота на вкладке «Обновление».')
					])
				]),
				pbFooter()
			]);
		}
		return this.renderForm();
	},

	renderForm: function() {
		var m, s, o;

		m = new form.Map('podkop_bot', _('Настройки Podkop Bot'),
			_('Редактирование /etc/config/podkop_bot. Живое состояние — на вкладке «Обзор».'));

		s = m.section(form.NamedSection, 'settings', 'settings');
		s.addremove = false;

		/* Helper: a non-editable sub-header row that visually opens a group.
		 * CBI has no native "fieldset" inside a NamedSection, so we render a
		 * DummyValue whose title is the group name — gives the screenshot-style
		 * blocks (Основные / Мониторинг / Транспорт) without inventing UCI keys. */
		var _grpN = 0;
		function group(title) {
			/* incrementing id — title.replace(/\\W/g,'') collapses to '' for Cyrillic
			 * (\\W treats non-ASCII as non-word), colliding all groups on _grp_ */
			var d = s.option(form.DummyValue, '_grp_' + (++_grpN));
			d.rawhtml = true;
			d.cfgvalue = function() {
				return '<h3 style="margin:.8em 0 .2em;border-bottom:1px solid rgba(127,127,127,.25);padding-bottom:.2em;">' + title + '</h3>';
			};
			return d;
		}

		/* ===== Группа 1: Основные ===== */
		group(_('Основные настройки'));

		o = s.option(form.Value, 'bot_token', _('Токен бота'),
			_('Токен от @BotFather (команда /newbot).'));
		o.password = true;

		o = s.option(form.Value, 'chat_id', _('Основной Chat/User ID'),
			_('Главный админ — куда идут алерты. Узнать ID: напишите @userinfobot. Оставьте пустым, сохраните и отправьте боту /start.'));

		o = s.option(form.DynamicList, 'admin_ids', _('Дополнительные Admin ID'),
			_('Числовые User ID. Каждый узнаёт свой ID командой /myid в боте.'));
		o.datatype = 'integer';

		o = s.option(form.DynamicList, 'admin_sender_chat_ids', _('Admin sender chat IDs'),
			_('Chat ID групп с анонимными админами — чтобы бот доверял сообщениям «от имени группы».'));
		o.datatype = 'integer';

		o = s.option(form.Flag, 'allow_anonymous_admins', _('Разрешить анонимных админов группы'),
			_('Если включено — админы, пишущие анонимно от имени группы, считаются доверенными.'));

		/* ===== Группа 2: Мониторинг и уведомления ===== */
		group(_('Мониторинг и уведомления'));

		o = s.option(form.Flag, 'startup_notify', _('Уведомление о старте'),
			_('Слать сообщение в Telegram при запуске бота.'));
		o.default = '1';

		o = s.option(form.Flag, 'alert_notify', _('Watchdog-алерты'),
			_('Уведомлять, если sing-box/SOCKS/маршрут упали и когда восстановились.'));
		o.default = '1';

		o = s.option(form.Value, 'health_interval', _('Интервал проверки, сек'),
			_('Период watchdog-проверки. Диапазон 30–3600. Меньше — быстрее реакция, больше нагрузка.'));
		o.datatype = 'range(30,3600)';
		o.default = '60';

		o = s.option(form.Flag, 'broadcast_alerts', _('Рассылать алерты всем admin_ids'),
			_('Watchdog-алерты уходят всем из admin_ids, а не только основному chat_id.'));
		o.default = '0';

		o = s.option(form.Flag, 'ram_alert', _('Алерт при низкой RAM'),
			_('Предупреждать, когда свободной памяти меньше ~30 MB.'));
		o.default = '1';

		o = s.option(form.Flag, 'daily_report', _('Ежедневный отчёт'),
			_('Отправлять сводку состояния в Telegram раз в сутки.'));
		o.default = '0';

		o = s.option(form.Value, 'daily_report_time', _('Время отчёта (ЧЧ:ММ)'),
			_('Когда слать ежедневный отчёт. Формат ЧЧ:ММ, например 08:00.'));
		o.default = '08:00';
		o.datatype = "and(string,maxlength(5))";
		o.placeholder = '08:00';
		o.depends('daily_report', '1');
		o.validate = function(section_id, value) {
			if (!value) return true;
			return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? true : _('Формат ЧЧ:ММ, 00:00–23:59');
		};

		/* Тихие часы (quiet hours) — ключи добавлены в бот v0.15.6. Подавляют
		 * watchdog/RAM алерты в заданном окне (overnight-диапазон поддержан,
		 * напр. 23:00–07:00). Daily Report НЕ подавляется — время выбрал юзер. */
		var qhValidate = function(section_id, value) {
			if (!value) return true;
			return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? true : _('Формат ЧЧ:ММ, 00:00–23:59');
		};

		o = s.option(form.Flag, 'quiet_hours_enabled', _('Тихие часы'),
			_('В заданном окне подавлять авто-алерты (watchdog, RAM). Ручные команды и ежедневный отчёт не блокируются.'));
		o.default = '0';

		o = s.option(form.Value, 'quiet_hours_from', _('Начало тихих часов (ЧЧ:ММ)'));
		o.default = '23:00';
		o.placeholder = '23:00';
		o.datatype = 'and(string,maxlength(5))';
		o.depends('quiet_hours_enabled', '1');
		o.validate = qhValidate;

		o = s.option(form.Value, 'quiet_hours_to', _('Конец тихих часов (ЧЧ:ММ)'),
			_('Диапазон через полночь допустим: 23:00–07:00 трактуется как ночь.'));
		o.default = '07:00';
		o.placeholder = '07:00';
		o.datatype = 'and(string,maxlength(5))';
		o.depends('quiet_hours_enabled', '1');
		o.validate = qhValidate;

		/* Еженедельный отчёт (weekly report) — ключи добавлены в бот v0.15.7.
		 * Сводка стабильности/трафика/подписки за неделю. День: %u (ISO,
		 * 1=Пн … 7=Вс), дефолт 7 (вс). */
		o = s.option(form.Flag, 'weekly_report', _('Еженедельный отчёт'),
			_('Сводка за неделю (стабильность, трафик, версии) раз в неделю.'));
		o.default = '0';

		o = s.option(form.ListValue, 'weekly_report_day', _('День недели'));
		o.value('1', _('Понедельник'));
		o.value('2', _('Вторник'));
		o.value('3', _('Среда'));
		o.value('4', _('Четверг'));
		o.value('5', _('Пятница'));
		o.value('6', _('Суббота'));
		o.value('7', _('Воскресенье'));
		o.default = '7';
		o.depends('weekly_report', '1');

		o = s.option(form.Value, 'weekly_report_time', _('Время отчёта (ЧЧ:ММ)'));
		o.default = '09:00';
		o.placeholder = '09:00';
		o.datatype = 'and(string,maxlength(5))';
		o.depends('weekly_report', '1');
		o.validate = qhValidate;

		/* ===== Группа 3: Транспорт (кратко; полная цепочка — на вкладке «Транспорт») ===== */
		group(_('Транспорт'));

		o = s.option(form.ListValue, 'transport', _('Политика транспорта'),
			_('Как бот ходит в Telegram: auto (direct→SOCKS), только SOCKS, только direct.'));
		o.value('auto', _('auto'));
		o.value('socks', _('только SOCKS'));
		o.value('direct', _('только direct'));
		o.default = 'auto';

		o = s.option(form.Value, 'custom_proxy', _('Custom proxy (tier3)'),
			_('Доп. прокси, напр. socks5://host:port. Необязательно.'));
		o.optional = true;

		o = s.option(form.Value, 'bind_interface', _('Bind interface'),
			_('Привязка исходящего интерфейса бота: auto или имя интерфейса.'));
		o.optional = true;

		return m.render().then(L.bind(function(formEl) {
			return E('div', {}, [ formEl, actionButtons.call(this), pbFooter() ]);
		}, this));
	}
});
