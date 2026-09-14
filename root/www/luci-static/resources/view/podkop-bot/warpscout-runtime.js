'use strict';
'require view';
'require rpc';
'require dom';
'require ui';

var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callWarpShortlist = rpc.declare({ object:'podkop_bot_warpscout', method:'shortlist' });
var callWarpRtStatus = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'status' });
var callRescueStatus = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'status' });
var callRescueSet = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'set', params:['key','value'] });
var callRescueTrigger = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'trigger' });
var callRescueNext = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'next' });
var callRescueReload = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'reload' });
var callRescueStop = rpc.declare({ object:'podkop_bot_warpscout_rescue', method:'stop' });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) { return E('span', { 'style':'display:inline-flex;align-items:flex-start;gap:.4em;' }, [E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';' }),E('span', {}, label)]); }
function row(label, valNode) { return E('div', { 'class':'pb-row pb-row--plain' }, [E('span', { 'class':'pb-row-label' }, label),E('span', { 'class':'pb-row-val' }, [ valNode ])]); }
function pbInjectCss() { if (document.getElementById('pb-css')) return; document.querySelector('head').appendChild(E('link', {'id':'pb-css','rel':'stylesheet','type':'text/css','href':L.resource('css/podkop-bot/podkop-bot.css')})); }
function timeoutText(tg) { var ms=parseInt(tg&&tg.latency_ms||0,10), sec=ms>0?(ms/1000).toFixed(1):'5.0'; return _('TIMEOUT')+' · '+((tg&&tg.reason==='connect_timeout')?_('connect timeout'):_('request timeout'))+' · '+sec+' s'; }
function rescueError(reason) {
	var m = {
		warpscout_disabled:_('WARP Rescue выключен в настройках'),
		not_ready:_('WARPSCOUT или account ещё не готовы'),
		controller_busy:_('револьвер уже выполняет другую команду'),
		qualification_running:_('сейчас выполняется TG API Routes'),
		discovery_running:_('сейчас выполняется WARP Discovery'),
		runtime_handoff_failed:_('не удалось освободить тестовый WARP SOCKS')
	};
	return m[reason] || reason || '?';
}

return view.extend({
	loadData:function(){ return Promise.all([callWarpStatus('').catch(function(){return null;}),callWarpShortlist().catch(function(){return null;}),callWarpRtStatus().catch(function(){return null;}),callRescueStatus().catch(function(){return null;})]); },
	load:function(){ pbInjectCss(); return this.loadData(); },
	refreshView:function(){ var self=this; return this.loadData().then(function(d){dom.content(self.root,self.renderBody(d));}); },
	render:function(data){ this.root=E('div',{}); dom.content(this.root,this.renderBody(data)); return this.root; },
	renderBody:function(data){
		var self=this,st=data[0],sl=data[1],rt=data[2],rs=data[3]||{};
		if(!st||!st.installed) return E('div',{},[E('h2',{},_('WARP Status')),E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[dot('grey',_('WARPSCOUT не установлен')),E('div',{'style':'margin-top:.7em;'},[E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/update')},_('Открыть Обновление'))])])]);
		var cfg=st.config||{},active=cfg.active_endpoint||'—',item=st.active_snapshot||null;
		if(!item)(sl&&sl.items||[]).some(function(x){if(x.endpoint===active){item=x;return true;}return false;});
		var tg=rt&&rt.telegram||{},tgNode=dot('grey',_('ещё не проверялся'));
		if(tg.status==='OK')tgNode=dot('green',_('OK')+(tg.http?(' · HTTP '+tg.http):'')+(tg.latency_ms?(' · '+tg.latency_ms+' ms'):''));
		else if(tg.status==='TIMEOUT')tgNode=dot('red',timeoutText(tg));
		else if(tg.status==='RATE_LIMITED')tgNode=dot('yellow',_('Telegram доступен · rate limited (429)'));
		else if(tg.status==='AUTH_ERROR')tgNode=dot('yellow',_('Telegram доступен · auth error (401)'));
		else if(tg.status==='API_DENIED')tgNode=dot('yellow',_('Telegram доступен · API denied (403)'));
		else if(tg.status==='OTHER_API_RESPONSE')tgNode=dot('yellow',_('Telegram отвечает · HTTP ')+(tg.http||'?'));
		else if(tg.status==='NETWORK_FAIL')tgNode=dot('red',_('NETWORK_FAIL')+(tg.curl_rc?(' · curl '+tg.curl_rc):''));
		var checked=item&&item.checked_at?this.ago(parseInt(item.checked_at,10)):'—',tgChecked=tg.checked_at?this.ago(parseInt(tg.checked_at,10)):'—';
		var auto=E('input',{type:'checkbox',checked:rs.auto?'checked':null});
		var actionStatus=E('div',{'style':'margin-top:.6em;'});
		function act(call,label){
			return E('button',{'class':'cbi-button','disabled':rs.busy?'disabled':null,'click':ui.createHandlerFn(self,function(){
				dom.content(actionStatus,dot('yellow',label+'…'));
				return call().then(function(r){
					dom.content(actionStatus,r&&r.ok?dot('green',_('Команда принята — состояние обновится автоматически')):dot('red',_('Ошибка: ')+rescueError(r&&r.reason)));
					window.setTimeout(function(){self.refreshView();},700);
					window.setTimeout(function(){self.refreshView();},3500);
				}).catch(function(){dom.content(actionStatus,dot('red',_('Ошибка RPC')));});
			})},label);
		}
		var saveAuto=E('button',{'class':'cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){return callRescueSet('rescue_auto',auto.checked?'1':'0').then(function(){return self.refreshView();});})},_('Сохранить автоматику'));
		var stateNode=rs.running?dot('green',_('активен')):(rs.busy?dot('yellow',String(rs.state||_('работает'))):dot(rs.state==='exhausted'?'red':'grey',String(rs.state||_('ожидает'))));
		var magNode=(rs.total||0)>0?dot('green',_('заряжен · ')+String(rs.total)+_(' рабочих WARP-маршрутов')):dot('grey',_('пуст · сначала нужны VALID результаты TG API Routes'));
		return E('div',{},[
			E('h2',{},_('WARP Status')),
			E('p',{'class':'pb-muted'},_('Здесь видно, какой WARP сейчас тестируется, и управляется резервный «револьвер». WARPSCOUT сначала находит хорошие WARP-адреса, TG API Routes проверяет, какие из них реально видят Telegram Bot API, а револьвер держит только прошедшие проверку варианты и может быстро переключаться между ними.')),
			E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[
				E('h3',{'style':'margin-top:0;'},_('Текущий WARP для ручных тестов')),
				E('p',{'class':'pb-hint-90'},_('Это временный тестовый туннель. Он нужен для вкладки «Тест сервисов» и не означает, что бот уже переключён на WARP. Когда вы нажимаете Fire/Следующий ниже, Rescue автоматически забирает этот же SOCKS-порт у тестового туннеля.')),
				row(_('WARPSCOUT'),E('span',{},(rt&&rt.version)||st.current||'—')),row(_('Active endpoint'),E('span',{},active)),row(_('Protocol'),E('span',{},String(cfg.protocol||'—').toUpperCase())),row(_('NODE'),E('span',{},item&&item.node||'—')),row(_('NODE LOCATION'),E('span',{},item&&item.node_location||'—')),row(_('SEEN AS'),E('span',{},item&&item.seen_as||'—')),row(_('Endpoint ping'),E('span',{},item&&item.endpoint_ping||'—')),row(_('Tunnel ping / loss'),E('span',{},(item&&item.tunnel_ping||'—')+' / '+(item&&item.loss||'—'))),row(_('Scout data age'),E('span',{},checked)),
				row(_('Test WARP tunnel'),rt&&rt.running?dot('green',_('работает')+(rt.pid?(' · PID '+rt.pid):'')):dot('grey',rt&&rt.state||_('остановлен'))),row(_('Local SOCKS'),E('span',{},rt&&rt.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191)))),row(_('Telegram API'),tgNode),row(_('Telegram test age'),E('span',{},tgChecked))
			]),
			E('div',{'class':'cbi-section pb-card','style':'max-width:820px;'},[
				E('h3',{'style':'margin-top:0;'},_('WARP Rescue — резервный револьвер')),
				E('p',{'class':'pb-muted'},_('Магазин — это список WARP-адресов, которые уже прошли реальный Telegram getMe. Fire запускает лучший доступный вариант. «Следующий» отбрасывает текущий и пробует следующий из магазина. «Перезарядить» заново запускает Discovery, затем TG API Routes и собирает новый магазин.')),
				row(_('Состояние'),stateNode),row(_('Магазин'),magNode),row(_('Позиция'),E('span',{},String(rs.index||0)+' / '+String(rs.total||0))),row(_('Активный WARP endpoint'),E('span',{},rs.endpoint||'—')),row(_('Rescue SOCKS'),E('span',{},rs.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191)))),
				row(_('Автоперезарядка'),auto),
				E('p',{'class':'pb-hint-90'},_('Автоперезарядка означает только одно: если все сохранённые VALID WARP закончились, Rescue один раз сам выполнит Discovery → проверку Telegram → соберёт новый магазин. Автоматическое переключение POLL/FAST бота на WARP пока не включено — это следующий этап после проверки на железе.')),
				E('div',{'style':'display:flex;gap:.5em;flex-wrap:wrap;'},[saveAuto,act(callRescueTrigger,_('Fire · запустить лучший')),act(callRescueNext,_('Следующий WARP')),act(callRescueReload,_('Перезарядить магазин')),act(callRescueStop,_('Стоп'))]),actionStatus,
				E('p',{'class':'pb-hint-90','style':'margin-top:.8em;'},_('OpenWrt Rescue / Bearhole: отдельный аварийный рубильник предусмотрен в backend, но его влияние на маршрутизацию пока не активировано до фиксации точной семантики.'))
			]),
			E('div',{'style':'margin-top:.7em;'},[E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/transport/warpscout')},_('Открыть настройки WARP Rescue')), ' ', E('a',{'class':'cbi-button','href':L.url('admin/services/podkop-bot/runtime/tg-api-routes')},_('Открыть TG API Routes'))])
		]);
	},
	ago:function(ts){var s=Math.floor(Date.now()/1000)-ts;if(s<60)return _('только что');if(s<3600)return Math.floor(s/60)+_(' мин назад');if(s<86400)return Math.floor(s/3600)+_(' ч назад');return Math.floor(s/86400)+_(' дн назад');},
	handleSave:null,handleSaveApply:null,handleReset:null
});
