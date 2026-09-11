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
var callRtStatus = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'status' });
var callRtStart = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'start' });
var callRtStop = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'stop' });
var callRtLog = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'log', params:['offset'] });
var callRtTelegram = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'telegram_test' });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) {
	return E('span', { 'style':'display:inline-flex;align-items:flex-start;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';' }),
		E('span', {}, label)
	]);
}
function row(label, value) {
	return E('div', { 'class':'pb-row pb-row--plain' }, [ E('span', { 'class':'pb-row-label' }, label), E('span', { 'class':'pb-row-val' }, value) ]);
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
function timeoutLabel(r) {
	var ms = parseInt(r && r.latency_ms || 0, 10);
	var sec = ms > 0 ? (ms / 1000).toFixed(1) : '5.0';
	var where = (r && r.reason === 'connect_timeout') ? _('connect timeout') : _('request timeout');
	return _('TIMEOUT') + ' · ' + where + ' · ' + sec + ' s';
}

return view.extend({
	loadData: function() {
		return Promise.all([
			callStatus('').catch(function(){return {ok:false};}),
			callShortlist().catch(function(){return {ok:false,items:[]};}),
			callRtStatus().catch(function(){return {ok:false,running:false,state:'unknown'};})
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
		var st=data[0]||{}, sl=data[1]||{items:[]}, rt=data[2]||{};
		this._st=st; this._sl=sl; this._rt=rt;
		var out=E('div', {}, [
			E('h2', {}, _('WARP Rescue / WARPSCOUT')),
			E('p', { 'class':'pb-hint-90', 'style':'max-width:820px;' }, _('Порядок работы: 1) WARP account, 2) поиск endpoints, 3) выбор endpoint, 4) тестовый SOCKS, 5) проверка Telegram API. WARPSCOUT выполняет discovery и ранжирование; LuCI только управляет его штатными командами.')),
			this.statusCard(st),
			this.accountCard(st),
			this.configCard(st),
			this.scanCard(st,sl),
			this.shortlistCard(sl),
			this.runtimeCard(st,rt,sl),
			this.logsCard()
		]);
		window.setTimeout(this.loadSavedLogs.bind(this), 0);
		return out;
	},

	statusCard: function(st) {
		return card(_('Состояние'), [
			row(_('WARPSCOUT'), st.installed ? dot('green', _('установлен')) : dot('yellow', _('не установлен'))),
			row(_('Версия'), st.current || '—'),
			row(_('Account'), st.account_ready ? dot('green', _('готов')) : dot('yellow', _('отсутствует'))),
			row(_('Выбранный endpoint'), (st.config && st.config.active_endpoint) || '—'),
			E('div', { 'style':'margin-top:.7em;' }, [ E('a', { 'class':'cbi-button', 'href':L.url('admin/services/podkop-bot/update') }, _('Установка / обновление WARPSCOUT')) ])
		]);
	},

	accountCard: function(st) {
		var self=this, status=E('div', { 'style':'margin-top:.5em;' });
		var reg=E('button', { 'class':'cbi-button cbi-button-action', 'disabled':!st.installed ? 'disabled' : null, 'click':ui.createHandlerFn(this,function(){ return self.runAction('register','',status,reg); }) }, st.account_ready ? _('Перерегистрировать account') : _('Создать WARP account'));
		var imp=E('button', { 'class':'cbi-button', 'click':ui.createHandlerFn(this,function(){
			dom.content(status,dot('grey',_('Загрузка account JSON…')));
			return ui.uploadFile('/tmp/warpscout-account-upload.json', null, _('Файл будет проверен как JSON и сохранён с правами 0600. Секреты не выводятся в LuCI и журнал.')).then(function(){
				return callImport().then(function(r){
					dom.content(status, r&&r.ok ? dot('green',_('Account импортирован')) : dot('red',_('Импорт отклонён: ')+((r&&r.reason)||'?')));
					if(r&&r.ok) return self.refreshView();
				});
			}).catch(function(e){ dom.content(status,dot('yellow',(e&&e.message)||_('Загрузка отменена'))); });
		}) }, _('Импортировать account JSON'));
		return card(_('WARP account'), [
			E('p', { 'class':'pb-hint-90' }, st.account_ready ? _('Account готов. Следующий шаг — найти рабочие WARP endpoints.') : _('Сначала создайте или импортируйте WARP account. Без него поиск endpoints недоступен.')),
			E('div', { 'class':'pb-action-row', 'style':'display:flex;gap:.5em;flex-wrap:wrap;' }, [reg,imp]), status
		]);
	},

	configCard: function(st) {
		var c=st.config||{}, self=this;
		function select(values, cur) { var s=E('select',{'class':'cbi-input-select'}); values.forEach(function(v){ s.appendChild(E('option',{value:v[0],selected:v[0]===cur?'selected':null},v[1])); }); return s; }
		function input(v, ph) { return E('input',{type:'text','class':'cbi-input-text',value:v||'',placeholder:ph||''}); }
		var enabled=E('input',{type:'checkbox',checked:c.enabled?'checked':null});
		var policy=select([['manual',_('Manual')],['reserve',_('Reserve')],['emergency',_('Emergency')]],c.policy||'manual');
		var proto=select([['awg','AWG'],['wg','WG'],['masque','MASQUE'],['masque-h2','MASQUE-H2']],c.protocol||'awg');
		var port=input(String(c.socks_port||18191),'18191');
		var node=input(c.node,'HEL,ARN'), country=input(c.country,'FI,SE'), exnode=input(c.exclude_node,'DME'), excountry=input(c.exclude_country,'RU');
		var status=E('div',{'style':'margin-top:.5em;'});
		var save=E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){
			var ops=[['enabled',enabled.checked?'1':'0'],['policy',policy.value],['protocol',proto.value],['socks_port',port.value.trim()],['node',node.value.trim()],['country',country.value.trim()],['exclude_node',exnode.value.trim()],['exclude_country',excountry.value.trim()]];
			dom.content(status,dot('grey',_('Сохранение…')));
			var p=Promise.resolve(); ops.forEach(function(x){ p=p.then(function(){return callSet(x[0],x[1]).then(function(r){if(!r||!r.ok) throw new Error((r&&r.reason)||'write_failed');});}); });
			return p.then(function(){dom.content(status,dot('green',_('Настройки сохранены')));return self.refreshView();}).catch(function(e){dom.content(status,dot('red',_('Ошибка: ')+(e&&e.message||'?')));});
		})},_('Сохранить'));
		var advanced=E('details',{'style':'margin-top:.7em;'},[
			E('summary',{'style':'cursor:pointer;color:#aaa;'},_('Расширенные параметры discovery / reserve')),
			E('div',{'style':'margin-top:.7em;'},[
				row(_('Использовать WARP Rescue'),enabled), row(_('Policy'),policy), row(_('Protocol'),proto),
				row(_('Node filter'),node), row(_('Country filter'),country), row(_('Exclude node'),exnode), row(_('Exclude country'),excountry),
				E('p',{'class':'pb-hint-90'},_('Фильтры напрямую передаются WARPSCOUT. LuCI не переоценивает качество найденных endpoints.'))
			])
		]);
		return card(_('SOCKS / параметры'), [
			row(_('Локальный SOCKS5h port'),port),
			advanced,
			E('div',{'style':'margin-top:.7em;'},[save]),status
		]);
	},

	scanCard: function(st, sl) {
		var self=this,status=E('div',{'style':'margin-top:.5em;'}), items=(sl&&sl.items)||[];
		var scan=E('button',{'class':'cbi-button cbi-button-action','disabled':!(st.installed&&st.account_ready) ? 'disabled' : null,'click':ui.createHandlerFn(this,function(){return self.runAction('scan','',status,scan);})},_('Найти WARP endpoints'));
		var target=E('button',{'class':'cbi-button','disabled':!(st.installed&&st.account_ready&&st.config&&st.config.active_endpoint) ? 'disabled' : null,'click':ui.createHandlerFn(this,function(){return self.runAction('target',(st.config&&st.config.active_endpoint)||'',status,target);})},_('Перепроверить выбранный (--target)'));
		var hint=!st.account_ready ? _('Шаг 1: сначала создайте WARP account выше.') : (!items.length ? _('Шаг 2: выполните поиск. После успешного scan ниже появится shortlist найденных endpoints.') : _('Поиск уже выполнен. Можно повторить полный scan или быстро перепроверить выбранный endpoint.'));
		return card(_('Discovery'), [
			E('p',{'class':'pb-hint-90'},hint),
			E('div',{'class':'pb-action-row','style':'display:flex;gap:.5em;flex-wrap:wrap;'},[scan,target]),status
		]);
	},

	shortlistCard: function(sl) {
		var self=this, items=(sl&&sl.items)||[], body=E('div',{});
		if(!items.length) dom.content(body,E('p',{'class':'pb-hint-90'},_('Пока пусто. Если scan в журнале нашёл endpoints, но здесь ничего нет — это ошибка разбора report, а не отсутствие рабочих WARP endpoints.')));
		else dom.content(body,items.map(function(x){
			var active=x.endpoint===sl.active;
			var b=E('button',{'class':'cbi-button'+(active?' cbi-button-positive':''),'disabled':active?'disabled':null,'click':ui.createHandlerFn(self,function(){return callSelect(x.endpoint).then(function(r){if(r&&r.ok)return self.refreshView();});})},active?_('Активный'):_('Выбрать'));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.65em 0;'},[
				E('div',{'style':'display:flex;justify-content:space-between;gap:1em;align-items:center;flex-wrap:wrap;'},[E('strong',{},x.endpoint),b]),
				E('div',{'class':'pb-hint-90'},[(x.node||'—')+' · '+(x.node_location||'—')+' · '+_('seen as ')+(x.seen_as||'—')+' · '+_('TUN ')+(x.tunnel_ping||'—')+' · '+_('loss ')+(x.loss||'—')])
			]);
		}));
		var next=E('button',{'class':'cbi-button','disabled':items.length<2?'disabled':null,'click':ui.createHandlerFn(this,function(){
			if(items.length<2)return;
			var idx=0; for(var i=0;i<items.length;i++) if(items[i].endpoint===sl.active){idx=i;break;}
			var ep=items[(idx+1)%items.length].endpoint;
			return callSelect(ep).then(function(r){if(r&&r.ok)return self.refreshView();});
		})},_('Следующий endpoint'));
		return card(_('Shortlist'),[body,E('div',{'style':'margin-top:.7em;'},[next])]);
	},

	runtimeCard: function(st, rt, sl) {
		var self=this, status=E('div',{'style':'margin-top:.6em;'}), canStart=!!(st.installed&&st.account_ready&&st.config&&st.config.active_endpoint);
		var start=E('button',{'class':'cbi-button cbi-button-action','disabled':(rt.running||!canStart)?'disabled':null,'click':ui.createHandlerFn(this,function(){
			start.disabled=true; dom.content(status,dot('yellow',_('WARPSCOUT поднимает тестовый SOCKS…')));
			return callRtStart().then(function(r){
				dom.content(status,r&&r.ok?dot('green',_('SOCKS поднят')):dot('red',_('SOCKS не поднялся: ')+((r&&r.reason)||'?')));
				return self.refreshView();
			}).catch(function(){dom.content(status,dot('red',_('Ошибка RPC')));start.disabled=false;});
		})},_('Поднять WARP SOCKS'));
		var stop=E('button',{'class':'cbi-button','disabled':!rt.running?'disabled':null,'click':ui.createHandlerFn(this,function(){
			stop.disabled=true; return callRtStop().then(function(r){dom.content(status,r&&r.ok?dot('green',_('SOCKS остановлен')):dot('red',_('Не удалось остановить')));return self.refreshView();}).catch(function(){stop.disabled=false;});
		})},_('Остановить WARP SOCKS'));
		var tg=E('button',{'class':'cbi-button','disabled':!rt.running?'disabled':null,'click':ui.createHandlerFn(this,function(){
			tg.disabled=true; dom.content(status,dot('grey',_('Проверяю api.telegram.org через этот SOCKS…')));
			return callRtTelegram().then(function(r){dom.content(status,self.telegramResult(r));tg.disabled=false;return self.refreshView();}).catch(function(){dom.content(status,dot('red',_('Telegram probe не завершился')));tg.disabled=false;});
		})},_('Проверить Telegram API'));
		var tgLast=(rt.telegram&&rt.telegram.status)?this.telegramResult(rt.telegram):dot('grey',_('ещё не проверялся'));
		var pre=!canStart ? E('p',{'style':'color:#e8a33d;font-size:90%;'},_('Чтобы поднять WARP SOCKS, сначала выполните Discovery и выберите endpoint.')) : E('span',{});
		return card(_('Тестовый WARP SOCKS'),[
			pre,
			E('p',{'class':'pb-hint-90'},_('WARPSCOUT socks — тестовый туннель без reconnect/failover. Его локальный socks5h можно использовать в Runtime → Тест сервисов как обычный маршрут проверки.')),
			row(_('WARP tunnel'),rt.running?dot('green',_('OK')+(rt.rss_mb!=null?(' · RSS '+rt.rss_mb+' MB'):'')):dot('grey',rt.state||_('остановлен'))),
			row(_('Endpoint'),rt.endpoint||((st.config&&st.config.active_endpoint)||'—')),
			row(_('Protocol'),String(rt.protocol||((st.config&&st.config.protocol)||'—')).toUpperCase()),
			row(_('SOCKS'),rt.proxy||('socks5h://127.0.0.1:'+((st.config&&st.config.socks_port)||18191))),
			row(_('Telegram API'),tgLast),
			(rt.telegram&&rt.telegram.proxy?row(_('Telegram test route'),rt.telegram.proxy):E('span',{})),
			(rt.telegram&&rt.telegram.error?row(_('Telegram detail'),rt.telegram.error):E('span',{})),
			E('div',{'class':'pb-action-row','style':'display:flex;gap:.5em;flex-wrap:wrap;margin-top:.7em;'},[start,stop,tg]),status
		]);
	},

	logsCard: function() {
		this._actionLogPre=logPre(); this._rtLogPre=logPre();
		return card(_('Журналы'),[
			E('p',{'class':'pb-hint-90'},_('Журналы последней операции сохраняются после её завершения. Форматирование и переводы строк WARPSCOUT сохраняются; широкие таблицы прокручиваются по горизонтали.')),
			E('details',{},[E('summary',{'style':'cursor:pointer;'},_('Последний Discovery / account log')),this._actionLogPre]),
			E('details',{'style':'margin-top:.6em;'},[E('summary',{'style':'cursor:pointer;'},_('Последний WARP SOCKS log')),this._rtLogPre])
		]);
	},

	loadSavedLogs: function() {
		var a=this._actionLogPre, r=this._rtLogPre;
		if(a) callActionLog(0).then(function(x){a.textContent=(x&&x.chunk)||_('Лог пуст.');}).catch(function(){});
		if(r) callRtLog(0).then(function(x){r.textContent=(x&&x.chunk)||_('Лог пуст.');}).catch(function(){});
	},

	telegramResult: function(r) {
		if(!r) return dot('red',_('нет результата'));
		var s=r.status||'';
		if(s==='OK') return dot('green',_('OK')+(r.http?(' · HTTP '+r.http):'')+(r.latency_ms?(' · '+r.latency_ms+' ms'):''));
		if(s==='TIMEOUT') return dot('red',timeoutLabel(r));
		if(s==='RATE_LIMITED') return dot('yellow',_('Telegram доступен · rate limited (429)'));
		if(s==='AUTH_ERROR') return dot('yellow',_('Telegram доступен · ошибка авторизации (401)'));
		if(s==='API_DENIED') return dot('yellow',_('Telegram доступен · API denied (403)'));
		if(s==='OTHER_API_RESPONSE') return dot('yellow',_('Telegram отвечает · HTTP ')+(r.http||'?'));
		return dot('red',_('NETWORK_FAIL')+(r.curl_rc?(' · curl '+r.curl_rc):''));
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
