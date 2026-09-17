'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

var callStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callSet = rpc.declare({ object:'podkop_bot_warpscout', method:'config_set', params:['key','value'] });
var callImport = rpc.declare({ object:'podkop_bot_warpscout', method:'account_import' });
var callAction = rpc.declare({ object:'podkop_bot_warpscout', method:'action_run', params:['action','target'] });
var callActionLog = rpc.declare({ object:'podkop_bot_warpscout', method:'action_log', params:['offset'] });
var callShortlist = rpc.declare({ object:'podkop_bot_warpscout', method:'shortlist' });
var callSelect = rpc.declare({ object:'podkop_bot_warpscout', method:'select', params:['endpoint'] });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var callRescueTrigger = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'trigger' });
var callRescueStop = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'stop' });
var callRescueLog = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'log', params:['offset'] });
var callWarpRtStart = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'start', params:['endpoint'] });
var callWarpRtStop = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'stop' });
var callWarpRtTelegram = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'telegram_test' });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) {
	return E('span', { 'style':'display:inline-flex;align-items:flex-start;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';' }),
		E('span', {}, label)
	]);
}
function helpLabel(label, help) {
	if (!help) return label;
	return E('span', { 'title':help, 'style':'cursor:help;text-decoration:underline dotted;text-underline-offset:2px;' }, [label, E('span', { 'style':'margin-left:.35em;color:#888;text-decoration:none;' }, 'ⓘ')]);
}
function row(label, value, help) {
	return E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, helpLabel(label, help)), E('span', { 'class':'pb-row-val' }, value) ]);
}
function card(title, children) {
	return E('div', { 'class':'cbi-section', 'style':'max-width:820px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;' }, [ E('h3', { 'style':'margin-top:0;' }, title) ].concat(children));
}
function logPre() {
	return E('pre', { 'style':'max-width:100%;box-sizing:border-box;max-height:360px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.7em;border-radius:6px;white-space:pre;font-family:monospace;font-size:82%;line-height:1.35;margin:.6em 0 0;' }, _('Лог пуст.'));
}
function pbInjectCss() {
	if (document.getElementById('pb-css')) return;
	document.querySelector('head').appendChild(E('link', { 'id':'pb-css', 'rel':'stylesheet', 'type':'text/css', 'href':L.resource('css/podkop-bot/podkop-bot.css') }));
}

return view.extend({
	loadData: function() {
		return Promise.all([
			callStatus('').catch(function(){return {ok:false};}),
			callShortlist().catch(function(){return {ok:false,items:[]};}),
			callRescueStatus().catch(function(){return {ok:false,running:false,state:'unknown',total:0};})
		]);
	},

	load: function() {
		pbInjectCss();
		return this.loadData();
	},

	render: function(data) {
		this.root = E('div', {});
		dom.content(this.root, this.renderBody(data));
		return this.root;
	},

	refreshView: function() {
		var self=this;
		return this.loadData().then(function(data){ dom.content(self.root, self.renderBody(data)); });
	},

	renderBody: function(data) {
		var st=data[0]||{}, sl=data[1]||{items:[]}, rs=data[2]||{};
		this._st=st; this._sl=sl; this._rs=rs;
		var out=E('div', {}, [
			E('h2', {}, _('WARP Rescue / WARPSCOUT')),
			E('p', { 'class':'pb-hint-90', 'style':'max-width:820px;' }, _('WARPSCOUT ищет и ранжирует доступные WARP-узлы. WARP Rescue использует только узлы, успешно прошедшие проверку Telegram Bot API, и продолжает работать независимо от открытой страницы LuCI. Для ручных проверок временно запускается отдельный тестовый SOCKS.')),
			this.statusCard(st),
			this.accountCard(st),
			this.configCard(st),
			this.scanCard(st,sl),
			this.shortlistCard(sl),
			this.rescueCard(st,rs),
			this.logsCard()
		]);
		window.setTimeout(this.loadSavedLogs.bind(this), 0);
		return out;
	},

	statusCard: function(st) {
		return card(_('Состояние'), [
			row(_('WARPSCOUT'), st.installed ? dot('green', _('установлен')) : dot('yellow', _('не установлен')), _('Наличие утилиты WARPSCOUT на роутере. Она ищет и оценивает WARP-узлы.')),
			row(_('Версия'), st.current || '—', _('Установленная версия WARPSCOUT.')),
			row(_('Учётная запись WARP'), st.account_ready ? dot('green', _('готова')) : dot('yellow', _('отсутствует')), _('Локальная учётная запись Cloudflare WARP, необходимая для запуска WARP-туннеля.')),
			row(_('Выбранный WARP-узел'), (st.config && st.config.active_endpoint) || '—', _('Узел, выбранный из результатов поиска. Это не обязательно текущий ON-AIR узел револьвера.')),
			E('div', { 'style':'margin-top:.7em;display:flex;gap:.5em;flex-wrap:wrap;' }, [
				E('a', { 'class':'cbi-button', 'href':L.url('admin/services/podkop-bot/update')+'#warpscout-update', 'title':_('Установить, обновить или удалить WARPSCOUT.') }, _('Установка / удаление WARPSCOUT'))
			])
		]);
	},

	accountCard: function(st) {
		var self=this, status=E('div', { 'style':'margin-top:.5em;' });
		var reg=E('button', { 'class':'cbi-button cbi-button-action', 'disabled':!st.installed ? 'disabled' : null, 'title':_('Создаёт новую локальную учётную запись WARP. Перерегистрация заменяет существующую.'), 'click':ui.createHandlerFn(this,function(){ return self.runAction('register','',status,reg); }) }, st.account_ready ? _('Перерегистрировать учётную запись') : _('Создать учётную запись WARP'));
		var imp=E('button', { 'class':'cbi-button', 'title':_('Импортирует ранее сохранённый JSON учётной записи WARP.'), 'click':ui.createHandlerFn(this,function(){
			dom.content(status,dot('grey',_('Загрузка JSON учётной записи…')));
			return ui.uploadFile('/tmp/warpscout-account-upload.json', null, _('Файл будет проверен как JSON и сохранён с правами 0600. Секреты не выводятся в LuCI и журнал.')).then(function(){
				return callImport().then(function(r){
					dom.content(status, r&&r.ok ? dot('green',_('Учётная запись импортирована')) : dot('red',_('Импорт отклонён: ')+((r&&r.reason)||'?')));
					if(r&&r.ok) return self.refreshView();
				});
			}).catch(function(e){ dom.content(status,dot('yellow',(e&&e.message)||_('Загрузка отменена'))); });
		}) }, _('Импортировать JSON учётной записи'));
		return card(_('Учётная запись WARP'), [
			E('p', { 'class':'pb-hint-90' }, st.account_ready ? _('Учётная запись готова. Следующий шаг — найти рабочие WARP-узлы.') : _('Сначала создайте или импортируйте учётную запись WARP. Без неё поиск узлов недоступен.')),
			E('div', { 'class':'pb-action-row', 'style':'display:flex;gap:.5em;flex-wrap:wrap;' }, [reg,imp]), status
		]);
	},

	configCard: function(st) {
		var c=st.config||{}, self=this;
		function select(values, cur) { var s=E('select',{'class':'cbi-input-select'}); values.forEach(function(v){ s.appendChild(E('option',{value:v[0],selected:v[0]===cur?'selected':null},v[1])); }); return s; }
		function input(v, ph) { return E('input',{type:'text','class':'cbi-input-text',value:v||'',placeholder:ph||''}); }
		var policy=select([['manual',_('Ручной')],['reserve',_('Резерв')],['emergency',_('Аварийный')]],c.policy||'manual');
		var proto=select([['awg','AWG'],['wg','WG'],['masque','MASQUE'],['masque-h2','MASQUE-H2']],c.protocol||'awg');
		var port=input(String(c.socks_port||18191),'18191');
		var node=input(c.node,'HEL,ARN'), country=input(c.country,'FI,SE'), exnode=input(c.exclude_node,'DME'), excountry=input(c.exclude_country,'RU');
		var status=E('div',{'style':'margin-top:.5em;'});
		var save=E('button',{'class':'cbi-button cbi-button-apply','title':_('Сохраняет параметры WARPSCOUT. Запущенный Rescue использует новые параметры при следующем запуске или перезарядке.'),'click':ui.createHandlerFn(this,function(){
			var ops=[['policy',policy.value],['protocol',proto.value],['socks_port',port.value.trim()],['node',node.value.trim()],['country',country.value.trim()],['exclude_node',exnode.value.trim()],['exclude_country',excountry.value.trim()]];
			dom.content(status,dot('grey',_('Сохранение…')));
			var p=Promise.resolve(); ops.forEach(function(x){ p=p.then(function(){return callSet(x[0],x[1]).then(function(r){if(!r||!r.ok) throw new Error((r&&r.reason)||'write_failed');});}); });
			return p.then(function(){dom.content(status,dot('green',_('Настройки сохранены')));return self.refreshView();}).catch(function(e){dom.content(status,dot('red',_('Ошибка: ')+(e&&e.message||'?')));});
		})},_('Сохранить'));
		var advanced=E('details',{'style':'margin-top:.7em;'},[
			E('summary',{'style':'cursor:pointer;color:#aaa;','title':_('Параметры, влияющие на поиск и выбор WARP-узлов.')},_('Расширенные параметры поиска и резерва')),
			E('div',{'style':'margin-top:.7em;'},[
				row(_('Режим'),policy,_('Ручной — выбор узла оператором. Резерв — использование WARP как резервного транспорта. Аварийный — режим для сценариев аварийного восстановления.')),
				row(_('Протокол'),proto,_('Транспорт, которым WARPSCOUT поднимает WARP-туннель. AWG обычно является основным вариантом; остальные выбираются при необходимости совместимости.')),
				row(_('Фильтр узлов'),node,_('Разрешённые коды WARP-узлов, например HEL,ARN. Несколько значений указываются через запятую. Пусто — без фильтра по узлам.')),
				row(_('Фильтр стран'),country,_('Разрешённые страны WARP-узлов, например FI,SE. Пусто — без фильтра по стране.')),
				row(_('Исключить узлы'),exnode,_('Коды WARP-узлов, которые не должны попадать в результаты поиска.')),
				row(_('Исключить страны'),excountry,_('Страны, которые нужно исключить из результатов поиска.')),
				E('p',{'class':'pb-hint-90'},_('Фильтры напрямую передаются WARPSCOUT. LuCI не переоценивает качество найденных WARP-узлов. Запуск и остановка WARP выполняются через WARP Rescue ниже.'))
			])
		]);
		return card(_('SOCKS / параметры'), [
			row(_('Порт SOCKS5h'),port,_('Локальный порт пользовательского WARP Rescue SOCKS5h. По умолчанию 18191. Не должен конфликтовать с другими службами роутера.')),
			advanced,
			E('div',{'style':'margin-top:.7em;'},[save]),status
		]);
	},

	scanCard: function(st, sl) {
		var self=this,status=E('div',{'style':'margin-top:.5em;'}), items=(sl&&sl.items)||[];
		var scan=E('button',{'class':'cbi-button cbi-button-action','disabled':!(st.installed&&st.account_ready) ? 'disabled' : null,'title':_('Запускает полный поиск и ранжирование доступных WARP-узлов.'),'click':ui.createHandlerFn(this,function(){return self.runAction('scan','',status,scan);})},_('Найти WARP-узлы'));
		var target=E('button',{'class':'cbi-button','disabled':!(st.installed&&st.account_ready&&st.config&&st.config.active_endpoint) ? 'disabled' : null,'title':_('Повторно проверяет только выбранный WARP-узел без полного поиска.'),'click':ui.createHandlerFn(this,function(){return self.runAction('target',(st.config&&st.config.active_endpoint)||'',status,target);})},_('Перепроверить выбранный узел'));
		var hint=!st.account_ready ? _('Шаг 1: сначала создайте учётную запись WARP выше.') : (!items.length ? _('Шаг 2: выполните поиск. После успешного поиска ниже появится список найденных WARP-узлов.') : _('Поиск уже выполнен. Можно повторить полный поиск или быстро перепроверить выбранный WARP-узел.'));
		return card(_('Поиск WARP-узлов'), [
			E('p',{'class':'pb-hint-90'},hint),
			E('div',{'class':'pb-action-row','style':'display:flex;gap:.5em;flex-wrap:wrap;'},[scan,target]),status
		]);
	},

	manualTelegramTest: function(endpoint,status,btn) {
		var self=this;
		btn.disabled=true;
		dom.content(status,dot('yellow',_('Временно запускаю WARP-узел ')+endpoint+_(' и проверяю Telegram Bot API…')));
		return callWarpRtStop().catch(function(){return null;}).then(function(){
			return callWarpRtStart(endpoint);
		}).then(function(r){
			if(!r||!r.ok)throw new Error((r&&r.reason)||'warp_start_failed');
			return callWarpRtTelegram();
		}).then(function(t){
			if(t&&t.verified_bot_api)dom.content(status,dot('green',_('Telegram VALID · HTTP ')+(t.http||'200')+(t.latency_ms?(' · '+t.latency_ms+' мс'):'')));
			else if(t&&t.telegram_reached)dom.content(status,dot('yellow',_('Telegram достижим, но не VALID · HTTP ')+(t.http||'—')));
			else dom.content(status,dot('red',_('Telegram FAIL · ')+((t&&t.reason)||'?')));
		}).catch(function(e){
			dom.content(status,dot('red',_('Проверка не завершилась: ')+((e&&e.message)||'?')));
		}).then(function(){
			return callWarpRtStop().catch(function(){return null;});
		}).finally(function(){btn.disabled=false;});
	},

	shortlistCard: function(sl) {
		var self=this, items=(sl&&sl.items)||[], body=E('div',{});
		if(!items.length) dom.content(body,E('p',{'class':'pb-hint-90'},_('Список пока пуст. Если поиск в журнале нашёл узлы, но здесь ничего нет, значит не удалось разобрать результаты поиска.')));
		else dom.content(body,items.map(function(x){
			var active=x.endpoint===sl.active, testStatus=E('span',{'style':'margin-left:.6em;'});
			var selectBtn=E('button',{'class':'cbi-button'+(active?' cbi-button-positive':''),'disabled':active?'disabled':null,'title':_('Сделать этот WARP-узел выбранным в настройках WARPSCOUT. Это не переключает ON-AIR узел револьвера.'),'click':ui.createHandlerFn(self,function(){return callSelect(x.endpoint).then(function(r){if(r&&r.ok)return self.refreshView();});})},active?_('Выбран'):_('Выбрать'));
			var tgBtn=E('button',{'class':'cbi-button','style':'padding:.2em .65em;font-size:85%;','title':_('Точечно проверить Telegram Bot API через этот WARP-узел. Результат не перестраивает магазин револьвера.'),'click':ui.createHandlerFn(self,function(){return self.manualTelegramTest(x.endpoint,testStatus,tgBtn);})},_('TG API'));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.65em 0;'},[
				E('div',{'style':'display:flex;justify-content:space-between;gap:1em;align-items:center;flex-wrap:wrap;'},[
					E('strong',{},x.endpoint),
					E('div',{'style':'display:flex;gap:.45em;align-items:center;flex-wrap:wrap;'},[tgBtn,selectBtn])
				]),
				E('div',{'class':'pb-hint-90'},[(x.node||'—')+' · '+(x.node_location||'—')+' · '+_('выход ')+(x.seen_as||'—')+' · '+_('туннель ')+(x.tunnel_ping||'—')+' · '+_('потери ')+(x.loss||'—'),testStatus])
			]);
		}));
		var next=E('button',{'class':'cbi-button','disabled':items.length<2?'disabled':null,'title':_('Выбирает следующий WARP-узел в списке найденных кандидатов.'),'click':ui.createHandlerFn(this,function(){
			if(items.length<2)return;
			var idx=0; for(var i=0;i<items.length;i++) if(items[i].endpoint===sl.active){idx=i;break;}
			var ep=items[(idx+1)%items.length].endpoint;
			return callSelect(ep).then(function(r){if(r&&r.ok)return self.refreshView();});
		})},_('Следующий WARP-узел'));
		return card(_('Найденные WARP-узлы'),[
			E('p',{'class':'pb-hint-90'},_('Здесь показаны кандидаты, найденные WARPSCOUT. В магазин револьвера попадают только WARP-узлы со статусом VALID после проверки Telegram Bot API. Кнопка TG API выполняет точечную проверку выбранного узла и сама магазин не перестраивает.')),
			body,E('div',{'style':'margin-top:.7em;'},[next])
		]);
	},

	rescueCard: function(st, rs) {
		var self=this, cfg=st.config||{}, enabled=!!cfg.enabled, status=E('div',{'style':'margin-top:.6em;'});
		var stateNode=rs.running?dot('green',_('работает')):(rs.busy?dot('yellow',String(rs.state||_('занят'))):dot((rs.state==='exhausted'||rs.state==='reload_failed')?'red':'grey',enabled?_('не запущен'):_('остановлен')));
		var power=E('button',{'class':'cbi-button '+(enabled?'cbi-button-negative':'cbi-button-positive'),'disabled':rs.busy?'disabled':null,'title':enabled?_('Останавливает WARP Rescue и разряжает магазин револьвера.'):_('Запускает WARP Rescue. Если магазин пуст, потребуется перезарядка.'),'click':ui.createHandlerFn(this,function(){
			dom.content(status,dot('yellow',enabled?_('Останавливаю WARP…'):_('Запускаю WARP…')));
			return (enabled?callRescueStop():callRescueTrigger()).then(function(r){dom.content(status,r&&r.ok?dot('green',enabled?_('WARP остановлен'):_('WARP запускается')):dot('red',_('Ошибка: ')+((r&&r.reason)||'?')));window.setTimeout(function(){self.refreshView();},700);window.setTimeout(function(){self.refreshView();},3500);});
		})},enabled?_('Остановить WARP'):_('Запустить WARP'));
		return card(_('WARP Rescue'),[
			E('p',{'class':'pb-hint-90'},_('Это основной WARP SOCKS. Для ручных проверок временно запускается отдельный тестовый SOCKS; после завершения восстанавливается тот же ON-AIR WARP-узел Rescue.')),
			row(_('Состояние'),stateNode,_('Текущее состояние пользовательского WARP Rescue SOCKS.')),
			row(_('WARP-узел'),E('span',{},rs.endpoint||cfg.active_endpoint||'—'),_('Узел, через который сейчас работает Rescue. Если Rescue остановлен, может показываться последний выбранный узел.')),
			row(_('Протокол'),E('span',{},String(cfg.protocol||'—').toUpperCase()),_('Протокол текущей конфигурации WARP-туннеля.')),
			row(_('SOCKS'),E('span',{},rs.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191))),_('Локальный SOCKS5h-адрес, который могут использовать бот и другие локальные службы.')),
			row(_('Магазин'),(rs.total||0)>0?dot('green',String(rs.total)+_(' VALID')):dot('grey',_('пуст')),_('Количество WARP-узлов, успешно прошедших общую проверку Telegram Bot API и загруженных в револьвер.')),
			row(_('Автоперезарядка'),rs.auto?dot('green',_('включена')):dot('grey',_('выключена')),_('При исчерпании магазина повторно запускает поиск, квалификацию Telegram API и сбор нового магазина.')),
			E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;margin-top:.7em;'},[power,E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/transport/warp-revolver'),'title':_('Открыть магазин WARP и управление FIRE / NEXT / RELOAD.')},_('Открыть револьвер'))]),status
		]);
	},

	logsCard: function() {
		this._actionLogPre=logPre(); this._rescueLogPre=logPre();
		return card(_('Журналы'),[
			E('p',{'class':'pb-hint-90'},_('Журналы последней операции сохраняются после её завершения. Тестовый SOCKS отдельно не отображается.')),
			E('details',{},[E('summary',{'style':'cursor:pointer;','title':_('Вывод последнего поиска WARP-узлов или операции с учётной записью.')},_('Последний поиск / журнал учётной записи')),this._actionLogPre]),
			E('details',{'style':'margin-top:.6em;'},[E('summary',{'style':'cursor:pointer;','title':_('Журнал запуска, остановки, FIRE, NEXT и перезарядки WARP Rescue.')},_('Журнал WARP Rescue')),this._rescueLogPre])
		]);
	},

	loadSavedLogs: function() {
		var a=this._actionLogPre, r=this._rescueLogPre;
		if(a) callActionLog(0).then(function(x){a.textContent=(x&&x.chunk)||_('Лог пуст.');}).catch(function(){});
		if(r) callRescueLog(0).then(function(x){r.textContent=(x&&x.chunk)||_('Лог пуст.');}).catch(function(){});
	},

	runAction: function(action,target,status,btn) {
		var self=this; btn.disabled=true; dom.content(status,dot('yellow',_('Операция выполняется… журнал доступен внизу страницы.')));
		return callAction(action,target||'').then(function(r){
			if(!r||!r.ok){btn.disabled=false;dom.content(status,dot('red',_('Не удалось запустить: ')+((r&&r.reason)||'?')));return;}
			var off=0;
			return new Promise(function(resolve){
				function tick(){callActionLog(off).then(function(x){
					if(x&&typeof x.offset==='number')off=x.offset;
					if(x&&x.done){btn.disabled=false;dom.content(status,x.exit_code===0?dot('green',_('Операция завершена')):dot('red',_('WARPSCOUT завершился с кодом ')+x.exit_code));self.loadSavedLogs();if(x.exit_code===0)self.refreshView();resolve(x);return;}
					window.setTimeout(tick,1200);
				}).catch(function(){window.setTimeout(tick,1800);});}
				tick();
			});
		}).catch(function(){btn.disabled=false;dom.content(status,dot('red',_('Ошибка RPC')));});
	},

	handleSave:null, handleSaveApply:null, handleReset:null
});
