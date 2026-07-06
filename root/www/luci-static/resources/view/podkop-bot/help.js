'use strict';
'require view';
'require ui';
'require rpc';
'require dom';

function h(txt) { return E('h3', { 'style':'margin:1.2em 0 .3em;border-bottom:1px solid rgba(127,127,127,.2);padding-bottom:.2em;' }, txt); }
function p(txt) { return E('p', { 'style':'margin:.4em 0;line-height:1.5;' }, txt); }
function li(items) {
	return E('ul', { 'style':'margin:.4em 0;padding-left:1.3em;line-height:1.6;' },
		items.map(function(i){ return E('li', {}, i); }));
}
function card(children) {
	return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid rgba(127,127,127,.2);border-radius:8px;padding:1em 1.4em;margin-top:1em;' }, children);
}
function dot(c, label) {
	var colours = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
	return E('span', { 'style':'display:inline-flex;align-items:center;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;background:'+(colours[c]||colours.grey)+';' }),
		E('span', {}, label)
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
	load: function() { return Promise.resolve(); },

	render: function() {
		return E('div', {}, [
			E('h2', {}, _('Помощь')),

			card([
				h(_('Назначение')),
				p(_('Этот интерфейс предназначен для управления Telegram-ботом podkop_bot: его установки, восстановления, диагностики, обновления и просмотра состояния. Повседневное управление туннелями удобнее вести в самом Telegram-боте, а этот интерфейс нужен для настройки и восстановления, в том числе когда бот недоступен.')),
				h(_('Границы')),
				p(_('Здесь не настраивается сам Podkop: серверы, подписки, proxy-секции и выбор сборки sing-box (tiny, standard, extended) находятся в приложениях luci-app-podkop, luci-app-podkop-plus и NetShift. Этот интерфейс обращается к Podkop только в объёме, необходимом боту: для работы транспорта через Mixed Proxy и для отображения версии и варианта.'))
			]),

			card([
				h(_('Разделы интерфейса')),
				li([
					E('span', {}, [ E('b', {}, _('Обзор')), ' \u2014 ' + _('состояние службы и автозапуска, версии бота, Podkop и sing-box, вариант Podkop, Mixed Proxy, доступность GitHub, использование памяти.') ]),
					E('span', {}, [ E('b', {}, _('Настройки')), ' \u2014 ' + _('параметры бота: уведомления, тихие часы, отчёты, оповещение о нехватке памяти и другие.') ]),
					E('span', {}, [ E('b', {}, _('Транспорт')), ' \u2014 ' + _('способы связи бота с серверами Telegram при блокировках: цепочка резервных маршрутов, их проверка и настройка.') ]),
					E('span', {}, [ E('b', {}, _('Мастер настройки')), ' \u2014 ' + _('пошаговая первичная установка бота.') ]),
					E('span', {}, [ E('b', {}, 'Runtime'), ' \u2014 ' + _('диагностика активного туннеля: страна и провайдер выхода, доступность сервисов, скорость, признаки блокировок ТСПУ. «Тип IP» — ориентировочная эвристика (по имени провайдера и реакции Google), а не точный fraud-score.') ]),
					E('span', {}, [ E('b', {}, _('Обновление')), ' \u2014 ' + _('проверка и обновление версии, автономная установка и удаление бота.') ]),
					E('span', {}, [ E('b', {}, _('Логи')), ' \u2014 ' + _('журнал работы бота (токен в журнале не отображается).') ])
				])
			]),

			card([
				h(_('Как бот связывается с Telegram')),
				p(_('При блокировках прямое соединение с серверами Telegram может быть недоступно. Бот последовательно перебирает маршруты сверху вниз, пока не найдёт рабочий:')),
				li([
					E('span', {}, [ E('b', {}, 'tier1'), ' \u2014 ' + _('Podkop SOCKS5 (Mixed Proxy активной секции). Основной маршрут.') ]),
					E('span', {}, [ E('b', {}, 'tier2'), ' \u2014 ' + _('резервные SOCKS-прокси, заданные вручную. Их может быть несколько; порядок определяет очередь перебора.') ]),
					E('span', {}, [ E('b', {}, 'tier3'), ' \u2014 ' + _('собственный прокси (custom proxy).') ]),
					E('span', {}, [ E('b', {}, 'tier4'), ' \u2014 ' + _('прямое соединение через WAN (если Telegram не заблокирован у провайдера).') ]),
					E('span', {}, [ E('b', {}, 'tier5'), ' \u2014 ' + _('аварийные IP-адреса Telegram (крайний случай).') ])
				]),
				p(_('Строка «Активный маршрут» показывает, какой из маршрутов используется в данный момент. Кнопка «Тест» проверяет отдельный маршрут, «Тест всей цепочки» — все по порядку.'))
			]),

			card([
				h(_('Обозначения цветов')),
				E('div', { 'style':'line-height:2;' }, [
					dot('green', _('работает, активно или проверка пройдена')), E('br', {}),
					dot('grey', _('неактивно или не настроено — это нормальное состояние')), E('br', {}),
					dot('yellow', _('внимание: настроено, но не отвечает, либо режим требует проверки')), E('br', {}),
					dot('red', _('неисправность'))
				])
			]),

			card([
				h(_('Если бот не отвечает')),
				li([
					_('На вкладке «Обзор» проверьте, что служба работает. Если нет — запустите её.'),
					_('На вкладке «Транспорт» проверьте активный маршрут. Если он не найден, проверьте tier1 (включён ли Mixed Proxy) и резервные прокси кнопкой «Тест».'),
					_('На вкладке «Логи» просмотрите последние записи на наличие ошибок.'),
					_('На вкладке «Обновление» при устаревшей версии обновите бота. Если GitHub заблокирован, проверка и обновление выполняются через SOCKS.')
				])
			]),

			card([
				h(_('Создание бота и получение своего ID')),
				p(_('Для работы podkop_bot нужны две вещи: токен бота и ваш Telegram ID, чтобы бот выполнял команды только от вас.')),
				E('div', { 'style':'margin:.4em 0;' }, [
					E('b', {}, _('Токен через @BotFather:')),
					li([
						_('Откройте в Telegram чат с @BotFather и отправьте команду /newbot.'),
						_('Укажите имя бота и его username (должен заканчиваться на «bot»).'),
						_('В ответ придёт токен вида 1234567890:AA… — это и есть bot_token.')
					])
				]),
				E('div', { 'style':'margin:.4em 0;' }, [
					E('b', {}, _('Свой Telegram ID:')),
					li([
						_('Откройте чат с @userinfobot и отправьте любое сообщение.'),
						_('Бот пришлёт число — это ваш ID. Укажите его как chat_id при установке.'),
						_('Для группы или канала ID начинается со знака «минус» (например, -100…).')
					])
				]),
				p(_('Токен и ID вводятся в Мастере настройки при первой установке.'))
			]),

			card([
				h(_('Установщик install.sh')),
				p(_('Бот устанавливается сценарием install.sh (файл /usr/lib/podkop_bot/install.sh). Он запускается автоматически из Мастера настройки и вкладки «Обновление», но его можно вызвать и вручную из консоли:')),
				li([
					E('span', {}, [ E('code', {}, '--action install'), ' \u2014 ' + _('установка (с параметром --config для токена и ID)') ]),
					E('span', {}, [ E('code', {}, '--action update'), ' \u2014 ' + _('обновление бота с GitHub') ]),
					E('span', {}, [ E('code', {}, '--action uninstall'), ' \u2014 ' + _('полное удаление') ]),
					E('span', {}, [ E('code', {}, '--action status'), ' \u2014 ' + _('состояние: вариант Podkop, версии, наличие конфигурации') ]),
					E('span', {}, [ E('code', {}, '--action check-token'), ' \u2014 ' + _('проверка токена без установки') ])
				]),
				p(_('Возможности установщика: автоматическое определение варианта Podkop (podkop, plus или NetShift); работа через SOCKS, если GitHub заблокирован напрямую; автономный режим, при котором ставится копия бота, вложенная в пакет; интерфейс на русском и английском языках.'))
			]),

			card([
				h(_('Podkop и его форки')),
				p(_('Приложение работает с оригинальным Podkop и двумя его форками, определяя установленный автоматически. Они различаются репозиторием, структурой конфигурации и способом задания режима секций:')),
				li([
					E('span', {}, [ _('Оригинальный '), E('b', {}, 'Podkop'), _(' — '), E('a', { 'href':'https://github.com/itdoginfo/podkop', 'target':'_blank', 'rel':'noopener' }, 'github.com/itdoginfo/podkop'), _('. Режим секции задаётся полями connection_type и proxy_config_type.') ]),
					E('span', {}, [ _('Форк '), E('b', {}, 'Podkop Plus'), _(' — '), E('a', { 'href':'https://github.com/ushan0v/podkop-plus', 'target':'_blank', 'rel':'noopener' }, 'github.com/ushan0v/podkop-plus'), _('. Использует поле action; подписка — это источник, а режим (selector/urltest) задаётся отдельными флагами.') ]),
					E('span', {}, [ _('Форк '), E('b', {}, 'NetShift'), _(' — '), E('a', { 'href':'https://github.com/yandexru45/netshift', 'target':'_blank', 'rel':'noopener' }, 'github.com/yandexru45/netshift'), _('. Своя структура путей и пространство имён UCI.') ])
				]),
				p(_('На вкладке Обновление показывается версия установленного Podkop или форка и наличие свежего релиза (проверка идёт напрямую или через прокси, если GitHub заблокирован). Обновление самого Podkop/форка выполняется его средствами — приложение только показывает наличие и ведёт на страницу релизов.'))
			]),

			card([
				h(_('Где настраивается остальное')),
				li([
					E('span', {}, [ _('Серверы, подписки, proxy-секции и сборка sing-box — в приложениях '), E('b', {}, _('luci-app-podkop, luci-app-podkop-plus, NetShift.')) ]),
					E('span', {}, [ _('Повседневное управление, отчёты и сбор диагностики — в '), E('b', {}, _('Telegram-боте.')) ]),
					E('span', {}, [ _('Исходный код LuCI-приложения — '), E('a', { 'href':'https://github.com/Medvedolog/luci-app-podkop-bot', 'target':'_blank', 'rel':'noopener' }, 'github.com/Medvedolog/luci-app-podkop-bot'), _('. Исходный код самого Telegram-бота — '), E('a', { 'href':'https://github.com/Medvedolog/podkop_bot', 'target':'_blank', 'rel':'noopener' }, 'github.com/Medvedolog/podkop_bot'), '.' ])
				])
			]),
			pbFooter()
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
