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
function pbInjectCss() {
	if (document.getElementById('pb-css')) return;
	document.querySelector('head').appendChild(E('link', { 'id':'pb-css', 'rel':'stylesheet', 'type':'text/css', 'href':L.resource('css/podkop-bot/podkop-bot.css') }));
}

return view.extend({
	load: function() {
		pbInjectCss();
		return Promise.all([ callStatus('').catch(function(){return {ok:false};}), callShortlist().catch(function(){return {ok:false,items:[]};}) ]);
	},

	render: function(data) {
		var self=this, st=data[0]||{}, sl=data[1]||{items:[]};
		this._st=st; this._sl=sl;
		return E('div', {}, [
			E('h2', {}, _('WARP Rescue / WARPSCOUT')),
			E('p', { 'class':'pb-hint-90', 'style':'max-width:820px;' }, _('WARPSCOUT выполняет discovery, проверку и ранжирование WARP endpoints. LuCI только запускает штатные команды, сохраняет выбранный результат и готовит его для будущего резервного транспорта бота.')),
			this.statusCard(st),
			this.accountCard(st),
			this.configCard(st),
			this.scanCard(st),
			this.shortlistCard(sl)
		]);
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
		var log=E('pre', { 'style':'display:none;max-width:820px;max-height:280px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:82%;margin-top:.6em;' }, '');
		var reg=E('button', { 'class':'cbi-button cbi-button-action', 'disabled':!st.installed, 'click':ui.createHandlerFn(this,function(){ return self.runAction('register','',status,log,reg); }) }, st.account_ready ? _('Перерегистрировать account') : _('Создать WARP account'));
		var imp=E('button', { 'class':'cbi-button', 'click':ui.createHandlerFn(this,function(){
			dom.content(status,dot('grey',_('Загрузка account JSON…')));
			return ui.uploadFile('/tmp/warpscout-account-upload.json', null, _('Файл будет проверен как JSON и сохранён с правами 0600. Секреты не выводятся в LuCI и журнал.')).then(function(){
				return callImport().then(function(r){ dom.content(status, r&&r.ok ? dot('green',_('Account импортирован')) : dot('red',_('Импорт отклонён: ')+((r&&r.reason)||'?'))); });
			}).catch(function(e){ dom.content(status,dot('yellow',(e&&e.message)||_('Загрузка отменена'))); });
		}) }, _('Импортировать account JSON'));
		return card(_('WARP account'), [
			E('p', { 'class':'pb-hint-90' }, _('Account управляется WARPSCOUT. LuCI не показывает token/private key и хранит файл только локально с правами 0600.')),
			E('div', { 'class':'pb-action-row', 'style':'display:flex;gap:.5em;flex-wrap:wrap;' }, [reg,imp]), status, log
		]);
	},

	configCard: function(st) {
		var self=this, c=st.config||{};
		function select(values, cur) { var s=E('select',{'class':'cbi-input-select'}); values.forEach(function(v){ s.appendChild(E('option',{value:v[0],selected:v[0]===cur?'selected':null},v[1])); }); return s; }
		function input(v, ph) { return E('input',{type:'text','class':'cbi-input-text',value:v||'',placeholder:ph||''}); }
		var enabled=E('input',{type:'checkbox',checked:c.enabled?'checked':null});
		var policy=select([['manual',_('Manual')],['reserve',_('Reserve')],['emergency',_('Emergency')]],c.policy||'manual');
		var proto=select([['awg','AWG'],['wg','WG'],['masque','MASQUE'],['masque-h2','MASQUE-H2']],c.protocol||'awg');
		var port=input(String(c.socks_port||18191),'18191');
		var node=input(c.node,'HEL,ARN'); var country=input(c.country,'FI,SE'); var exnode=input(c.exclude_node,'DME'); var excountry=input(c.exclude_country,'RU');
		var status=E('div',{'style':'margin-top:.5em;'});
		var save=E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){
			var ops=[['enabled',enabled.checked?'1':'0'],['policy',policy.value],['protocol',proto.value],['socks_port',port.value.trim()],['node',node.value.trim()],['country',country.value.trim()],['exclude_node',exnode.value.trim()],['exclude_country',excountry.value.trim()]];
			dom.content(status,dot('grey',_('Сохранение…')));
			var p=Promise.resolve(); ops.forEach(function(x){ p=p.then(function(){return callSet(x[0],x[1]).then(function(r){if(!r||!r.ok) throw new Error((r&&r.reason)||'write_failed');});}); });
			return p.then(function(){dom.content(status,dot('green',_('Настройки сохранены')));}).catch(function(e){dom.content(status,dot('red',_('Ошибка: ')+(e&&e.message||'?')));});
		})},_('Сохранить'));
		return card(_('Параметры discovery / reserve'), [
			row(_('Использовать WARP Rescue'),enabled), row(_('Policy'),policy), row(_('Protocol'),proto), row(_('Локальный SOCKS port'),port),
			row(_('Node filter'),node), row(_('Country filter'),country), row(_('Exclude node'),exnode), row(_('Exclude country'),excountry),
			E('p',{'class':'pb-hint-90'},_('Фильтры передаются WARPSCOUT как -node/-country/-exclude-node/-exclude-country. LuCI сама не оценивает качество endpoint.')),
			save,status
		]);
	},

	scanCard: function(st) {
		var self=this,status=E('div',{'style':'margin-top:.5em;'}),log=E('pre',{'style':'display:none;max-width:820px;max-height:320px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:82%;margin-top:.6em;'},'');
		var scan=E('button',{'class':'cbi-button cbi-button-action','disabled':!(st.installed&&st.account_ready),'click':ui.createHandlerFn(this,function(){return self.runAction('scan','',status,log,scan);})},_('Сканировать endpoints'));
		var target=E('button',{'class':'cbi-button','disabled':!(st.installed&&st.account_ready&&st.config&&st.config.active_endpoint),'click':ui.createHandlerFn(this,function(){return self.runAction('target',(st.config&&st.config.active_endpoint)||'',status,log,target);})},_('Перепроверить выбранный (--target)'));
		return card(_('Discovery'), [
			E('p',{'class':'pb-hint-90'},_('Полный scan запускается штатным WARPSCOUT с -P. Быстрая перепроверка использует --target на уже выбранном endpoint. Результаты NODE / NODE LOCATION / SEEN AS / tunnel ping / loss берутся из отчёта WARPSCOUT.')),
			E('div',{'class':'pb-action-row','style':'display:flex;gap:.5em;flex-wrap:wrap;'},[scan,target]),status,log
		]);
	},

	shortlistCard: function(sl) {
		var self=this, items=(sl&&sl.items)||[];
		var body=E('div',{});
		if(!items.length) dom.content(body,E('p',{'class':'pb-hint-90'},_('Shortlist пока пуст. После успешного scan сохраняются первые три endpoint в уже отсортированном WARPSCOUT порядке.')));
		else dom.content(body,items.map(function(x){
			var active=x.endpoint===sl.active;
			var b=E('button',{'class':'cbi-button'+(active?' cbi-button-positive':''),'disabled':active?'disabled':null,'click':ui.createHandlerFn(self,function(){return callSelect(x.endpoint).then(function(r){if(r&&r.ok) location.reload();});})},active?_('Активный'):_('Выбрать'));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.65em 0;'},[
				E('div',{'style':'display:flex;justify-content:space-between;gap:1em;align-items:center;flex-wrap:wrap;'},[E('strong',{},x.endpoint),b]),
				E('div',{'class':'pb-hint-90'},[(x.node||'—')+' · '+(x.node_location||'—')+' · '+_('seen as ') +(x.seen_as||'—')+' · '+_('TUN ')+(x.tunnel_ping||'—')+' · '+_('loss ')+(x.loss||'—')])
			]);
		}));
		return card(_('Shortlist'),[body]);
	},

	runAction: function(action,target,status,log,btn) {
		var self=this; btn.disabled=true; log.style.display='block'; log.textContent=''; dom.content(status,dot('yellow',_('Операция выполняется…')));
		return callAction(action,target||'').then(function(r){
			if(!r||!r.ok){btn.disabled=false;dom.content(status,dot('red',_('Не удалось запустить: ')+((r&&r.reason)||'?')));return;}
			var off=0,text='';
			return new Promise(function(resolve){
				function tick(){ callActionLog(off).then(function(x){
					if(x&&x.chunk){text+=x.chunk;log.textContent=text;log.scrollTop=log.scrollHeight;} if(x&&typeof x.offset==='number')off=x.offset;
					if(x&&x.done){btn.disabled=false;dom.content(status,x.exit_code===0?dot('green',_('Операция завершена')):dot('red',_('WARPSCOUT завершился с кодом ')+x.exit_code)); if(x.exit_code===0)window.setTimeout(function(){location.reload();},500); resolve(x);return;} window.setTimeout(tick,1500);
				}).catch(function(){window.setTimeout(tick,2000);}); }
				tick();
			});
		}).catch(function(){btn.disabled=false;dom.content(status,dot('red',_('Ошибка RPC')));});
	},

	handleSave:null, handleSaveApply:null, handleReset:null
});
