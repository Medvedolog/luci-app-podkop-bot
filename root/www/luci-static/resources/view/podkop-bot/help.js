'use strict';
'require view';
'require ui';
'require rpc';
'require dom';

/*
 * luci-app-podkop-bot — Help.
 *
 * Typography rules kept deliberately simple so the page reads as one voice:
 *   h()    section heading
 *   p()    normal paragraph
 *   note() muted aside (the ONLY place a dimmed colour is used)
 *   item() the ONLY pattern for definition bullets: <b>term</b> — text
 * Anything that needs a different weight or colour should get a helper here
 * rather than an ad-hoc inline style, otherwise the page drifts into a mix of
 * greys and bolds again.
 */

var MUTED = 'color:var(--pb-muted,#888);';

function h(txt) {
	return E('h3', { 'style':'margin:1.2em 0 .4em;border-bottom:1px solid var(--border-color-medium,rgba(127,127,127,.2));padding-bottom:.2em;' }, txt);
}
function p(txt) {
	return E('p', { 'style':'margin:.5em 0;line-height:1.55;' }, txt);
}
function note(txt) {
	return E('p', { 'style':'margin:.5em 0;line-height:1.55;font-size:92%;'+MUTED }, txt);
}
function li(items) {
	return E('ul', { 'style':'margin:.5em 0;padding-left:1.3em;line-height:1.6;' },
		items.map(function(i){ return E('li', {}, i); }));
}
function item(term, text) {
	return E('span', {}, [ E('b', {}, term), ' \u2014 ' + text ]);
}
function cmd(code, text) {
	return E('span', {}, [ E('code', {}, code), ' \u2014 ' + text ]);
}
function link(term, href, text) {
	return E('span', {}, [
		E('b', {}, term), ' \u2014 ',
		E('a', { 'href':href, 'target':'_blank', 'rel':'noopener' }, href.replace(/^https?:\/\//, '')),
		'. ' + text
	]);
}
function card(children) {
	return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.4em;margin-top:1em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));' }, children);
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
	var box = E('div', { 'style': 'max-width:820px;margin-top:1.2em;padding-top:.6em;border-top:1px solid rgba(127,127,127,.15);font-size:85%;text-align:right;'+MUTED }, [ span ]);
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
				h(_('Зачем эта страница')),
				p(_('Отсюда бот устанавливается, обновляется и чинится. Здесь же видно, работает ли он и что у него со связью.')),
				p(_('Повседневно туннелями удобнее управлять в самом Telegram-боте. Этот интерфейс нужен для установки и для тех случаев, когда бот молчит и через Telegram до него не достучаться.')),
				h(_('Что здесь не настраивается')),
				p(_('Серверы, подписки и правила маршрутизации задаются в приложении самого Podkop или его форка. Эта страница только читает их, чтобы бот мог выходить в сеть и показывать диагностику.')),
				note(_('Исключение — кнопка «Обновить Podkop» на вкладке «Обновление»: она просто запускает штатный установщик Podkop, ничего не настраивая.'))
			]),

			card([
				h(_('Вкладки')),
				li([
					item(_('Обзор'), _('работает ли бот, включён ли автозапуск, какие версии установлены, есть ли доступ к GitHub, сколько занято памяти.')),
					item(_('Настройки'), _('параметры бота: уведомления, тихие часы, отчёты, предупреждение о нехватке памяти. Здесь же находятся настройки WARP Rescue / WARPSCOUT.')),
					item(_('Транспорт → Цепочка прокси'), _('как бот подключается к Telegram, если прямой доступ заблокирован: порядок резервных маршрутов и их проверка.')),
					item(_('Транспорт → Револьвер WARP'), _('магазин WARP-узлов со статусом VALID, переключение ON-AIR узла, перезарядка и управление WARP Rescue.')),
					item(_('Мастер настройки'), _('пошаговая первая установка бота.')),
					item(_('Проверка маршрутов'), _('диагностика выхода: страна и провайдер, доступность сервисов, скорость и проверка Telegram API по всем маршрутам.')),
					item(_('Обновление'), _('три части обновляются независимо: веб-интерфейс, Telegram-бот и Podkop. Здесь же удаление бота и управление WARPSCOUT.')),
					item(_('Логи'), _('журнал работы бота. Токен в журнале не показывается.'))
				]),
				note(_('Слово «маршрут» на вкладке «Проверка маршрутов» означает способ выхода в интернет, который сейчас проверяется: секция Podkop, транспортный или ручной прокси, либо WARP Rescue. Это не маршрут из системной таблицы маршрутизации.'))
			]),

			card([
				h(_('Как бот подключается к Telegram')),
				p(_('Если Telegram заблокирован у провайдера, бот пробует способы связи по очереди сверху вниз и останавливается на первом рабочем:')),
				li([
					item(_('Через Podkop (tier1)'), _('трафик бота идёт через ваш туннель. Основной способ, которого обычно достаточно.')),
					item(_('Резервные прокси (tier2)'), _('SOCKS-прокси, добавленные вручную. Пробуются в указанном порядке.')),
					item(_('Свой прокси (tier3)'), _('дополнительный прокси на случай, если предыдущие маршруты не сработали.')),
					item(_('Напрямую через WAN (tier4)'), _('обычное соединение через провайдера. Сработает, если Telegram у него не блокируется.')),
					item(_('Аварийные адреса Telegram (tier5)'), _('прямые IP-адреса Telegram. Крайний резерв.')),
					item(_('WARP Rescue'), _('автоматически добавляется в цепочку, когда WARPSCOUT настроен и Rescue включён.'))
				]),
				p(_('Активный маршрут подсвечивается. Кнопка «Тест» проверяет один маршрут, «Проверить всю цепочку» — все доступные маршруты по очереди.'))
			]),

			card([
				h(_('Что означают цвета')),
				E('div', { 'style':'line-height:2;' }, [
					dot('green', _('всё в порядке: работает или проверка пройдена')), E('br', {}),
					dot('grey', _('выключено или не настроено — чаще всего это нормально')), E('br', {}),
					dot('yellow', _('стоит посмотреть: настроено, но не отвечает или выполняется операция')), E('br', {}),
					dot('red', _('ошибка'))
				])
			]),

			card([
				h(_('Если бот не отвечает')),
				p(_('Пройдите по шагам сверху вниз — обычно причина находится на первом или втором:')),
				li([
					_('«Обзор» — проверьте, что служба запущена. Если нет, запустите её кнопкой.'),
					_('«Транспорт → Цепочка прокси» — посмотрите активный маршрут. Если его нет, проверьте Podkop, резервные прокси и WARP Rescue.'),
					_('«Проверка маршрутов» — запустите лёгкую проверку Telegram API или полную диагностику нужного маршрута.'),
					_('«Логи» — посмотрите последние записи, там обычно видна причина.'),
					_('«Обновление» — если версия устарела, обновите бота. При заблокированном GitHub проверка и загрузка идут через прокси автоматически.')
				])
			]),

			card([
				h(_('Как получить токен и свой ID')),
				p(_('Боту нужны две вещи: токен — чтобы работать, и ваш Telegram ID — чтобы слушаться только вас.')),
				p(E('b', {}, _('Токен — у @BotFather:'))),
				li([
					_('Откройте в Telegram чат с @BotFather и отправьте /newbot.'),
					_('Придумайте имя бота и его username, который должен заканчиваться на «bot».'),
					_('В ответ придёт строка вида 1234567890:AA… — это и есть токен.')
				]),
				p(E('b', {}, _('Свой ID — у @userinfobot:'))),
				li([
					_('Откройте чат с @userinfobot и отправьте любое сообщение.'),
					_('В ответ придёт число — это ваш ID.'),
					_('Если бот будет писать в группу или канал, их ID начинается с минуса, например -100….')
				]),
				p(_('Оба значения вводятся в «Мастере настройки» при первой установке.'))
			]),

			card([
				h(_('Установщик install.sh')),
				p(_('Бот ставится сценарием /usr/lib/podkop_bot/install.sh. Обычно его запускает сам интерфейс из «Мастера настройки» и вкладки «Обновление». При необходимости его можно вызвать вручную из консоли:')),
				li([
					cmd('--action install', _('установка; токен и ID передаются параметром --config')),
					cmd('--action update', _('обновление бота с GitHub')),
					cmd('--action uninstall', _('полное удаление')),
					cmd('--action status', _('показать установленный вариант Podkop, версии и наличие настроек')),
					cmd('--action check-token', _('проверить токен, ничего не устанавливая'))
				]),
				p(_('Установщик сам определяет установленный вариант Podkop, умеет работать через прокси при заблокированном GitHub, а если сети нет совсем — ставит копию бота, вложенную в пакет.'))
			]),

			card([
				h(_('Podkop и его форки')),
				p(_('Существует оригинальный Podkop и несколько его форков. Приложение определяет установленный автоматически, выбирать вручную ничего не нужно. Различия важны в основном для разработчика: у форков свои репозитории и формат настроек.')),
				li([
					link('Podkop', 'https://github.com/itdoginfo/podkop', _('оригинал.')),
					link('Podkop Plus', 'https://github.com/ushan0v/podkop-plus', _('форк с расширенными возможностями.')),
					link('NetShift', 'https://github.com/yandexru45/netshift', _('форк со своей структурой файлов и настроек.')),
					link('Forkop', 'https://github.com/ushan0v/forkop', _('продолжение Podkop Plus под новым именем.'))
				]),
				p(_('На вкладке «Обновление» видно версию установленного Podkop и наличие свежего выпуска. Там же его можно обновить: приложение запускает штатный установщик и показывает журнал.'))
			]),

			card([
				h(_('Где настраивается остальное')),
				li([
					item(_('Серверы, подписки, правила'), _('в приложении самого Podkop или его форка.')),
					item(_('Повседневное управление и отчёты'), _('в Telegram-боте.'))
				]),
				p([
					_('Исходный код: '),
					E('a', { 'href':'https://github.com/Medvedolog/luci-app-podkop-bot', 'target':'_blank', 'rel':'noopener' }, _('веб-интерфейс')),
					_(' и '),
					E('a', { 'href':'https://github.com/Medvedolog/podkop_bot', 'target':'_blank', 'rel':'noopener' }, _('Telegram-бот')),
					'.'
				])
			]),
			pbFooter()
		]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
