'use strict';
'require view';
'require rpc';
'require dom';
'require ui';

var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var callRescueMagazine = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'magazine' });
var callRescueSet = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'set', params:['key','value'] });
var callRescueTrigger = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'trigger' });
var callRescueNext = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'next' });
var callRescueFire = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'fire', params:['endpoint'] });
var callRescueReload = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'reload' });
var callRescueStop = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'stop' });

var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function row(label,val){return E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},label),E('span',{'class':'pb-row-val'},[val])]);}
function pbInjectCss(){if(document.getElementById('pb-css'))return;document.querySelector('head').appendChild(E('link',{'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')}));}
function rescueError(reason){var m={warpscout_disabled:_('WARP Rescue выключен'),not_ready:_('WARPSCOUT или учётная запись WARP ещё не готовы'),controller_busy:_('револьвер уже выполняет другую команду'),qualification_running:_('сейчас выполняется проверка Telegram API'),discovery_running:_('сейчас выполняется поиск WARP-узлов'),runtime_handoff_failed:_('не удалось освободить тестовый WARP SOCKS'),bad_endpoint:_('некорректный WARP-узел'),not_in_magazine:_('этого WARP-узла нет в текущем магазине')};return m[reason]||reason||'?';}
function ago(ts){var n=parseInt(ts||0,10);if(!n)return '—';var s=Math.max(0,Math.floor(Date.now()/1000)-n);if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');}
function magazineLoader(){
	var cells=[];
	for(var i=0;i<6;i++)cells.push(E('span',{'class':'pb-mag-load-cell','style':'animation-delay:'+(i*140)+'ms;'},'■'));
	return E('span',{'class':'pb-mag-load','title':_('Магазин перезаряжается'),'aria-label':_('Магазин перезаряжается')},[E('span',{'class':'pb-mag-load-cells'},cells),E('span',{'class':'pb-mag-load-text'},_('патроны в барабан…'))]);
}

return view.extend({
	loadData:function(){return Promise.all([callWarpStatus('').catch(function(){return null;}),callRescueStatus().catch(function(){return null;}),callRescueMagazine().catch(function(){return {ok:false,items:[]};})]);},
	load:function(){pbInjectCss();return this.loadData();},
	render:function(data){this.root=E('div',{});dom.content(this.root,this.renderBody(data));if(data[1]&&data[1].busy)this.watchOperation();return this.root;},
	refreshView:function(){var self=this;return this.loadData().then(function(d){dom.content(self.root,self.renderBody(d));return d;});},
	watchOperation:function(){var self=this;if(this.watchTimer)window.clearTimeout(this.watchTimer);this.watchTimer=window.setTimeout(function(){self.refreshView().then(function(d){if(d[1]&&d[1].busy)self.watchOperation();});},900);},

	magazineCard:function(mag,rs,actionStatus){
		var self=this,items=(mag&&mag.items)||[];
		if(!items.length)return E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[E('h3',{'style':'margin-top:0;'},_('Магазин')),E('p',{'class':'pb-hint-90'},_('Магазин пуст. Нажмите «Перезарядить»: поиск WARP-узлов → проверка Telegram API → отбор VALID.'))]);
		var body=items.map(function(x){
			var active=x.state==='active',next=x.state==='next';
			var badge=active?dot('green','ON-AIR'):(next?dot('yellow','NEXT'):dot('grey','READY'));
			var fire=E('button',{
				'class':'cbi-button',
				'style':active?'padding:.18em .65em;font-size:82%;min-height:0;background:#33a02c;color:#fff;border-color:#33a02c;':'padding:.18em .65em;font-size:82%;min-height:0;background:#e8a33d;color:#111;border-color:#e8a33d;',
				'disabled':(active||rs.busy)?'disabled':null,
				'click':ui.createHandlerFn(self,function(){
					dom.content(actionStatus,dot('yellow','FIRE · '+x.endpoint+' · '+_('запуск SOCKS → Telegram getMe…')));
					fire.disabled=true;
					return callRescueFire(x.endpoint).then(function(r){
						dom.content(actionStatus,r&&r.ok?dot('yellow',r.already_active?_('Уже ON-AIR'):_('WARP-узел принят · проверяю WARP и Telegram…')):dot('red',_('Ошибка: ')+rescueError(r&&r.reason)));
						if(r&&r.ok)self.watchOperation();else fire.disabled=false;
					}).catch(function(){dom.content(actionStatus,dot('red',_('Ошибка RPC')));fire.disabled=false;});
				})
			},active?'ON-AIR':'FIRE');
			var details=[];
			if(x.node||x.node_location)details.push((x.node||'—')+(x.node_location?(' · '+x.node_location):''));
			if(x.seen_as)details.push(_('выход ') + x.seen_as);
			if(x.tg_latency_ms)details.push(_('Задержка TG ')+x.tg_latency_ms+' мс');
			if(x.endpoint_ping&&x.endpoint_ping!=='?'&&x.endpoint_ping!=='—')details.push(_('Задержка узла ')+x.endpoint_ping);
			if(x.tunnel_ping&&x.tunnel_ping!=='?'&&x.tunnel_ping!=='—')details.push(_('Туннель ')+x.tunnel_ping);
			if(x.loss&&x.loss!=='?')details.push(_('Потери ')+x.loss);
			if(x.checked_at)details.push(ago(x.checked_at));
			return E('div',{'style':'border-top:1px solid rgba(127,127,127,.14);padding:.65em 0;'},[
				E('div',{'style':'display:flex;align-items:center;justify-content:space-between;gap:.8em;flex-wrap:wrap;'},[
					E('div',{'style':'display:flex;align-items:center;gap:.6em;flex-wrap:wrap;'},[E('strong',{},String(x.index||'?')+'. '+(x.endpoint||'—')),badge]),fire
				]),E('div',{'class':'pb-hint-90','style':'margin-top:.25em;'},details.length?details.join(' · '):_('Кандидат WARP со статусом VALID'))
			]);
		});
		return E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[E('h3',{'style':'margin-top:0;'},_('Магазин')),E('p',{'class':'pb-hint-90'},_('Здесь только WARP-узлы, прошедшие проверку Telegram API со статусом VALID. FIRE выбирает конкретный узел и перед ON-AIR ещё раз проверяет Telegram Bot API.')),E('div',{},body)]);
	},

	renderBody:function(data){
		var self=this,st=data[0],rs=data[1]||{},mag=data[2]||{items:[]};
		if(!st||!st.installed)return E('div',{},[E('h2',{},_('Револьвер WARP')),E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[dot('grey',_('WARPSCOUT не установлен')),E('div',{'style':'margin-top:.7em;'},[E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/update')},_('Открыть «Обновление»'))])])]);
		var cfg=st.config||{},enabled=!!cfg.enabled,auto=E('input',{type:'checkbox',checked:rs.auto?'checked':null}),autostart=E('input',{type:'checkbox',checked:rs.autostart?'checked':null}),actionStatus=E('div',{'style':'margin-top:.6em;'});
		function act(call,label,disabled){return E('button',{'class':'cbi-button','disabled':(rs.busy||disabled)?'disabled':null,'click':ui.createHandlerFn(self,function(){dom.content(actionStatus,dot('yellow',label+' · '+_('команда отправлена…')));return call().then(function(r){if(r&&r.ok){dom.content(actionStatus,dot('yellow',label+' · '+_('выполняется…')));self.watchOperation();}else dom.content(actionStatus,dot('red',_('Ошибка: ')+rescueError(r&&r.reason)));}).catch(function(){dom.content(actionStatus,dot('red',_('Ошибка RPC')));});})},label);}
		var powerBtn=E('button',{'class':'cbi-button '+(enabled?'cbi-button-negative':'cbi-button-positive'),'disabled':rs.busy?'disabled':null,'click':ui.createHandlerFn(this,function(){dom.content(actionStatus,dot('yellow',enabled?_('Останавливаю WARP…'):_('Запускаю WARP…')));var p=enabled?callRescueStop():callRescueTrigger();return p.then(function(r){if(r&&r.ok){dom.content(actionStatus,dot('yellow',enabled?_('WARP останавливается…'):_('WARP запускается…')));self.watchOperation();}else dom.content(actionStatus,dot('red',_('Ошибка: ')+rescueError(r&&r.reason)));}).catch(function(){dom.content(actionStatus,dot('red',_('Ошибка RPC')));});})},enabled?_('Остановить WARP'):_('Запустить WARP'));
		var saveAuto=E('button',{'class':'cbi-button cbi-button-apply','disabled':rs.busy?'disabled':null,'click':ui.createHandlerFn(this,function(){return callRescueSet('rescue_auto',auto.checked?'1':'0').then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'write_failed');return callRescueSet('rescue_autostart',autostart.checked?'1':'0');}).then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'write_failed');return self.refreshView();}).catch(function(e){dom.content(actionStatus,dot('red',_('Ошибка настроек автоматики: ')+((e&&e.message)||'?')));});})},_('Применить автоматику'));
		var busyLabel=String(rs.state||_('работает'));
		if(rs.busy&&rs.state==='reloading'){
			var phase={manual:_('открываю барабан · готовлюсь к перезарядке'),discovery:_('ищу патроны · Discovery WARP-узлов'),qualification:_('проверяю капсюли · Telegram API qualification'),building:_('заряжаю магазин · укладываю только VALID')};
			busyLabel=_('Перезарядка')+' · '+(phase[rs.reason]||rs.reason||_('подготовка'));
		}else if(rs.busy&&rs.state==='firing'){
			busyLabel=_('Взвожу курок')+' · '+String(rs.index||0)+' / '+String(rs.total||0)+' · '+_('тестовый отстрел: SOCKS → Telegram getMe');
		}
		var stateNode=rs.running?dot('green',_('работает')):(rs.busy?dot('yellow',busyLabel):dot((rs.state==='exhausted'||rs.state==='reload_failed'||rs.state==='fire_failed')?'red':'grey',enabled?_('не запущен'):String(rs.state||_('остановлен'))));
		var magNode=(rs.total||0)>0?dot('green',_('заряжен · ')+String(rs.total)+_(' VALID WARP-маршрутов')):dot('grey',_('пуст · сначала нужны VALID результаты Telegram API'));
		var position=rs.busy&&rs.state==='reloading'?magazineLoader():E('span',{},String(rs.index||0)+' / '+String(rs.total||0));
		return E('div',{},[
			E('h2',{},_('Револьвер WARP')),
			E('p',{'class':'pb-muted','style':'max-width:820px;'},_('Постоянный резервный WARP SOCKS для Telegram. Использует только WARP-узлы со статусом VALID и работает независимо от открытой страницы LuCI.')),
			E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[
				E('h3',{'style':'margin-top:0;'},_('WARP Rescue')),
				E('p',{'class':'pb-muted'},_('«Перезарядить» выполняет поиск WARP-узлов → проверку Telegram API → сбор магазина → запуск лучшего WARP. «Следующий WARP» переключает Rescue на следующий VALID узел.')),
				row(_('WARP Rescue'),enabled?dot('green',_('включён')):dot('grey',_('выключен'))),row(_('Состояние'),stateNode),row(_('Магазин'),magNode),row(_('Позиция'),position),row(_('Активный WARP-узел'),E('span',{},rs.endpoint||'—')),row(_('SOCKS WARP Rescue'),rs.running?dot('green',(rs.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191)))):E('span',{},rs.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191)))),E('div',{'style':'margin:.8em 0;padding:.7em .8em;border:1px solid rgba(127,127,127,.18);border-radius:8px;'},[
					E('h4',{'style':'margin:.05em 0 .55em;'},_('Автоматика Rescue')),
					row(_('Автозапуск и самовосстановление'),E('label',{'style':'display:inline-flex;align-items:center;gap:.5em;font-weight:600;'},[autostart,E('span',{},_('Включить'))])),
					E('p',{'class':'pb-hint-90','style':'margin:.25em 0 .65em;'},_('Поднимает WARP Rescue после загрузки роутера и восстанавливает SOCKS, если он упал. Ручная кнопка «Остановить WARP» отключает Rescue и запрещает watchdog поднимать его снова.')),
					row(_('Автоперезарядка магазина'),E('label',{'style':'display:inline-flex;align-items:center;gap:.5em;font-weight:600;'},[auto,E('span',{},_('Включить'))])),
					E('p',{'class':'pb-hint-90','style':'margin:.25em 0 0;'},_('Когда сохранённые VALID WARP-узлы исчерпаны, автоматически выполняет новый поиск, Telegram qualification и собирает магазин заново.'))
				]),
				E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;'},[powerBtn,saveAuto,act(callRescueNext,_('Следующий WARP'),!enabled),act(callRescueReload,_('Перезарядить'),false)]),actionStatus
			]),
			this.magazineCard(mag,rs,actionStatus),
			E('div',{'style':'margin-top:.7em;display:flex;gap:.5em;flex-wrap:wrap;'},[E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/settings/warpscout')},_('Расширенные настройки WARP Rescue')),E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/runtime/services')},_('Проверка маршрутов / Telegram API')),E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/update')+'#warpscout-update'},_('Установка / удаление WARPSCOUT'))])
		]);
	},
	handleSave:null,handleSaveApply:null,handleReset:null
});
